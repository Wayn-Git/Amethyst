"""Routing priority, and what happens when a provider runs out of quota.

The failure these exist for: a provider that had 429'd a minute ago was still
tried first, and being written off for a flat five minutes whether it asked for
six seconds or an hour. Neither is routing around a limit -- both are guessing
at one.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import pytest

from backend.runtime import availability
from backend.runtime.chain import Link, build_chain
from backend.runtime.failures import FailureKind
from backend.runtime.http import reset_after


@pytest.fixture(autouse=True)
def _forget():
    availability.forget()
    yield
    availability.forget()


# --- reading what the provider said -----------------------------------------


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"retry-after": "5"}, 5.0),
        # Groq's own shape, from a real 429 body: "try again in 5.835s".
        ({"retry-after": "5.835s"}, 5.835),
        ({"x-ratelimit-reset-tokens": "1m30s"}, 90.0),
        ({"x-ratelimit-reset-requests": "250ms"}, 0.25),
        # Clamped: an hour is "not now", and pinning availability on one header
        # for an hour is how a recovered provider stays dark.
        ({"retry-after": "3h"}, 900.0),
        ({}, None),
        ({"retry-after": "soon"}, None),
    ],
)
def test_a_reset_header_is_read_however_the_provider_writes_it(headers, expected):
    """`float()` alone rejects `5.835s`, so a provider that said exactly when it
    would clear was read as having said nothing.

    Mutation check: parse with `float()` only.
    """
    import httpx

    assert reset_after(httpx.Headers(headers)) == expected


def test_an_http_date_retry_after_is_seconds_from_now_not_a_timestamp():
    """`Retry-After` is allowed to be an HTTP-date. Read as a bare number it is
    an astronomically large duration -- clamped, but wrong in the direction
    that leaves a healthy provider dark for the maximum.

    Mutation check: delete the date branch in `_duration`.
    """
    import httpx

    soon = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=45))
    seconds = reset_after(httpx.Headers({"retry-after": soon}))
    assert seconds is not None and 30 < seconds < 60


# --- remembering it ---------------------------------------------------------


def test_exhaustion_lasts_as_long_as_the_provider_asked_for():
    """Not a flat five minutes. Groq says 5.8s; an account out of monthly quota
    says an hour. Treating both the same keeps one dark too long and lets the
    other back in to fail again.

    Mutation check: ignore `retry_after` and always use FAILURE_TTL_SECONDS.
    """
    availability.record_exhausted("groq", retry_after=30.0, message="out of tokens")
    clears = availability.clears_in("groq")
    assert clears is not None and 25 < clears <= 30

    state = availability.cached("groq")
    assert state is not None and state.available is False
    assert state.exhausted is True, "exhausted is distinct from unreachable"


def test_a_provider_that_said_nothing_gets_the_default_sulk():
    availability.record_exhausted("llm7", retry_after=None)
    clears = availability.clears_in("llm7")
    assert clears is not None and clears > 60


def test_a_moment_is_rounded_up_so_the_retry_does_not_land_first():
    """A provider that just refused will refuse a retry 800ms later.

    Mutation check: drop the ten-second floor.
    """
    availability.record_exhausted("groq", retry_after=0.4)
    clears = availability.clears_in("groq")
    assert clears is not None and clears >= 9


def test_an_unreachable_provider_is_not_reported_as_exhausted():
    """"Wait" and "fix it" are different instructions."""
    availability.record_failure("ollama", FailureKind.UNREACHABLE)
    state = availability.cached("ollama")
    assert state is not None and state.available is False and state.exhausted is False


def test_a_provider_that_answers_clears_what_was_remembered():
    availability.record_exhausted("groq", retry_after=300.0)
    availability.record_success("groq")
    assert availability.clears_in("groq") is None
    assert availability.cached("groq").available is True


# --- routing around it ------------------------------------------------------


def _configs():
    from backend.config import ProviderConfig

    return {
        name: ProviderConfig(name=name, default_model=f"{name}-1")
        for name in ("nvidia", "cloudflare", "google", "groq")
    }


def test_the_priority_order_decides_who_answers_next():
    chain = build_chain(
        "nvidia", "nemotron", configs=_configs(), order=["nvidia", "cloudflare", "google", "groq"]
    )
    assert [link.provider for link in chain] == ["nvidia", "cloudflare", "google"]


def test_an_exhausted_provider_is_left_out_of_the_chain():
    """`_usable` already did this for failures; it has to hold for quota too.

    Mutation check: drop the `availability.cached` check from `_usable`.
    """
    availability.record_exhausted("cloudflare", retry_after=120.0)
    chain = build_chain(
        "nvidia", "nemotron", configs=_configs(), order=["nvidia", "cloudflare", "google", "groq"]
    )
    assert [link.provider for link in chain] == ["nvidia", "google", "groq"]
    assert Link(provider="cloudflare", model="cloudflare-1") not in chain


def test_the_chosen_provider_stays_in_the_chain_even_when_exhausted():
    """It is stepped over at the head of the turn, not removed: if every
    alternative is also down, asking the provider the user actually chose is
    better than refusing to try anything."""
    availability.record_exhausted("nvidia", retry_after=120.0)
    chain = build_chain(
        "nvidia", "nemotron", configs=_configs(), order=["nvidia", "cloudflare", "google", "groq"]
    )
    assert chain[0].provider == "nvidia"


# --- the turn itself --------------------------------------------------------


def _registry():
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.registry import ToolRegistry

    return ToolRegistry(ConfirmationService(auto_approve))


def _model(client, provider, model):
    from backend.runtime.types import Capabilities, ResolvedModel

    return ResolvedModel(
        provider=provider,
        model=model,
        client=client,
        capabilities=Capabilities(streaming=False, context_window=32_000),
    )


class _Answers:
    def __init__(self, text):
        self.text, self.calls = text, 0

    async def complete(self, messages, tools=None, params=None):
        from backend.runtime.types import ModelResponse

        self.calls += 1
        return ModelResponse(text=self.text)


async def test_a_turn_started_on_an_exhausted_provider_answers_elsewhere(db, monkeypatch):
    """And says so, rather than spending the first attempt proving the 429.

    `build_chain` skips exhausted providers when it picks the alternatives, but
    the chosen one goes in unconditionally -- so a conversation pinned to a
    provider that ran out a minute ago failed at the head of every turn until
    the memory expired.

    Mutation check: delete the pre-resolve skip loop in `Director._run`.
    """
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository

    answered = _Answers("cloudflare answered")
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda provider, model, **kw: [
            Link(provider="nvidia", model="nemotron"),
            Link(provider="cloudflare", model="llama"),
        ],
    )
    asked: list[str] = []

    def resolve(provider, model=None, **kw):
        asked.append(provider)
        return _model(answered, provider, model or "m")

    monkeypatch.setattr("backend.agent.director.resolve", resolve)
    availability.record_exhausted("nvidia", retry_after=120.0, message="out of tokens")

    cid = ConversationRepository().create("nvidia", "nemotron")
    events = [
        e async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(cid, "hi")
    ]
    kinds = [e.type for e in events]

    assert asked == ["cloudflare"], "the exhausted provider is never asked"
    assert kinds[-1] == "done"
    switched = [e for e in events if e.type == "status" and e.data.get("state") == "switching"]
    assert switched and switched[0].data["provider"] == "cloudflare"
    warnings = [e.data["message"] for e in events if e.type == "warning"]
    assert warnings and "nvidia is out of quota" in warnings[0], (
        "the substitution is announced, never silent"
    )


async def test_a_healthy_provider_is_not_stepped_over(db, monkeypatch):
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository

    answered = _Answers("nvidia answered")
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda provider, model, **kw: [
            Link(provider="nvidia", model="nemotron"),
            Link(provider="cloudflare", model="llama"),
        ],
    )
    asked: list[str] = []

    def resolve(provider, model=None, **kw):
        asked.append(provider)
        return _model(answered, provider, model or "m")

    monkeypatch.setattr("backend.agent.director.resolve", resolve)

    cid = ConversationRepository().create("nvidia", "nemotron")
    events = [
        e async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(cid, "hi")
    ]

    assert asked == ["nvidia"]
    assert not [e for e in events if e.type == "warning"], "nothing to announce"


async def test_the_last_link_is_asked_even_when_it_is_exhausted(db, monkeypatch):
    """Stepping over the only provider left would refuse to try anything.

    Mutation check: change the skip loop's bound to `len(chain)`.
    """
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository

    answered = _Answers("answered anyway")
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda provider, model, **kw: [Link(provider="nvidia", model="nemotron")],
    )
    asked: list[str] = []

    def resolve(provider, model=None, **kw):
        asked.append(provider)
        return _model(answered, provider, model or "m")

    monkeypatch.setattr("backend.agent.director.resolve", resolve)
    availability.record_exhausted("nvidia", retry_after=120.0)

    cid = ConversationRepository().create("nvidia", "nemotron")
    events = [
        e async for e in Director(_registry(), stream=False, memory=False, retrieval=False).run(cid, "hi")
    ]

    assert asked == ["nvidia"], "the only provider is still asked"
    assert events[-1].type == "done"
