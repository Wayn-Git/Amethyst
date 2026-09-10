"""A turn that dies mid tool call must not poison the conversation.

Recorded from a real conversation on 2026-09-09: the model called
`fetch__mcp__fetch`, the assistant row carrying that call was persisted, and the
turn then ended on a provider error before the tool result was written. The
transcript was left holding an assistant message whose `tool_calls` nothing
answers -- and the chat-completions wire format requires every tool call to be
followed by its `tool` message.

Every later turn in that conversation then shipped the malformed array, and the
same three providers answered:

    groq       400 "Tool choice is none, but model called a tool"
    cloudflare 400 "Bad input: Error: oneOf at '/' not met"
    nvidia     200, and an empty answer

which is why one interrupted turn read as "the model has lost the project" on
whatever provider was tried next.
"""

from __future__ import annotations

from backend.agent.prompt import to_wire_messages
from backend.db.repositories import ConversationRepository, MessageRepository

CALL = [{"id": "call-1", "type": "function", "function": {"name": "fetch", "arguments": "{}"}}]


def _conversation(db_unused=None) -> str:
    return ConversationRepository().create("fake", "fake-1")


def test_an_unanswered_tool_call_never_reaches_the_wire(db):
    """The heal, and the one that matters for a database that already holds
    broken conversations: a dangling call is dropped on the way out, so an old
    conversation starts working again rather than staying dead forever.

    Mutation check: return `[to_wire_message(m) for m in history]` again.
    """
    cid = _conversation()
    repo = MessageRepository()
    repo.append(cid, "user", "find me something")
    repo.append(cid, "assistant", "", tool_calls=CALL)
    # ...and nothing answers it, because the turn died here.

    wire = to_wire_messages(repo.history(cid))

    assert not any(m.get("tool_calls") for m in wire), "the unanswered call is not sent"
    # The row carried nothing but that call, so there is nothing left to send;
    # what matters is that the malformed array never reaches a provider.
    assert [m["role"] for m in wire] == ["user"]


def test_an_answered_tool_call_is_left_exactly_as_it_was(db):
    """The common case must not be touched. A tool call and its result are how
    the model reads back what it already did."""
    cid = _conversation()
    repo = MessageRepository()
    repo.append(cid, "user", "find me something")
    repo.append(cid, "assistant", "", tool_calls=CALL)
    repo.append(cid, "tool", "the result", tool_call_id="call-1", tool_name="fetch")

    wire = to_wire_messages(repo.history(cid))

    assert [m["role"] for m in wire] == ["user", "assistant", "tool"]
    assert wire[1]["tool_calls"] == CALL


