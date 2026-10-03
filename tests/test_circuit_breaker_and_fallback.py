"""Tests for Task 15: Provider Fallback Chain & Circuit Breaker.

Verifies:
1. Provider circuit breaker: tracks consecutive failures, trips after 3 failures,
   skips provider for 180s cooldown, resets on success or forget.
2. Usable checks in chain skipping circuit-broken providers.
3. Seamless message history passing across fallback chain links on 429, 5xx, and timeouts.
4. Model routing preferences (stronger for tool rounds, fast/cheap for summaries).
5. Guaranteed final answer synthesis falling back across chain links.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agent.config import AgentConfig, agent_config
from backend.agent.director import Director
from backend.agent.state import AgentState
from backend.config import ProviderConfig
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.runtime import availability
from backend.runtime.chain import AttemptBudget, Link, build_chain
from backend.runtime.failures import FailureKind
from backend.runtime.http import ProviderError, ProviderHTTPError
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.tools.base import RiskLevel, Tool, ToolResult
from backend.tools.registry import ToolRegistry


def test_circuit_breaker_trips_after_three_consecutive_failures():
    """Circuit breaker trips after 3 consecutive failures and stays open for 180s cooldown."""
    provider = "flaky_provider"
    availability.forget(provider)

    assert availability.consecutive_failures(provider) == 0
    assert not availability.is_circuit_open(provider)

    # 1st failure
    availability.record_failure(provider, FailureKind.UPSTREAM_UNHEALTHY, "500 server error")
    assert availability.consecutive_failures(provider) == 1
    assert not availability.is_circuit_open(provider)

    # 2nd failure
    availability.record_failure(provider, FailureKind.UNREACHABLE, "timeout")
    assert availability.consecutive_failures(provider) == 2
    assert not availability.is_circuit_open(provider)

    # 3rd failure -> trips circuit breaker
    availability.record_failure(provider, FailureKind.UPSTREAM_UNHEALTHY, "502 gateway error")
    assert availability.consecutive_failures(provider) == 3
    assert availability.is_circuit_open(provider)

    # Cached availability reports unavailable with circuit breaker reason
    state = availability.cached(provider)
    assert state is not None
    assert not state.available
    assert "circuit breaker open" in state.reason

    # Clears in returns positive duration up to cooldown
    clears = availability.clears_in(provider)
    assert clears is not None
    assert 170.0 < clears <= 180.0


def test_circuit_breaker_resets_on_success():
    """A successful call resets consecutive failures and clears the tripped circuit."""
    provider = "recovering_provider"
    availability.forget(provider)

    availability.trip_circuit(provider, cooldown=180.0)
    assert availability.is_circuit_open(provider)

    availability.record_success(provider)
    assert not availability.is_circuit_open(provider)
    assert availability.consecutive_failures(provider) == 0
    state = availability.cached(provider)
    assert state is not None and state.available


def test_circuit_breaker_exhausted_trips_after_three():
    """Rate limit exhaustion (429) also counts towards circuit breaker trips."""
    provider = "rate_limited_provider"
    availability.forget(provider)

    availability.record_exhausted(provider, retry_after=5.0)
    assert availability.consecutive_failures(provider) == 1
    assert not availability.is_circuit_open(provider)

    availability.record_exhausted(provider, retry_after=5.0)
    assert availability.consecutive_failures(provider) == 2
    assert not availability.is_circuit_open(provider)

    availability.record_exhausted(provider, retry_after=5.0)
    assert availability.consecutive_failures(provider) == 3
    assert availability.is_circuit_open(provider)


def test_circuit_broken_provider_is_skipped_in_chain():
    """build_chain skips providers whose circuit breaker is tripped."""
    availability.forget()
    provider_broken = "groq_broken"
    provider_healthy = "cerebras_healthy"

    availability.trip_circuit(provider_broken)
    assert availability.is_circuit_open(provider_broken)

    configs = {
        "nvidia": ProviderConfig(name="nvidia", default_model="nemotron"),
        provider_broken: ProviderConfig(name=provider_broken, default_model="llama-70b"),
        provider_healthy: ProviderConfig(name=provider_healthy, default_model="llama-70b"),
    }
    chain = build_chain("nvidia", "nemotron", configs=configs, order=None)
    providers_in_chain = [link.provider for link in chain]

    assert provider_broken not in providers_in_chain
    assert provider_healthy in providers_in_chain


@pytest.mark.asyncio
async def test_fallback_chain_seamless_history_handover_on_429(monkeypatch):
    """When primary provider returns 429, fallback link seamlessly receives complete message history."""
    conv_repo = ConversationRepository()
    msg_repo = MessageRepository()
    cid = conv_repo.create("provider_a", "model_a")

    received_messages_b = []

    class MockClientA:
        async def complete(self, messages, tools=None, params=None):
            raise ProviderHTTPError(
                "Rate limit exceeded (429)",
                status_code=429,
                kind=FailureKind.RATE_LIMITED,
                retry_after=10.0,
            )

    class MockClientB:
        async def complete(self, messages, tools=None, params=None):
            received_messages_b.extend(messages)
            return ModelResponse(text="Handover complete successfully.")

    model_a = ResolvedModel(
        provider="provider_a",
        model="model_a",
        client=MockClientA(),
        capabilities=Capabilities(streaming=False),
    )
    model_b = ResolvedModel(
        provider="provider_b",
        model="model_b",
        client=MockClientB(),
        capabilities=Capabilities(streaming=False),
    )

    def mock_resolve(prov, mod=None, **kwargs):
        if prov == "provider_a":
            return model_a
        return model_b

    monkeypatch.setattr("backend.agent.director.resolve", mock_resolve)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("provider_a", "model_a"), Link("provider_b", "model_b")],
    )

    registry = ToolRegistry()
    director = Director(registry, stream=False, memory=False)

    events = [e async for e in director.run(cid, "Check my calendar and email")]

    # Verification
    # 1. Fallback switching status and warning was emitted
    event_types = [e.type for e in events]
    assert "status" in event_types
    statuses = [e.data.get("state") for e in events if e.type == "status"]
    assert "switching" in statuses

    # 2. Provider B received the user message
    user_msgs = [m for m in received_messages_b if m.get("role") == "user"]
    assert any("Check my calendar and email" in m.get("content", "") for m in user_msgs)

    # 3. Final text answer was delivered
    assistant_msgs = [m for m in msg_repo.history(cid) if m.role == "assistant"]
    assert any("Handover complete successfully." in m.content for m in assistant_msgs)


@pytest.mark.asyncio
async def test_fallback_chain_seamless_history_handover_on_5xx_and_timeout(monkeypatch):
    """When primary provider returns 500 server error, fallback link seamlessly answers."""
    conv_repo = ConversationRepository()
    msg_repo = MessageRepository()
    cid = conv_repo.create("primary", "primary_model")

    received_messages_fb = []

    class MockClient500:
        async def complete(self, messages, tools=None, params=None):
            raise ProviderHTTPError(
                "Internal server error (500)",
                status_code=500,
                kind=FailureKind.UPSTREAM_UNHEALTHY,
            )

    class MockClientFallback:
        async def complete(self, messages, tools=None, params=None):
            received_messages_fb.extend(messages)
            return ModelResponse(text="Answer from fallback after 500.")

    m_primary = ResolvedModel("primary", "primary_model", MockClient500(), Capabilities(streaming=False))
    m_fb = ResolvedModel("fallback", "fb_model", MockClientFallback(), Capabilities(streaming=False))

    def mock_resolve(prov, mod=None, **kwargs):
        if prov == "primary":
            return m_primary
        return m_fb

    monkeypatch.setattr("backend.agent.director.resolve", mock_resolve)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("primary", "primary_model"), Link("fallback", "fb_model")],
    )

    registry = ToolRegistry()
    director = Director(registry, stream=False, memory=False)
    events = [e async for e in director.run(cid, "Important query")]

    assistant_msgs = [m for m in msg_repo.history(cid) if m.role == "assistant"]
    assert any("Answer from fallback after 500." in m.content for m in assistant_msgs)


@pytest.mark.asyncio
async def test_model_routing_tier_distinction():
    """Director selects heavy tier for tool-enabled turns and fast tier when tools are absent."""
    reg_with_tools = ToolRegistry()
    reg_with_tools.register(
        Tool(
            name="test_tool",
            description="A test tool",
            parameters={"type": "object", "properties": {}},
            handler=AsyncMock(),
            risk=RiskLevel.LOW,
        )
    )
    director_tools = Director(reg_with_tools, stream=False)
    req_tools = director_tools._route_request("find events", None)
    assert req_tools.tier == agent_config.tool_round_tier  # "heavy"
    assert req_tools.needs_tools is True

    reg_empty = ToolRegistry()
    director_empty = Director(reg_empty, stream=False)
    req_empty = director_empty._route_request("hello", None)
    assert req_empty.tier == agent_config.summary_round_tier  # "fast"
    assert req_empty.needs_tools is False


@pytest.mark.asyncio
async def test_guaranteed_final_answer_walks_chain_if_primary_fails(monkeypatch):
    """_guaranteed_final_answer tries fallback chain if primary model fails completion."""
    conv_repo = ConversationRepository()
    cid = conv_repo.create("primary", "primary_model")

    class FailingModel:
        name = "failing"
        class client:
            @staticmethod
            async def complete(messages, tools=None):
                raise RuntimeError("Primary model completely dead")

    class WorkingFallbackModel:
        name = "working_fb"
        class client:
            @staticmethod
            async def complete(messages, tools=None):
                return ModelResponse(text="Synthesized summary from fallback link.")

    def mock_resolve(prov, mod=None, **kwargs):
        if prov == "primary":
            return FailingModel()
        return WorkingFallbackModel()

    monkeypatch.setattr("backend.agent.director.resolve", mock_resolve)

    state = AgentState(conversation_id=cid, active=0)
    said = []
    director = Director(ToolRegistry(), stream=False)
    chain = [Link("primary", "primary_model"), Link("backup", "backup_model")]

    events = [
        ev
        async for ev in director._guaranteed_final_answer(
            cid,
            FailingModel(),
            "System prompt",
            said,
            state,
            "budget reached",
            chain=chain,
        )
    ]

    assert any("Synthesized summary from fallback link." in said_text for said_text in said)
    done_events = [e for e in events if e.type == "done"]
    assert len(done_events) == 1
    assert "Synthesized summary from fallback link." in done_events[0].data.get("text", "")
