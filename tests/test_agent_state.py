"""A turn's state outlives the process that was running it.

Everything a turn knew used to live as local variables on `Director._run`'s
stack, with the rest in three process-memory dicts. So a `kill -9` took all of
it -- and because a kill skips the `finally` in `Director.run`, it also skipped
`close_open_tool_calls`, the repair that stops one unanswered tool call leaving a
conversation broken on every provider afterwards. Nothing on disk said a turn had
been interrupted rather than answered: `resumable` arrived on the terminal frame
and lived in the browser's component state, which a reload cleared.

These tests hold the line that the state is canonical, that it survives, that it
only ever moves the way `TRANSITIONS` allows, and that persisting it cannot cost
a turn.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from backend.agent import state as state_module
from backend.agent.director import Director, close_open_tool_calls
from backend.agent.state import (
    PHASES,
    STATE_VERSION,
    TERMINAL,
    AgentState,
    IllegalTransition,
    UnknownStateVersion,
)
from backend.db.repositories import (
    AgentRunRepository,
    ConversationRepository,
    MessageRepository,
)
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationRequest, ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolResult
from backend.tools.registry import ToolRegistry


def _tool(name: str, risk: RiskLevel = RiskLevel.LOW) -> Tool:
    async def handler(args, ctx):
        return ToolResult.ok(f"{name} ran")

    return Tool(
        name=name,
        description="d",
        parameters={"type": "object", "properties": {}},
        handler=handler,
        risk=risk,
    )


def _registry(gate: ConfirmationService | None = None) -> ToolRegistry:
    registry = ToolRegistry(gate or ConfirmationService(_allow))
    registry.register(_tool("view_file"))
    registry.register(_tool("write_file", RiskLevel.HIGH))
    return registry


async def _allow(request: ConfirmationRequest) -> bool:
    return True


class _Scripted:
    """A provider running from a script, one response per call."""

    def __init__(self, responses):
        self.responses = list(responses)

    async def complete(self, messages, tools=None, params=None):
        answer = self.responses.pop(0) if self.responses else ModelResponse(text="done")
        if isinstance(answer, Exception):
            raise answer
        return answer


def _patch(monkeypatch, client):
    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: ResolvedModel(
            provider="fake",
            model="fake-1",
            client=client,
            capabilities=Capabilities(streaming=False, context_window=32_000),
        ),
    )


def _director(workspace, registry=None) -> Director:
    return Director(
        registry or _registry(),
        workspace_root=str(workspace),
        memory=False,
        retrieval=False,
    )


async def _run(director, cid, message="do a thing"):
    return [event async for event in director.run(cid, message)]


def _conversation() -> str:
    return ConversationRepository().create("fake", "fake-1")


@pytest.fixture
def api():
    """The API keeps process-global MCP and confirmation state; restore it so
    these tests cannot leak into each other."""
    from backend.api import main

    saved_mcp = dict(main._mcp)
    saved_pending = dict(main._pending)
    main._mcp.update({"manager": None, "registry": None, "workspace": None, "errors": {}})
    main._pending.clear()
    yield main
    main._mcp.clear()
    main._mcp.update(saved_mcp)
    main._pending.clear()
    main._pending.update(saved_pending)


# --- serialization ----------------------------------------------------------


def test_a_state_survives_a_round_trip_through_json(db):
    """The state is only canonical if reading it back gives the same turn.

    A field left out of `to_json` reads as a default on the way back, so a turn
    recovered after a restart would have lost a counter and silently allowed
    itself another resume, another continuation, another provider.

    Mutation check: drop any field from `AgentState.to_json`.
    """
    state = AgentState(
        conversation_id="c1",
        mode="plan",
        phase="acting",
        request_message_id=4,
        plan_message_id=9,
        carried="half an ans",
        nudge="carry on",
        call_fingerprints={"view_file:{}": 2},
        warned_about_tools=True,
        warned_about_cap=True,
        degraded=True,
        blind_noted=True,
        step_open=3,
        tool_message_ids=[11, 12],
        tool_calls_made=2,
        retrieved=[{"kind": "memory", "id": 7}, {"kind": "chunk", "id": 3, "label": "a > b"}],
        pending=[{"kind": "approval", "id": "r1", "operation_key": "write_file"}],
        chain=["nvidia/nemotron", "groq/groq-1"],
        active=1,
        link="groq/groq-1",
        iteration=5,
        continuations=1,
        resumes=2,
        budget_spent=3,
        checkpoint=12,
        seen_message_id=44,
        error="upstream was unhealthy",
    )

    assert AgentState.from_json(json.loads(json.dumps(state.to_json()))) == state


def test_a_state_written_by_an_older_version_is_upgraded(db, monkeypatch):
    """A version bump must not silently discard the runs already on disk.

    Without the walk, a payload from an older `STATE_VERSION` either loads with
    the new fields defaulted -- a turn whose counters now mean something else --
    or fails to load at all.

    Mutation check: have `from_json` return the payload without consulting
    `_UPGRADES`.
    """
    monkeypatch.setitem(
        state_module._UPGRADES,
        STATE_VERSION - 1,
        lambda payload: {**payload, "resumes": 2},
    )

    older = {"version": STATE_VERSION - 1, "conversation_id": "c1"}
    assert AgentState.from_json(older).resumes == 2


def test_a_state_written_by_a_newer_version_is_refused(db):
    """Reading a newer payload with this version's fields is a silent downgrade.

    The counters would keep their names and lose their meaning, which is worse
    than having no state for that turn at all.

    Mutation check: drop the version comparison in `AgentState.from_json`.
    """
    with pytest.raises(UnknownStateVersion):
        AgentState.from_json({"version": STATE_VERSION + 1, "conversation_id": "c1"})


def test_an_unreadable_run_row_is_not_an_error_the_caller_has_to_handle(db):
    """A row this build cannot read must not take down a startup sweep.

    The turn it described is over either way; the only cost of answering `None`
    is that no pickup is offered for it.

    Mutation check: let `AgentRunRepository._load` raise instead of logging.
    """
    cid = _conversation()
    runs = AgentRunRepository()
    state = AgentState(conversation_id=cid)
    runs.open(state)
    runs.conn.execute(
        "UPDATE agent_runs SET state = ? WHERE id = ?",
        (json.dumps({"version": STATE_VERSION + 99}), state.id),
    )
    runs.conn.commit()

    assert runs.latest(cid) is None
    # And the sweep still retires it, or it would be swept again forever.
    assert runs.interrupt_live() == [cid]
    assert runs.conn.execute(
        "SELECT phase FROM agent_runs WHERE id = ?", (state.id,)
    ).fetchone()["phase"] == "interrupted"


# --- transitions ------------------------------------------------------------


def test_a_finished_turn_cannot_start_running_again(db):
    """The transition table is the whole truth about what a turn may do next.

    Nothing validated this before -- `STATUSES` is a display vocabulary the loop
    never reads back -- so a bug that resumed a completed turn would have written
    a second answer over a finished one.

    Mutation check: empty `TRANSITIONS`, or have `enter` assign without checking.
    """
    state = AgentState(conversation_id="c1")
    state.enter("reasoning").enter("acting").enter("completed")

    with pytest.raises(IllegalTransition):
        state.enter("acting")
    with pytest.raises(IllegalTransition):
        state.enter("nonsense")
    assert state.phase == "completed", "a refused transition must not half-apply"


def test_every_phase_is_written_by_something(db):
    """A phase nothing writes is a reserved slot, which this codebase does not keep.

    The same rule `STATUSES` is held to in `test_modes_and_status.py`, for the
    same reason: a value an interface has to handle but can never see is a
    promise nothing keeps.

    `preparing` is the exception and is checked by opening a row rather than by
    grepping: it is the phase a run *starts* in, so the thing that writes it is
    the dataclass default, and a literal for it anywhere would be redundant.

    Mutation check: add a phase to `PHASES` and do not write it anywhere.
    """
    from pathlib import Path

    cid = _conversation()
    runs = AgentRunRepository()
    opened = AgentState(conversation_id=cid)
    runs.open(opened)
    assert runs.get(opened.id).phase == "preparing"

    written = ""
    for path in ("backend/agent/director.py", "backend/db/repositories.py"):
        written += Path(path).read_text()

    for phase in PHASES:
        if phase == "preparing":
            continue
        assert f'"{phase}"' in written or f"'{phase}'" in written, f"nothing writes {phase}"


def test_what_belongs_to_one_answer_is_cleared_when_the_next_one_starts(db):
    """`carried` is per-answer; the counters that bound a turn are per-turn.

    These were re-declared inside the loop body before, so the reset was a
    property of Python scoping and invisible to anything reading the state --
    including a recovery path that would have resumed an answer with the
    previous iteration's half-sentence.

    Mutation check: have `begin_iteration` leave `carried` alone.
    """
    state = AgentState(conversation_id="c1", carried="half", resumes=2, tool_calls_made=4)
    state.begin_iteration(1)

    assert state.carried == ""
    assert state.resumes == 0
    assert state.tool_calls_made == 4, "the turn's own budget does not reset per answer"


def test_recalled_facts_are_recorded_by_row_id(db):
    """What a turn was told, kept as ids rather than as a second copy of the text.

    `MemoryService.render` writes each fact as `[id] fact` so the model can
    supersede one by number, and `parse_diff` reads the numbers back the same
    way -- this is the third reader of that format, not a new one. The ids stay
    resolvable because a fact is superseded and never deleted.

    Mutation check: have `_memory_references` return the rendered lines.
    """
    references = Director._memory_references(
        ["[3] the user writes in British English", "[11] deadline is Friday", "not numbered"]
    )

    assert references == [{"kind": "memory", "id": 3}, {"kind": "memory", "id": 11}]
    blob = json.dumps(references)
    assert "British" not in blob, "the fact itself is copied onto the run row"


# --- persistence ------------------------------------------------------------


async def test_a_turn_writes_its_state_and_keeps_writing_it(db, workspace, monkeypatch):
    """A state written once at the end is no use to anything that crashes.

    Counted rather than asserted at a number: the two turns differ only in how
    many tools the model asked for in one batch, so the extra writes can only
    have come from the extra tool result -- which is the most expensive thing in
    a turn to lose, because it is work already done against the real machine.

    Mutation check: delete the `_checkpoint` call after the tool result.
    """

    async def turn(*names):
        _patch(
            monkeypatch,
            _Scripted(
                [
                    ModelResponse(
                        tool_calls=[
                            ToolCall(id=f"c{i}", name=name, arguments={})
                            for i, name in enumerate(names)
                        ]
                    ),
                    ModelResponse(text="done"),
                ]
            ),
        )
        cid = _conversation()
        await _run(_director(workspace), cid)
        return AgentRunRepository().latest(cid)

    one = await turn("view_file")
    two = await turn("view_file", "view_file")

    assert one.phase == "completed"
    assert one.link == "fake/fake-1"
    assert one.tool_calls_made == 1
    assert two.tool_calls_made == 2
    assert two.checkpoint > one.checkpoint, "the second tool result was never written down"


async def test_the_state_holds_references_rather_than_copies(db, workspace, monkeypatch):
    """Duplicating the transcript into the run row is what ADR-0017 refuses.

    The tool's arguments and its result are already rows in `messages`; a second
    copy here is the one that goes stale, and it is the copy nothing prunes.

    Mutation check: store `call.arguments` or `result.content` on the state
    instead of the row id.
    """
    _patch(
        monkeypatch,
        _Scripted(
            [
                ModelResponse(
                    tool_calls=[ToolCall(id="c1", name="view_file", arguments={"path": "x.md"})]
                ),
                ModelResponse(text="done"),
            ]
        ),
    )
    cid = _conversation()

    await _run(_director(workspace), cid)

    state = AgentRunRepository().latest(cid)
    rows = {m.id for m in MessageRepository().history(cid)}
    assert state.tool_message_ids, "the run does not say which rows it produced"
    assert set(state.tool_message_ids) <= rows
    assert state.request_message_id in rows
    blob = json.dumps(state.to_json())
    assert "view_file ran" not in blob, "the tool's result is copied into the state"
    # Including through the loop guard's key, which used to be the arguments
    # rendered verbatim. `execution_logs` redacts arguments before writing them;
    # nothing redacts this row, so it stores a digest instead.
    assert "x.md" not in blob, "the tool's arguments are copied into the state"
    assert state.call_fingerprints, "the loop guard stopped recording calls"


async def test_a_state_that_cannot_be_written_does_not_cost_the_turn(db, workspace, monkeypatch):
    """The state is how a turn is remembered, not how it is delivered.

    A locked database is no reason the user cannot have the answer already on
    their screen -- the same rule `_persist` follows, and for the same reason.

    Mutation check: remove the `try/except` from `Director._checkpoint`.
    """
    _patch(monkeypatch, _Scripted([ModelResponse(text="the answer")]))
    monkeypatch.setattr(
        AgentRunRepository,
        "save",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("database is locked")),
    )
    cid = _conversation()

    events = await _run(_director(workspace), cid)

    assert [e.type for e in events][-1] == "done"
    assert events[-1].data["text"] == "the answer"


# --- recovery ---------------------------------------------------------------


def test_a_turn_whose_process_died_is_retired_at_boot(db):
    """A run left in a live phase reads as permanently in flight.

    That is the "Thinking forever" a dropped stream used to show, except now it
    survives a restart. With one uvicorn worker, nothing else can be driving it.

    Mutation check: have `interrupt_live` return the ids without writing the phase.
    """
    cid = _conversation()
    runs = AgentRunRepository()
    state = AgentState(conversation_id=cid)
    runs.open(state)
    runs.save(state.enter("reasoning"))

    assert runs.interrupt_live() == [cid]

    recovered = runs.get(state.id)
    assert recovered.phase == "interrupted"
    assert recovered.error, "an interrupted turn that says nothing looks like a clean one"
    # Idempotent: a second boot has nothing left to sweep.
    assert runs.interrupt_live() == []


def test_the_repair_is_idempotent_and_answers_what_it_finds(db):
    """A kill skips the `finally` that repairs a dangling tool call.

    One of those leaves every later turn in the conversation shipping a
    malformed `tool_calls` array -- the 2026-09-09 conversation that was dead on
    groq, cloudflare and nvidia at once.

    Mutation check: have `close_open_tool_calls` skip the `answered` set, and
    the second call writes a second interrupted row.
    """
    cid = _conversation()
    messages = MessageRepository()
    messages.append(
        cid,
        "assistant",
        None,
        tool_calls=[{"id": "c1", "function": {"name": "view_file", "arguments": {}}}],
    )

    assert close_open_tool_calls(cid) == 1

    closed = [m for m in messages.history(cid) if m.role == "tool"]
    assert [m.tool_call_id for m in closed] == ["c1"]
    assert closed[0].is_error
    # Idempotent, because the sweep runs on every boot.
    assert close_open_tool_calls(cid) == 0


def test_starting_the_app_recovers_what_the_last_process_left_behind(db, api):
    """The sweep is the only thing that runs after a kill, so it has to do both.

    A run left in a live phase reads as permanently in flight, and its
    conversation may also be holding a tool call nothing answered -- two halves
    of the same dead process, repaired in one place at startup.

    Mutation check: delete either call in `_lifespan`'s recovery block.
    """
    cid = _conversation()
    MessageRepository().append(
        cid,
        "assistant",
        None,
        tool_calls=[{"id": "c1", "function": {"name": "view_file", "arguments": {}}}],
    )
    runs = AgentRunRepository()
    state = AgentState(conversation_id=cid)
    runs.open(state)
    runs.save(state.enter("reasoning").enter("acting"))

    # Entering the client is what runs the lifespan, which is the boot.
    with TestClient(api.app):
        pass

    assert runs.get(state.id).phase == "interrupted"
    answered = [m for m in MessageRepository().history(cid) if m.role == "tool"]
    assert [m.tool_call_id for m in answered] == ["c1"]


async def test_a_turn_that_gave_up_mid_answer_is_recorded_as_resumable(
    db, workspace, monkeypatch, api
):
    """The pickup offer has to survive the reload that loses the terminal frame.

    `resumable` was on that frame and nowhere else, so the only thing that knew
    a half-answer could be finished was the browser tab that had watched it
    happen.

    The frame is a `guard`, not an `error`, and the phase is `stopped`, not
    `failed`. A turn holding an answer has not failed -- a stream dying after
    the content arrived is a transport failure, and ending on the red card told
    the reader the work was lost while it sat on screen above the card. `guard`
    is the frame for "it ended early, here is what it is worth", and `stopped`
    is what keeps `resumable` true, since that is `carried and phase !=
    "completed"`.

    Mutation check: stop assigning `state.carried` on the give-up path, or
    check point it as `completed` (which silently ends the pickup offer).
    """
    from backend.runtime.failures import FailureKind
    from backend.runtime.http import ProviderStreamError
    from backend.runtime.types import StreamEvent

    class _DiesHalfway:
        """Half an answer on screen, then a failure nothing can recover from."""

        async def stream(self, messages, tools=None, params=None):
            yield StreamEvent(type="text", text="half an ans")
            raise ProviderStreamError("gone", kind=FailureKind.NON_RETRYABLE)

    monkeypatch.setattr(
        "backend.agent.director.resolve",
        lambda *a, **k: ResolvedModel(
            provider="fake",
            model="fake-1",
            client=_DiesHalfway(),
            capabilities=Capabilities(streaming=True, context_window=32_000),
        ),
    )
    cid = _conversation()
    director = Director(
        _registry(),
        workspace_root=str(workspace),
        memory=False,
        retrieval=False,
        stream=True,
    )

    events = await _run(director, cid)
    assert events[-1].type == "guard", "a turn holding an answer is not a failure"
    assert "half an ans" in events[-1].data["text"], "the frame threw the answer away"
    assert not [e for e in events if e.type == "error"], "no red card over a delivered answer"

    state = AgentRunRepository().latest(cid)
    assert state.phase == "stopped"
    assert state.carried == "half an ans"
    assert state.resumable, "the row cannot answer the question the frame just answered"
    assert state.error

    with TestClient(api.app) as client:
        body = client.get(f"/api/conversations/{cid}/run").json()
    assert body["phase"] == "stopped"
    assert body["run_id"] == state.id
    assert body["resumable"] is True
    assert body["link"] == state.link


async def test_the_run_endpoint_answers_for_a_conversation_that_never_ran(db, api):
    """"No turn yet" and "no such conversation" are different answers.

    A 404 for the first would make an unused conversation look like a broken
    link, which is the bounce the interface already had once.

    Mutation check: raise 404 when `latest` returns None.
    """
    cid = _conversation()
    with TestClient(api.app) as client:
        assert client.get(f"/api/conversations/{cid}/run").json() == {}
        assert client.get("/api/conversations/nope/run").status_code == 404


# --- suspension -------------------------------------------------------------


async def test_a_turn_waiting_on_a_permission_prompt_says_so_on_disk(db, workspace, monkeypatch):
    """A suspended turn was a future in process memory and nothing else.

    So a restart could not tell a turn waiting on a person from one waiting on a
    model, and the sweep reported both the same way.

    Mutation check: delete the `confirmation_required` branch in `_note_suspension`.
    """
    suspended: asyncio.Future[ConfirmationRequest] = asyncio.get_event_loop().create_future()
    answer: asyncio.Future[bool] = asyncio.get_event_loop().create_future()

    async def ask(request: ConfirmationRequest) -> bool:
        # Shaped like `main._await_confirmation`: announce, then block on a
        # future somebody else resolves. Awaiting is the point -- a callback that
        # answers without yielding never lets the turn suspend at all, so the
        # phase it is being asked about would never be reached.
        suspended.set_result(request)
        return await answer

    _patch(
        monkeypatch,
        _Scripted(
            [
                ModelResponse(tool_calls=[ToolCall(id="c1", name="write_file", arguments={})]),
                ModelResponse(text="done"),
            ]
        ),
    )
    cid = _conversation()
    director = _director(workspace, _registry(ConfirmationService(ask)))

    turn = asyncio.ensure_future(_run(director, cid))
    request = await asyncio.wait_for(suspended, timeout=5)

    # Read while the turn is genuinely suspended: the only moment this phase
    # exists, and the one a restart has to be able to see.
    waiting = AgentRunRepository().latest(cid)
    assert waiting.phase == "awaiting_approval", "the turn did not record that it was waiting"
    assert waiting.pending == [
        {"kind": "approval", "id": request.id, "operation_key": request.operation_key}
    ]

    answer.set_result(True)
    events = await asyncio.wait_for(turn, timeout=5)

    assert any(e.type == "confirmation_required" for e in events), "the gate stopped asking"
    assert [e.type for e in events][-1] == "done", "allowing it did not let the turn finish"
    state = AgentRunRepository().latest(cid)
    assert state.phase == "completed"
    assert state.pending == [], "the turn is still marked as waiting on an answered prompt"


def test_the_terminal_phases_are_the_ones_the_sweep_leaves_alone(db):
    """`TERMINAL` and the schema's partial index have to name the same set.

    They are two copies of one fact -- SQL cannot read the Python tuple -- so a
    phase added to one and not the other leaves finished runs being swept on
    every boot, or live ones never swept at all.

    Mutation check: add a phase to `TERMINAL` and not to `idx_agent_runs_live`.
    """
    from pathlib import Path

    schema = Path("backend/db/schema.sql").read_text()
    index = schema.split("idx_agent_runs_live")[1]
    named = {phase for phase in PHASES if f"'{phase}'" in index.split(";")[0]}
    assert named == set(TERMINAL)
