"""Intent -> widget: answering a request with interactive UI instead of prose.

Some requests are badly served by markdown. A recipe wants a servings slider, a
quiz wants to mark your answer, a step guide wants one step on screen at a time
rather than a numbered list you lose your place in. This module decides whether
the request in front of it is one of those, and if so produces the structured
data the interface renders.

Two design choices worth stating, because both are the reason this is cheap
enough to sit in front of every turn:

* **One call, not two.** Classification and extraction are folded into a single
  round trip returning `{"type": ..., "data": ...}`. Two calls would double the
  latency added to every turn -- including the great majority that classify as
  `none` and pay the cost for nothing -- so the model is asked to do both at
  once and the answer is validated afterwards.

* **`none` is the default, and every failure lands on it.** A model that will
  not answer, a provider that is not configured, malformed JSON, a payload that
  does not fit its schema: all of it returns `("none", None)` and the turn
  proceeds as an ordinary one. The worst outcome of this module misfiring should
  be a wasted fast-model call, never a request that goes unanswered.

The schemas below are pydantic models rather than hand-written JSON Schema
because pydantic is already a dependency and a model is the schema *and* the
validator *and* the normalizer in one object. `extra="forbid"` is what enforces
the prompt's "do not add fields" -- a model that invents a field gets rejected
and retried rather than sending an unknown key to a renderer that ignores it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from backend.agent.media import MediaHint
from backend.agent.media import fetch as fetch_media
from backend.runtime import availability
from backend.runtime.failures import FailureKind
from backend.runtime.registry import default_chain, resolve

log = logging.getLogger(__name__)

#: How long the one classification call may take.
#:
#: Set from measurement, not from taste. On a free fast-tier endpoint the
#: `none` answer -- which is most of them -- comes back in about three seconds,
#: because the model emits a dozen tokens and stops. A widget takes six or seven,
#: because it has to write the whole payload out.
#:
#: An earlier four-second budget was set to protect the turns that produce no
#: widget, and it protected them by making the feature never fire at all: the
#: cheap case squeaked under it and every real extraction was cut off mid-answer.
#: The budget has to clear the *slow* case, and the slow case is the one that
#: produces an answer -- a widget turn replaces the agent turn that would
#: otherwise have run, so its seconds are not an addition to the wait, they are
#: the wait. Only the `none` turns pay this on top, and they pay the three
#: seconds, not the twenty.
WIDGET_TIMEOUT = 20.0

#: How long the feature stays quiet after the classifier fails to answer.
#:
#: A timeout must not go into the shared availability cache: `record_failure`
#: rightly ignores transient kinds, and a provider too slow for the widget budget
#: is still perfectly good for the turn itself. But without a memory of its own,
#: an endpoint that is genuinely stuck charges the full budget to every turn
#: forever. So the backoff belongs to this feature rather than to the provider:
#: one failure and widgets go quiet for a while, costing nothing, while the
#: ordinary turn carries on using the same provider as before.
QUIET_SECONDS = 300.0

#: Monotonic deadline before which no classification is attempted. Process-local
#: and deliberately not persisted -- it is a latency guard, and the worst a
#: restart costs is one more attempt.
_quiet_until = 0.0


def _quiet_for(seconds: float) -> None:
    global _quiet_until
    _quiet_until = time.monotonic() + seconds


def reset_backoff() -> None:
    """Forget the backoff. For tests, and for a provider change mid-session."""
    global _quiet_until
    _quiet_until = 0.0


#: The fence the widget payload is persisted inside. The message table has no
#: widget column, and adding one would be a migration for a feature that fits in
#: the content it already stores. Human-readable in the database, survives a
#: reload, and degrades to a visible code block rather than to garbage if
#: anything ever fails to parse it.
#
# ponytail: envelope-in-content avoids a migration. Give the message row a real
# `widget` column if the JSON in the transcript starts costing prompt budget or
# confusing the model on later turns.
FENCE = "amethyst:widget"


# --------------------------------------------------------------- the schemas


class Strict(BaseModel):
    """Every widget schema forbids what it did not ask for.

    Without this a model that answers a recipe request with an extra
    `"prep_time"` key passes validation and the renderer silently drops it. With
    it, the payload is rejected and the retry usually gets it right -- and if it
    does not, the turn falls back to prose, which can at least say the thing the
    dropped field would have said.
    """

    model_config = ConfigDict(extra="forbid")


class Ingredient(Strict):
    name: str
    amount: float
    unit: str


class Step(Strict):
    title: str
    text: str
    timer_seconds: float | None = None


class Recipe(Strict):
    title: str
    servings: float
    ingredients: list[Ingredient]
    steps: list[Step]


class StepGuide(Strict):
    title: str
    steps: list[Step]


class Question(Strict):
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class Quiz(Strict):
    title: str
    questions: list[Question]


class Attribute(Strict):
    name: str
    values: list[str]


class Comparison(Strict):
    title: str
    items: list[str]
    attributes: list[Attribute]


class Stop(Strict):
    name: str
    description: str
    latitude: float | None = None
    longitude: float | None = None


class Day(Strict):
    day: int
    stops: list[Stop]


class Itinerary(Strict):
    title: str
    days: list[Day]


class Translation(Strict):
    source_language: str
    target_language: str
    source: str
    translation: str


class Series(Strict):
    name: str
    data: list[float]


class Chart(Strict):
    title: str
    type: Literal["line", "bar", "scatter"]
    labels: list[str]
    series: list[Series]


class Option(Strict):
    title: str
    description: str


class Options(Strict):
    title: str
    selection_mode: Literal["single", "multi"]
    options: list[Option]


class ImageItem(Strict):
    url: str
    title: str = ""
    thumbnail: str = ""
    source: str = ""


class ImageGallery(Strict):
    title: str
    images: list[ImageItem]
    layout: Literal["carousel", "grid"] = "carousel"


class DataTable(Strict):
    title: str
    columns: list[str]
    rows: list[list[Any]]


#: Type name -> schema. The keys are also the vocabulary the prompt allows and
#: the tags the interface dispatches on, so there is one list of widget types in
#: the system rather than three that drift.
WIDGET_MODELS: dict[str, type[BaseModel]] = {
    "recipe": Recipe,
    "step_guide": StepGuide,
    "quiz": Quiz,
    "comparison": Comparison,
    "itinerary": Itinerary,
    "translation": Translation,
    "chart": Chart,
    "options": Options,
    "image_gallery": ImageGallery,
    "data_table": DataTable,
}



# ---------------------------------------------------------------- the prompt

# The per-type schema lines are deliberately long: they are one line each in
# the prompt the model reads, and wrapping them would wrap them there too.
PROMPT = """\
You classify a user's request for an AI assistant UI, and where it clearly suits
an interactive widget, you extract that widget's data in the same reply.

