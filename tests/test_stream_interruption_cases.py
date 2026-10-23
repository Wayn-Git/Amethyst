"""Regression tests simulating stream failure and recovery scenarios:
(a) stream cut mid-text
(b) stream cut mid tool-call JSON
(c) error event inside a 200 response
(d) 429 with Retry-After
(e) 90-second approval wait
(f) provider fallback
Each ends in a completed answer without user action.
"""

from __future__ import annotations

import asyncio
import time
import pytest

from backend.agent.director import Director
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.runtime import availability
from backend.runtime.chain import Link
from backend.runtime.failures import FailureKind
from backend.runtime.http import ProviderHTTPError, ProviderStreamError
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, StreamEvent, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolResult
from backend.tools.registry import ToolRegistry, build_default_registry


def text(chunk: str) -> StreamEvent:
    return StreamEvent(type="text", text=chunk)


def done(answer: str) -> StreamEvent:
    return StreamEvent(type="done", response=ModelResponse(text=answer))


@pytest.fixture(autouse=True)
def forget_failures():
    availability.forget()
    yield
    availability.forget()


class ScriptedStreamer:
    def __init__(self, scripts: list[list[StreamEvent | Exception]]):
        self.scripts = list(scripts)
        self.calls = 0

    async def stream(self, messages, tools=None, params=None):
        self.calls += 1
        script = self.scripts.pop(0) if self.scripts else [done("default")]
        for item in script:
            if isinstance(item, Exception):
                raise item
            yield item

    async def complete(self, messages, tools=None, params=None):
        self.calls += 1
        return ModelResponse(text="completed")


def make_model(provider: str, client) -> ResolvedModel:
    return ResolvedModel(
        provider=provider,
        model=f"{provider}-1",
        client=client,
        capabilities=Capabilities(streaming=True, context_window=32_000),
    )


async def test_case_a_stream_cut_mid_text(db, workspace, monkeypatch):
    """(a) A stream cut mid-text auto-recovers and completes without user action."""
    streamer = ScriptedStreamer([
        [text("The capital of France is"), ProviderStreamError("stream dropped mid-text", kind=FailureKind.UPSTREAM_UNHEALTHY)],
        [text(" Paris."), done("The capital of France is Paris.")],
    ])
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: make_model("fake", streamer),
    )

    cid = ConversationRepository().create("fake", "fake-1")
    reg = build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "what is the capital of France?")]
    types = [e.type for e in events]

    assert "error" not in types, "turn ended in error instead of resuming"
    assert any(e.type == "status" and e.data.get("state") == "resuming" for e in events)

    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "Paris" in kept
    assert "[model error]" not in kept


async def test_case_b_stream_cut_mid_tool_call_json(db, workspace, monkeypatch):
    """(b) A stream cut mid tool-call JSON discards the partial call, retries, and finishes."""
    # Step 1 attempt 1: cut mid tool-call JSON
    # Step 1 attempt 2: successful complete tool call
    # Step 2: final answer
    tool_call = ToolCall(id="call_list", name="list_files", arguments={"path": "."})

    streamer = ScriptedStreamer([
        [
            StreamEvent(type="tool_arguments", tool_name="list_files", tool_index=0, arguments_so_far='{"path": "/incompl'),
            ProviderStreamError("stream dropped mid tool JSON", kind=FailureKind.UPSTREAM_UNHEALTHY),
        ],
        [
            StreamEvent(type="done", response=ModelResponse(tool_calls=[tool_call])),
        ],
        [
            text("Found workspace files."),
            done("Found workspace files."),
        ],
    ])
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: make_model("fake", streamer),
    )

    cid = ConversationRepository().create("fake", "fake-1")
    reg = build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "list files")]
    types = [e.type for e in events]

    assert "error" not in types, "turn failed on mid tool-call stream cut"
    assert any(e.type == "tool_result" for e in events), "tool call was not executed on retry"
    assert any(e.type == "assistant_delta" for e in events)

    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "Found workspace files" in kept


