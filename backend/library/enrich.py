"""Saying what a saved thing is about -- from what it actually says.

This is the half that makes a library worth having rather than a list of links:
a summary, a handful of tags, and the concrete things the text names that you
could go and find again -- a restaurant, a grinder, a book, a recipe.

**It runs on text that exists, or it does not run.** A direct-message share
carries a video and a title and no caption; asking a model what such a reel is
"about" would be inventing from a filename, and the invention would be
indistinguishable from the real thing on the page. So the guard is structural --
`text_source == 'none'` and short text both return before any client is touched,
and a test asserts the model is never called -- rather than an instruction in a
prompt that a later edit could soften.

Everything written here is stored twice, and neither place would do alone. The
columns are what the interface renders without parsing markdown. The item's own
markdown file is what the indexer reads (ADR-0004), which is what puts the
summary and the tags into search -- so "that video about coffee grind" finds a
reel whose transcript never says the phrase.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse

from backend.runtime import availability
from backend.runtime.failures import FailureKind
from backend.runtime.registry import default_chain, resolve

log = logging.getLogger(__name__)

#: Below this a "summary" is a restatement of the title. A one-line caption is
#: not something to be summarised.
MIN_ENRICHABLE_CHARS = 15
MAX_ENRICH_CHARS = 24_000
ENRICH_TIMEOUT = 90.0
#: Nobody is waiting on this, so it walks further than a turn would. The journal's
#: reasoning, unchanged.
BACKGROUND_FALLBACK_LINKS = 4

MAX_TAGS = 3
MAX_RESOURCES = 12

CATEGORIES = ("movie", "travel", "food", "tool", "book", "general")

CANONICAL_TOPICS = (
    "ai",
    "algorithms",
    "programming",
    "tools",
    "design",
    "cinema",
    "streaming",
    "data-science",
    "reading",
    "society",
    "hardware",
    "business",
    "security",
    "science",
)

TOPIC_SYNONYMS: dict[str, str] = {
    # AI & Machine Learning
    "ai": "ai",
    "gpt": "ai",
    "gpt6": "ai",
    "claude": "ai",
    "claude opus": "ai",
    "gemini": "ai",
    "llama": "ai",
    "kimi": "ai",
    "jlm": "ai",
    "glm": "ai",
    "model": "ai",
    "models": "ai",
    "inference": "ai",
    "machine learning": "ai",
    "machine-learning": "ai",
    "generative": "ai",
    "attention": "ai",
    "humanoid robots": "ai",
    "agent router": "ai",
    "bytez": "ai",
    # Algorithms & Data Structures
    "algorithm": "algorithms",
    "algorithms": "algorithms",
    "a*": "algorithms",
    "bfs": "algorithms",
    "dijkstra": "algorithms",
    "binarysearch": "algorithms",
    "pathfinding": "algorithms",
    "heuristic": "algorithms",
    "graph": "algorithms",
    "graph search": "algorithms",
    "optimization": "algorithms",
    # Programming, Software & Open Source
    "coding": "programming",
    "code-editor": "programming",
    "github": "programming",
    "hackathon": "programming",
    "hacker": "programming",
    "local-first": "programming",
    "deployment": "programming",
    "automation": "programming",
    "api": "programming",
    "open-source": "programming",
    "computer science": "programming",
    "software": "programming",
    # Data Science & Retrieval
    "hnsw": "data-science",
    "hybridsearch": "data-science",
    "filteredsearch": "data-science",
    "decision trees": "data-science",
    "linear regression": "data-science",
    "logistic regression": "data-science",
    # Design & UI/UX
    "design": "design",
    "figma": "design",
    "ui": "design",
    "ux": "design",
    # Cinema & Television
    "cinema": "cinema",
    "film": "cinema",
    "films": "cinema",
    "film adaptation": "cinema",
    "movie": "cinema",
    "movies": "cinema",
    "drama": "cinema",
    "romance": "cinema",
    "thriller": "cinema",
    "comedy": "cinema",
    "action": "cinema",
    "character portrait": "cinema",
    "dinnerparty": "cinema",
    "forbidden love": "cinema",
    "coming of age": "cinema",
    "mayday": "cinema",
    "leftovers": "cinema",
    "fable5": "cinema",
    "comet": "cinema",
    "i robot": "cinema",
    "larp": "cinema",
    "series": "cinema",
    "show": "cinema",
    "shows": "cinema",
    "tv": "cinema",
    "television": "cinema",
    "actor": "cinema",
    "actress": "cinema",
    "director": "cinema",
    "trailer": "cinema",
    "anime": "cinema",
    "fiction": "cinema",
    "duy beni": "cinema",
    "proyecto final": "cinema",
    "tearsmith": "cinema",
    "crush": "cinema",
    "archie": "cinema",
    # Streaming
    "netflix": "streaming",
    "amazon prime": "streaming",
    "amazonprimevideo": "streaming",
    "apple tv": "streaming",
    "hbo": "streaming",
    # Tools & Productivity
    "tool": "tools",
    "tools": "tools",
    "desktop": "tools",
    "dictation": "tools",
    "free": "tools",
    "free credits": "tools",
    "cost": "tools",
    "credits": "tools",
    "linkedin": "tools",
    # Reading & Education
    "book": "reading",
    "books": "reading",
    "education": "reading",
    "beginners": "reading",
    # Society & Culture
    "faith": "society",
    "grief": "society",
    "inequality": "society",
    "culture": "society",
    "philosophy": "society",
    # Hardware
    "gpu": "hardware",
}


def canonicalize_tags(tags: list[str] | tuple[str, ...]) -> list[str]:
    """Map raw or ad-hoc tags to normalized canonical topics, capped at MAX_TAGS."""
    cleaned: list[str] = []
    seen: set[str] = set()

    for raw in tags:
        if not raw or not isinstance(raw, str):
            continue
        tag = raw.strip().lower()
        tag = re.sub(r"^#+", "", tag).strip()
        if not tag:
            continue

        canonical = TOPIC_SYNONYMS.get(tag)
        if not canonical:
            if tag.endswith("s") and tag[:-1] in TOPIC_SYNONYMS:
                canonical = TOPIC_SYNONYMS[tag[:-1]]
            elif tag in CANONICAL_TOPICS:
                canonical = tag
            else:
                continue

        if canonical and canonical not in seen:
            seen.add(canonical)
            cleaned.append(canonical)
            if len(cleaned) >= MAX_TAGS:
                break

    # If item has cinema or streaming, remove any accidental 'society' tag
    if ("cinema" in cleaned or "streaming" in cleaned) and "society" in cleaned:
        cleaned.remove("society")

    return cleaned


RESOURCE_TYPES = (
    "movie",
    "show",
    "travel",
    "destination",
    "food",
    "restaurant",
    "cafe",
    "recipe",
    "tool",
    "product",
    "book",
    "place",
    "person",
    "link",
    "other",
)

#: Text sources that are somebody's actual words. Anything else cannot be
#: enriched, by definition.
REAL_TEXT_SOURCES = (
    "caption",
    "transcript",
    "caption and transcript",
    "visual content",
    "caption and visual content",
    "slide analysis",
    "caption and slide analysis",
    "page",
    "notes",
    "description",
    "video description",
)

PROMPT = """\
You are describing one thing the user saved, using only the text below.

