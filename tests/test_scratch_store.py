from __future__ import annotations

import json
import pytest

from backend.agent.config import agent_config
from backend.agent.scratch_store import (
    read_scratch_payload_handler,
    scratch_store,
    scratch_tool,
)
from backend.agent.director import Director
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def test_compact_payload_small_noop():
    text = "Short result under threshold"
    compacted, handle = scratch_store.compact_payload(text, tool_name="dummy", max_chars=1000)
    assert compacted == text
    assert handle is None


def test_compact_payload_large_json_list():
    items = [{"id": i, "name": f"Item {i}", "data": "x" * 200} for i in range(50)]
    full_json = json.dumps(items)
    assert len(full_json) > 4000

    compacted, handle = scratch_store.compact_payload(full_json, tool_name="test_tool", max_chars=1000)
    assert handle is not None
    assert f"Full payload stored under handle '{handle}'" in compacted
    assert "Found 50 items total" in compacted

    # The stored content is the original
    retrieved = scratch_store.get(handle)
    assert retrieved == full_json


def test_compact_payload_large_text():
    full_text = "Line " + "\nLine ".join(f"number {i}: some detailed content here" for i in range(300))
    assert len(full_text) > 4000

    compacted, handle = scratch_store.compact_payload(full_text, tool_name="grep_files", max_chars=1000)
    assert handle is not None
    assert handle in compacted
    assert scratch_store.get(handle) == full_text


@pytest.mark.asyncio
async def test_read_scratch_payload_tool_handler():
    handle = scratch_store.store("Big data content here", tool_name="fetch")
    ctx = ToolContext(conversation_id="s1")

    res = await read_scratch_payload_handler({"handle": handle}, ctx)
    assert not res.is_error
    assert res.content == "Big data content here"

    # Non-existent handle
    res_err = await read_scratch_payload_handler({"handle": "nonexistent_handle"}, ctx)
    assert res_err.is_error


@pytest.mark.asyncio
async def test_director_offloads_large_tool_result_to_scratch(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    # Generate a large payload > max_payload_chars
    big_items = [{"id": f"msg_{i}", "snippet": f"Important email content {i} " + ("word " * 50)} for i in range(40)]
    big_payload = json.dumps(big_items)
    assert len(big_payload) > agent_config.max_payload_chars

    async def big_handler(args, ctx):
        return ToolResult.ok(big_payload)

    registry.register(Tool(
        name="fetch_big_data",
        description="Fetch big data",
        parameters={},
        handler=big_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="1", name="fetch_big_data", arguments={})
            ]
        ),
        ModelResponse(text="Read the big data preview."),
    ])

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "fetch big data"):
        events.append(ev)

    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    content = tool_results[0]["content"]
    assert "Full payload stored under handle" in content
    assert "Showing first 10 above" in content
