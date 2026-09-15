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


def _certainly_not_a_widget(message: str) -> bool:
    """Whether to skip the classifier entirely for this message.

    The classifier is a whole fast-model round trip -- ~570ms measured -- taken
    before the turn's own model is even called, and its prompt says plainly that
    `none` "is the right answer far more often than not". So most of those calls
    buy nothing, and on a greeting they are the difference between a turn that
    feels instant and one that does not.

    Two ways to skip. A URL or a fenced code block means "go do something with
    this", which no widget type serves. Technical markers (code syntax, file
    extensions, dev tools) indicate a development task even if a widget signal
    like "how to" is present. Otherwise the message must carry at least one word
    suggesting a widget; without one, the classifier's own answer would almost
    certainly have been `none`.

    The cost of being wrong is bounded and small: the turn is answered normally,
    in prose, by the full model. A widget is an enhancement to an answer, never
    the only way to give one.
    """
    # Very short messages (<5 words) are never widget requests — greetings,
    # acknowledgments, simple questions. Skip immediately.
    if len(message.split()) < 5:
        return True
    if "```" in message or "http://" in message or "https://" in message:
        return True
    # Technical content overrides widget signals: "how to fix this bug" is a
    # development task, not a recipe or quiz.
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

    The third element is media, retrieved through the existing search tools when
    the one extraction call above said it would help. It is always a list and is
    usually empty: a widget with no media is the normal case, not a degraded one.
    """
    if not user_message.strip():
        return ("none", None, [])

    if _certainly_not_a_widget(user_message):
        # A link or a code block means "go do something with this", never a
        # recipe or a quiz. Skipping the fast-model call here is time-to-first-
        # token the turn keeps -- the classifier's own answer would be `none`.
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
