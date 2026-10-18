"""Intent -> widget: the classifier's routing, the schemas, and the fallbacks.

The thing worth protecting here is not that widgets render. It is that they
never cost anyone an answer: every way this can go wrong -- no provider, a dead
provider, junk instead of JSON, a payload that does not fit its schema -- has to
end at `("none", None)` so the ordinary turn runs.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.agent import widgets
from backend.agent.widgets import (
    WIDGET_MODELS,
    classify_and_extract,
    parse_envelope,
    to_envelope,
)
from backend.runtime.chain import Link

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def _forget():
    """The availability cache is process-global; two tests must not share it."""
    from backend.runtime import availability

    availability.forget()
    widgets.reset_backoff()
    yield
    availability.forget()
    widgets.reset_backoff()


# --- fixtures ---------------------------------------------------------------


class _Replies:
    """A client that reads from a script, one reply per `complete`."""

    def __init__(self, *texts):
        self.texts, self.calls = list(texts), 0

    async def complete(self, messages, tools=None, params=None):
        from backend.runtime.types import ModelResponse

        self.calls += 1
        # The last reply repeats, so a test asserting "still junk" does not have
        # to know how many attempts the implementation makes.
        text = self.texts[min(self.calls - 1, len(self.texts) - 1)]
        if isinstance(text, Exception):
            raise text
        return ModelResponse(text=text)


def _wire(monkeypatch, client, *, links=("groq",), media=None):
    from backend.runtime.types import Capabilities, ResolvedModel

    # No network from a classification test. `fetch_media` is covered on its own
    # in `test_media.py`.
    async def no_media(hint):
        return media or []

    monkeypatch.setattr(widgets, "fetch_media", no_media)

    monkeypatch.setattr(
        widgets,
        "default_chain",
        lambda **kw: [Link(provider=p, model="fast-model") for p in links],
    )
    monkeypatch.setattr(
        widgets,
        "resolve",
        lambda provider, model=None, **kw: ResolvedModel(
            provider=provider,
            model=model or "fast-model",
            client=client,
            capabilities=Capabilities(streaming=False, context_window=32_000),
        ),
    )
    return client


RECIPE = {
    "title": "Pancakes",
    "servings": 4,
    "ingredients": [{"name": "flour", "amount": 200, "unit": "g"}],
    "steps": [{"title": "Mix", "text": "Combine everything.", "timer_seconds": None}],
}


def _answer(kind, data, media=None):
    async def classify(message):
        return (kind, data, media or [])

    return classify


# --- classifier routing -----------------------------------------------------


async def test_none_falls_through_to_the_ordinary_turn(monkeypatch):
    """The default, and the answer for most requests.

    Mutation check: make `_read` return a type for `{"type":"none"}`.
    """
    client = _wire(monkeypatch, _Replies('{"type":"none","data":null}'))

    # Phrased to carry a widget signal ("how do i") so the classifier is
    # actually consulted -- this test is about a `none` *reply* falling through,
    # not about the pre-filter that skips the call entirely.
    assert await classify_and_extract("how do i explain monads") == ("none", None, [])
    # Decided, not retried: `none` is an answer.
    assert client.calls == 1


async def test_a_clear_match_comes_back_validated(monkeypatch):
    _wire(monkeypatch, _Replies(json.dumps({"type": "recipe", "data": RECIPE})))

    kind, data, _ = await classify_and_extract("give me a recipe for pancakes please")

    assert kind == "recipe"
    assert data["title"] == "Pancakes"
    assert data["ingredients"][0]["unit"] == "g"
    # Normalized through the schema, so the renderer sees the optional field
    # whether or not the model wrote it.
    assert data["steps"][0]["timer_seconds"] is None


async def test_a_fenced_reply_is_tolerated(monkeypatch):
    """Models fence JSON even when told not to. Cheaper to accept than retry.

    Mutation check: delete the ``` handling in `_read`.
    """
    fenced = "```json\n" + json.dumps({"type": "recipe", "data": RECIPE}) + "\n```"
    client = _wire(monkeypatch, _Replies(fenced))

    kind, _, _ = await classify_and_extract("give me a recipe for pancakes please")

    assert kind == "recipe"
    assert client.calls == 1


async def test_no_configured_provider_is_not_an_error(monkeypatch):
    monkeypatch.setattr(widgets, "default_chain", lambda **kw: [])

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])


async def test_an_empty_message_asks_nobody(monkeypatch):
    called = False

    def chain(**kw):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(widgets, "default_chain", chain)

    assert await classify_and_extract("   ") == ("none", None, [])
    assert not called


# --- malformed output -------------------------------------------------------


async def test_malformed_json_is_retried_once_then_given_up_on(monkeypatch):
    """One retry, then prose. Not zero, and not a loop.

    Mutation check: change the retry range in `classify_and_extract` to 1 or 3.
    """
    client = _wire(monkeypatch, _Replies("sorry, I cannot do that"))

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 2


async def test_the_retry_is_what_rescues_a_wobble(monkeypatch):
    client = _wire(
        monkeypatch,
        _Replies("not json at all", json.dumps({"type": "recipe", "data": RECIPE})),
    )

    kind, _, _ = await classify_and_extract("give me a recipe for pancakes please")

    assert kind == "recipe"
    assert client.calls == 2


async def test_a_payload_that_misses_its_schema_is_rejected(monkeypatch):
    """A recipe with no ingredients is not a recipe the renderer can draw.

    Mutation check: drop the `model_validate` call in `_read`.
    """
    broken = json.dumps({"type": "recipe", "data": {"title": "Pancakes"}})
    client = _wire(monkeypatch, _Replies(broken))

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 2


async def test_an_invented_type_is_rejected(monkeypatch):
    client = _wire(monkeypatch, _Replies('{"type":"horoscope","data":{}}'))

    # Carries a signal ("suggest") so the call is made and its invented type is
    # what gets rejected.
    assert await classify_and_extract("can you please suggest my horoscope") == ("none", None, [])
    assert client.calls == 2


async def test_a_dead_provider_costs_one_attempt_and_no_more(monkeypatch):
    """No chain walk here, deliberately.

    Background work walks a chain because nobody is waiting on it. A person is
    waiting on the turn behind this one, so a provider that will not answer
    costs a single attempt and the turn proceeds without a widget.

    Mutation check: loop over every link in `classify_and_extract`.
    """

    class _Dead:
        def __init__(self):
            self.calls = 0

        async def complete(self, messages, tools=None, params=None):
            self.calls += 1
            raise RuntimeError("connection refused")

    client = _wire(monkeypatch, _Dead(), links=("ollama", "groq"))

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 1


async def test_a_provider_already_known_to_be_down_is_not_asked(monkeypatch):
    """Otherwise a dead endpoint charges the timeout to every turn, forever.

    Mutation check: delete the `availability.cached` guard.
    """
    from backend.runtime import availability
    from backend.runtime.failures import FailureKind

    client = _wire(monkeypatch, _Replies(json.dumps({"type": "recipe", "data": RECIPE})))
    availability.record_failure("groq", FailureKind.UPSTREAM_UNHEALTHY, "down")

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 0


async def test_a_timeout_puts_the_feature_to_sleep_rather_than_the_provider(monkeypatch):
    """The backoff is this feature's, not the shared availability cache's.

    A provider too slow for a four-second widget budget is still perfectly good
    for the turn itself, so it must stay in the picker -- but something has to
    remember, or the timeout is charged to every turn forever.

    Mutation check: delete the `_quiet_for` call on timeout.
    """
    from backend.runtime import availability

    class _Slow:
        def __init__(self):
            self.calls = 0

        async def complete(self, messages, tools=None, params=None):
            self.calls += 1
            await asyncio.sleep(10)

    monkeypatch.setattr(widgets, "WIDGET_TIMEOUT", 0.01)
    client = _wire(monkeypatch, _Slow())

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    # The provider is untouched: the turn behind this still wants it.
    assert availability.cached("groq") is None
    # But the next turn does not pay the timeout again.
    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 1


async def test_the_backoff_clears(monkeypatch):
    client = _wire(monkeypatch, _Replies(json.dumps({"type": "recipe", "data": RECIPE})))
    widgets._quiet_for(300)

    assert await classify_and_extract("give me a recipe for pancakes please") == ("none", None, [])
    assert client.calls == 0

    widgets.reset_backoff()
    kind, _, _ = await classify_and_extract("give me a recipe for pancakes please")
    assert kind == "recipe"


# --- schemas ----------------------------------------------------------------


GOOD = {
    "recipe": RECIPE,
    "step_guide": {
        "title": "Change a tyre",
        "steps": [{"title": "Jack it", "text": "Lift the car.", "timer_seconds": 60}],
    },
    "quiz": {
        "title": "Water cycle",
        "questions": [
            {
                "question": "What is evaporation?",
                "options": ["a", "b"],
                "correct_index": 0,
                "explanation": "because",
            }
        ],
    },
    "comparison": {
        "title": "Rust vs Go",
        "items": ["Rust", "Go"],
        "attributes": [{"name": "GC", "values": ["no", "yes"]}],
    },
    "itinerary": {
        "title": "Kyoto",
        "days": [
            {
                "day": 1,
                "stops": [
                    {
                        "name": "Fushimi Inari",
                        "description": "Torii gates.",
                        "latitude": 34.96,
                        "longitude": 135.77,
                    }
                ],
            }
        ],
    },
    "translation": {
        "source_language": "English",
        "target_language": "French",
        "source": "hello",
        "translation": "bonjour",
    },
    "chart": {
        "title": "Sales",
        "type": "bar",
        "labels": ["Jan", "Feb"],
        "series": [{"name": "2024", "data": [1, 2]}],
    },
    "options": {
        "title": "Pick one",
        "selection_mode": "single",
        "options": [{"title": "A", "description": "the first"}],
    },
    "image_gallery": {
        "title": "Supercars",
        "images": [
            {
                "url": "https://example.com/p1.jpg",
                "title": "P1",
                "thumbnail": "https://example.com/p1_thumb.jpg",
                "source": "car.com",
            }
        ],
        "layout": "carousel",
    },
    "data_table": {
        "title": "Comparison",
        "columns": ["Model", "Price"],
        "rows": [["Model S", "$80,000"], ["Taycan", "$90,000"]],
    },
    "sandboxed_ui": {
        "title": "Interactive Tool",
        "initial_height": 400,
        "html": "<button>Click me</button>",
        "css": "button { color: red; }",
        "js": "console.log('init');",
        "scripts": ["https://cdn.jsdelivr.net/npm/chart.js"],
    },
}



def test_every_widget_type_has_a_schema_and_a_fixture():
    """So a type added to one list cannot be forgotten in the others."""
    assert set(GOOD) == set(WIDGET_MODELS)


@pytest.mark.parametrize("kind", sorted(GOOD))
def test_a_good_payload_validates(kind):
    WIDGET_MODELS[kind].model_validate(GOOD[kind])


@pytest.mark.parametrize("kind", sorted(GOOD))
def test_an_extra_field_is_refused(kind):
    """`extra="forbid"` is what enforces the prompt's "do not add fields".

    Mutation check: drop `extra="forbid"` from `Strict`.
    """
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        WIDGET_MODELS[kind].model_validate({**GOOD[kind], "surprise": 1})


@pytest.mark.parametrize("kind", sorted(GOOD))
def test_a_missing_required_field_is_refused(kind):
    from pydantic import ValidationError

    payload = {k: v for k, v in GOOD[kind].items() if k != "title"}
    # `translation` has no title; drop one of its own required fields instead.
    if kind == "translation":
        payload = {k: v for k, v in GOOD[kind].items() if k != "translation"}

    with pytest.raises(ValidationError):
        WIDGET_MODELS[kind].model_validate(payload)


def test_the_closed_vocabularies_are_closed():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        WIDGET_MODELS["chart"].model_validate({**GOOD["chart"], "type": "pie"})
    with pytest.raises(ValidationError):
        WIDGET_MODELS["options"].model_validate(
            {**GOOD["options"], "selection_mode": "maybe"}
        )


# --- envelopes --------------------------------------------------------------


def test_an_envelope_round_trips():
    envelope = to_envelope("recipe", RECIPE)

    assert parse_envelope(envelope) == {"type": "recipe", "data": RECIPE, "media": []}


def test_ordinary_prose_is_not_a_widget():
    assert parse_envelope("Here is a recipe for pancakes.") is None
    assert parse_envelope("```json\n{\"type\":\"recipe\"}\n```") is None


