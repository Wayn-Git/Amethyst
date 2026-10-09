"""The subagent model fallback (amethyst-v2 Phase 01, Task 1).

`configured_providers()` returns a dict, and the last-resort branch indexed it
with `[0]` -- a KeyError swallowed by `except Exception: pass`, so the branch
always returned None and every subagent died with "No model available". Each
test names the mutation that makes it fail.
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.agent.runner import SubagentRunner
from backend.agent.types import AgentType
from backend.config import ProviderConfig


def _agent(**kw):
    return AgentType(name="worker", mode="subagent", description="d", **kw)


def _runner():
    # `_resolve_model` touches no instance state; building the real registry
    # pulls in every builtin tool and is irrelevant here.
    return object.__new__(SubagentRunner)


def test_the_first_provider_comes_from_the_dict_not_a_position(monkeypatch):
    """Mutation check: `first = providers[0]` -- KeyError on a dict, swallowed,
    None returned, subagent dead with "No model available"."""
    monkeypatch.setattr(
        "backend.config.configured_providers",
        lambda: {"zulu": ProviderConfig(name="zulu", default_model="zulu-1")},
    )
    monkeypatch.setattr(
        "backend.agent.runner.resolve",
        lambda provider, model: SimpleNamespace(provider=provider, model=model),
    )

    got = _runner()._resolve_model(_agent(), None)

    assert got is not None, "the last resort must find a model"
    assert (got.provider, got.model) == ("zulu", "zulu-1")


def test_an_empty_registry_returns_none_rather_than_raising(monkeypatch):
    monkeypatch.setattr("backend.config.configured_providers", lambda: {})
    assert _runner()._resolve_model(_agent(), None) is None


def test_a_conversation_model_wins_over_the_last_resort(monkeypatch):
    from backend.db.repositories import ConversationRepository

    monkeypatch.setattr(
        "backend.config.configured_providers",
        lambda: {"zulu": ProviderConfig(name="zulu", default_model="zulu-1")},
    )
    monkeypatch.setattr(
        "backend.agent.runner.resolve",
        lambda provider, model: SimpleNamespace(provider=provider, model=model),
    )
    cid = ConversationRepository().create("conv-prov", "conv-model")

    got = _runner()._resolve_model(_agent(), cid)

    assert (got.provider, got.model) == ("conv-prov", "conv-model"), (
        "the conversation's own model beats the generic last resort"
    )


def test_a_failed_last_resort_logs_and_returns_none(monkeypatch, caplog):
    """Bare `pass` is how the original bug survived; the warning is the proof
    the failure is visible now.

    Mutation check: restore `except Exception: pass`.
    """
    import logging

    monkeypatch.setattr(
        "backend.config.configured_providers",
        lambda: {"zulu": ProviderConfig(name="zulu", default_model="zulu-1")},
    )

    def boom(provider, model):
        raise RuntimeError("no route to provider")

    monkeypatch.setattr("backend.agent.runner.resolve", boom)

    with caplog.at_level(logging.WARNING):
        got = _runner()._resolve_model(_agent(), None)

    assert got is None
    assert "subagent model fallback failed" in caplog.text