Reply with JSON and nothing else:

{"category": "movie|travel|food|tool|book|general",
 "summary": "...",
 "tags": ["..."],
 "resources": [{"type": "...", "name": "...", "detail": "...", "url": "..."}]}

Rules:
- category: one of movie|travel|food|tool|book|general. Pick:
  - "movie" for films, cinema, tv shows, series, anime, documentaries, streaming watchlists, clips or reels discussing movies/shows/actors/characters. NEVER mark movies, films, or series as "general" or "society".
  - "travel" for travel spots, vacation destinations, cities, sights, trip itineraries.
  - "food" for restaurants, cafes, street food, dishes to try, recipes, dining spots.
  - "tool" for software, developer tools, AI apps, SaaS, hardware, tech utilities.
  - "book" for books, reading lists, literature, papers.
  - "general" for other topics only when none of the above fit.
- summary: two to four sentences on what this is about, in plain language. No preamble, no "this video discusses".
- tags: two to three lowercase canonical topic words (e.g. ai, algorithms, programming, tools, design, cinema, streaming, data-science, reading). For any movies, series, shows, actors, or films, always use "cinema" or "streaming" as the primary tag -- NEVER tag movies or entertainment with "society".
- resources: concrete named things the text names that the user could go and find or watch:
  - movie/show: title, platform/genre, why to watch.
  - travel/destination: city/country, spot name, best to visit.
  - food/restaurant/cafe/recipe: dish name, restaurant/cafe, cuisine.
  - tool/product: app name, utility, hardware.
  - book: title, author.
  - place/person/link/other.
  `type` must be one of movie|show|travel|destination|food|restaurant|cafe|\