def test_an_answer_that_merely_quotes_an_envelope_is_still_prose():
    """The fence has to be the whole message, not part of it.

    Mutation check: relax `parse_envelope` to search rather than match.
    """
    quoted = "As I was saying:\n\n" + to_envelope("recipe", RECIPE)

    assert parse_envelope(quoted) is None


def test_a_corrupt_envelope_is_not_a_widget():
    assert parse_envelope(f"```{widgets.FENCE}\nnot json\n```") is None
    assert parse_envelope(f"```{widgets.FENCE}\n{{\"type\":\"nope\",\"data\":{{}}}}\n```") is None


# --- the turn ---------------------------------------------------------------


def _registry():
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.registry import ToolRegistry

    return ToolRegistry(ConfirmationService(auto_approve))


async def test_a_widget_answers_the_turn_without_running_the_agent(db, monkeypatch):
    """The whole point: a clear match costs one fast call, not a turn.

    Mutation check: drop the `return` after the widget `done` event.
    """
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository, MessageRepository

    monkeypatch.setattr(
        "backend.agent.director.classify_and_extract",
        _answer("recipe", RECIPE),
    )

    def never(*a, **kw):
        raise AssertionError("the agent loop ran for a request answered by a widget")

    monkeypatch.setattr("backend.agent.director.resolve", never)

    cid = ConversationRepository().create("groq", "m")
    events = [
        e
        async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(
            cid, "give me a recipe for pancakes please"
        )
    ]

    kinds = [e.type for e in events]
    assert "widget" in kinds
    assert kinds[-1] == "done"

    widget = next(e for e in events if e.type == "widget").data["widget"]
    assert widget["type"] == "recipe"
    assert widget["data"]["title"] == "Pancakes"

    # And the transcript can rebuild it when the conversation is reopened.
    rows = MessageRepository().history(cid)
    assert parse_envelope(rows[-1].content) == {"type": "recipe", "data": RECIPE, "media": []}