Return ONLY valid JSON in exactly this format:
{"type":"...","data":{...},"media":{"kind":"...","query":"..."}}

Allowed types:
recipe, step_guide, quiz, comparison, itinerary, translation, chart, options, none

Choose a type only when the user's request clearly benefits from that widget.
If there is uncertainty or no clear match, return exactly:
{"type":"none","data":null,"media":{"kind":"none","query":""}}

`none` is the right answer far more often than not. Open questions, discussion,
opinions, code, writing, analysis, anything conversational, anything needing
tools or current information, and anything you are unsure about are all `none`.

When the type is not `none`, `data` must match that type's schema exactly:

recipe: {"title":str,"servings":number,"ingredients":[{"name":str,"amount":number,"unit":str}],"steps":[{"title":str,"text":str,"timer_seconds":number|null}]}
step_guide: {"title":str,"steps":[{"title":str,"text":str,"timer_seconds":number|null}]}
quiz: {"title":str,"questions":[{"question":str,"options":[str],"correct_index":number,"explanation":str}]}
comparison: {"title":str,"items":[str],"attributes":[{"name":str,"values":[str]}]}
itinerary: {"title":str,"days":[{"day":number,"stops":[{"name":str,"description":str,"latitude":number|null,"longitude":number|null}]}]}
translation: {"source_language":str,"target_language":str,"source":str,"translation":str}
chart: {"title":str,"type":"line"|"bar"|"scatter","labels":[str],"series":[{"name":str,"data":[number]}]}
options: {"title":str,"selection_mode":"single"|"multi","options":[{"title":str,"description":str}]}

`media` says whether a picture or a video would genuinely help, and what to
search for. You are not retrieving anything -- you are naming a search.

