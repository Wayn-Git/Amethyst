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