async def test_none_leaves_the_turn_alone(db, monkeypatch):
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel

    monkeypatch.setattr("backend.agent.director.classify_and_extract", _answer("none", None))

    class _Prose:
        async def complete(self, messages, tools=None, params=None):
            return ModelResponse(text="monads are monoids in the category of endofunctors")

    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda provider, model=None, **kw: ResolvedModel(
            provider=provider,
            model="m",
            client=_Prose(),
            capabilities=Capabilities(streaming=False, context_window=32_000),
        ),
    )

    cid = ConversationRepository().create("groq", "m")
    events = [
        e
        async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(
            cid, "explain monads"
        )
    ]

    assert "widget" not in [e.type for e in events]
    assert "monoids" in next(e for e in events if e.type == "done").data["text"]


async def test_a_turn_with_attachments_is_never_a_widget(db, monkeypatch):
    """A widget answers a self-contained request; an attachment is not one.

    Mutation check: drop the `not attachments` guard in `Director._run`.
    """
    asked = False

    async def classify(message):
        nonlocal asked
        asked = True
        return ("none", None, [])

    monkeypatch.setattr("backend.agent.director.classify_and_extract", classify)
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("stop here")),
    )

    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository

    cid = ConversationRepository().create("groq", "m")
    _ = [
        e
        async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(
            cid, "what is this", attachments=[{"path": "a.png", "media_type": "image/png"}]
        )
    ]

    assert not asked