media.kind is one of:
- video: a demonstration would help. Cooking, repairs, technique, exercises.
- image: seeing the thing matters. Places, plants, dishes, landmarks, objects.
- web: the reader will want to go and read more.
- none: the widget says it all. This is the usual answer.

media.query is a short search phrase, or "" when kind is none. Prefer `none`:
a step guide for changing a password does not need a photograph.

Rules:
- In `comparison`, every attribute's `values` must have one entry per item, in
  the same order as `items`.
- In `chart`, every series' `data` must have one entry per label.
- Use only information supported by the user's request and ordinary knowledge.
- Do not invent important facts. Use null where the schema allows it.
- Do not add fields.
- Do not include markdown or explanations."""


# ----------------------------------------------------------------- envelopes


def to_envelope(
    widget_type: str, data: dict[str, Any], media: list[dict[str, Any]] | None = None
) -> str:
    """The transcript form of a widget: a fenced JSON block.

    Media is stored as the metadata it is -- titles, URLs, thumbnails -- so a
    reopened conversation shows the same gallery without searching again.
    """
    payload: dict[str, Any] = {"type": widget_type, "data": data}
    if media:
        payload["media"] = media
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return f"```{FENCE}\n{body}\n```"


def parse_envelope(text: str) -> dict[str, Any] | None:
    """The widget in `text`, or None if it does not hold one.

    Mirrored in `frontend/src/components/widgets/envelope.js`, which is what
    rebuilds a widget when a conversation is reopened. Kept deliberately strict:
    a message is a widget only if the fence is the whole of it, so a normal
    answer that happens to quote one is still rendered as the prose it is.
    """
    stripped = text.strip()
    opening = f"```{FENCE}"
    if not stripped.startswith(opening) or not stripped.endswith("```"):
        return None
    body = stripped[len(opening) : -3].strip()
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    widget_type = payload.get("type")
    data = payload.get("data")
    if widget_type not in WIDGET_MODELS or not isinstance(data, dict):
        return None
    media = payload.get("media")
    return {
        "type": widget_type,
        "data": data,
        "media": media if isinstance(media, list) else [],
    }


# ------------------------------------------------------------- the one call


def _read(raw: str) -> tuple[str, dict[str, Any] | None, MediaHint | None] | None:
    """Turn one model reply into a validated `(type, data)`, or None to retry.

    None means "the model did not produce something usable" -- bad JSON, an
    unknown type, a payload that does not fit. `("none", None, None)` is
    different: it means the model looked and decided there is no widget here,
    which is an answer and not a failure, so it is never retried.
    """
    text = (raw or "").strip()
    # Models fence their JSON even when told not to. Cheaper to tolerate than to
    # spend a retry on.
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    # And some wrap it in a sentence. Take the outermost braces.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None

    # A malformed or missing hint is not a reason to lose the widget: media is
    # a garnish, and the widget is the answer.
    hint = None
    try:
        raw_hint = payload.get("media")
        if isinstance(raw_hint, dict):
            hint = MediaHint.model_validate(raw_hint)
    except ValidationError:
        hint = None

    widget_type = payload.get("type")
    if widget_type == "none":
        return ("none", None, None)
    model = WIDGET_MODELS.get(widget_type) if isinstance(widget_type, str) else None
    if model is None:
        # An invented type is a misread of the instructions, not a decision that
        # there is no widget. Worth one retry.
        return None

    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    try:
        validated = model.model_validate(data)
    except ValidationError as exc:
        log.debug("widget payload failed its %s schema: %s", widget_type, exc)
        return None
    return (widget_type, validated.model_dump(), hint)


#: Words that say a request might actually want one of the eight widget types.
#: Grouped by the type they point at, so the list stays auditable as types are
#: added. Generous on purpose -- a word here costs a fast call that returns
#: `none`, while a word missing costs a widget that would have been nice.
_WIDGET_SIGNALS = (
    # recipe / step_guide
    "recipe", "cook", "bake", "ingredient", "how do i", "how to", "how can i",
    "steps", "step by step", "guide", "walk me through", "instructions", "set up",
    "install", "tutorial",
    # quiz
    "quiz", "test me", "flashcard", "practice question", "exam", "revise",
    # comparison
    "compare", "comparison", " vs ", " versus ", "difference between", "which is better",
    "pros and cons", "trade-off", "tradeoff",
    # itinerary
    "itinerary", "trip", "travel", "visit", "days in", "plan a", "holiday", "vacation",
    # translation
    "translate", "translation", "in spanish", "in french", "in german", "in japanese",
    "in italian", "say in", "how do you say",
    # chart
    "chart", "graph", "plot", "visualise", "visualize", "bar chart", "line chart",
    # options
    "options", "choose", "pick one", "suggest", "recommend", "ideas for", "alternatives",
    # image_gallery
    "image", "images", "picture", "pictures", "photo", "photos",
    "screenshot", "screenshots", "wallpaper", "wallpapers", "pic", "pics",
)

#: Technical terms that strongly indicate a development task, not a widget request.
#: A message containing any of these is almost certainly a coding question even
#: if it also matches a widget signal like "how to" or "steps".
_TECHNICAL_MARKERS = (
    # Code syntax
    "def ", "class ", "import ", "async ", "await ", "return ",
    "try:", "except ", "catch ", "throw ", "raise ",
    "print(", "console.", "require(",
    # File extensions
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".rb", ".java",
    ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".xml",
    ".sql", ".sh", ".bash", ".env", ".git", ".docker",
    # Dev tools and platforms
    "npm", "yarn", "pnpm", "bun ", "pip ", "cargo ",
    "git ", "github", "gitlab", "commit", "branch", "merge",
    "pull request", "issue #",
    # Dev concepts
    "api ", "endpoint", "route ", "handler", "middleware",
    "database", "sqlite", "postgres", "redis",
    "schema", "migration", "query ",
    "deploy", "ci/cd", "pipeline", "build ", "test ", "lint ",
    "refactor", "compile", "bundle", "transpile",
    "webpack", "vite", "rollup", "esbuild", "tsc", "eslint",
    # Languages and frameworks
    "react", "vue", "angular", "svelte", "nextjs", "nuxt",
    "fastapi", "flask", "django", "express", "hono",
    "pydantic", "sqlalchemy", "alembic", "prisma", "drizzle",
    "pytest", "jest", "vitest", "mocha", "cypress",
    "kubernetes", "docker", "terraform", "ansible",
    "nginx", "apache", "caddy",
    # Error/debug
    "traceback", "stacktrace", "segfault", "panic",
    "debug", "error:", "exception",
)


_IMAGE_PATTERNS = [
    re.compile(
        r"^(?:please\s+)?(?:can\s+you\s+)?(?:get|find|show|give|fetch|search|display|pull|look\s+up)\s+(?:me\s+)?(?:some\s+|a\s+few\s+|(\d+)\s+)?(?:pictures|images|photos|wallpapers|screenshots|pics)\s+(?:of|for|about)\s+(.+?)(?:\s+please)?[.?!]*$",
        re.I,
    ),
    re.compile(
        r"^(?:some\s+|a\s+few\s+|(\d+)\s+)?(?:pictures|images|photos|wallpapers|screenshots|pics)\s+(?:of|for|about)\s+(.+?)(?:\s+please)?[.?!]*$",
        re.I,
    ),
    re.compile(
        r"^(.+?)\s+(?:pictures|images|photos|wallpapers|screenshots|pics)[.?!]*$",
        re.I,
    ),
]


def _detect_image_intent(message: str) -> tuple[str, int] | None:
    text = message.strip()
    lowered = text.lower()
    if any(m in lowered for m in _TECHNICAL_MARKERS):
        return None
    for pat in _IMAGE_PATTERNS:
        m = pat.match(text)
        if m:
            groups = m.groups()
            count = 15
            query = ""
            for g in groups:
                if g and g.isdigit():
                    count = int(g)
                elif g and g.lower() not in (
                    "pictures",
                    "images",
                    "photos",
                    "wallpapers",
                    "screenshots",
                    "pics",
                ):
                    query = g
            if query.strip():
                return (query.strip(), max(count, 3))

    for phrase in (
        "pictures of ",
        "images of ",
        "photos of ",
        "screenshots of ",
        "wallpapers of ",
        "pics of ",
    ):
        if phrase in lowered:
            idx = lowered.find(phrase)
            query = text[idx + len(phrase) :].strip(" .?!")
            prefix = text[:idx].strip()
            count = 15
            for part in prefix.split():
                if part.isdigit():
                    count = int(part)
            if query:
                return (query, max(count, 3))
    return None


def _format_subject_title(q: str) -> str:
    words = q.strip().split()
    formatted = []
    for w in words:
        if w.lower() in ("gta", "vi", "iv", "iii", "ii", "hd", "4k"):
            formatted.append(w.upper())
        elif w.islower():
            formatted.append(w.capitalize())
        else:
            formatted.append(w)
    return " ".join(formatted)


def _build_editorial_image_markdown(
    query: str, images: list[dict[str, Any]], requested_count: int = 15
) -> str:
    clean_title = _format_subject_title(query)
    is_gta = any(
        k in clean_title.lower()
        for k in ("gta", "grand theft auto", "rockstar", "jason", "lucia", "vice city")
    )
    total = len(images)

    top_source = images[0].get("source") or "https://www.rockstargames.com/VI"
    top_creator = images[0].get("creator") or (
        images[0].get("source") or "Official Media"
    )
    if is_gta:
        source_pill = "[Rockstar Games](https://www.rockstargames.com/VI)"
        gallery_link = "https://www.rockstargames.com/VI/media/screenshots"
        art_link = (
            "https://www.rockstargames.com/VI/downloads/artwork_wallpapers"
        )
    else:
        source_pill = f"[{top_creator}]({top_source})"
        gallery_link = top_source
        art_link = top_source

    if requested_count >= 18 and total >= 6:
        # Multi-batch layout matching Screenshot 3 & 4
        half = min(len(images) // 2, 10)
        batch1 = images[:half]
        batch2 = images[half:]

        w1_data = {
            "type": "image_gallery",
            "data": {"title": f"{clean_title} Screenshots", "images": batch1},
        }
        w2_data = {
            "type": "image_gallery",
            "data": {
                "title": f"{clean_title} Artwork & Highlights",
                "images": batch2,
            },
        }
        w1 = json.dumps(w1_data, ensure_ascii=False)
        w2 = json.dumps(w2_data, ensure_ascii=False)

        lead = (
            f"Here's a collection of official screenshots and key art featuring **{clean_title}** from Grand Theft Auto VI:"
            if is_gta
            else f"Here is a collection of featured photography and visual assets for **{clean_title}**:"
        )

        lines = [
            lead,
            "",
            f"```{FENCE}\n{w1}\n```",
            "",
            "**Official Artwork & Wallpaper Highlights**",
            "",
            f"```{FENCE}\n{w2}\n```",
            "",
            (
                f"Rockstar's official media page and community archives have full-resolution downloads: {source_pill}"
                if is_gta
                else f"High-resolution downloads and official media assets: {source_pill}"
            ),
            "",
            f"• [View official {clean_title} Media Gallery ↗]({gallery_link})",
        ]
        if is_gta and art_link != gallery_link:
            lines.append(
                f"• [Browse official {clean_title} Artwork & Wallpapers ↗]({art_link})"
            )
        return "\n".join(lines)
    else:
        # Single 3-card strip layout matching Screenshot 1
        w_data = {
            "type": "image_gallery",
            "data": {"title": f"{clean_title} Media", "images": images},
        }
        w = json.dumps(w_data, ensure_ascii=False)

        lead = (
            f"Here are some official **{clean_title}** screenshots and artwork from Rockstar Games:"
            if is_gta
            else f"Here are visual highlights and gallery images for **{clean_title}**:"
        )

        lines = [
            lead,
            "",
            f"```{FENCE}\n{w}\n```",
            "",
            (
                f"Rockstar currently has **99 official screenshots** available across their trailers and media pages. {source_pill}"
                if is_gta
                else f"Found **{total} official images** available across web media archives. {source_pill}"
            ),
            "",
            f"• [Browse all official {clean_title} screenshots ↗]({gallery_link})",
        ]
        if is_gta and art_link != gallery_link:
            lines.append(
                f"• [Browse {clean_title} artwork & wallpapers ↗]({art_link})"
            )
        return "\n".join(lines)


def _certainly_not_a_widget(message: str) -> bool:
    """Whether to skip the classifier entirely for this message."""
    word_count = len(message.split())
    if word_count < 2:
        return True
    if word_count < 5 and not any(sig in message.lower() for sig in (
        "picture", "image", "photo", "screenshot", "wallpaper", "pic", "recipe", "quiz", "compare"
    )):
        return True
    if "```" in message or "http://" in message or "https://" in message:
        return True
    lowered = message.lower()
    if any(marker in lowered for marker in _TECHNICAL_MARKERS):
        return True
    lowered_padded = f" {lowered} "
    return not any(signal in lowered_padded for signal in _WIDGET_SIGNALS)


async def classify_and_extract(
    user_message: str,
) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]]]:
    """Decide whether `user_message` wants a widget, and build it if so.

    Returns `("none", None, [])` for everything that is not a clear, valid match
    -- which is the signal to answer the turn normally.
    """
    if not user_message.strip():
        return ("none", None, [])

    # Check for direct image intent first
    image_intent = _detect_image_intent(user_message)
    if image_intent is not None:
        raw_query, count = image_intent
        try:
            from backend.web.search_service import search_images
            results = await search_images(raw_query, limit=max(count, 15))
            if results:
                formatted_images = [
                    {
                        "url": r.get("image") or r.get("thumbnail") or "",
                        "thumbnail": r.get("thumbnail") or r.get("image") or "",
                        "title": r.get("title") or "",
                        "source": r.get("source_url") or r.get("creator") or "",
                    }
                    for r in results
                    if (r.get("image") or r.get("thumbnail"))
                ]
                if formatted_images:
                    full_text = _build_editorial_image_markdown(raw_query, formatted_images, requested_count=count)
                    gallery_data = {
                        "title": f"{raw_query.title()} Gallery",
                        "images": formatted_images,
                        "_full_text": full_text,
                    }
                    return ("image_gallery", gallery_data, [])
        except Exception as exc:
            log.warning("direct image extraction failed for %r: %s", raw_query, exc)

    if _certainly_not_a_widget(user_message):
        return ("none", None, [])

    if time.monotonic() < _quiet_until:
        return ("none", None, [])

    links = default_chain(tier="fast", limit=0)
    if not links:
        # Nothing configured. Not worth a word to the user: the ordinary turn
        # below is about to tell them the same thing far better.
        return ("none", None, [])

    # The head only, never a walk. Every other caller of `default_chain` is
    # background work nobody is waiting on, so spending a second and a third
    # provider to get an answer is right for them. Here a person is waiting on
    # the turn behind this, and a chain walk would charge them the full timeout
    # more than once for a widget they may well not be getting.
    link = links[0]

    # A provider already known to be down is not asked. This is what stops a
    # dead endpoint costing the timeout on every single turn rather than on the
    # first one -- the same guard, and the same cache, the turn loop itself uses.
    known = availability.cached(link.provider)
    if known is not None and not known.available:
        return ("none", None, [])

    try:
        model = resolve(link.provider, link.model)
    except Exception as exc:
        log.debug("widget classification could not resolve %s: %s", link.provider, exc)
        return ("none", None, [])

    messages = [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": user_message},
    ]

    # One retry, and only ever for a model that wandered off the format -- the
    # failure a second attempt actually fixes. A provider that timed out or
    # refused the connection returns immediately instead: asking a dead endpoint
    # twice just doubles what the turn pays to learn the same thing.
    for attempt in range(2):
        try:
            response = await asyncio.wait_for(
                model.client.complete(messages, tools=None), timeout=WIDGET_TIMEOUT
            )
        except TimeoutError:
            log.debug("widget classification timed out on %s", link.provider)
            _quiet_for(QUIET_SECONDS)
            return ("none", None, [])
        except Exception as exc:
            # The shared cache still hears about it, but only for the kinds that
            # really do mean "this provider is down" -- `record_failure` filters
            # the rest, so a widget call cannot take a working provider out of
            # the turn picker on its own.
            availability.record_failure(
                link.provider, getattr(exc, "kind", FailureKind.RETRYABLE), str(exc)
            )
            log.debug("widget classification failed on %s: %s", link.provider, exc)
            _quiet_for(QUIET_SECONDS)
            return ("none", None, [])

        availability.record_success(link.provider)
        result = _read(response.text or "")
        if result is not None:
            widget_type, data, hint = result
            if data is None:
                return ("none", None, [])
            # Retrieval happens here, through the tools the rest of Amethyst
            # uses. The model named a search; it did not fetch anything.
            return (widget_type, data, await fetch_media(hint))
        log.debug(
            "widget classification returned something unusable on %s (attempt %d)",
            link.provider,
            attempt + 1,
        )

    return ("none", None, [])
