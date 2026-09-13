"""A document appearing on screen while the model is still writing it.

Two halves, tested separately because they fail for different reasons: the
adapter has to *emit* argument fragments, and the director has to turn those
into `artifact_open` / `artifact_delta` without sending the same text twice.
"""

import json
from types import SimpleNamespace

import pytest

from backend.agent.director import _LiveArtifacts
from backend.runtime.providers.openai_compat import OpenAICompatClient


def _chunk(**delta):
    return {"choices": [{"delta": delta}]}


class _FakeSSE:
    """Stands in for the provider's SSE stream."""

    def __init__(self, frames):
        self.frames = frames

    def __call__(self, *args, **kwargs):
        async def gen():
            for frame in self.frames:
                yield json.dumps(frame)

        return gen()


@pytest.mark.asyncio
async def test_the_adapter_emits_arguments_as_they_arrive(monkeypatch):
    document = "# Title\n\nA paragraph."
    payload = json.dumps({"path": "notes.md", "content": document})

    # The name in one frame, then the JSON a few characters at a time, which is
    # exactly the shape every OpenAI-compatible provider streams tool calls in.
    frames = [
        _chunk(tool_calls=[{"index": 0, "id": "call_1", "function": {"name": "create_artifact"}}]),
    ]
    for i in range(0, len(payload), 7):
        frames.append(
            _chunk(tool_calls=[{"index": 0, "function": {"arguments": payload[i : i + 7]}}])
        )
    frames.append({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]})

    monkeypatch.setattr(
        "backend.runtime.providers.openai_compat.stream_sse", _FakeSSE(frames)
    )

    client = OpenAICompatClient(base_url="http://x/v1", api_key="k", model="m")
    seen = [e async for e in client.stream([{"role": "user", "content": "hi"}])]

    fragments = [e for e in seen if e.type == "tool_arguments"]
    assert fragments, "the adapter accumulated the arguments without ever emitting them"
    assert all(f.tool_name == "create_artifact" for f in fragments)
    # Each event carries the whole prefix so far, and the prefixes only grow.
    lengths = [len(f.arguments_so_far) for f in fragments]
    assert lengths == sorted(lengths)
    assert fragments[-1].arguments_so_far == payload

    # And the terminal event still carries the assembled call, as it always did.
    done = [e for e in seen if e.type == "done"][-1]
    assert done.response.tool_calls[0].name == "create_artifact"
    assert done.response.tool_calls[0].arguments["content"] == document


def _director_double(tmp_path):
    return SimpleNamespace(
        ARTIFACT_TOOL="create_artifact",
        workspace_root=str(tmp_path),
        _artifact_path=lambda call: str(tmp_path / call.arguments["path"]),
    )


def test_the_director_opens_once_and_sends_only_the_difference(tmp_path):
    document = "# Title\n\nA paragraph that arrives in pieces."
    payload = json.dumps({"path": "notes.md", "content": document})
    live = _LiveArtifacts(_director_double(tmp_path), "conv-1")

    opens, text = 0, ""
    for i in range(1, len(payload) + 1):
        chunk = SimpleNamespace(
            tool_name="create_artifact", tool_index=0, arguments_so_far=payload[:i]
        )
        for event in live.feed(chunk):
            if event.type == "artifact_open":
                opens += 1
            elif event.type == "artifact_delta":
                text += event.data["text"]

    assert opens == 1, "the panel would have been reset mid-write"
    assert text == document


def test_nothing_is_announced_before_the_path_is_complete(tmp_path):
    live = _LiveArtifacts(_director_double(tmp_path), "conv-1")
    # A path still arriving is not a path. Announcing on a prefix would compute
    # the artifact's id, media type and language from the wrong filename.
    for prefix in ('{"path": "no', '{"path": "notes', '{"path": "notes.m'):
        chunk = SimpleNamespace(tool_name="create_artifact", tool_index=0, arguments_so_far=prefix)
        assert list(live.feed(chunk)) == []


def test_other_tools_are_not_streamed(tmp_path):
    live = _LiveArtifacts(_director_double(tmp_path), "conv-1")
    chunk = SimpleNamespace(
        tool_name="run_shell_command", tool_index=0, arguments_so_far='{"command": "ls"'
    )
    assert list(live.feed(chunk)) == []


def test_sent_for_reports_what_already_reached_the_panel(tmp_path):
    from backend.runtime.types import ToolCall

    document = "hello world"
    payload = json.dumps({"path": "notes.md", "content": document})
    live = _LiveArtifacts(_director_double(tmp_path), "conv-1")
    list(live.feed(SimpleNamespace(tool_name="create_artifact", tool_index=0, arguments_so_far=payload)))

    call = ToolCall(id="1", name="create_artifact", arguments={"path": "notes.md", "content": document})
    # This is what stops `_artifact_opening` sending the whole file a second
    # time once the call is finally dispatched.
    assert live.sent_for(call) == document