async def test_media_survives_a_reopened_conversation(db, monkeypatch):
    """It rides in the envelope, so reopening does not search for it again.

    Mutation check: drop `media` from `to_envelope`.
    """
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository, MessageRepository

    video = {
        "kind": "youtube",
        "title": "Carbonara in 10 minutes",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "embed_url": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        "source": "Some Cook",
        "duration": "10:02",
    }
    monkeypatch.setattr(
        "backend.agent.director.classify_and_extract", _answer("recipe", RECIPE, [video])
    )
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("the agent loop ran")),
    )

    cid = ConversationRepository().create("groq", "m")
    events = [
        e
        async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(
            cid, "teach me carbonara"
        )
    ]

    live = next(e for e in events if e.type == "widget").data["widget"]
    assert live["media"] == [video]

    stored = parse_envelope(MessageRepository().history(cid)[-1].content)
    assert stored["media"] == [video]


@pytest.mark.asyncio
async def test_a_link_or_code_skips_the_classifier_call(monkeypatch):
    """A URL or a code fence can never be a widget, so the fast-model round trip
    is skipped -- time to first token the turn gets to keep.

    Mutation check: remove the `_certainly_not_a_widget` guard.
    """
    from backend.agent import widgets

    def _boom(*a, **k):
        raise AssertionError("the classifier model was called")

    monkeypatch.setattr(widgets, "resolve", _boom)

    skipped = (
        "check https://example.com/report",   # a link: go fetch it
        "fix this ```py\nx=1\n```",           # code
        "Hi there",                           # a greeting is not a widget
        "what is the capital of France",      # a plain question is not a widget
    )
    for message in skipped:
        assert await widgets.classify_and_extract(message) == ("none", None, [])