recipe|tool|product|book|place|person|link|other.
  `detail` is key information in ten words or fewer. For `url`, provide the direct link from the text or the official tool/service domain (e.g. "chatgpt.com", "github.com"). For movies/shows, url may be omitted.
- An empty list is the right answer when the text names nothing. Padding a list \
with things that were not mentioned is the main failure mode here.
- If the text is too thin to say anything true about, reply \
{"category": "general", "summary": null, "tags": [], "resources": []}."""


def infer_category(
    resources: list[dict] | tuple[dict, ...],
    tags: list[str] | tuple[str, ...],
    kind: str = "",
) -> str:
    """Derive primary category from resources, details, tags, or item kind.

    Ordered by how strongly each source says it: a resource's own `type`
    beats a word in its detail, which beats a tag, which beats the item's
    kind. Plain sets and membership rather than cleverness, because this
    runs on every library read (`as_dict`) and must never be the reason one
    is slow.
    """
    # (category, resource types, words looked for in the detail)
    by_resource = (
        ("movie", ("movie", "show", "film", "series"),
         ("film", "movie", "cinema", "tv series", "series", "documentary", "actor", "premiere", "character")),
        ("travel", ("travel", "destination", "spot"),
         ("destination", "hotel", "visit", "trip", "city", "tourist")),
        ("food", ("food", "restaurant", "cafe", "recipe", "dish"),
         ("restaurant", "cafe", "recipe", "dish", "cuisine", "food")),
        ("tool", ("tool",), ("software", "app", "tool", "saas", "platform")),
        ("book", ("book",), ("book", "novel", "author")),
    )
    for r in resources:
        rtype = str(r.get("type") or "").lower()
        detail = str(r.get("detail") or "").lower()
        for category, types, words in by_resource:
            if rtype in types or any(w in detail for w in words):
                return category

    # (category, tags)
    by_tag = (
        ("movie", ("movie", "movies", "film", "films", "cinema", "netflix",
                   "series", "tv", "show", "shows", "science fiction", "fiction", "crush", "drama", "thriller", "comedy", "action", "romance", "archie")),
        ("travel", ("travel", "destination", "trip", "hotel", "explore",
                    "vacation", "tourism", "city", "places")),
        ("food", ("food", "restaurant", "cafe", "recipe", "dining", "dish",
                  "cooking", "dessert", "coffee")),
        ("tool", ("tool", "tools", "software", "ai", "saas", "tech", "app",
                  "startup", "code")),
        ("book", ("book", "books", "reading", "author", "paper", "literature")),
    )
    tag_set = {t.lower() for t in tags}
    for category, wanted in by_tag:
        if any(t in tag_set for t in wanted):
            return category

    if kind == "book":
        return "book"
    return "general"


@dataclass(frozen=True)
class Enrichment:
    category: str = "general"
    summary: str | None = None
    tags: tuple[str, ...] = ()
    resources: tuple[dict, ...] = ()
    #: Why there is nothing, when there is nothing. Never prose, always a reason.
    note: str | None = None
    provider: str | None = None
    model: str | None = None

    @property
    def empty(self) -> bool:
        return not (self.summary or self.tags or self.resources)


def _clean_tag(value: object) -> str | None:
    tag = re.sub(r"\s+", " ", str(value or "")).strip().lower()[:40]
    return tag or None


URL_PATTERN = re.compile(
    r'(?i)\b(?:https?://[^\s<>"\'\)\]]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|ai|app|co|dev|me|tt|tv|so|xyz|tech|info|biz|site|online|cloud|design|store|link|gl|it|to|is|gg|ly|fm)(?:/[^\s<>"\'\)\]]*)?)'
)


def normalize_url(raw: str) -> str:
    """Normalize a raw string or domain into a proper, clickable http(s) URL."""
    if not raw or not isinstance(raw, str):
        return ""
    url = raw.strip()
    url = re.sub(r'^[<(\["\']+', "", url)
    url = re.sub(r'[>)"\'\].,;:!?]+$', "", url)
    if not url:
        return ""
    if " " in url:
        # Check if a valid URL is embedded inside text (e.g. mobile share sheets)
        match = URL_PATTERN.search(url)
        if match:
            url = match.group(0)
            url = re.sub(r'^[<(\["\']+', "", url)
            url = re.sub(r'[>)"\'\].,;:!?]+$', "", url)
        else:
            return ""
    if not re.match(r"^https?://", url, re.I):
        url = f"https://{url}"
    try:
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https") and parsed.netloc and "." in parsed.netloc:
            host = parsed.netloc.split(":")[0]
            parts = host.split(".")
            if len(parts) >= 2 and len(parts[-1]) >= 2 and not parts[-1].isdigit():
                return url
    except Exception:
        pass
    return ""


def extract_urls(text: str) -> list[str]:
    """Extract all distinct clickable URLs visibly present in text."""
    if not text:
        return []
    urls: list[str] = []
    seen: set[str] = set()
    for m in URL_PATTERN.finditer(text):
        norm = normalize_url(m.group(0))
        if norm and norm.lower() not in seen:
            seen.add(norm.lower())
            urls.append(norm)
    return urls


KNOWN_TOOL_URLS = {
    "chatgpt": "https://chatgpt.com",
    "chat gpt": "https://chatgpt.com",
    "openai": "https://openai.com",
    "claude": "https://claude.ai",
    "anthropic": "https://anthropic.com",
    "gemini": "https://gemini.google.com",
    "google gemini": "https://gemini.google.com",
    "copilot": "https://copilot.microsoft.com",
    "cursor": "https://cursor.com",
    "github": "https://github.com",
    "midjourney": "https://midjourney.com",
    "perplexity": "https://perplexity.ai",
    "huggingface": "https://huggingface.co",
    "hugging face": "https://huggingface.co",
    "replicate": "https://replicate.com",
    "ollama": "https://ollama.com",
    "runway": "https://runwayml.com",
    "suno": "https://suno.com",
    "elevenlabs": "https://elevenlabs.io",
    "figma": "https://figma.com",
    "notion": "https://notion.so",
    "linear": "https://linear.app",
    "raycast": "https://raycast.com",
    "v0": "https://v0.dev",
    "bolt": "https://bolt.new",
    "replit": "https://replit.com",
    "playtracker": "https://playtracker.net",
    "supabase": "https://supabase.com",
    "vercel": "https://vercel.com",
    "docker": "https://docker.com",
    "obsidian": "https://obsidian.md",
    "tailwind": "https://tailwindcss.com",
    "nextjs": "https://nextjs.org",
    "react": "https://react.dev",
    "vue": "https://vuejs.org",
    "python": "https://python.org",
    "rust": "https://rust-lang.org",
    "postgresql": "https://postgresql.org",
    "slack": "https://slack.com",
    "discord": "https://discord.com",
    "spotify": "https://spotify.com",
    "netflix": "https://netflix.com",
    "youtube": "https://youtube.com",
}


def resolve_entity_url(name: str, kind: str) -> str:
    """Resolve a missing entity URL to an authoritative platform link.

    Covers movies/shows (TMDB), books (Goodreads), places/food (Google Maps),
    music (Spotify), code/repos (GitHub), known tools (official domain), and general (Google).
    """
    from urllib.parse import quote_plus

    q = quote_plus(name.strip())
    name_clean = re.sub(r"[^a-z0-9]", "", name.lower())

    for tool_key, tool_url in KNOWN_TOOL_URLS.items():
        if name_clean == re.sub(r"[^a-z0-9]", "", tool_key):
            return tool_url

    if kind in ("movie", "show", "film", "series", "tv", "cinema"):
        return f"https://www.themoviedb.org/search?query={q}"
    if kind in ("book", "novel", "reading", "author"):
        return f"https://www.goodreads.com/search?q={q}"
    if kind in ("place", "restaurant", "cafe", "food", "travel", "destination", "hotel"):
        return f"https://www.google.com/maps/search/?api=1&query={q}"
    if kind in ("music", "song", "artist", "album", "audio", "track", "podcast"):
        return f"https://open.spotify.com/search/{q}"
    if kind in ("code", "repo", "library", "framework", "package", "github"):
        return f"https://github.com/search?q={q}"

    return f"https://www.google.com/search?q={q}"


def _clean_resource(entry: object, text_urls: list[str] | None = None) -> dict | None:
    if not isinstance(entry, dict):
        return None
    name = str(entry.get("name") or "").strip()[:120]
    if not name:
        return None
    kind = str(entry.get("type") or "other").strip().lower()
    raw_url = str(entry.get("url") or "").strip()

    normalized = normalize_url(raw_url)

    # If url was display text (e.g. "Dust", "Relay") or empty, see if a matching
    # URL exists in the source text
    if not normalized and text_urls:
        name_lower = re.sub(r"[^a-z0-9]", "", name.lower())
        for u in text_urls:
            host = (urlparse(u).hostname or "").lower()
            host_clean = re.sub(r"[^a-z0-9]", "", host)
            if name_lower and (name_lower in host_clean or host_clean in name_lower):
                normalized = u
                break

    # If the model didn't provide a URL, auto-resolve to an authoritative platform link.
    # If the model explicitly hallucinated prose (e.g. "probably somewhere in Bristol"),
    # drop it unless it matches a known tool name.
    if not normalized:
        if not raw_url:
            normalized = resolve_entity_url(name, kind)
        else:
            name_clean = re.sub(r"[^a-z0-9]", "", raw_url.lower())
            for tool_key, tool_url in KNOWN_TOOL_URLS.items():
                if name_clean == re.sub(r"[^a-z0-9]", "", tool_key):
                    normalized = tool_url
                    break

    return {
        "type": kind if kind in RESOURCE_TYPES else "other",
        "name": name,
        "detail": str(entry.get("detail") or "").strip()[:200],
        "url": normalized,
    }


def parse_enrichment(text: str, source_text: str = "") -> Enrichment | None:
    """Read the model's reply, keeping only what is the right shape."""
    body = (text or "").strip()
    if not body:
        return None
    if body.startswith("```"):
        body = re.sub(r"^```[a-z]*\s*", "", body)
        body = re.sub(r"\s*```$", "", body)
    if not body.startswith("{"):
        start, end = body.find("{"), body.rfind("}")
        if start == -1 or end <= start:
            return None
        body = body[start : end + 1]

    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    summary = data.get("summary")
    summary = str(summary).strip() if isinstance(summary, str) and summary.strip() else None

    tags = []
    for value in data.get("tags") or []:
        tag = _clean_tag(value)
        if tag and tag not in tags:
            tags.append(tag)

    text_urls = extract_urls(source_text) if source_text else []

    resources = []
    seen_urls: set[str] = set()
    for entry in data.get("resources") or []:
        cleaned = _clean_resource(entry, text_urls=text_urls)
        if cleaned:
            resources.append(cleaned)
            if cleaned["url"]:
                seen_urls.add(cleaned["url"].lower())

    # Any URL visibly present in the source content that was not already captured
    # should be added as an extracted link resource.
    for u in text_urls:
        if u.lower() not in seen_urls and len(resources) < MAX_RESOURCES:
            host = (urlparse(u).hostname or u).lower()
            link_name = host.removeprefix("www.")
            resources.append({
                "type": "link",
                "name": link_name,
                "detail": "Link from content",
                "url": u,
            })
            seen_urls.add(u.lower())

    raw_cat = str(data.get("category") or "").strip().lower()
    category = raw_cat if raw_cat in CATEGORIES and raw_cat != "general" else infer_category(resources, tags)
    if category == "general":
        category = infer_category(resources, tags)

    canonical_tags = canonicalize_tags(tags)
    if not canonical_tags and tags:
        canonical_tags = tags[:MAX_TAGS]

    return Enrichment(
        category=category,
        summary=summary,
        tags=tuple(canonical_tags[:MAX_TAGS]),
        resources=tuple(resources[:MAX_RESOURCES]),
    )


