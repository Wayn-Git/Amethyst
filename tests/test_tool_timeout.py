from __future__ import annotations

import asyncio
import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director
from backend.runtime.chain import Link
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


class MockModelClient:
    def __init__(self, responses: list[ModelResponse]):
        self.responses = list(responses)

    async def stream(self, messages, tools=None, params=None):
        if not self.responses:
            yield type("Chunk", (), {"type": "text", "text": "All done."})()
            yield type("Chunk", (), {"type": "done", "response": ModelResponse(text="All done.")})()
            return
        resp = self.responses.pop(0)
        if resp.text:
            yield type("Chunk", (), {"type": "text", "text": resp.text})()
        yield type("Chunk", (), {"type": "done", "response": resp})()

    async def complete(self, messages, tools=None, params=None):
        if not self.responses:
            return ModelResponse(text="All done.")
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_single_tool_hard_timeout(monkeypatch):
    """A tool that hangs beyond its timeout is stopped and returns a clean error."""
    from backend.db.repositories import ConversationRepository

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def hanging_handler(args, ctx):
        await asyncio.sleep(2.0)
        return ToolResult.ok("finished")

    # Register tool with short timeout (0.15s)
    hanging_tool = Tool(
        name="slow_operation",
        description="Slow operation",
        parameters={"type": "object", "properties": {}},
        handler=hanging_handler,
        risk=RiskLevel.LOW,
        timeout=0.15,
    )
    registry.register(hanging_tool)

    resp1 = ModelResponse(
        text="Running slow operation...",
        tool_calls=[ToolCall(id="tc1", name="slow_operation", arguments={})],
    )
    resp2 = ModelResponse(text="Operation timed out, continuing.")

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)
    events = [e async for e in director.run(cid, "run slow op")]

    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    assert tool_results[0].data["is_error"] is True
    assert "timed out after 0s and was stopped" in tool_results[0].data["content"] or "timed out" in tool_results[0].data["content"]


@pytest.mark.asyncio
async def test_parallel_batch_partial_timeout_resilience(monkeypatch):
    """In a parallel batch, completed siblings succeed while a timed-out sibling returns an error."""
    from backend.db.repositories import ConversationRepository

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))
    received_messages_in_r2 = []

    async def fast_handler(args, ctx):
        await asyncio.sleep(0.02)
        return ToolResult.ok("Fast data: [alpha, beta, gamma]")

    async def hanging_handler(args, ctx):
        await asyncio.sleep(2.0)
        return ToolResult.ok("Should never reach here")

    # Fast tool
    registry.register(
        Tool(
            name="fast_tool",
            description="Fast query",
            parameters={"type": "object", "properties": {}},
            handler=fast_handler,
            risk=RiskLevel.LOW,
        )
    )

    # Hanging tool with short timeout (0.15s)
    registry.register(
        Tool(
            name="hanging_tool",
            description="Hanging query",
            parameters={"type": "object", "properties": {}},
            handler=hanging_handler,
            risk=RiskLevel.LOW,
            timeout=0.15,
        )
    )

    resp1 = ModelResponse(
        text="Running fast and hanging tools in parallel...",
        tool_calls=[
            ToolCall(id="tc_fast", name="fast_tool", arguments={}),
            ToolCall(id="tc_hang", name="hanging_tool", arguments={}),
        ],
    )

    class InspectingMockClient:
        def __init__(self):
            self.round = 0

        async def complete(self, messages, tools=None, params=None):
            self.round += 1
            if self.round == 1:
                return resp1
            received_messages_in_r2.extend(messages)
            return ModelResponse(text="Answer synthesized with fast data.")

    inspecting_client = InspectingMockClient()
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=inspecting_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)
    events = [e async for e in director.run(cid, "run parallel")]

    # Check that both tool_result events were emitted
    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2

    fast_res = next(r for r in tool_results if r.data["name"] == "fast_tool")
    assert fast_res.data["is_error"] is False
    assert "Fast data: [alpha, beta, gamma]" in fast_res.data["content"]

    hang_res = next(r for r in tool_results if r.data["name"] == "hanging_tool")
    assert hang_res.data["is_error"] is True
    assert "timed out" in hang_res.data["content"]

    # Verify that the model received both results in round 2
    tool_msgs = [m for m in received_messages_in_r2 if m.get("role") == "tool"]
    assert len(tool_msgs) >= 2
    tool_contents = [m.get("content", "") for m in tool_msgs]
    assert any("Fast data: [alpha, beta, gamma]" in c for c in tool_contents)
    assert any("timed out" in c for c in tool_contents)


@pytest.mark.asyncio
async def test_global_tool_timeout_seconds_configuration(monkeypatch):
    """When a tool has no explicit timeout, it obeys agent_config.tool_timeout_seconds."""
    from backend.db.repositories import ConversationRepository

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def slow_handler(args, ctx):
        await asyncio.sleep(0.5)
        return ToolResult.ok("done")

    registry.register(
        Tool(
            name="default_timeout_tool",
            description="Default timeout tool",
            parameters={"type": "object", "properties": {}},
            handler=slow_handler,
            risk=RiskLevel.LOW,
            # No tool.timeout set -> uses agent_config.tool_timeout_seconds
        )
    )

    # Temporarily set agent_config.tool_timeout_seconds to 0.1s
    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 0.1)

    resp1 = ModelResponse(
        text="Running tool with global timeout...",
        tool_calls=[ToolCall(id="tc_glob", name="default_timeout_tool", arguments={})],
    )
    resp2 = ModelResponse(text="Done.")

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)
    events = [e async for e in director.run(cid, "test global timeout")]

    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    assert tool_results[0].data["is_error"] is True
    assert "timed out" in tool_results[0].data["content"]