@pytest.mark.asyncio
async def test_image_gallery_schema_and_envelope():
    from backend.agent.widgets import WIDGET_MODELS, parse_envelope, to_envelope
    assert "image_gallery" in WIDGET_MODELS
    assert "data_table" in WIDGET_MODELS

    gallery_data = {
        "title": "Supercars",
        "images": [
            {
                "url": "https://example.com/car1.jpg",
                "title": "McLaren P1",
                "thumbnail": "https://example.com/thumb1.jpg",
                "source": "caranddriver.com",
            }
        ],
        "layout": "carousel",
    }
    envelope = to_envelope("image_gallery", gallery_data)
    parsed = parse_envelope(envelope)
    assert parsed is not None
    assert parsed["type"] == "image_gallery"
    assert parsed["data"]["title"] == "Supercars"
    assert len(parsed["data"]["images"]) == 1
    assert parsed["data"]["images"][0]["url"] == "https://example.com/car1.jpg"


@pytest.mark.asyncio
async def test_search_images_tool(monkeypatch):
    from backend.tools.base import ToolContext
    from backend.tools.builtin.image_search import search_images

    async def mock_search_images(query, limit=12):
        return [
            {
                "url": "https://example.com/ferrari.jpg",
                "thumbnail": "https://example.com/ferrari_thumb.jpg",
                "title": "Ferrari F40 in Red",
                "source": "autocar.co.uk",
            }
        ]

    monkeypatch.setattr("backend.web.search_service.search_images", mock_search_images)
    ctx = ToolContext(conversation_id="c1")
    res = await search_images({"query": "Ferrari F40", "limit": 4}, ctx)
    assert not res.is_error
    assert "Ferrari F40" in res.content
    assert "amethyst:widget" in res.content
    assert "image_gallery" in res.content


