from __future__ import annotations

import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director, FINAL_STEP_INSTRUCTION
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolResult
from backend.tools.registry import ToolRegistry


@pytest.mark.asyncio
async def test_system_context_injects_steps_remaining_and_final_step(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy_handler(args, ctx):
        return ToolResult.ok("Data retrieved")

    registry.register(Tool(
        name="fetch_info",
        description="Fetch info",
        parameters={},
        handler=dummy_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    received_messages_per_round = []
    received_tools_per_round = []

    responses = iter([
        ModelResponse(tool_calls=[ToolCall(id="c1", name="fetch_info", arguments={})]),
        ModelResponse(text="Here is your final answer based on the retrieved data."),
    ])

    class Client:
        async def complete(self, messages, tools=None, params=None):
            received_messages_per_round.append(messages)
            received_tools_per_round.append(tools)
            return next(responses)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "fetch data and answer"):
        events.append(ev)

    assert len(received_messages_per_round) == 2

    # Round 1: intermediate round, tools available, steps remaining injected
    r1_system_contents = [m["content"] for m in received_messages_per_round[0] if m.get("role") == "system"]
    assert any("steps remaining:" in c for c in r1_system_contents)
    assert received_tools_per_round[0] is not None

    # Round 2: final answer emitted
    done_events = [e.data for e in events if e.type == "done"]
    assert len(done_events) >= 1
    assert "Here is your final answer" in done_events[-1]["text"]


@pytest.mark.asyncio
async def test_guaranteed_final_answer_synthesizes_on_iteration_limit(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    call_count = 0

    async def repeating_handler(args, ctx):
        nonlocal call_count
        call_count += 1
        return ToolResult.ok(f"Result piece #{call_count}")

    registry.register(Tool(
        name="do_work",
        description="Do work",
        parameters={"step": {"type": "integer"}},
        handler=repeating_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    # Configure a tiny budget of 2 rounds
    monkeypatch.setattr(agent_config, "default_step_budget", 2)
    monkeypatch.setattr(agent_config, "max_iterations", 2)
    monkeypatch.setattr(agent_config, "max_continuations", 0)

    final_call_received_tools = "uncalled"
    final_call_received_params = None

    class Client:
        def __init__(self):
            self.turn = 0

        async def complete(self, messages, tools=None, params=None):
            nonlocal final_call_received_tools, final_call_received_params
            self.turn += 1
            if tools is not None:
                # Model keeps wanting to call tools without providing final answer
                return ModelResponse(tool_calls=[ToolCall(id=f"c{self.turn}", name="do_work", arguments={"step": self.turn})])
            else:
                # Terminal final answer call: tools=None, tool_choice="none"
                final_call_received_tools = tools
                final_call_received_params = params
                return ModelResponse(text="Synthesized final answer from 2 pieces of data.")

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "do repeating work"):
        events.append(ev)

    # Verify tools=None was passed to the guaranteed final answer call
    assert final_call_received_tools is None
    assert final_call_received_params is not None
    assert getattr(final_call_received_params, "tool_choice", None) == "none"

    # Verify a synthesized final answer was delivered
    done_events = [e.data for e in events if e.type == "done"]
    assert len(done_events) >= 1
    assert "Synthesized final answer from 2 pieces of data" in done_events[-1]["text"]


@pytest.mark.asyncio
async def test_guaranteed_final_answer_falls_back_to_summarise_if_model_fails(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def work_handler(args, ctx):
        return ToolResult.ok("Some work output")

    registry.register(Tool(
        name="work_tool",
        description="Work tool",
        parameters={},
        handler=work_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    monkeypatch.setattr(agent_config, "default_step_budget", 1)
    monkeypatch.setattr(agent_config, "max_iterations", 1)
    monkeypatch.setattr(agent_config, "max_continuations", 0)

    class Client:
        async def complete(self, messages, tools=None, params=None):
            if tools is not None:
                return ModelResponse(tool_calls=[ToolCall(id="1", name="work_tool", arguments={})])
            # Model crashes on final answer call
            raise RuntimeError("Model service down")

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "do work"):
        events.append(ev)

    # Must have fallen back to _summarise rather than dropping into silence
    done_events = [e.data for e in events if e.type == "done"]
    assert len(done_events) >= 1
    assert "work_tool" in done_events[-1]["text"]
