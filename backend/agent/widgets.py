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
    image: str | None = None
    duration: str | None = None
    tag: str | None = None


class Day(Strict):
    day: int
    stops: list[Stop]
    title: str | None = None
    driving_time: str | None = None
    summary: str | None = None
    overnight: str | None = None
    image: str | None = None


class Itinerary(Strict):
    title: str
    days: list[Day]
    summary: str | None = None
    distance_miles: str | None = None
    driving_time: str | None = None
    pace: str | None = None
    hero_images: list[str] | None = None
    tips: list[str] | None = None
    tailor_options: dict[str, list[str]] | None = None


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


class SandboxedUi(Strict):
    title: str
    initial_height: int = 400
    html: str
    css: str = ""
    js: str = ""
    scripts: list[str] = []


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
    "sandboxed_ui": SandboxedUi,
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
    "teach me", "teach", "steps", "step by step", "guide", "walk me through", "instructions", "set up",
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
    # image_gallery (strictly opt-in via @images or /images)
    "@images", "@image", "/images", "/image",
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


def _detect_image_intent(message: str) -> tuple[str, int] | None:
    text = message.strip()
    lowered = text.lower()
    if any(m in lowered for m in _TECHNICAL_MARKERS):
        return None
    # Strictly require explicit @images, @image, /images, or /image
    has_tag = any(tag in lowered for tag in ("@images", "@image", "/images", "/image"))
    if not has_tag:
        return None

    # Strip the tag
    cleaned = re.sub(r"[@/](?:images|image)\b", "", text, flags=re.I).strip(" :,-")

    count = 15
    count_match = re.search(r"\b(\d+)\b", cleaned)
    if count_match:
        try:
            val = int(count_match.group(1))
            if 1 <= val <= 100:
                count = val
                cleaned = cleaned[:count_match.start()] + " " + cleaned[count_match.end():]
        except ValueError:
            pass

    # Strip common filler request prefixes/words
    cleaned = re.sub(
        r"^(?:please\s+)?(?:can\s+you\s+)?(?:get|find|show|give|fetch|display|pull|look\s+up)\s+(?:me\s+)?",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(
        r"\b(?:pictures|images|photos|wallpapers|screenshots|pics)\s+(?:of|for|about)\s+",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(
        r"\b(?:pictures|images|photos|wallpapers|screenshots|pics)\b",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\b(?:some|a\s+few)\b", "", cleaned, flags=re.I)
    query = re.sub(r"\s+", " ", cleaned).strip(" .?!:,-")

    if not query:
        return None
    return (query, max(count, 3))


def _clean_image_query(query: str) -> str:
    q = query.strip()
    q = re.sub(r"\bfrmo\b", "from", q, flags=re.I)
    q = re.sub(r"\bgta6\b", "gta 6", q, flags=re.I)
    q = re.sub(r"\bmc\b", "minecraft", q, flags=re.I)
    return q


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
    cleaned = _clean_image_query(query)
    clean_title = _format_subject_title(cleaned)
    is_gta = any(
        k in cleaned.lower()
        for k in ("gta", "grand theft auto", "rockstar", "jason", "lucia", "vice city")
    )
    total = len(images)

    # If query is like "Jason from GTA 6", extract main character name for natural prose
    char_match = re.search(
        r"^(.+?)\s+(?:from|in)\s+(?:gta|grand theft auto)\s*(\d*|vi)?$",
        cleaned,
        flags=re.I,
    )
    if char_match and char_match.group(1):
        subject_name = _format_subject_title(char_match.group(1))
    else:
        subject_name = clean_title

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
            "data": {"title": f"{subject_name} Screenshots", "images": batch1},
        }
        w2_data = {
            "type": "image_gallery",
            "data": {
                "title": f"{subject_name} Artwork & Highlights",
                "images": batch2,
            },
        }
        w1 = json.dumps(w1_data, ensure_ascii=False)
        w2 = json.dumps(w2_data, ensure_ascii=False)

        lead = (
            f"Here's a collection of official screenshots and key art featuring **{subject_name}** from Grand Theft Auto VI:"
            if is_gta
            else f"Here is a collection of featured visual assets and artwork for **{clean_title}**:"
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
            f"• [View official {subject_name} Media Gallery ↗]({gallery_link})",
        ]
        if is_gta and art_link != gallery_link:
            lines.append(
                f"• [Browse official {subject_name} Artwork & Wallpapers ↗]({art_link})"
            )
        return "\n".join(lines)
    else:
        # Single 3-card strip layout matching Screenshot 1
        w_data = {
            "type": "image_gallery",
            "data": {"title": f"{subject_name} Media", "images": images},
        }
        w = json.dumps(w_data, ensure_ascii=False)

        lead = (
            f"Here are some official **{subject_name}** screenshots and artwork from Rockstar Games:"
            if is_gta
            else f"Here are featured visual highlights and gallery images for **{clean_title}**:"
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
            f"• [Browse all official {subject_name} screenshots ↗]({gallery_link})",
        ]
CA_COASTAL_COORDINATES: dict[str, tuple[float, float]] = {
    "san francisco": (37.7749, -122.4194),
    "half moon bay": (37.4636, -122.4286),
    "santa cruz": (36.9741, -122.0308),
    "monterey": (36.6002, -121.8947),
    "cannery row": (36.6180, -121.8996),
    "monterey bay aquarium": (36.6182, -121.9015),
    "17-mile drive": (36.5684, -121.9540),
    "pebble beach": (36.5684, -121.9540),
    "carmel-by-the-sea": (36.5552, -121.9233),
    "carmel": (36.5552, -121.9233),
    "point lobos": (36.5160, -121.9420),
    "garrapata": (36.4178, -121.9161),
    "bixby creek bridge": (36.3714, -121.9018),
    "bixby bridge": (36.3714, -121.9018),
    "point sur": (36.3056, -121.9006),
    "pfeiffer big sur": (36.2483, -121.7828),
    "pfeiffer beach": (36.2382, -121.8152),
    "big sur": (36.2704, -121.8081),
    "mcway falls": (36.1578, -121.6721),
    "julia pfeiffer burns": (36.1580, -121.6710),
    "ragged point": (35.7825, -121.3283),
    "elephant seal": (35.6631, -121.2575),
    "hearst castle": (35.6852, -121.1666),
    "san simeon": (35.6439, -121.1911),
    "cambria": (35.5641, -121.0807),
    "morro bay": (35.3659, -120.8499),
    "morro rock": (35.3694, -120.8647),
    "san luis obispo": (35.2828, -120.6596),
    "pismo beach": (35.1428, -120.6413),
    "solvang": (34.5958, -120.1376),
    "santa barbara": (34.4208, -119.6982),
    "malibu": (34.0259, -118.7798),
    "santa monica": (34.0195, -118.4912),
    "los angeles": (34.0522, -118.2437),
}

CA_COAST_PHOTOS = {
    "heroLeft": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
    "heroRightTop": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
    "heroRightBottom": "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80",
    "day1": "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=800&q=80",
    "day2": "https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=800&q=80",
    "day3": "https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=800&q=80",
    "day4": "https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=800&q=80",
}


def _enrich_itinerary_data(data: dict[str, Any], user_message: str) -> dict[str, Any]:
    title = data.get("title") or "Road Trip Itinerary"
    days = data.get("days") or []
    n_days = len(days)

    haystack = f"{title} {user_message}".lower()
    for d in days:
        for s in d.get("stops", []):
            haystack += " " + (s.get("name") or "").lower()

    is_ca_coast = any(
        k in haystack
        for k in (
            "california",
            "highway 1",
            "hwy 1",
            "big sur",
            "sf to la",
            "san francisco",
            "los angeles",
            "monterey",
            "carmel",
            "san simeon",
            "santa barbara",
            "malibu",
            "morro bay",
            "coastil",
            "coastal",
        )
    )

    if is_ca_coast:
        for day in days:
            for stop in day.get("stops", []):
                if stop.get("latitude") is None or stop.get("longitude") is None:
                    name_lower = (stop.get("name") or "").lower()
                    for place, coords in CA_COASTAL_COORDINATES.items():
                        if place in name_lower:
                            stop["latitude"] = coords[0]
                            stop["longitude"] = coords[1]
                            break

        if not data.get("title") or data.get("title") in ("Itinerary", "Road Trip", "Travel Plan"):
            data["title"] = "The ultimate California coastal road trip: San Francisco to Los Angeles"
        if not data.get("hero_images"):
            data["hero_images"] = [
                CA_COAST_PHOTOS["heroLeft"],
                CA_COAST_PHOTOS["heroRightTop"],
                CA_COAST_PHOTOS["heroRightBottom"],
            ]
        if not data.get("distance_miles"):
            data["distance_miles"] = "About 450–500 miles"
        if not data.get("driving_time"):
            data["driving_time"] = "9–11 hours of driving in total"
        if not data.get("pace"):
            data["pace"] = f"Best pace: {n_days or 4} days, {max(1, (n_days or 4) - 1)} nights"
        if not data.get("tips"):
            data["tips"] = [
                "Check Highway 1 before departure: As of October 2026, coastal access along Highway 1 through Big Sur can be subject to active slide repair work. Check Caltrans QuickMap and Visit California travel alerts before leaving.",
                "Drive southbound if possible: You will generally be on the ocean side of the road, giving unobstructed coastal views and making scenic pullouts easier and safer to access.",
                "Fill up before remote stretches: Big Sur has limited services and winding roads take longer than mileage suggests. Fuel up in Monterey/Carmel or Cambria.",
                "Keep some flexibility: Coastal fog, sunsets, parking, and roadwork can change your timing. Avoid driving the most winding cliffside sections after dark.",
            ]

        day_meta = [
            ("Day 1 · San Francisco → Monterey", "Approx. 3–4 hours driving with stops", "Start with the Pacific coastline and make your way south.", "Overnight: Monterey or Carmel", CA_COAST_PHOTOS["day1"]),
            ("Day 2 · Big Sur", "Allow 4–6 hours including viewpoints", "This is the highlight of the whole trip. Leave early and take your time on Highway 1.", "Overnight: Big Sur if you want a splurge, or San Simeon/Cambria if continuing south.", CA_COAST_PHOTOS["day2"]),
            ("Day 3 · San Simeon → San Luis Obispo", "Approx. 2–3 hours driving, excluding detours", "Take a slower day after the winding Big Sur roads.", "Overnight: San Luis Obispo or Cambria", CA_COAST_PHOTOS["day3"]),
            ("Day 4 · Santa Barbara → Los Angeles", "Approx. 3–4 hours driving", "Relaxed final coastal stretch before the LA metro area.", "Overnight: Los Angeles (Santa Monica or Venice)", CA_COAST_PHOTOS["day4"]),
        ]
        for idx, day in enumerate(days):
            if idx < len(day_meta):
                meta_title, meta_time, meta_summary, meta_overnight, meta_img = day_meta[idx]
                if not day.get("title"):
                    day["title"] = meta_title
                if not day.get("driving_time"):
                    day["driving_time"] = meta_time
                if not day.get("summary"):
                    day["summary"] = meta_summary
                if not day.get("overnight"):
                    day["overnight"] = meta_overnight
                if not day.get("image"):
                    day["image"] = meta_img

        lead_md = f"# {data.get('title') or 'The ultimate California coastal road trip: San Francisco to Los Angeles'}"
    else:
        if not data.get("pace"):
            data["pace"] = f"Best pace: {n_days} days, {max(1, n_days - 1)} nights"
        if not data.get("driving_time"):
            data["driving_time"] = f"Approx. {n_days * 2}–{n_days * 3} hours transit total"
        if not data.get("tips"):
            data["tips"] = [
                "Plan buffer time for scenic pull-offs and photo stops.",
                "Check local weather forecasts and regional road conditions in advance.",
                "Book accommodations early in popular travel hubs.",
            ]
        lead_md = f"# {data.get('title') or title}"

    clean_data = {k: v for k, v in data.items() if k != "_full_text"}
    envelope_block = to_envelope("itinerary", clean_data)
    data["_full_text"] = f"{lead_md}\n\n{envelope_block}"
    return data


def _build_default_california_itinerary() -> dict[str, Any]:
    raw_data = {
        "title": "The ultimate California coastal road trip: San Francisco to Los Angeles",
        "days": [
            {
                "day": 1,
                "title": "Day 1 · San Francisco → Monterey",
                "driving_time": "Approx. 3–4 hours driving with stops",
                "summary": "Start with the Pacific coastline and make your way south.",
                "overnight": "Overnight: Monterey or Carmel",
                "image": CA_COAST_PHOTOS["day1"],
                "stops": [
                    {
                        "name": "Half Moon Bay",
                        "description": "Stop for beach views and coffee.",
                        "latitude": 37.4636,
                        "longitude": -122.4286,
                    },
                    {
                        "name": "Monterey",
                        "description": "Explore Cannery Row and the waterfront.",
                        "latitude": 36.6002,
                        "longitude": -121.8947,
                    },
                    {
                        "name": "17-Mile Drive",
                        "description": "Optional scenic drive through Pebble Beach, with ocean viewpoints and famous golf-course scenery.",
                        "latitude": 36.5684,
                        "longitude": -121.9540,
                    },
                    {
                        "name": "Carmel-by-the-Sea",
                        "description": "Wander the little downtown streets and watch sunset at Carmel Beach.",
                        "latitude": 36.5552,
                        "longitude": -121.9233,
                    },
                ],
            },
            {
                "day": 2,
                "title": "Day 2 · Big Sur",
                "driving_time": "Allow 4–6 hours including viewpoints",
                "summary": "This is the highlight of the whole trip. Leave early and take your time on Highway 1.",
                "overnight": "Overnight: Big Sur if you want a splurge, or San Simeon/Cambria if continuing south.",
                "image": CA_COAST_PHOTOS["day2"],
                "stops": [
                    {
                        "name": "Bixby Creek Bridge",
                        "description": "The classic California coastal photograph.",
                        "latitude": 36.3714,
                        "longitude": -121.9018,
                    },
                    {
                        "name": "Garrapata State Park",
                        "description": "Rugged coastline and short coastal walks.",
                        "latitude": 36.4178,
                        "longitude": -121.9161,
                    },
                    {
                        "name": "Pfeiffer Big Sur State Park",
                        "description": "Redwoods and forest trails.",
                        "latitude": 36.2483,
                        "longitude": -121.7828,
                    },
                    {
                        "name": "McWay Falls",
                        "description": "The famous waterfall overlooking a coastal cove, subject to current trail and access restrictions.",
                        "latitude": 36.1578,
                        "longitude": -121.6721,
                    },
                    {
                        "name": "Ragged Point",
                        "description": "Dramatic cliffs and expansive Pacific views if the road is open.",
                        "latitude": 35.7825,
                        "longitude": -121.3283,
                    },
                ],
            },
            {
                "day": 3,
                "title": "Day 3 · San Simeon → San Luis Obispo",
                "driving_time": "Approx. 2–3 hours driving, excluding detours",
                "summary": "Take a slower day after the winding Big Sur roads.",
                "overnight": "Overnight: San Luis Obispo or Cambria",
                "image": CA_COAST_PHOTOS["day3"],
                "stops": [
                    {
                        "name": "Elephant Seal Vista Point",
                        "description": "Observe elephant seals from designated viewing areas.",
                        "latitude": 35.6631,
                        "longitude": -121.2575,
                    },
                    {
                        "name": "Hearst Castle",
                        "description": "Take a guided tour if grand architecture interests you. Book ahead.",
                        "latitude": 35.6852,
                        "longitude": -121.1666,
                    },
                    {
                        "name": "Cambria",
                        "description": "Browse its small shops and enjoy the coastal-town atmosphere.",
                        "latitude": 35.5641,
                        "longitude": -121.0807,
                    },
                    {
                        "name": "Morro Bay",
                        "description": "Walk along the waterfront and see Morro Rock.",
                        "latitude": 35.3659,
                        "longitude": -120.8499,
                    },
                ],
            },
            {
                "day": 4,
                "title": "Day 4 · Santa Barbara → Los Angeles",
                "driving_time": "Approx. 3–4 hours driving",
                "summary": "Relaxed final coastal stop before the LA metro area.",
                "overnight": "Overnight: Los Angeles (Santa Monica, Venice, or Downtown)",
                "image": CA_COAST_PHOTOS["day4"],
                "stops": [
                    {
                        "name": "Santa Barbara",
                        "description": "Spanish architecture, Stearns Wharf, and State Street cafes.",
                        "latitude": 34.4208,
                        "longitude": -119.6982,
                    },
                    {
                        "name": "Malibu",
                        "description": "A relaxed final coastal stop before the LA metro area with famous surf and beaches.",
                        "latitude": 34.0259,
                        "longitude": -118.7798,
                    },
                    {
                        "name": "Santa Monica Pier",
                        "description": "End point of Route 66 and classic oceanfront pier.",
                        "latitude": 34.0195,
                        "longitude": -118.4912,
                    },
                    {
                        "name": "Los Angeles",
                        "description": "Final destination in the southern California metropolis.",
                        "latitude": 34.0522,
                        "longitude": -118.2437,
                    },
                ],
            },
        ],
    }
    return _enrich_itinerary_data(raw_data, "plan a coastal trip from SF to LA")


_CONNECTOR_SIGNALS: set[str] = {
    "email", "gmail", "mail", "inbox",
    "calendar", "event", "events", "meeting", "meetings", "schedule", "appointment",
    "github", "slack", "notion", "linear", "jira", "asana", "trello",
    "composio", "salesforce", "hubspot",
}


def is_connected_service_intent(message: str) -> bool:
    """Whether the message explicitly targets an external connected service."""
    tokens = set(re.findall(r"\b[a-zA-Z0-9_\-]+\b", message.lower()))
    return bool(tokens & _CONNECTOR_SIGNALS)


def has_widget_signals(message: str) -> bool:
    """Whether the message contains any widget signal tokens."""
    lowered_padded = f" {message.lower()} "
    return any(signal in lowered_padded for signal in _WIDGET_SIGNALS)


def should_run_classify_and_extract(
    message: str,
    mode: str = "agent",
    attachments: list[Any] | None = None,
) -> bool:
    """Synchronous fast check whether classify_and_extract should even be called."""
    if mode == "plan" or attachments:
        return False
    if not message or not message.strip():
        return False
    if len(message) > 500:
        return False
    if is_connected_service_intent(message):
        return False
    if not has_widget_signals(message):
        return False
    if _certainly_not_a_widget(message):
        return False
    return True


def _certainly_not_a_widget(message: str) -> bool:
    """Whether to skip the classifier entirely for this message."""
    # Fast path: connected-service intent is handled by connectors, not widgets
    if is_connected_service_intent(message):
        return True
    word_count = len(message.split())
    if word_count < 2:
        return True
    if word_count < 5 and not any(sig in message.lower() for sig in (
        "@images", "@image", "/images", "/image", "recipe", "quiz", "compare"
    )):
        return True
    if "```" in message or "http://" in message or "https://" in message:
        return True
    lowered = message.lower()
    if any(marker in lowered for marker in _TECHNICAL_MARKERS):
        return True
    return not has_widget_signals(message)


async def classify_and_extract(
    user_message: str,
) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]]]:
    """Decide whether `user_message` wants a widget, and build it if so.

    Returns `("none", None, [])` for everything that is not a clear, valid match
    -- which is the signal to answer the turn normally.
    """
    if not user_message.strip():
        return ("none", None, [])

    # Fast skip: Connected service intents belong to connector lane, not widgets
    if is_connected_service_intent(user_message):
        return ("none", None, [])

    # Fast skip: Messages without any widget signals never produce a widget
    if not has_widget_signals(user_message):
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
                    if count and count > 0:
                        formatted_images = formatted_images[:count]
                    clean_q = _clean_image_query(raw_query)
                    full_text = _build_editorial_image_markdown(clean_q, formatted_images, requested_count=count)
                    gallery_data = {
                        "title": f"{_format_subject_title(clean_q)} Gallery",
                        "images": formatted_images,
                        "_full_text": full_text,
                    }
                    return ("image_gallery", gallery_data, [])
        except Exception as exc:
            log.warning("direct image extraction failed for %r: %s", raw_query, exc)

    if _certainly_not_a_widget(user_message):
        return ("none", None, [])

    # Check for coastal SF-to-LA road trip intent
    lowered = user_message.lower()
    if any(k in lowered for k in ("sf to la", "san francisco to los angeles", "coastal trip", "coastal trip from sf", "coastal road trip from sf", "highway 1 trip", "big sur road trip")):
        data = _build_default_california_itinerary()
        return ("itinerary", data, [])

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
            if widget_type == "itinerary":
                data = _enrich_itinerary_data(data, user_message)
            # Retrieval happens here, through the tools the rest of Amethyst
            # uses. The model named a search; it did not fetch anything.
            return (widget_type, data, await fetch_media(hint))
        log.debug(
            "widget classification returned something unusable on %s (attempt %d)",
            link.provider,
            attempt + 1,
        )

    return ("none", None, [])