@pytest.mark.asyncio
async def test_image_gallery_only_for_explicit_tag(monkeypatch):
    from backend.agent import widgets

    async def mock_search_images(query, limit=12):
        return [
            {
                "url": "https://example.com/img.jpg",
                "thumbnail": "https://example.com/thumb.jpg",
                "title": "Test Image",
                "source": "example.com",
            }
        ]

    monkeypatch.setattr("backend.web.search_service.search_images", mock_search_images)

    # General queries mentioning images/pictures MUST NOT trigger image gallery widget
    for general in (
        "Seperate images",
        "Get me 10 images of jason and lucia from gta 6 seperately",
        "pictures of cute cats",
        "show me screenshots",
    ):
        res = await widgets.classify_and_extract(general)
        assert res == ("none", None, []), f"Unexpected widget for {general}: {res}"

    # Explicit @images / /images tags DO trigger image gallery widget
    for tagged in (
        "@images jason and lucia",
        "jason and lucia @images",
        "/images nature",
        "@image cars",
    ):
        res = await widgets.classify_and_extract(tagged)
        assert res[0] == "image_gallery", f"Expected image_gallery for {tagged}, got {res}"
        assert res[1] is not None


@pytest.mark.asyncio
async def test_coastal_trip_itinerary_extraction():
    from backend.agent import widgets

    kind, data, media = await widgets.classify_and_extract("plan a coastil trip from SF to LA")
    assert kind == "itinerary"
    assert data is not None
    assert "_full_text" in data
    assert "The ultimate California coastal road trip" in data["_full_text"]
    assert "amethyst:widget" in data["_full_text"]
    assert "Check Highway 1 before departure" in data["_full_text"]

    assert len(data.get("hero_images", [])) >= 3
    assert data.get("distance_miles") == "About 450–500 miles"
    assert data.get("driving_time") == "9–11 hours of driving in total"
    assert len(data.get("days", [])) == 4

    day1 = data["days"][0]
    assert "San Francisco" in day1["title"]
    assert len(day1["stops"]) >= 3
    for stop in day1["stops"]:
        assert stop.get("latitude") is not None
        assert stop.get("longitude") is not None


def test_visualization_steer_instructions_coverage():
    from backend.agent.director import VISUALIZATION_STEER_INSTRUCTIONS

    assert "itinerary" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["itinerary"]
    assert "comparison" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["comparison"]
    assert "recipe" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["recipe"]
    assert "step_guide" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["step_guide"]
    assert "quiz" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["quiz"]
    assert "generate_sandboxed_ui" in VISUALIZATION_STEER_INSTRUCTIONS["calculator"]
    assert "generate_sandboxed_ui" in VISUALIZATION_STEER_INSTRUCTIONS["simulation"]


@pytest.mark.asyncio
async def test_classify_and_extract_skips_connected_service_intents(monkeypatch):
    """Messages with connected-service intents must skip classify_and_extract entirely."""
    from backend.agent import widgets

    def boom(*a, **kw):
        raise AssertionError("Model was resolved for a connected-service query")

    monkeypatch.setattr(widgets, "resolve", boom)

    connected_queries = (
        "what's on my calendar today",
        "summarize my latest email",
        "check my inbox for receipts",
        "create a github issue for bug 123",
        "post an update to slack",
        "search notion for engineering docs",
        "update my linear board",
    )
    for q in connected_queries:
        res = await widgets.classify_and_extract(q)
        assert res == ("none", None, []), f"Expected ('none', None, []) for {q!r}, got {res}"


@pytest.mark.asyncio
async def test_classify_and_extract_skips_missing_widget_signals(monkeypatch):
    """Messages with no widget signals must skip classify_and_extract without model calls."""
    from backend.agent import widgets

    def boom(*a, **kw):
        raise AssertionError("Model was resolved for a query without widget signals")

    monkeypatch.setattr(widgets, "resolve", boom)

    plain_queries = (
        "what is the capital of Australia?",
        "explain the theory of relativity briefly",
        "search the web for python asyncio gather",
    )
    for q in plain_queries:
        res = await widgets.classify_and_extract(q)
        assert res == ("none", None, []), f"Expected ('none', None, []) for {q!r}, got {res}"