async def test_case_c_error_event_inside_200_response(db, workspace, monkeypatch):
    """(c) An error event inside a 200 response auto-recovers and completes."""
    streamer = ScriptedStreamer([
        [ProviderStreamError('{"error": {"message": "Error in input stream"}}', kind=FailureKind.UPSTREAM_UNHEALTHY)],
        [text("NIM recovered and answered."), done("NIM recovered and answered.")],
    ])
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: make_model("fake", streamer),
    )

    cid = ConversationRepository().create("fake", "fake-1")
    reg = build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "test error event")]
    types = [e.type for e in events]

    assert "error" not in types
    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "NIM recovered" in kept


async def test_case_d_429_with_retry_after(db, workspace, monkeypatch):
    """(d) A 429 with Retry-After respects the wait and finishes the turn without user action."""
    streamer = ScriptedStreamer([
        [ProviderHTTPError("rate limit exceeded", kind=FailureKind.RATE_LIMITED, retry_after=0.05, status=429)],
        [text("Answered after 429 wait."), done("Answered after 429 wait.")],
    ])
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *a, **k: [Link(provider="fake", model="fake-1")],
    )
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: make_model("fake", streamer),
    )

    cid = ConversationRepository().create("fake", "fake-1")
    reg = build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "test 429")]
    types = [e.type for e in events]

    assert "error" not in types
    assert any(e.type == "status" and e.data.get("state") == "reconnecting" for e in events)
    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "Answered after 429 wait" in kept


async def test_case_e_90_second_approval_wait(db, workspace, monkeypatch):
    """(e) A 90-second approval wait does not leave stale socket or stream failures."""
    async def _guarded_handler(args, context):
        if getattr(context.state, "suspended_at", None):
            context.state.suspended_at -= 90.0
        return ToolResult.ok("action executed")

    tool = Tool(
        name="guarded_action",
        description="A sensitive tool needing approval",
        parameters={"type": "object", "properties": {}},
        handler=_guarded_handler,
    )

    class ApprovalGate:
        def requires_confirmation(self, tool_name, operation=None, params=None):
            return True
        async def request_confirmation(self, request):
            return True

    reg = ToolRegistry(ConfirmationService(ApprovalGate()))
    reg.register(tool)

    tool_call = ToolCall(id="c-guarded", name="guarded_action", arguments={})
    streamer = ScriptedStreamer([
        [StreamEvent(type="done", response=ModelResponse(tool_calls=[tool_call]))],
        [text("Action was approved and finished successfully."), done("Action was approved and finished successfully.")],
    ])
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: make_model("fake", streamer),
    )

    cid = ConversationRepository().create("fake", "fake-1")
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "run guarded action")]
    types = [e.type for e in events]

    assert "error" not in types
    assert any(e.type == "confirmation_required" for e in events)
    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "approved and finished" in kept


async def test_case_f_provider_fallback(db, workspace, monkeypatch):
    """(f) Provider fallback switches to next configured provider and completes."""
    primary_streamer = ScriptedStreamer([
        [ProviderHTTPError("fake-1 unavailable", kind=FailureKind.UNREACHABLE)],
        [ProviderHTTPError("fake-1 unavailable", kind=FailureKind.UNREACHABLE)],
    ])
    fallback_streamer = ScriptedStreamer([
        [text("Answer from fallback provider fake-2."), done("Answer from fallback provider fake-2.")],
    ])

    models = {
        "fake-1": make_model("fake-1", primary_streamer),
        "fake-2": make_model("fake-2", fallback_streamer),
    }

    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *a, **k: [Link(provider="fake-1", model="model-1"), Link(provider="fake-2", model="model-2")],
    )
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda provider, model=None, **kw: models[provider],
    )

    cid = ConversationRepository().create("fake-1", "model-1")
    reg = build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))
    d = Director(reg, workspace_root=str(workspace), memory=False, retrieval=False, stream=True)

    events = [event async for event in d.run(cid, "test fallback")]
    types = [e.type for e in events]

    assert "error" not in types
    assert any(e.type == "warning" and "fake-2" in e.data.get("message", "") for e in events), "fallback not announced"
    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert "Answer from fallback provider fake-2." in kept