def _refusal(text: str, text_source: str | None) -> str | None:
    """The reason not to ask a model, when there is one."""
    if (text_source or "none") not in REAL_TEXT_SOURCES:
        return (
            "there is no text for this one. A direct-message share carries the video"
            " and a title, and no caption -- nothing was summarised because there"
            " would have been nothing to summarise from."
        )
    if len(text.strip()) < MIN_ENRICHABLE_CHARS:
        return (
            "the text is a line or two, which is already the whole of it. Summarising"
            " it would just be repeating it."
        )
    return None


async def enrich_text(
    text: str, *, title: str, kind: str = "video", text_source: str = "none", client=None
) -> Enrichment:
    """Summary, tags and resources for some text -- or a stated reason there are none."""
    refusal = _refusal(text, text_source)
    if refusal:
        # Returns before any client is resolved. This is the guard, and it is
        # structural on purpose: a prompt can be edited, a return cannot.
        return Enrichment(note=refusal)

    body = text.strip()[:MAX_ENRICH_CHARS]
    if len(text.strip()) > MAX_ENRICH_CHARS:
        body += "\n…(cut off)"
    messages = [
        {"role": "system", "content": PROMPT},
        {
            "role": "user",
            # The source is named because a whisper transcript has no reliable
            # punctuation and the model should know it is reading speech.
            "content": (
                f"<title>{title}</title>\n<kind>{kind}</kind>\n"
                f"<source>{text_source}</source>\n<text>\n{body}\n</text>"
            ),
        },
    ]

    if client is not None:
        return await _ask(client, messages, None, None, source_text=body)

    links = default_chain(limit=BACKGROUND_FALLBACK_LINKS)
    if not links:
        return Enrichment(
            note="no model is configured, so there is no summary. The text above is"
            " what was actually said."
        )

    last: Enrichment | None = None
    for link in links:
        try:
            model = resolve(link.provider, link.model)
        except Exception as exc:
            last = Enrichment(note=f"{link.provider} could not be resolved: {exc}")
            continue
        result = await _ask(model.client, messages, link.provider, link.model, source_text=body)
        if not result.empty:
            availability.record_success(link.provider)
            return result
        last = result

    tried = ", ".join(str(link) for link in links)
    reason = last.note if last and last.note else "nothing came back"
    return Enrichment(note=f"none of the configured providers answered ({tried}). {reason}")