def test_a_partially_answered_batch_keeps_only_what_was_answered(db):
    """A model can ask for three tools and the turn can die after the first.

    Dropping the whole assistant message would throw away a result that *was*
    computed; keeping the unanswered calls sends the same malformed array. So
    the message stays and the calls nothing answered are removed.

    Mutation check: drop the whole assistant row when any call is unanswered.
    """
    cid = _conversation()
    repo = MessageRepository()
    calls = [
        {"id": "call-1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
        {"id": "call-2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
    ]
    repo.append(cid, "user", "do both")
    repo.append(cid, "assistant", "", tool_calls=calls)
    repo.append(cid, "tool", "a is done", tool_call_id="call-1", tool_name="a")

    wire = to_wire_messages(repo.history(cid))

    assert [m["role"] for m in wire] == ["user", "assistant", "tool"]
    assert [c["id"] for c in wire[1]["tool_calls"]] == ["call-1"]


def test_an_assistant_message_with_words_survives_losing_its_calls(db):
    """The model often says something before calling a tool. That sentence is
    part of the answer and is not lost with the call."""
    cid = _conversation()
    repo = MessageRepository()
    repo.append(cid, "user", "find me something")
    repo.append(cid, "assistant", "Let me look that up.", tool_calls=CALL)

    wire = to_wire_messages(repo.history(cid))

    assert wire[-1]["content"] == "Let me look that up."
    assert not wire[-1].get("tool_calls")


def test_an_empty_assistant_message_with_nothing_left_is_dropped(db):
    """An assistant row that was only ever a tool call, whose call is gone, is
    an empty message. Some providers reject one; all of them learn nothing.

    Mutation check: keep the row when content is empty.
    """
    cid = _conversation()
    repo = MessageRepository()
    repo.append(cid, "user", "find me something")
    repo.append(cid, "assistant", "", tool_calls=CALL)
    repo.append(cid, "user", "never mind, just answer")

    wire = to_wire_messages(repo.history(cid))

    assert [m["role"] for m in wire] == ["user", "user"]


def test_an_orphan_tool_result_is_dropped_too(db):
    """The mirror image: a `tool` row whose call is not in the history is just
    as malformed, and history trimming can produce one by cutting above the
    assistant message that made the call."""
    cid = _conversation()
    repo = MessageRepository()
    repo.append(cid, "user", "hi")
    repo.append(cid, "tool", "a result from nowhere", tool_call_id="call-9", tool_name="fetch")

    wire = to_wire_messages(repo.history(cid))

    assert [m["role"] for m in wire] == ["user"]


# --- and the turn closes its own -------------------------------------------


def _registry():
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.registry import ToolRegistry

    return ToolRegistry(ConfirmationService(auto_approve))


def _model(client):
    from backend.runtime.types import Capabilities, ResolvedModel

    return ResolvedModel(
        provider="fake",
        model="fake-1",
        client=client,
        capabilities=Capabilities(streaming=False, context_window=32_000),
    )


async def test_a_turn_whose_reader_hangs_up_answers_its_own_call(db, monkeypatch):
    """The prevention, at the source, in the shape it actually happened.

    The assistant row carrying the call is persisted before the tool is
    dispatched. If the reader goes away in that window -- the browser's fetch
    dies, the stream is closed, the generator is collected -- the tool row is
    never written and the transcript is left holding a call nothing answers.
    An ordinary tool *error* is not this: that still writes a row.

    Mutation check: delete the `finally` that calls `_close_open_tool_calls`.
    """
    from backend.agent.director import Director
    from backend.runtime.types import ModelResponse, ToolCall

    class AsksOnce:
        async def complete(self, messages, tools=None, params=None):
            return ModelResponse(tool_calls=[ToolCall(id="call-1", name="fetch", arguments={})])

    monkeypatch.setattr("backend.agent.director.resolve", lambda *a, **k: _model(AsksOnce()))

    cid = ConversationRepository().create("fake", "fake-1")
    director = Director(_registry(), stream=False, memory=False, retrieval=False)

    stream = director.run(cid, "fetch me something")
    async for event in stream:
        if event.type == "tool_call":
            break          # the reader hangs up, exactly here
    await stream.aclose()

    history = MessageRepository().history(cid)
    requested = [c["id"] for m in history for c in (m.tool_calls or [])]
    answered = [m.tool_call_id for m in history if m.role == "tool"]
    assert requested == ["call-1"], "the assistant row with the call was persisted"
    assert answered == ["call-1"], "and the turn answered it on the way out"
    assert any(
        m.role == "tool" and m.is_error and "did not complete" in (m.content or "")
        for m in history
    ), "the model is told the tool did not run, so it can ask again"

    # And the conversation is usable again rather than dead on every provider.
    wire = to_wire_messages(history)
    ids = {c["id"] for m in wire for c in (m.get("tool_calls") or [])}
    results = {m.get("tool_call_id") for m in wire if m.get("role") == "tool"}
    assert ids and ids <= results


async def test_closing_out_does_not_answer_a_call_twice(db, monkeypatch):
    """A tool that ran wrote its own row. Writing a second, contradictory one
    would tell the model its result did not happen.

    Mutation check: drop the `call_id in answered` check in
    `_close_open_tool_calls`.
    """
    from backend.agent.director import Director
    from backend.runtime.types import ModelResponse, ToolCall
    from backend.tools.base import RiskLevel, Tool, ToolResult

    async def echo(args, ctx):
        return ToolResult.ok("the tool really ran")

    registry = _registry()
    registry.register(
        Tool(
            name="echo",
            description="echo",
            parameters={"type": "object", "properties": {}},
            handler=echo,
            risk=RiskLevel.LOW,
        )
    )

    class OnceThenAnswers:
        def __init__(self):
            self.calls = 0

        async def complete(self, messages, tools=None, params=None):
            self.calls += 1
            if self.calls == 1:
                return ModelResponse(tool_calls=[ToolCall(id="call-1", name="echo", arguments={})])
            return ModelResponse(text="all done")

    monkeypatch.setattr(
        "backend.agent.director.resolve", lambda *a, **k: _model(OnceThenAnswers())
    )

    cid = ConversationRepository().create("fake", "fake-1")
    _ = [
        e
        async for e in Director(registry, stream=False, memory=False, retrieval=False).run(
            cid, "echo please"
        )
    ]

    history = MessageRepository().history(cid)
    tool_rows = [m for m in history if m.role == "tool"]
    assert len(tool_rows) == 1, "one call, one result"
    assert tool_rows[0].content == "the tool really ran"
    assert not tool_rows[0].is_error