async def _ask(
    client, messages: list[dict], provider: str | None, model: str | None, source_text: str = ""
) -> Enrichment:
    try:
        response = await asyncio.wait_for(
            client.complete(messages, tools=None), timeout=ENRICH_TIMEOUT
        )
    except TimeoutError:
        late = f"{provider or 'the model'} did not answer within {ENRICH_TIMEOUT:.0f}s"
        if provider:
            availability.record_failure(provider, FailureKind.RETRYABLE, late)
        return Enrichment(note=late)
    except Exception as exc:
        log.warning("enrichment failed on %s: %s", provider or "the model", exc)
        if provider:
            availability.record_failure(
                provider, getattr(exc, "kind", FailureKind.RETRYABLE), str(exc)
            )
        return Enrichment(note=f"{provider or 'the model'} could not be reached: {exc}")

    parsed = parse_enrichment(response.text or "", source_text=source_text)
    if parsed is None:
        return Enrichment(
            note="the model did not answer in the expected format", provider=provider, model=model
        )
    return Enrichment(
        summary=parsed.summary,
        tags=parsed.tags,
        resources=parsed.resources,
        provider=provider,
        model=model,
    )


def render_markdown(
    *,
    title: str,
    body: str,
    body_heading: str = "Text",
    enrichment: Enrichment | None = None,
    capture_note: str | None = None,
) -> str:
    """The item's file: what the model wrote, then what was actually said.

    The `## {body_heading}` heading and the provenance footer are the honesty
    rule expressed in the artefact rather than only in a database column -- a
    reader can always tell which words are the source's and which are not.
    """
    out = [f"# {title}", ""]
    enrichment = enrichment or Enrichment()

    if enrichment.summary:
        out += [enrichment.summary, ""]
    if enrichment.tags:
        out += [f"Tags: {', '.join(enrichment.tags)}", ""]
    if enrichment.resources:
        out.append("## Mentioned")
        for item in enrichment.resources:
            line = f"- {item['type']} — {item['name']}"
            if item.get("detail"):
                line += f": {item['detail']}"
            if item.get("url"):
                line += f" ({item['url']})"
            out.append(line)
        out.append("")

    if body.strip():
        out += [f"## {body_heading}", "", body.strip(), ""]
    elif capture_note:
        out += [f"_{capture_note}_", ""]

    if enrichment.summary or enrichment.tags or enrichment.resources:
        source = enrichment.model or "a model"
        provider = f"{enrichment.provider}:{source}" if enrichment.provider else source
        out += [
            "---",
            f"_Summary, tags and the list above were written by {provider} from the"
            f" {body_heading.lower()}. The {body_heading.lower()} is what was said._",
        ]
    elif enrichment.note:
        out += ["---", f"_{enrichment.note}_"]

    return "\n".join(out).rstrip() + "\n"


#: The headings `render_markdown` writes a body under. Knowing them is what lets
#: the source text be read back out of a file that has already been enriched --
#: without it, re-enriching would summarise the previous summary.
BODY_HEADINGS = ("Transcript", "Caption", "Caption and Transcript", "Text", "Notes")

_HEADING = re.compile(rf"^## ({'|'.join(BODY_HEADINGS)})\s*$", re.MULTILINE)


def body_of(markdown: str) -> tuple[str, str]:
    """The source text out of an item's file, and which heading it sat under.

    `render_markdown` is the only writer of these files, so this is a parse of a
    format we control rather than a guess at someone else's.
    """
    text = markdown or ""
    match = _HEADING.search(text)
    if match:
        body = text[match.end() :]
        # Everything up to the provenance rule, which is the last thing written.
        cut = body.rfind("\n---\n")
        if cut != -1:
            body = body[:cut]
        return body.strip(), match.group(1)

    # Never enriched: the file is a title and then the text.
    lines = text.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    return "\n".join(lines).strip(), "Text"


def stamp() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")
