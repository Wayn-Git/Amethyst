"""The Director: the single owner of the reason -> act -> observe cycle (ADR-0016).

Nothing else decides what happens next. Tool calls run sequentially by default,
because AMETHYST's tools mutate local filesystem and database state and a single
user gains almost nothing from concurrency here.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from backend.agent.planning import (
    EXECUTE_INSTRUCTION,
    PLAN_INSTRUCTION,
    PLAN_TOOL,
    PLAN_TOOL_NAME,
    STEP_TOOL,
    STEP_TOOL_NAME,
    parse_plan,
)
from backend.agent.prompt import (
    BASE_PROMPT,
    budget_history,
    build_system_prompt,
    cap_tools,
    dropped_summary,
    environment_block,
    estimate_tokens,
    extract_skill_invocations,
    fit_tools_to_budget,
    to_wire_message,
    to_wire_messages,
    tool_schema_tokens,
)
from backend.agent.state import AgentState, IllegalTransition
from backend.agent.widgets import classify_and_extract, to_envelope
from backend.db.repositories import (
    AgentRunRepository,
    ConversationRepository,
    MessageRepository,
)
from backend.runtime import availability
from backend.runtime.chain import AttemptBudget, Link, announcement, build_chain, reason_for
from backend.runtime.failures import FailureKind, should_fall_back, should_retry
from backend.runtime.http import ProviderStreamError
from backend.runtime.registry import resolve
from backend.runtime.router import AUTO, RouteRequest, route
from backend.runtime.types import ModelParameters, ModelResponse, ToolCall
from backend.tools.base import ToolContext, ToolResult
from backend.tools.registry import ToolRegistry

log = logging.getLogger(__name__)

#: Applied to the estimated token count when checking a provider's
#: tokens-per-minute ceiling -- see the comment at its one use site.
TPM_SAFETY_MARGIN = 1.5


@dataclass
class Guards:
    # Raised from 16 and 40. The real backstop on a turn is `max_seconds`,
    # which bounds it in the only unit anybody waiting actually feels; the step
    # counts existed to stop a loop spinning, and at 16 they were stopping
    # ordinary work instead. A search-read-edit-verify task spends four steps
    # per file it touches, so three files hit the old ceiling and the turn
    # answered from half a job with its tools taken away on the last step.
    max_iterations: int = 24
    max_tool_calls: int = 60
    max_seconds: float = 600.0
    max_repeated_calls: int = 3
    # How many times a turn may be restarted after the model ended it without
    # actually answering -- an empty reply, or one the provider cut off. Bounded
    # so a model that only ever returns nothing cannot spin.
    max_continuations: int = 2
    # How many times one answer may be picked up again after the stream carrying
    # it failed halfway. Two: the failure is intermittent, so one covers the
    # ordinary blip and a second a long answer that stumbles twice -- and every
    # resume re-sends the whole partial, so a third triples the token cost of
    # the longest answers with no evidence it recovers any more of them.
    max_resumes: int = 2


# Providers name a truncated response differently; all of them mean the same
# thing -- the model was still writing when it ran out of room.
_TRUNCATED = {"length", "max_tokens", "incomplete"}

CONTINUE_AFTER_EMPTY = (
    "Your previous turn ended without a reply. The user's request is not"
    " finished. Continue now: call the tools you still need, then answer."
    " Do not apologise and do not restate the request."
)

#: Sent with the half-written answer when the stream carrying it died. The
#: reader is already looking at that half, so a resume that starts again --
#: with a preamble, an apology, or the same opening sentence -- shows up on
#: screen as the answer stuttering.
RESUME_AFTER_CUT = (
    "Your previous message was cut off mid-sentence by a network failure and"
    " the user can already see everything you wrote. Continue it from exactly"
    " where it stops, starting with the very next character. Do not repeat any"
    " of it, do not start again, do not apologise, and do not mention the"
    " interruption."
)

CONTINUE_AFTER_TRUNCATION = (
    "Your previous message was cut off before it finished. Continue from"
    " exactly where it stopped. Do not repeat what you already wrote."
)

FINAL_STEP_INSTRUCTION = (
    "This is the last step available for this turn. You cannot call any more"
    " tools. Answer the user now with what you already have: give the result if"
    " you have it, and if the work is unfinished, say plainly what you did, what"
    " you found, and what is left. Do not apologise for the limit."
)


class Stopped(Exception):
    """The user asked to stop while a model call was in flight.

    Distinct from `CancelledError`, which also arrives when the *interface*
    hangs up: one ends the turn with a `guard` frame the reader sees, the other
    means there is nobody left to tell.
    """


async def _race_cancel(awaitable, cancel: asyncio.Event | None):
    """Await something, but give up the moment the user asks to stop.

    Stop used to be checked only between iterations of the loop, so pressing it
    during a model call did nothing until that call returned -- with a 120s
    timeout and three retries, up to about eight minutes of a dead interface.
    Racing here is what makes the button mean what it says: cancelling the task
    propagates into httpx and aborts the request itself rather than waiting for a
    response nobody wants.
    """
    if cancel is None:
        return await awaitable

    work = asyncio.ensure_future(awaitable)
    waiter = asyncio.ensure_future(cancel.wait())
    try:
        done, _ = await asyncio.wait({work, waiter}, return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return work.result()
        work.cancel()
        # Let the cancellation actually land before unwinding, so the socket is
        # closed rather than left to a garbage collector.
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await work
        raise Stopped
    finally:
        waiter.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await waiter


async def _none() -> tuple[str | None, list[dict[str, Any]]]:
    """The absent retrieval block, as an awaitable -- see `run`'s gather."""
    return None, []


async def _empty():
    """The absent memory recall, as an awaitable -- see `run`'s gather."""
    return []


async def _stream_until_cancelled(stream, cancel: asyncio.Event | None):
    """The provider's chunks, abandoned the moment the user asks to stop.

    The wait before the first byte is the long one -- and the one a per-chunk
    check cannot see -- so every step is raced, not just the gaps between them.
    """
    iterator = stream.__aiter__()
    while True:
        try:
            chunk = await _race_cancel(iterator.__anext__(), cancel)
        except StopAsyncIteration:
            return
        yield chunk


@dataclass
class Event:
    """Streamed to the interface so it can show progress mid-turn.

    The answer arrives exactly once: as `assistant_delta` chunks when the
    provider streams, or as a single `assistant_text` when it does not. An
    interface that renders both would show the answer twice, so the loop never
    emits both for the same model response.
    """

    type: str  # assistant_delta | reasoning_delta | assistant_text | tool_call
    # | confirmation_required | tool_result | status | plan | step_started
    # | step_done | warning | guard | error | done | memory
    # | artifact_open | artifact_delta | artifact_done
    # | question_required | question_settled | widget
    data: dict[str, Any] = field(default_factory=dict)


#: The named states a turn passes through. Every one of these already existed
#: inside the loop and none of it was visible: the interface showed "Thinking"
#: from the moment a turn opened until the first token arrived, whether the
#: three seconds had gone on retrieval, a cold connector, a provider retry or
#: the model itself. They are a closed set so an interface can style them and so
#: a new one cannot appear unannounced.
STATUSES = (
    "starting",       # the API is building the agent: connectors coming up
    "retrieving",     # searching the vault for context
    "recalling",      # reading long-term memory
    "thinking",       # waiting on the model
    "planning",       # waiting on the model, in plan mode
    "generating",     # the model has started answering
    "tool",           # running a builtin tool
    "connector",      # running a connector's tool
    "retrying",       # continuing after an empty or truncated reply
    "resuming",       # picking one answer back up after its stream died
    "switching",      # falling back to another provider
    "completed",
    "cancelled",
    "failed",
)
# Deliberately absent: "syncing". Nothing inside a turn syncs -- the Microsoft
# To Do mirror runs on its own fifteen-minute loop and on `POST /api/tasks/sync`,
# neither of which is a turn. It is a *connector* state and lives in
# `backend/mcp/lifecycle.py`, where an interface reads it. A name here that nothing
# ever emits would be a reserved slot.


def _conversation_fallback(conversation: Any) -> list[str] | None:
    """This conversation's own fallback order, if it has been given one.

    None means "no opinion" and defers to providers.yaml; an empty list means
    "do not fall back", which is why a bad value degrades to None rather than to
    `[]` -- the two say opposite things and a parse failure must not silently
    pick the stricter one.
    """
    try:
        raw = conversation["fallback"]
    except (KeyError, IndexError):
        return None  # a database that predates the column
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        log.warning("conversation has an unreadable fallback order: %r", raw)
        return None
    return [str(name) for name in parsed] if isinstance(parsed, list) else None


def merge_partial(carried: str, fragment: str) -> str:
    """Join a carried partial to the next fragment without repeating the seam.

    `RESUME_AFTER_CUT` asks the model to carry on from the very next character,
    and most of the time it does. Sometimes it restates the last few words
    first -- more often across a *hand-over*, where the model being asked to
    continue never wrote the text it is continuing. The user sees that as
    "...the reason is that the the reason is that the", which reads as the
    answer glitching rather than as two providers having been involved.

    So the longest overlap between the tail of what is held and the head of
    what just arrived is dropped once. Bounded at `_MAX_SEAM` characters
    because this is a seam repair, not a diff: a model that genuinely repeats a
    whole paragraph has made a different mistake, and silently deleting a
    paragraph because it happened to match is far worse than leaving one in.
    """
    if not carried:
        return fragment
    if not fragment:
        return carried
    window = min(len(carried), len(fragment), _MAX_SEAM)
    for size in range(window, 0, -1):
        if carried[-size:] == fragment[:size]:
            return carried + fragment[size:]
    return carried + fragment


#: How much of the seam is checked for a repeat. A sentence or so: long enough
#: to catch a model restating the clause it was cut off in, short enough that a
#: coincidental match cannot swallow real content.
_MAX_SEAM = 200


def _nothing_can_answer(routed: Any) -> str:
    """Why "Auto" could not pick anything, in the user's terms.

    The rejection reasons the router already collected, rather than a general
    sentence: "no provider is available" sends someone to Settings to look at
    entries that are all present and all correct, where "groq is out of quota,
    clears in 47s; ollama: nothing answered at its endpoint" says which of the
    two very different problems this is.
    """
    reasons = [
        f"{c.provider} ({c.rejected})"
        for c in (routed.candidates if routed else [])
        if c.rejected
    ]
    if not reasons:
        return (
            "No provider is configured to answer. Add one in Settings -> Models,"
            " or pick a model for this conversation."
        )
    return "No provider could take this turn: " + "; ".join(reasons) + "."


def _fingerprint(call: ToolCall) -> str:
    """A stable key for "this exact call again", from arguments of any shape.

    `json.dumps(..., default=str)` is not enough: a self-referential argument
    still raises `ValueError`, and a raise here happens *before* the tool runs,
    so a malformed tool call from the model used to end the entire turn rather
    than the one call. `repr` is a worse key -- unordered, so two equal dicts can
    differ -- and a worse key only weakens a loop guard, which is the right
    thing to lose.

    Hashed, because these keys are persisted on the run row now (see
    `AgentState.call_fingerprints`). The arguments themselves reach the database
    once, through `ExecutionLogRepository.record`, which redacts them first; a
    second unredacted copy here would put a path, a token or a query on a row
    nothing redacts. A digest answers the only question the guard asks -- is this
    the same call again -- and answers nothing else.
    """
    try:
        rendered = json.dumps(call.arguments, sort_keys=True, default=str)
    except Exception:
        rendered = repr(call.arguments)
    digest = hashlib.sha256(rendered.encode("utf-8", "replace")).hexdigest()[:16]
    return f"{call.name}:{digest}"


def _guard(
    reason: str, said: list[str], iteration: int, tool_calls: int, started: float
) -> Event:
    """A guard frame that hands back the work, not only the reason it stopped.

    `guard` is terminal -- the API closes the stream on it -- and it used to
    carry a reason and nothing else, so a turn stopped at its iteration limit
    after twelve useful steps reported "iteration limit reached" and threw away
    everything the user had watched arrive. The reason is why it ended; the text
    is what it is worth.
    """
    return Event(
        "guard",
        {
            "reason": reason,
            "text": "".join(said).strip(),
            **_cost(iteration + 1, tool_calls, started),
        },
    )


def _cost(iterations: int, tool_calls: int, started: float) -> dict[str, Any]:
    """What the turn cost, in the three numbers a person can read.

    Every one of these was already being counted and none of it left the loop:
    `execution_logs.duration_ms` has held the per-tool half since logging
    shipped and nothing has ever read it. Attached to `done` rather than kept in
    a table, because the question "why did that take two minutes" is asked
    immediately or not at all.
    """
    return {
        "steps": iterations,
        "tools": tool_calls,
        "duration_ms": int((time.monotonic() - started) * 1000),
    }


# What the model can actually be shown. Anything else stays a path.
_VIEWABLE = {"image/png", "image/jpeg", "image/webp", "image/gif"}
# Providers reject oversized images outright, and a 20MB screenshot is a failed
# turn rather than a slow one.
_MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _with_images(wire: list[dict[str, Any]], attachments: list[dict[str, Any]] | None):
    """Attach images to the last user message as content blocks.

    The interface used to append attachments to the prompt as a line of text --
    `Attached files (read them with view_file): - /home/.../Screenshot.png` --
    which meant the model never saw a single pixel. Asked to put that screenshot
    in a GitHub issue it pasted the path, because the path was all it had.

    Every provider adapter already understands `{"type": "image", ...}` blocks
    (`openai_compat`, `anthropic` and `google` all convert them, and
    `runtime/vision.py` has been building them for video frames all along).
    Nothing was producing them for chat attachments; this does.

    Non-image files keep the old treatment: the path plus a nudge toward
    `view_file`, which is the right answer for a PDF or a CSV.
    """
    if not attachments:
        return wire

    import base64
    from pathlib import Path

    blocks: list[dict[str, Any]] = []
    for item in attachments:
        media = str(item.get("media_type") or "").lower()
        path = item.get("path")
        if media not in _VIEWABLE or not path:
            continue
        try:
            raw = Path(path).read_bytes()
        except OSError as exc:
            log.warning("could not read the attachment %s: %s", path, exc)
            continue
        if len(raw) > _MAX_IMAGE_BYTES:
            log.warning("attachment %s is %d bytes; too large to send", path, len(raw))
            continue
        blocks.append({
            "type": "image",
            "media_type": media,
            "data": base64.b64encode(raw).decode("utf-8"),
        })

    if not blocks:
        return wire

    # The last user turn is the one the files were attached to.
    for i in range(len(wire) - 1, -1, -1):
        if wire[i].get("role") != "user":
            continue
        said = wire[i].get("content")
        text = said if isinstance(said, str) else ""
        patched = list(wire)
        patched[i] = {
            "role": "user",
            "content": [{"type": "text", "text": text}, *blocks],
        }
        return patched

    return wire


class _LiveArtifacts:
    """Turns streamed tool arguments into a document appearing on screen.

    `create_artifact` carries a whole file in its arguments, so a turn that
    writes one used to show nothing at all until the model had finished
    emitting it -- often the longest silence in a session. The OpenAI-compatible
    adapter now yields the JSON prefix as it grows, and this reads the `content`
    value out of it and sends the difference.

    One instance per attempt, because the ids it hands out have to match the
    ones `_artifact_opening` computes for the same paths, and because a retry
    against a different provider starts the document again from nothing.

    Anthropic and Google do not stream arguments, so nothing here ever fires for
    them and `_artifact_opening` sends the whole file exactly as before.
    """

    def __init__(self, director: "Director", conversation_id: str) -> None:
        self._director = director
        self._conversation_id = conversation_id
        # index -> {"id", "path", "sent"}
        self._open: dict[int, dict[str, Any]] = {}

    def feed(self, chunk: Any):
        """Events for one `tool_arguments` fragment. Yields nothing for most."""
        if chunk.tool_name != self._director.ARTIFACT_TOOL:
            return
        raw = chunk.arguments_so_far or ""
        index = chunk.tool_index or 0

        from backend.runtime.partial_json import partial_string

        state = self._open.get(index)
        if state is None:
            # The path has to be complete before anything can be announced --
            # it decides the artifact's id, its media type and its language. A
            # document whose `content` arrives before its `path` simply waits.
            path = partial_string(raw, "path")
            if not path or f'"{path}"' not in raw:
                return
            opened = self._announce(path, partial_string(raw, "title"))
            if opened is None:
                return
            state, event = opened
            self._open[index] = state
            yield event

        content = partial_string(raw, "content")
        if len(content) <= len(state["sent"]):
            return
        # Only ever the difference, and only when it really is a continuation.
        delta = (
            content[len(state["sent"]):]
            if content.startswith(state["sent"])
            else content
        )
        state["sent"] = content
        yield Event("artifact_delta", {"id": state["id"], "text": delta})

    def opened(self, call: ToolCall) -> bool:
        """Whether this document was already announced from the stream."""
        return self._state_for(call) is not None

    def sent_for(self, call: ToolCall) -> str:
        """How much of this call's document already reached the panel.

        Matched on the resolved path rather than the index, because by dispatch
        time the call has been assembled and its position in the stream is no
        longer something the caller knows.
        """
        state = self._state_for(call)
        return state["sent"] if state else ""

    def _state_for(self, call: ToolCall):
        if call.name != self._director.ARTIFACT_TOOL:
            return None
        path = self._director._artifact_path(call)
        if path is None:
            return None
        for state in self._open.values():
            if state["path"] == path:
                return state
        return None

    def _announce(self, raw_path: str, title: str):
        """The `artifact_open` for a path, or None if it cannot be resolved."""
        from pathlib import Path

        from backend.db.repositories import ArtifactRepository
        from backend.tools.builtin.filesystem import artifact_type

        resolved = self._director._artifact_path(ToolCall(id="", name=self._director.ARTIFACT_TOOL, arguments={"path": raw_path}))
        if resolved is None:
            return None

        media_type, language = artifact_type(Path(resolved))
        artifact_id = ArtifactRepository.identify(self._conversation_id, resolved)
        state = {"id": artifact_id, "path": resolved, "sent": ""}
        event = Event(
            "artifact_open",
            {
                "id": artifact_id,
                "path": resolved,
                "title": title.strip() or Path(resolved).name,
                "media_type": media_type,
                "language": language,
            },
        )
        return state, event


#: What a tool row says when its call never got to run.
INTERRUPTED_TOOL_RESULT = (
"This tool call did not complete: the turn ended before a result came"
" back. Nothing was done. Call it again if the work still needs doing."
)


def close_open_tool_calls(conversation_id: str) -> int:
    """Answer every tool call this conversation left hanging.

    The chat-completions format requires each entry in an assistant
    message's `tool_calls` to be followed by a `tool` message carrying the
    same id. A turn that dies between the model asking for a tool and the
    result being written leaves one that nothing answers -- and from then
    on *every* later turn in that conversation ships a malformed array.

    Recorded from a real conversation on 2026-09-09, where the model called
    `fetch__mcp__fetch` and the turn ended before the result: the history
    that left behind drew `400 "Tool choice is none, but model called a
    tool"` from groq, `400 "Bad input: oneOf at '/' not met"` from
    cloudflare, and a 200 with an empty answer from nvidia. One interrupted
    turn, and the conversation was dead on every provider -- which is what
    "the model has lost the project" actually was.

    Written as a real row rather than patched over on the way to the wire,
    because the model should read what happened: a tool it asked for did
    not run, and it may ask again. `to_wire_messages` heals the same shape
    defensively, for the conversations broken before this existed.

    A module-level function rather than a method, because the repair is also
    needed at startup for a turn whose process was killed -- which skips the
    `finally` in `Director.run` that would otherwise have done it, and leaves no
    Director behind to call. Returns how many calls it answered.
    """
    messages = MessageRepository()
    try:
        history = messages.history(conversation_id)
    except Exception as exc:
        log.warning("could not read %s back to close its tool calls: %s", conversation_id, exc)
        return 0

    closed = 0

    answered = {m.tool_call_id for m in history if m.role == "tool" and m.tool_call_id}
    for message in history:
        for call in message.tool_calls or []:
            call_id = call.get("id")
            if not call_id or call_id in answered:
                continue
            answered.add(call_id)
            requested = call.get("function", call)
            try:
                messages.append(
                    conversation_id,
                    "tool",
                    INTERRUPTED_TOOL_RESULT,
                    tool_call_id=call_id,
                    tool_name=requested.get("name") or "unknown",
                    is_error=True,
                )
            except Exception as exc:
                log.warning("could not close tool call %s: %s", call_id, exc)
                continue
            closed += 1
    return closed


class Director:
    def __init__(
        self,
        registry: ToolRegistry,
        *,
        workspace_root: str | None = None,
        guards: Guards | None = None,
        params: ModelParameters | None = None,
        stream: bool = False,
        retrieval: bool = True,
        memory: bool = True,
        mode: str = "chat",
    ):
        self.registry = registry
        self.workspace_root = workspace_root
        self.guards = guards or Guards()
        self.params = params or ModelParameters()
        self.stream = stream
        self.retrieval = retrieval
        self.memory = memory
        # "chat" acts; "plan" looks and hands back steps. A field rather than a
        # sentence glued to the user's message: the sentence was persisted into
        # the transcript and replayed on every later turn, and nothing enforced
        # it -- the tool schemas, the permission gate and dispatch were
        # identical either way. See `backend/agent/planning.py`.
        self.mode = mode
        self.conversations = ConversationRepository()
        self.messages = MessageRepository()
        # Where this turn's own state goes, so it outlives the process
        # running it. See `backend/agent/state.py`.
        self.runs = AgentRunRepository()

    async def run(
        self,
        conversation_id: str,
        user_message: str,
        cancel: asyncio.Event | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[Event]:
        """Errors are data, all the way out to the interface.

        Anything unexpected -- an unconfigured provider, a prompt-assembly
        failure, a database error -- becomes a final `error` event rather than
        an exception. Raising out of this generator tears down an already-open
        SSE response with a 200 status and no terminal event, which reads to a
        browser as a truncated body the interface cannot distinguish from a
        network drop.
        """
        # What the user has already been shown. A failure this far out used to
        # discard it, so a turn that streamed two paragraphs and then hit an
        # unhandled error rendered as an error and nothing else -- and nothing
        # was in the transcript either, so reloading did not bring it back.
        shown: list[str] = []
        # Built here rather than inside `_run` so the handlers below can record
        # how the turn ended. `_run` opens the row once it knows the
        # conversation exists; until then this is an object nothing has stored,
        # and a checkpoint against it updates no rows.
        state = AgentState(conversation_id=conversation_id, mode=self.mode)
        try:
            async for event in self._run(
                state, conversation_id, user_message, cancel, attachments
            ):
                if event.type in ("assistant_delta", "assistant_text"):
                    shown.append(event.data.get("text") or "")
                yield event
        except Exception as exc:
            log.exception("the turn failed outside the loop's own handling")
            partial = "".join(shown).strip()
            message = f"{type(exc).__name__}: {exc}"
            state.error = message
            state.carried = partial
            if partial:
                self._persist(conversation_id, "assistant", f"{partial}\n\n[error] {message}")
            yield Event("status", {"state": "failed"})
            # `error` is the terminal frame and stays the only one -- the API
            # closes the stream on it. It carries the partial answer so the
            # reader has the work as well as the reason.
            yield Event("error", {"message": message, "text": partial})
        except GeneratorExit:
            # The reader is gone and there is nobody to yield to.
            #
            # `GeneratorExit` is a BaseException, so it used to land in the
            # handler below and be answered with an `error` frame -- and
            # yielding while a generator is being closed is exactly what Python
            # refuses: "async generator ignored GeneratorExit". The turn then
            # unwound through that RuntimeError instead of through its own
            # `finally`, which is how a tool call the model had just asked for
            # never got its result row written. Say nothing, let the close
            # proceed, and leave the clean-up to `finally`.
            raise
        except BaseException as exc:
            # `except Exception` does not catch CancelledError, which is what a
            # server shutdown, a reload, or Starlette dropping the task raises
            # here -- and a generator that raises out of an already-open SSE
            # response ends a 200 body with no terminal frame. To a browser that
            # is indistinguishable from a truncated download, so the interface
            # sat on "Thinking" forever. Say what happened, then let it
            # propagate: swallowing cancellation would keep the loop alive.
            state.error = f"the turn was interrupted: {type(exc).__name__}"
            state.carried = "".join(shown).strip()
            yield Event(
                "error",
                {
                    "message": state.error,
                    "text": state.carried,
                },
            )
            raise
        finally:
            # However this turn ended, it does not get to leave a tool call
            # nobody answered behind it. See `close_open_tool_calls`.
            self._close_open_tool_calls(conversation_id)
            # Nor a run row that still claims to be in flight. Every ordinary
            # exit already reaches a terminal phase; this covers the ones that
            # leave through an exception or a closed generator, which is exactly
            # the case a reader cannot tell from a turn still thinking.
            if not state.terminal:
                self._checkpoint(state, "failed")

    async def _run(
        self,
        state: AgentState,
        conversation_id: str,
        user_message: str,
        cancel: asyncio.Event | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[Event]:
        conversation = self.conversations.get(conversation_id)
        if conversation is None:
            yield Event("error", {"message": f"unknown conversation {conversation_id}"})
            return

        # "/weekly-review do the thing" pins that skill for this turn, mirroring
        # the slash menu in the interface. The marker is stripped so the model
        # sees the request, not the routing syntax.
        pinned, user_message = extract_skill_invocations(user_message)
        # Written before anything that can fail.
        #
        # This used to sit after the chain was built and the model resolved,
        # which meant an unconfigured provider or a model that would not
        # resolve ended the turn with the question never reaching the
        # transcript. The interface names a conversation from its first message
        # before sending, so what that left behind was a titled conversation
        # holding no rows at all -- and opening one of those from the history
        # column drew the empty-chat landing page, which reads as the click
        # having bounced. The question is the user's, not the model's: it is
        # kept whether or not anything answers it.
        state.request_message_id = self._persist(conversation_id, "user", user_message)
        # The request is held by reference: the row above is the user's message,
        # and a second copy on the run row would be the one that goes stale.
        self._open(state)

        # Some requests are answered better by interactive UI than by prose. One
        # fast-model call decides, and on a clear match the turn ends here with
        # the widget instead of running the agent loop at all.
        #
        # Skipped for plan mode and for anything with attachments: a widget is a
        # single-shot answer to a self-contained request, and both of those are
        # turns where the agent has work the classifier cannot see. Everything
        # uncertain classifies as `none` and falls through to the loop below, so
        # the cost of this misfiring is a wasted call rather than a lost answer.
        if self.mode != "plan" and not attachments:
            widget_started = time.monotonic()
            widget_type, widget_data, widget_media = await classify_and_extract(user_message)
            if widget_type != "none" and widget_data is not None:
                # Persisted as the assistant's own message, fenced, because the
                # message table has no widget column and the transcript is what
                # rebuilds the conversation when it is reopened. Media travels
                # in it as metadata -- titles, URLs, thumbnails -- so reopening
                # shows the same gallery without searching for it again.
                envelope = to_envelope(widget_type, widget_data, widget_media)
                self._persist(conversation_id, "assistant", envelope)
                self.conversations.touch(conversation_id)
                # `preparing` does not go straight to `completed`; the call above
                # was this turn's reasoning, so it is recorded as such.
                self._checkpoint(state, "reasoning")
                self._checkpoint(state, "completed")
                yield Event(
                    "widget",
                    {
                        "widget": {
                            "type": widget_type,
                            "data": widget_data,
                            "media": widget_media,
                        }
                    },
                )
                yield Event("status", {"state": "completed"})
                yield Event(
                    "done",
                    {
                        "text": envelope,
                        "iterations": 1,
                        **_cost(1, 0, widget_started),
                    },
                )
                return

        # The chosen provider, then whatever else could answer if it cannot.
        # Built once per turn rather than per iteration: it costs a read of
        # providers.yaml and a keychain round trip, and a turn is up to fifteen
        # iterations. `state.active` only moves forward, so a provider that failed is
        # not rediscovered on every later iteration of the same turn.
        budget = AttemptBudget()
        stated = _conversation_fallback(conversation)
        chosen = conversation["provider"]
        # Routing is asked for the order whenever the conversation has not
        # stated one, and for the head as well when the user picked "Auto".
        # Skipped entirely when both are stated, so a conversation someone
        # configured by hand is left exactly as they configured it.
        routed = None
        if chosen == AUTO or stated is None:
            routed = route(self._route_request(user_message, attachments))
        if chosen == AUTO:
            if routed is None or routed.head is None:
                # Nothing can answer. Said here rather than left to `resolve`,
                # which would be handed the literal string "auto" and raise
                # `ProviderNotConfigured` -- a sentence about a provider the
                # user has never heard of, for a problem that is really "every
                # provider you have is down or switched off".
                message = _nothing_can_answer(routed)
                self._persist(conversation_id, "assistant", f"[model error] {message}")
                state.error = message
                state.route = routed.explain() if routed else None
                self._checkpoint(state, "failed", budget=budget)
                yield Event("status", {"state": "failed"})
                yield Event("error", {"message": message})
                return
            head_provider, head_model = routed.head.provider, routed.head.model
        else:
            head_provider, head_model = chosen, conversation["model"]

        chain = build_chain(
            head_provider,
            head_model,
            order=stated if stated is not None else (routed.order if routed else None),
        )
        # Kept so the run row can answer "why this provider" later. Recorded
        # even when only the order was routed: the head the user picked is not
        # the interesting half of that question.
        state.route = routed.explain() if routed else None
        state.chain = [str(link) for link in chain]
        # None until a link resolves. The walk below can exhaust the chain
        # without ever assigning one, and the check after it is what turns
        # that into an error frame rather than a NameError.
        model = None
        # Resolving the *first* link was the one model call in the turn
        # with nothing behind it.
        #
        # Everywhere else -- an empty reply, a rate limit, a server error --
        # the loop moves `state.active` along the chain and answers on the next
        # provider. Here it did not: a provider that could not even be
        # resolved (no key, an endpoint that would not answer, a model name
        # the provider has retired) raised straight out of the turn, and
        # the user got an error where the fallback they had configured
        # would have got them an answer. The chain is walked instead, and
        # the skip is announced the same way a mid-turn switch is.
        last_error: Exception | None = None
        # A provider already known to be out of quota is stepped over
        # before it is asked.
        #
        # `build_chain` skips exhausted providers when it picks the
        # *alternatives*, but the chosen one goes in unconditionally --
        # so a turn started on a provider that 429'd a minute ago spent
        # its first attempt proving that again. The step is announced,
        # never silent: the user picked that model, and an answer from
        # somewhere else without a word is worse than the wait.
        while state.active < len(chain) - 1:
            known = availability.cached(chain[state.active].provider)
            if known is None or known.available:
                break
            skipped = chain[state.active]
            state.active += 1
            log.warning(
                "%s is %s; starting on %s instead",
                skipped.provider,
                "exhausted" if known.exhausted else "unavailable",
                chain[state.active].provider,
            )
            yield Event("status", {"state": "switching", "provider": chain[state.active].provider})
            yield Event(
                "warning",
                {
                    "message": announcement(
                        skipped,
                        "is out of quota" if known.exhausted else "is unavailable",
                        chain[state.active],
                    )
                },
            )
        while state.active < len(chain):
            try:
                model = resolve(
                    chain[state.active].provider,
                    chain[state.active].model,
                    max_retries=budget.allowance(len(chain) - 1 - state.active) - 1,
                )
                # Which link is actually answering, recorded the moment it is
                # known. The conversation's own provider column is what the user
                # picked, not what replied -- and after a switch those differ.
                state.link = str(chain[state.active])
                break
            except Exception as exc:
                last_error = exc
                failed = chain[state.active]
                log.warning("%s could not be resolved: %s", failed.provider, exc)
                availability.record_failure(failed.provider, FailureKind.UNREACHABLE)
                state.active += 1
                if state.active >= len(chain):
                    break
                yield Event(
                    "status", {"state": "switching", "provider": chain[state.active].provider}
                )
                yield Event(
                    "warning",
                    {
                        "message": announcement(
                            failed, "could not be reached", chain[state.active]
                        )
                    },
                )
        if model is None:
            raise last_error or RuntimeError("no configured provider could be reached")

        # Fetched once for the turn, not once per iteration: it answers the
        # question the user actually asked, and search_documents is there for
        # everything the model only discovers it needs mid-turn.
        planning = self.mode == "plan"
        # A turn is "executing" when the message approves a plan. Progress
        # through it is *reported* by the model rather than inferred from which
        # tools it happened to call -- inferring it would be inventing a
        # progress bar, and an invented one is worse than none.
        executing = not planning and user_message.lstrip().lower().startswith("approved")
        state.step_open: int | None = None
        if self.retrieval:
            yield Event("status", {"state": "retrieving"})
        elif self.memory:
            yield Event("status", {"state": "recalling"})
        # Two independent best-effort lookups, run together: an embedder round
        # trip awaited before the memory service added its own latency to the
        # head of every turn for no ordering reason at all.
        retrieved, recalled = await asyncio.gather(
            self._retrieve(user_message) if self.retrieval else _none(),
            self._recall(conversation_id, user_message) if self.memory else _empty(),
        )
        retrieved_context, chunk_refs = retrieved
        # What the turn was given, by reference rather than by copy: the text
        # is already in the vault and in `memories`, and a second copy here is
        # the one that would go stale. See `_memory_references`.
        state.retrieved = [*self._memory_references(recalled), *chunk_refs]
        hidden_servers = self._disabled_connectors(conversation_id)
        # Which connectors can actually be reached this turn. Resolved once:
        # it is the same answer on every round trip, and it is read twice per
        # iteration -- for the schema order and for the tool cap.
        ready_servers = self._ready_connectors()

        context = ToolContext(
            conversation_id=conversation_id,
            workspace_root=self.workspace_root,
            events=asyncio.Queue(),
            # Plan mode's enforcement half. The schemas are withheld below; this
            # is what refuses a mutating tool named anyway.
            read_only=planning,
        )
        # The one piece of turn state deliberately left off `state`:
        # `time.monotonic()` counts from an arbitrary point in *this* process, so
        # a recovered run reads `state.created_at` instead and this stays local.
        started = time.monotonic()
        # The counters, the warning latches and the half-written answer are all
        # on `state` now. `state.warned_about_tools`, `state.warned_about_cap`
        # and `state.degraded` are still said once per turn rather than once per
        # iteration: the same tools are withheld on every round trip, and fifteen
        # identical warnings is noise covering the one line that mattered.
        #
        # Everything the user has been shown this turn, kept local because it is
        # rebuildable -- a guard or a failure reads it to hand back work already
        # on screen, and the transcript is where it ends up. `state.carried` is
        # the narrower thing: the half-answer that has nowhere else to live.
        said: list[str] = []
        # The transcript as wire messages, assembled once and appended to as the
        # turn writes new rows. Reading the full history from SQLite on every
        # round trip -- with `json.loads` on every tool_calls blob -- made a
        # long conversation cost O(rows x iterations) on the event loop.
        history: list[dict[str, Any]] = to_wire_messages(
            self.messages.history(conversation_id)
        )
        state.seen_message_id = self._last_message_id(conversation_id)

        for iteration in range(self.guards.max_iterations):
            if cancel is not None and cancel.is_set():
                self._checkpoint(state, "cancelled", budget=budget)
                yield _guard("stopped by the user", said, iteration, state.tool_calls_made, started)
                break
            if time.monotonic() - started > self.guards.max_seconds:
                state.error = "time limit reached"
                self._checkpoint(state, "stopped", budget=budget)
                yield _guard("time limit reached", said, iteration, state.tool_calls_made, started)
                break

            # The last iteration is spent forcing an answer, not another tool
            # call: withholding the schemas below turns "iteration limit
            # reached" -- a dead end with nothing to show -- into a real
            # wrap-up of whatever the turn has. The hard guard in the `else`
            # branch stays as a backstop for the case a provider ignores it.
            final_step = iteration == self.guards.max_iterations - 1

            # Clears what belongs to one answer rather than to the turn:
            # `state.carried`, `state.resumes`, `state.blind_noted`. It was the
            # re-declaration of those inside this loop that reset them before,
            # which made the reset a property of Python scoping and invisible to
            # anything reading the state.
            state.begin_iteration(iteration)
            response = None
            # Whether the answer already reached the interface as deltas -- not
            # whether the streaming path was taken. An adapter may fall back to
            # a plain call inside stream() when the endpoint ignores
            # `stream: true`, and that answer still has to be delivered.
            streamed = False
            streamed_text: list[str] = []

            # One answer, from however many providers it takes to get one.
            while True:
                links_after = len(chain) - 1 - state.active
                allowance = budget.allowance(links_after)
                try:
                    system_prompt = build_system_prompt(
                        workspace_root=self.workspace_root,
                        conversation_id=conversation_id,
                        pinned_skills=pinned,
                        retrieved_context=retrieved_context,
                        memories=recalled,
                    )
                except Exception as exc:
                    # An unreadable skill file, a capability table mid-migration,
                    # a memory row that will not render. None of that is a reason
                    # the user cannot have an answer: the model can work from the
                    # base prompt alone, and it used to lose the whole turn here.
                    log.warning("system prompt assembly failed, using the base prompt: %s", exc)
                    system_prompt = f"{BASE_PROMPT}\n\n{environment_block(self.workspace_root)}"
                    if not state.degraded:
                        state.degraded = True
                        yield Event(
                            "warning",
                            {"message": "some context could not be assembled for this turn"},
                        )
                # Built before the history is budgeted, not after: the schemas go
                # out on every round trip and measured 29,620 tokens across 132
                # tools, so budgeting without them overstates the room left by more
                # than the system prompt costs.
                if executing:
                    system_prompt = f"{system_prompt}\n\n{EXECUTE_INSTRUCTION}"
                if planning:
                    # Appended to the system prompt, never to the transcript.
                    # The old prefix lived in the message, so a conversation
                    # asked for a plan once kept being asked for one forever.
                    system_prompt = f"{system_prompt}\n\n{PLAN_INSTRUCTION}"
                tool_schemas = (
                    self.registry.schemas(
                        hidden_servers=hidden_servers,
                        read_only=planning,
                        priority_servers=ready_servers,
                    )
                    if model.capabilities.tools
                    else None
                )
                if not planning and executing and tool_schemas is not None:
                    # Only where there is a plan to be part-way through. Offering
                    # it on every chat turn would be a tool with nothing to
                    # describe, which models call anyway.
                    tool_schemas = [*tool_schemas, STEP_TOOL]
                if planning and tool_schemas is not None:
                    # Offered by the director, not registered: it changes
                    # nothing, so there is nothing to dispatch, and a tool that
                    # only exists in one mode has no business in a registry
                    # shared by every conversation.
                    tool_schemas = [*tool_schemas, PLAN_TOOL]
                # Some endpoints cap how many tools one request may carry -- Groq
                # at 128, against the 178 this machine offers -- and the refusal
                # is a 400 before a token moves. Trimmed here rather than at the
                # adapter so the turn can say what it lost: a tool withheld
                # silently is the same failure one layer further from the person
                # who can fix it.
                if final_step:
                    # No tools on the last step. A model handed tools spends the
                    # step calling one, and there is no iteration left to read
                    # the result -- so it is offered none and asked to answer.
                    tool_schemas = None
                    # Said, not done quietly. An answer written without the tool
                    # it needed, with nothing on screen to say the tools had
                    # been taken away, is indistinguishable from a model that
                    # did not think to use one -- which is what "it isn't smart
                    # enough" looks like from the outside.
                    if not state.warned_about_cap:
                        state.warned_about_cap = True
                        yield Event(
                            "warning",
                            {
                                "message": (
                                    f"this turn reached its {self.guards.max_iterations}-step"
                                    " limit, so the answer below is written from what it had"
                                    " rather than by using more tools"
                                )
                            },
                        )
                if tool_schemas is not None and model.capabilities.max_tools:
                    tool_schemas, dropped = cap_tools(
                        tool_schemas,
                        model.capabilities.max_tools,
                        priority_servers=ready_servers,
                    )
                    if dropped and not state.warned_about_tools:
                        state.warned_about_tools = True
                        yield Event("warning", {"message": dropped_summary(dropped)})
                try:
                    # Rows this turn wrote since the last round trip -- tool
                    # results, assistant tool_calls -- appended to the snapshot
                    # taken once at the head of the turn. A fallback attempt
                    # reuses the same assembled list rather than re-reading it.
                    for message in self.messages.history(conversation_id):
                        if message.id is not None and message.id > state.seen_message_id:
                            history.append(to_wire_message(message))
                            state.seen_message_id = message.id
                    # Re-budgeted against whichever model is about to be called.
                    # Carrying a 200,000-token history into a 32,000-token
                    # fallback trades one provider's outage for the next one's
                    # refusal.
                    budgeted = budget_history(
                        history,
                        context_window=model.capabilities.context_window,
                        system_prompt=system_prompt,
                        tools=tool_schemas,
                    )
                except Exception as exc:
                    # A row the budgeter cannot measure -- a tool_calls blob that
                    # will not serialize, most likely. The last exchange is
                    # enough to answer from, and is strictly better than the
                    # error frame this used to become.
                    log.warning("history assembly failed, sending the last exchange: %s", exc)
                    budgeted = [{"role": "user", "content": user_message}]
                    if not state.degraded:
                        state.degraded = True
                        yield Event(
                            "warning",
                            {"message": "earlier messages could not be read for this turn"},
                        )
                wire = [{"role": "system", "content": system_prompt}, *budgeted]
                # Picking up a cut-off answer, rather than asking for it again.
                # The partial is not in the history -- it is only persisted when
                # the turn gives up -- so the model is shown it here.
                if state.carried:
                    wire.append({"role": "assistant", "content": state.carried})
                    wire.append({"role": "user", "content": RESUME_AFTER_CUT})
                # Images the user attached to *this* turn, put back onto the
                # message they were attached to. They are not in `history`,
                # because the transcript stores what was said and a screenshot
                # is not text -- see `_with_images`.
                #
                # Gated on the model that is actually about to answer, not on
                # the one the user picked. A vision request that falls back to a
                # text-only link used to send the image anyway: Nvidia answers
                # `400 Received multimodal data but multimodal processing is not
                # enabled`, so one transient 503 upstream turned "what is in this
                # screenshot" into a failed turn.
                if attachments:
                    if model.capabilities.vision:
                        wire = _with_images(wire, attachments)
                    elif not state.blind_noted:
                        state.blind_noted = True
                        yield Event(
                            "warning",
                            {
                                "message": f"{chain[state.active].provider} cannot look at images,"
                                " so this turn was sent without them",
                            },
                        )
                if state.nudge:
                    # Cleared once a call succeeds, not here: a fallback
                    # attempt has to carry the same instruction.
                    wire.append({"role": "system", "content": state.nudge})
                if final_step:
                    wire.append({"role": "system", "content": FINAL_STEP_INSTRUCTION})

                # Some accounts cap tokens *per minute*, not just context window
                # or tool count -- Groq's free tier is 8,000, and the system
                # prompt plus tool schemas alone measured 21,000-29,000 on this
                # machine. That request 413s regardless of what the user typed,
                # every time, so sending it is a guaranteed-fail round trip that
                # ends with raw provider JSON in the chat. Checked here, after
                # `cap_tools` has already trimmed what it can, so this only
                # fires when trimming genuinely was not enough.
                #
                # `estimate_tokens` is `len(text) // 4` -- tuned against prose,
                # and a live 413 was observed carrying this margin's estimate
                # under budget while Groq's own tokenizer reported 18,091 for
                # the same request: dense, punctuation-heavy tool-schema JSON
                # tokenizes worse than the 4-chars-per-token the heuristic
                # assumes. `TPM_SAFETY_MARGIN` is a deliberately conservative
                # correction for that gap, not a measured ratio -- there is no
                # cheap way to get Groq's real tokenizer client-side, and the
                # cost of guessing low is a request already known likely to
                # fail going out anyway; the cost of guessing high is only an
                # earlier, cleaner fallback.
                # A tokens-per-minute cap is the free tier's real ceiling, and
                # the tool schemas are what blow it -- so trim the tools to fit
                # and still answer, rather than skipping the provider. This is
                # the difference between "groq is unusable with connectors on"
                # and "groq answers with as many tools as fit", which is what a
                # small client on the same free tier does implicitly. The skip
                # below now only fires when the system prompt *alone* is over
                # budget, which trimming cannot help.
                if model.capabilities.tokens_per_minute and tool_schemas is not None:
                    tool_schemas, tpm_dropped = fit_tools_to_budget(
                        tool_schemas,
                        system_prompt=system_prompt,
                        token_budget=model.capabilities.tokens_per_minute,
                        margin=TPM_SAFETY_MARGIN,
                        priority_servers=ready_servers,
                    )
                    if tpm_dropped and not state.warned_about_tools:
                        state.warned_about_tools = True
                        yield Event("warning", {"message": dropped_summary(tpm_dropped)})
                if model.capabilities.tokens_per_minute:
                    baseline = round(
                        (estimate_tokens(system_prompt) + tool_schema_tokens(tool_schemas))
                        * TPM_SAFETY_MARGIN
                    )
                    if baseline > model.capabilities.tokens_per_minute:
                        kind = FailureKind.NON_RETRYABLE_RATE_LIMIT
                        budget.spend(1)
                        availability.record_failure(
                            chain[state.active].provider,
                            kind,
                            f"a single request here needs about {baseline:,} tokens,"
                            f" over its {model.capabilities.tokens_per_minute:,}"
                            " tokens-per-minute limit",
                        )
                        reason = "cannot take a request this size"
                        can_hand_over = links_after > 0 and budget.remaining > 0
                        if can_hand_over:
                            failed = chain[state.active]
                            state.active += 1
                            model = resolve(
                                chain[state.active].provider,
                                chain[state.active].model,
                                max_retries=budget.allowance(len(chain) - 1 - state.active) - 1,
                            )
                            state.link = str(chain[state.active])
                            log.warning(
                                "%s %s (%s); falling back to %s",
                                failed, reason, kind, chain[state.active],
                            )
                            yield Event(
                                "status",
                                {"state": "switching", "provider": chain[state.active].provider},
                            )
                            yield Event(
                                "warning",
                                {"message": announcement(failed, reason, chain[state.active])},
                            )
                            self._checkpoint(state, budget=budget)
                            continue
                        message = (
                            f"{chain[state.active].provider} {reason} ({baseline:,} tokens needed,"
                            f" {model.capabilities.tokens_per_minute:,} per minute allowed) and"
                            " no other provider is configured to try instead."
                        )
                        partial = merge_partial(state.carried, "".join(streamed_text)).strip()
                        noted = f"[model error] {message}"
                        self._persist(
                            conversation_id,
                            "assistant",
                            f"{partial}\n\n{noted}" if partial else noted,
                        )
                        state.error = message
                        state.carried = partial
                        self._checkpoint(state, "failed", budget=budget)
                        yield Event("status", {"state": "failed"})
                        yield Event("error", {"message": message})
                        return

                response = None
                streamed = False
                streamed_text = []
                # Reset per attempt, and defined whether or not the provider
                # streams: the dispatch loop below asks it how much of a
                # document already reached the panel, and Anthropic and Google
                # never take the streaming branch at all.
                live_artifacts = _LiveArtifacts(self, conversation_id)
                # The turn is about to spend money and time on a model call, so
                # this is the point worth being able to recover to.
                self._checkpoint(state, "reasoning", budget=budget)
                yield Event("status", {"state": "planning" if planning else "thinking"})
                try:
                    if (
                        self.stream
                        and model.capabilities.streaming
                        and hasattr(model.client, "stream")
                    ):
                        # Deltas go out as they arrive so the interface can render
                        # progressively; tool calls are only actionable once assembled.
                        async for chunk in _stream_until_cancelled(
                            model.client.stream(wire, tools=tool_schemas, params=self.params),
                            cancel,
                        ):
                            if chunk.type == "text" and chunk.text:
                                if not streamed_text:
                                    # The moment the wait stops being a wait.
                                    # Without it "Thinking" stayed on screen
                                    # underneath text that was already arriving.
                                    yield Event("status", {"state": "generating"})
                                streamed_text.append(chunk.text)
                                said.append(chunk.text)
                                yield Event("assistant_delta", {"text": chunk.text})
                            elif chunk.type == "reasoning" and chunk.text:
                                yield Event("reasoning_delta", {"text": chunk.text})
                            elif chunk.type == "tool_arguments":
                                # A document being written, one fragment at a
                                # time. Only `create_artifact` is streamed this
                                # way; every other tool is silent until dispatch.
                                for event in live_artifacts.feed(chunk):
                                    yield event
                            elif chunk.type == "done":
                                response = chunk.response
                        streamed = bool(streamed_text)
                        if response is None:
                            # The provider dropped the stream before its terminal
                            # event. Keep what already reached the user rather than
                            # discarding a partial answer they can see on screen.
                            partial = merge_partial(state.carried, "".join(streamed_text))
                            response = ModelResponse(text=partial or None, stop_reason="incomplete")
                            yield Event(
                                "warning",
                                {"message": "the response was cut off before it finished"},
                            )
                    else:
                        response = await _race_cancel(
                            model.client.complete(wire, tools=tool_schemas, params=self.params),
                            cancel,
                        )
                except Stopped:
                    # Whatever had already streamed is on screen and is worth
                    # keeping; the rest of the turn is not.
                    partial = merge_partial(state.carried, "".join(streamed_text)).strip()
                    if partial:
                        self._persist(conversation_id, "assistant", partial)
                    state.carried = partial
                    self._checkpoint(state, "cancelled", budget=budget)
                    yield Event("status", {"state": "cancelled"})
                    yield _guard(
                        "stopped by the user", said, iteration, state.tool_calls_made, started
                    )
                    self.conversations.touch(conversation_id)
                    return
                except Exception as exc:
                    raw_message = f"{type(exc).__name__}: {exc}"
                    # A failure that was never classified is a bad request as
                    # far as anything downstream is concerned: it stops rather
                    # than spending another provider on a guess.
                    kind = getattr(exc, "kind", FailureKind.NON_RETRYABLE)

                    # An answer that was already being written is picked up
                    # again rather than abandoned.
                    #
                    # NVIDIA emits `{"error":{"message":"Error in input
                    # stream"}}` inside an already-200 body, intermittently,
                    # after tokens have streamed. Every recovery path was shut
                    # off once a byte had moved, so the turn died holding half a
                    # sentence and the user finished it by typing "continue"
                    # into the transcript -- several times a session. That is
                    # what this does for them, and it is a *continuation*: the
                    # objection to falling back mid-answer is that a second
                    # provider would start again underneath the half already on
                    # screen, which a resume cannot do.
                    #
                    # Decided before the spend below, which used to take the
                    # whole allowance for any retryable kind: a resume weighed
                    # after that line would never have a budget to run on.
                    # Either an answer was already being written, or the
                    # provider faltered *inside* a stream it had already opened.
                    #
                    # The second half is not about continuing anything. A model
                    # that opens with a tool call streams no prose at all, so a
                    # blip on the call after the tool result found `streamed_text`
                    # empty, skipped the resume, and -- with no link left to hand
                    # over to -- killed a turn whose work was already done and
                    # written down. That is the "Error in input stream" left
                    # sitting under a tool result that plainly succeeded.
                    #
                    # `ProviderStreamError` is the discriminator rather than the
                    # kind, because it means the request already passed auth,
                    # routing and validation to open a 200: this provider was
                    # working a moment ago and is worth asking again. A provider
                    # that is merely unreachable never opened anything, and
                    # re-asking it just pays its timeout twice before the
                    # handover that was always the right answer.
                    can_resume = (
                        (bool(streamed_text or state.carried)
                         or isinstance(exc, ProviderStreamError))
                        and should_retry(kind)
                        and state.resumes < self.guards.max_resumes
                        # One attempt stays reserved for the links behind this
                        # one, so a provider that state.resumes twice and then dies
                        # does not leave the chain with nothing to spend.
                        and budget.remaining > 1
                    )
                    if can_resume:
                        state.resumes += 1
                        budget.spend(1)
                        # Carried here rather than where `streamed_text` is
                        # emptied, because the wire for the next attempt is
                        # assembled before that point -- carrying it there left
                        # the resumed call with nothing to continue from.
                        state.carried = merge_partial(state.carried, "".join(streamed_text))
                        # Deliberately not `record_failure`: that darkens the
                        # provider for the rest of the session (it feeds
                        # `chain._usable`), and a blip we recovered from inside
                        # the same answer is not evidence the provider is down.
                        # The failure is recorded below if the state.resumes run out.
                        log.info(
                            "%s cut the answer short (%s); resuming it (%d/%d)",
                            chain[state.active].provider,
                            kind,
                            state.resumes,
                            self.guards.max_resumes,
                        )
                        self._checkpoint(state, budget=budget)
                        yield Event("status", {"state": "resuming"})
                        continue

                    # A retryable failure exhausted its allowance before it
                    # was raised; a non-retryable one cost exactly one call.
                    budget.spend(allowance if should_retry(kind) else 1)
                    # A rate limit is remembered for as long as the provider
                    # asked for, not for a flat five minutes. Groq answers
                    # "try again in 5.835s" and used to be written off for the
                    # rest of the sulk anyway; a provider that says an hour was
                    # let back in after five minutes to fail again.
                    if kind in (FailureKind.RATE_LIMITED, FailureKind.NON_RETRYABLE_RATE_LIMIT):
                        availability.record_exhausted(
                            chain[state.active].provider,
                            retry_after=getattr(exc, "retry_after", None),
                            message=reason_for(kind),
                        )
                    else:
                        availability.record_failure(chain[state.active].provider, kind)

                    # Text already on screen used to stop this dead: a second
                    # provider would have restarted the answer underneath the
                    # half the user was reading, which is worse than failing.
                    #
                    # That objection stopped being true when resumes shipped.
                    # `state.carried` is rebuilt into the wire as an assistant
                    # message plus `RESUME_AFTER_CUT` on every iteration, and
                    # neither is provider-specific -- so a *different* provider
                    # picks a cut answer up exactly the way the same one does.
                    # Keeping the guard meant a mid-answer failure could only
                    # ever be retried on the provider that had just failed, and
                    # once `max_resumes` ran out the turn died holding half a
                    # sentence with two healthy providers still in the chain.
                    # That is the "Error in input stream" a user sees over and
                    # over: NVIDIA's NIM emits it intermittently *after* tokens
                    # have moved, which is precisely the case this excluded.
                    #
                    # The partial is carried first, so what follows is a
                    # continuation and not a restart.
                    can_hand_over = (
                        links_after > 0
                        and should_fall_back(kind)
                        and budget.remaining > 0
                    )
                    if can_hand_over:
                        resuming = bool(streamed_text or state.carried)
                        state.carried = merge_partial(state.carried, "".join(streamed_text))
                        failed = chain[state.active]
                        state.active += 1
                        model = resolve(
                            chain[state.active].provider,
                            chain[state.active].model,
                            max_retries=budget.allowance(len(chain) - 1 - state.active) - 1,
                        )
                        state.link = str(chain[state.active])
                        log.warning(
                            "%s failed (%s): %s; falling back to %s",
                            failed, kind, raw_message, chain[state.active],
                        )
                        yield Event(
                            "status",
                            {"state": "switching", "provider": chain[state.active].provider},
                        )
                        yield Event(
                            "warning",
                            {
                                "message": announcement(
                                    failed,
                                    reason_for(kind),
                                    chain[state.active],
                                    resuming=resuming,
                                )
                            },
                        )
                        self._checkpoint(state, budget=budget)
                        continue

                    # Every fallback exhausted, or this failure was never
                    # fallback-worthy. The provider's own error body -- a
                    # paragraph of JSON on Groq, for one -- goes to the log,
                    # already the audit trail; it does not belong in the
                    # transcript as if it were the model's own answer. A user
                    # who got a raw 413 body reading "please reduce your
                    # message size" in place of a reply is what "the model
                    # isn't responding" looks like from outside.
                    log.warning(
                        "%s failed (%s): %s", chain[state.active].provider, kind, raw_message
                    )
                    message = f"{chain[state.active].provider} {reason_for(kind)}."
                    partial = merge_partial(state.carried, "".join(streamed_text)).strip()

                    if partial:
                        # There is an answer. Deliver it, and do not call it a
                        # failure.
                        #
                        # This used to end on an `error` frame with
                        # `[model error] ...` appended to the transcript under
                        # the text -- so a turn that streamed a *complete*
                        # answer and then had its stream fall over on the way
                        # out showed the whole answer and a red card saying it
                        # had failed. Which is the one thing the reader
                        # believes: the work is done and the interface says it
                        # is broken.
                        #
                        # A stream that dies after the content has arrived is a
                        # transport failure, not a turn failure, and what
                        # decides that is what is in hand rather than how the
                        # connection ended.
                        #
                        # `stopped`, not `completed`, and a `guard` frame
                        # rather than `done`. Both halves matter. `guard` is
                        # the frame this codebase already has for "it ended
                        # early, here is what it is worth" -- the interface
                        # draws it as a neutral note rather than the red card.
                        # And `AgentState.resumable` is `carried and phase !=
                        # "completed"`, so `stopped` is what keeps the pickup
                        # offer alive on reload (ADR-0021) for an answer that
                        # really was cut short. Calling it `completed` would
                        # have quietly deleted that.
                        state.carried = partial
                        state.error = message
                        self._persist(conversation_id, "assistant", partial)
                        self.conversations.touch(conversation_id)
                        if state.step_open is not None:
                            yield Event("step_done", {"number": state.step_open})
                            state.step_open = None
                        self._checkpoint(state, "stopped", budget=budget)
                        yield _guard(
                            f"{message} What it had written is above",
                            [partial],
                            iteration,
                            state.tool_calls_made,
                            started,
                        )
                        return

                    # Nothing was produced, so this really is a failed turn.
                    noted = f"[model error] {message}"
                    self._persist(conversation_id, "assistant", noted)
                    state.error = message
                    self._checkpoint(state, "failed", budget=budget)
                    yield Event("status", {"state": "failed"})
                    yield Event("error", {"message": message, "resumable": False})
                    return

                availability.record_success(chain[state.active].provider)
                # What this request cost, against the provider's minute. The
                # provider's own counts where it reported them -- nothing this
                # side tokenizes as well as the endpoint does -- and the same
                # estimate the precheck uses where it did not, because being
                # roughly right about "is this one near its ceiling" is the
                # whole question, and the alternative was knowing nothing until
                # a 429 arrived.
                availability.record_usage(
                    chain[state.active].provider,
                    (response.input_tokens or 0) + (response.output_tokens or 0)
                    or round(
                        (estimate_tokens(system_prompt) + tool_schema_tokens(tool_schemas))
                        * TPM_SAFETY_MARGIN
                    ),
                )
                state.nudge = None
                break

            if not streamed and response.reasoning:
                # A non-streaming provider hands back its thinking in one piece.
                # It reaches the interface on the same channel a streamed one
                # uses, so nothing downstream needs a second way to render it --
                # and it stays out of the answer either way.
                yield Event("reasoning_delta", {"text": response.reasoning})

            if response.text and not streamed:
                # Already delivered chunk by chunk when the provider streamed;
                # re-emitting it whole would render the same answer twice.
                said.append(response.text)
                yield Event("status", {"state": "generating"})
                yield Event("assistant_text", {"text": response.text})

            if not response.tool_calls:
                answer = response.text or ""
                truncated = (response.stop_reason or "").lower() in _TRUNCATED

                # A turn that ends with nothing to show is not a finished turn.
                # Models do this after a tool result -- they stop instead of
                # acting on it -- and a truncated answer stops mid-sentence.
                # Both used to end the turn silently, leaving the user to type
                # "continue" to get the work they already asked for.
                unfinished = not answer.strip() or truncated
                if unfinished and state.continuations < self.guards.max_continuations:
                    state.continuations += 1
                    if answer.strip():
                        self._persist(conversation_id, "assistant", answer)
                        state.nudge = CONTINUE_AFTER_TRUNCATION
                        yield Event("status", {"state": "retrying"})
                        yield Event(
                            "warning",
                            {"message": "the answer was cut off; continuing it"},
                        )
                    else:
                        state.nudge = CONTINUE_AFTER_EMPTY
                        yield Event("status", {"state": "retrying"})
                        yield Event(
                            "warning",
                            {"message": "the model stopped without answering; continuing"},
                        )
                    continue

                if not answer.strip():
                    # Out of state.continuations and still nothing from the model. The
                    # turn is not empty, though -- it has whatever it streamed
                    # before it stopped, and whatever its tools came back with --
                    # and handing that over beats closing on an empty bubble and
                    # making the user ask again for work already done.
                    yield Event(
                        "warning",
                        {"message": "the model ended the turn without an answer"},
                    )
                    # Kept apart from `answer` on purpose: this is AMETHYST's
                    # account of the turn, not the model's, and feeding it back
                    # into memory extraction would file a sentence AMETHYST wrote as
                    # something the model said.
                    delivered = self._summarise(conversation_id, said)
                else:
                    delivered = answer

                self._persist(conversation_id, "assistant", delivered)
                self.conversations.touch(conversation_id)
                if state.step_open is not None:
                    yield Event("step_done", {"number": state.step_open})
                    state.step_open = None
                # `carried` is cleared before the terminal phase: the answer
                # landed, and a state that still held half of it would offer a
                # pickup for a turn that has nothing left to pick up.
                state.carried = ""
                self._checkpoint(state, "completed", budget=budget)
                yield Event("status", {"state": "completed"})
                yield Event(
                    "done",
                    {
                        "text": delivered,
                        "iterations": iteration + 1,
                        **_cost(iteration + 1, state.tool_calls_made, started),
                    },
                )

                # After `done`, deliberately: extraction is a second model call,
                # and blocking the terminal event on it would keep an interface's
                # composer disabled for the length of one. An interface that
                # stops reading at `done` simply skips it.
                async for event in self._remember(
                    conversation_id, user_message, answer, chain[state.active]
                ):
                    yield event
                return

            if planning:
                submitted = next(
                    (c for c in response.tool_calls if c.name == PLAN_TOOL_NAME), None
                )
                if submitted is not None:
                    plan = parse_plan(submitted.arguments)
                    # Persisted as the assistant's own words. The frame is what
                    # the interface renders, but the transcript is what the
                    # *model* reads on the executing turn -- "approved" means
                    # nothing if the thing approved is not in the history.
                    plan_message_id = self._persist(
                        conversation_id, "assistant", plan.as_markdown()
                    )
                    self.conversations.touch(conversation_id)
                    state.plan_message_id = plan_message_id
                    self._checkpoint(state, "completed", budget=budget)
                    yield Event("plan", plan.as_dict())
                    yield Event("status", {"state": "completed"})
                    yield Event(
                        "done",
                        {
                            "text": plan.as_markdown(),
                            "iterations": iteration + 1,
                            **_cost(iteration + 1, state.tool_calls_made, started),
                        },
                    )
                    return

            asked = self._persist(
                conversation_id,
                "assistant",
                response.text,
                tool_calls=[
                    {
                        "id": c.id,
                        "function": {"name": c.name, "arguments": c.arguments},
                    }
                    for c in response.tool_calls
                ],
            )
            # Held by reference. The arguments are already in that row and the
            # audit is already in `execution_logs`; what neither of them says is
            # which rows *this* run produced.
            if asked is not None:
                state.tool_message_ids.append(asked)
            self._checkpoint(state, "acting", budget=budget)

            for call in response.tool_calls:
                if call.name == STEP_TOOL_NAME:
                    # Answered here, not dispatched: it changes nothing, so
                    # there is nothing to run. The previous step closes when the
                    # next one opens -- a model that forgets the last one leaves
                    # it open rather than the interface claiming it finished.
                    number = call.arguments.get("number")
                    if state.step_open is not None and state.step_open != number:
                        yield Event("step_done", {"number": state.step_open})
                    state.step_open = number
                    yield Event(
                        "step_started",
                        {"number": number, "title": call.arguments.get("title") or ""},
                    )
                    self._persist(
                        conversation_id,
                        "tool",
                        f"step {number} noted",
                        tool_call_id=call.id,
                        tool_name=call.name,
                    )
                    continue

                if state.tool_calls_made >= self.guards.max_tool_calls:
                    state.error = "tool call limit reached"
                    self._checkpoint(state, "stopped", budget=budget)
                    yield _guard(
                        "tool call limit reached", said, iteration, state.tool_calls_made, started
                    )
                    self.conversations.touch(conversation_id)
                    return
                state.tool_calls_made += 1

                fingerprint = _fingerprint(call)
                seen = state.call_fingerprints.get(fingerprint, 0) + 1
                state.call_fingerprints[fingerprint] = seen
                if seen > self.guards.max_repeated_calls:
                    result = ToolResult.error(
                        f"'{call.name}' has been called with identical arguments"
                        f" {seen} times. Stop repeating it and try a"
                        " different approach, or tell the user what is blocking you."
                    )
                else:
                    tool = self.registry.get(call.name)
                    server = getattr(tool, "server_name", None)
                    yield Event(
                        "status",
                        {
                            "state": "connector" if server else "tool",
                            "tool": call.name,
                            "server": server,
                        },
                    )
                    yield Event("tool_call", {"name": call.name, "arguments": call.arguments})
                    # An artifact opens before the write, not after it.
                    #
                    # The panel is a view of the document being produced, so it
                    # has to exist while it is being produced -- and dispatch
                    # here can suspend for as long as a confirmation prompt
                    # takes to be answered. Announcing afterwards would mean the
                    # panel appeared, fully written, at the moment the user
                    # pressed Allow. `artifact_done` below carries whether the
                    # write actually succeeded. See ADR-0020.
                    for event in self._artifact_opening(
                        conversation_id,
                        call,
                        already_sent=live_artifacts.sent_for(call),
                        already_open=live_artifacts.opened(call),
                    ):
                        yield event
                    # Dispatch can suspend the turn waiting on a confirmation,
                    # so its events have to reach the interface before it
                    # returns -- awaiting the result first would announce the
                    # prompt only after it had been answered.
                    dispatch = asyncio.create_task(self._execute(call, context))
                    stopper = self._cancel_on_request(cancel, dispatch)
                    try:
                        async for event in self._drain(context.events, dispatch):
                            self._note_suspension(state, event)
                            yield event
                    finally:
                        if stopper is not None:
                            stopper.cancel()
                    if state.pending:
                        # Answered, timed out, or cancelled out from under it --
                        # either way the turn is running again.
                        state.pending.clear()
                        self._checkpoint(state, "acting")

                    if dispatch.cancelled():
                        # The user stopped the turn while this call was in
                        # flight -- including while it sat waiting on a
                        # confirmation. The trajectory has to say so, or the
                        # history claims a call that never finished. Checked
                        # rather than caught: swallowing a CancelledError here
                        # would also swallow the interface hanging up.
                        result = ToolResult.error(
                            f"'{call.name}' was interrupted by the user before it completed."
                        )
                    else:
                        result = dispatch.result()

                answered = self._persist(
                    conversation_id,
                    "tool",
                    result.content,
                    tool_call_id=call.id,
                    tool_name=call.name,
                    is_error=result.is_error,
                )
                if answered is not None:
                    state.tool_message_ids.append(answered)
                # A tool result is the most expensive thing in a turn to lose:
                # it is work already done against the real machine.
                self._checkpoint(state, budget=budget)
                yield Event(
                    "tool_result",
                    {"name": call.name, "content": result.content, "is_error": result.is_error},
                )
                for event in self._artifact_closing(conversation_id, call, result):
                    yield event

                if cancel is not None and cancel.is_set():
                    self._checkpoint(state, "cancelled", budget=budget)
                    yield Event("status", {"state": "cancelled"})
                    yield _guard(
                        "stopped by the user", said, iteration, state.tool_calls_made, started
                    )
                    self.conversations.touch(conversation_id)
                    return
        else:
            state.error = "iteration limit reached"
            self._checkpoint(state, "stopped", budget=budget)
            yield _guard(
                "iteration limit reached",
                said,
                self.guards.max_iterations - 1,
                state.tool_calls_made,
                started,
            )

        self.conversations.touch(conversation_id)

    #: How many tool results a fallback summary names before it stops listing.
    SUMMARY_TOOL_LIMIT = 8

    def _summarise(self, conversation_id: str, said: list[str]) -> str:
        """What this turn has, when the model would not say it itself.

        Not a model call -- a second one is exactly what is unavailable at this
        point -- but a plain reading of the trajectory. Anything already shown
        to the user first, then the tools that ran, so the user can see the work
        happened and decide what to ask next.
        """
        spoken = "".join(said).strip()
        if spoken:
            return spoken
        try:
            history = self.messages.history(conversation_id)
        except Exception:
            history = []
        ran = [m.tool_name for m in history if m.role == "tool" and m.tool_name]
        if not ran:
            return (
                "I could not produce an answer this turn — the model returned nothing."
                " Please ask again."
            )
        listed = ", ".join(dict.fromkeys(ran[-self.SUMMARY_TOOL_LIMIT :]))
        return (
            "The model stopped before writing an answer, so here is what this turn"
            f" actually did: it ran {listed}. Their results are above. Ask again and"
            " I will work from them."
        )

    def _disabled_connectors(self, conversation_id: str) -> set[str]:
        """Connectors whose tools this turn must not be offered.

        Two reasons, and they are different in kind:

        * **Switched off for this conversation.** One MCP manager serves the
          whole process, so a conversation-scoped toggle cannot be honoured by
          connecting a different set of servers -- the connections are shared.
          It is honoured here instead, by not advertising their tools, and again
          at dispatch.
        * **Connected but not signed in.** A stdio server starts, registers its
          tools and answers `initialize` long before anyone attaches an account
          to it, so `connected` was putting fifteen Gmail tools in front of a
          model that could not call one of them. It called one anyway, got
          `Connection closed`, concluded there was an outage and handed the work
          back -- which is the bug this whole phase started from.
        """
        servers = {t.server_name for t in self.registry.list() if t.server_name}
        if not servers:
            return set()

        hidden: set[str] = set()
        try:
            from backend.capabilities import CapabilityService, Kind

            service = CapabilityService()
            hidden |= {
                name
                for name in servers
                if service.switched_off(Kind.CONNECTOR, name, conversation_id)
            }
        except Exception as exc:
            log.debug("could not read connector state, advertising all of them: %s", exc)

        from backend.mcp import guidance

        unsigned = guidance.unsigned_connectors() & servers
        if unsigned:
            log.info("withholding tools of connectors with no account: %s", sorted(unsigned))
        return hidden | unsigned

    @staticmethod
    def _ready_connectors() -> set[str]:
        """Connectors that are connected and signed in, for the schema order.

        Best-effort by construction, and the failure is cheap: an empty set is
        the order this loop has always used.
        """
        try:
            from backend.mcp import live

            return set(live.ready_connectors())
        except Exception as exc:
            log.debug("could not read connector readiness for this turn: %s", exc)
            return set()

    async def _recall(self, conversation_id: str, user_message: str) -> list[str]:
        """Standing facts about the user, for the top of the prompt.

        Best-effort like retrieval: memory that can fail a turn is worse than no
        memory. The service itself decides whether it is switched on and returns
        nothing when it is not.
        """
        if not self.memory:
            return []
        try:
            from backend.memory import MemoryService

            return await MemoryService().recall(user_message, conversation_id)
        except Exception as exc:
            log.debug("memory recall unavailable for this turn: %s", exc)
            return []

    async def _remember(
        self,
        conversation_id: str,
        user_message: str,
        answer: str,
        answered_with: Link | None = None,
    ) -> AsyncIterator[Event]:
        """Post-turn extraction, emitting an event only when something changed.

        Nothing here may break a finished turn: the answer is already on screen
        and the trajectory is already persisted, so a failure at this point is a
        log line and nothing more.
        """
        if not self.memory or not answer.strip():
            return
        try:
            from backend.memory import MemoryService

            service = MemoryService()
            if not service.store.is_enabled(conversation_id):
                return
            client = self._memory_client(conversation_id, answered_with)
            if client is None:
                return
            diff = await service.extract(conversation_id, user_message, answer, client)
        except Exception as exc:
            log.debug("memory extraction failed: %s", exc)
            return

        if diff:
            yield Event(
                "memory", {"created": diff.create, "superseded": diff.supersede}
            )

    def _memory_client(self, conversation_id: str, answered_with: Link | None = None):
        """The extraction model: the user's chosen small one, else the turn's own.

        ai-runtime.md gives this role its own row because it runs on every turn
        and wants to be small, cheap and local. Falling back to the model that
        answered is what keeps memory working on a machine with one provider
        configured -- and after a fallback that is not the provider named on the
        conversation, which has just been proven unable to answer.
        """
        from backend.config import load_memory_model

        pinned = load_memory_model()
        if pinned:
            try:
                return resolve(*pinned).client
            except Exception as exc:
                log.debug("configured memory model unavailable, using the conversation's: %s", exc)

        if answered_with is not None:
            return resolve(answered_with.provider, answered_with.model).client

        conversation = self.conversations.get(conversation_id)
        if conversation is None:
            return None
        return resolve(conversation["provider"], conversation["model"]).client

    @staticmethod
    def _memory_references(recalled: list[str]) -> list[dict[str, Any]]:
        """The row ids behind the facts this turn was given.

        `MemoryService.render` writes each fact as `[id] fact` so the model can
        supersede one by number, and `parse_diff` reads the numbers back out the
        same way -- this is the third reader of that format, not a new one. The
        ids are worth keeping because a fact is superseded and never deleted, so
        one recorded here still resolves however the memory later changed.
        """
        references: list[dict[str, Any]] = []
        for line in recalled:
            head, _, _ = line.partition("]")
            if not head.startswith("["):
                continue
            try:
                references.append({"kind": "memory", "id": int(head[1:])})
            except ValueError:
                continue
        return references

    async def _retrieve(self, user_message: str) -> tuple[str | None, list[dict[str, Any]]]:
        """Pre-fetch vault context for the question that opened the turn.

        Best-effort by construction: an unreachable embedder or a missing vector
        extension must degrade the answer, never fail the turn. Skipped entirely
        while nothing is indexed, so a user who has never run `amethyst index` pays
        neither the query nor the embedder round trip.
        """
        if not self.retrieval or not user_message.strip():
            return None, []
        try:
            from backend.retrieval.indexer import Indexer
            from backend.retrieval.search import SearchService

            if Indexer().stats()["chunks"] == 0:
                return None, []
            context, hits = await SearchService().context_and_hits(user_message)
            # The chunk id alone is not a durable reference: the indexer removes
            # and re-inserts a chunk whose text changed, so the label -- the path
            # and heading a reader would use to find it again -- rides along.
            return context or None, [
                {"kind": "chunk", "id": hit.chunk_id, "label": hit.label} for hit in hits
            ]
        except Exception as exc:
            log.debug("retrieval unavailable for this turn: %s", exc)
            return None, []

    def _last_message_id(self, conversation_id: str) -> int:
        """The newest row id in a conversation, for the incremental history read."""
        try:
            row = self.conn_or_none().execute(
                "SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()
            return int(row[0])
        except Exception:
            return 0

    def conn_or_none(self):
        """The shared connection, or None if the database will not open."""
        try:
            from backend.db.connection import get_connection

            return get_connection()
        except Exception:
            return None

    #: The one tool whose output is a deliverable rather than a step. Named
    #: here rather than sniffed from arguments because the *name* is what
    #: arrives first in a streamed tool call -- which is the whole reason the
    #: declaration is a tool at all. See ADR-0020.
    ARTIFACT_TOOL = "create_artifact"

    def _close_open_tool_calls(self, conversation_id: str) -> None:
        """This turn's share of `close_open_tool_calls`, which is all of it."""
        close_open_tool_calls(conversation_id)

    def _artifact_path(self, call: ToolCall) -> str | None:
        """Where this call will write, resolved the way the tool will resolve it."""
        raw = (call.arguments or {}).get("path")
        if not isinstance(raw, str) or not raw.strip():
            return None
        from pathlib import Path

        root = Path(self.workspace_root or Path.cwd()).expanduser().resolve()
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = root / path
        return str(path.resolve())

    def _artifact_opening(
        self, conversation_id: str, call: ToolCall, *, already_sent: str = "", already_open: bool = False,
    ):
        """Announce an artifact and hand over its content.

        Two events rather than one because the shape is the streaming shape.
        When the provider streamed the arguments, `_LiveArtifacts` has already
        opened this document and sent most of it; `already_sent` is how much,
        so this emits only the tail rather than the file twice. When the
        provider did not stream -- Anthropic and Google still do not -- nothing
        was sent, and this emits the whole thing exactly as it always did.
        """
        if call.name != self.ARTIFACT_TOOL:
            return
        path = self._artifact_path(call)
        if path is None:
            return

        from pathlib import Path

        from backend.db.repositories import ArtifactRepository
        from backend.tools.builtin.filesystem import artifact_type

        media_type, language = artifact_type(Path(path))
        arguments = call.arguments or {}
        title = str(arguments.get("title") or "").strip() or Path(path).name
        artifact_id = ArtifactRepository.identify(conversation_id, path)
        # Announced once. When the arguments streamed, `_LiveArtifacts` already
        # opened this document and the panel has been filling ever since --
        # opening it a second time restarts it from empty, which is a document
        # blinking out and back in the middle of being read.
        if not already_open:
            yield Event(
                "artifact_open",
                {
                    "id": artifact_id,
                    "path": path,
                    "title": title,
                    "media_type": media_type,
                    "language": language,
                },
            )
        content = arguments.get("content")
        if isinstance(content, str) and content:
            # Only what the live stream has not already shown. The prefix check
            # matters: if the two disagree the streamed text was wrong, and the
            # authoritative version is this one, so send all of it.
            tail = content[len(already_sent):] if content.startswith(already_sent) else content
            if tail:
                yield Event("artifact_delta", {"id": artifact_id, "text": tail})

    def _artifact_closing(self, conversation_id: str, call: ToolCall, result: ToolResult):
        """Close the artifact, and say whether the file was actually written.

        `artifact_open` fires before dispatch, which can be refused at the
        permission gate or fail on the disk. Without this the panel would show
        a document that does not exist as though it had been saved.

        The row is written here rather than at open for the same reason: an
        artifact recorded before the write would survive a denied confirmation
        as a version of a file nobody has.
        """
        if call.name != self.ARTIFACT_TOOL:
            return
        path = self._artifact_path(call)
        if path is None:
            return

        from pathlib import Path

        from backend.db.repositories import ArtifactRepository
        from backend.tools.builtin.filesystem import artifact_type

        artifact_id = ArtifactRepository.identify(conversation_id, path)
        if result.is_error:
            yield Event(
                "artifact_done",
                {
                    "id": artifact_id,
                    "bytes": 0,
                    "version": 0,
                    "is_error": True,
                    "message": result.content,
                },
            )
            return

        arguments = call.arguments or {}
        content = arguments.get("content") or ""
        media_type, language = artifact_type(Path(path))
        title = str(arguments.get("title") or "").strip() or Path(path).name
        version = 1
        try:
            row = ArtifactRepository().record(
                conversation_id,
                path,
                title=title,
                media_type=media_type,
                language=language,
                size=len(content),
            )
            version = int(row["version"])
        except Exception as exc:
            # The same bargain `_persist` makes: the document is on disk and on
            # screen, and losing the row that lets it be reopened later is not a
            # reason to fail the turn that produced it.
            log.warning("could not record the artifact for %s: %s", path, exc)
        yield Event(
            "artifact_done",
            {
                "id": artifact_id,
                "bytes": len(content),
                "version": version,
                "is_error": False,
            },
        )

    def _route_request(self, user_message: str, attachments: Any) -> RouteRequest:
        """What the router needs to know about this turn, from what is to hand.

        Measured, not guessed, and measured *before* the history is budgeted --
        which is the only ordering that works: budgeting needs a context window,
        a context window comes from a resolved model, and which model to resolve
        is the question being asked. So the estimate here is the tool schemas
        plus the message: the floor of what the request will cost, and the part
        that actually varies. The history and the system prompt are left out
        because they are the same whichever provider answers, and this figure is
        only ever compared between providers.

        It is deliberately a floor. The real figure is rechecked against the
        chosen provider's own tokens-per-minute ceiling further down the loop,
        where guessing low costs one clean fallback -- and guessing high here
        would rule out providers that would have answered fine.
        """
        tools = self.registry.schemas(read_only=self.mode == "plan") if self.registry else []
        return RouteRequest(
            context_tokens=estimate_tokens(user_message) + tool_schema_tokens(tools),
            tool_count=len(tools),
            needs_tools=bool(tools),
            needs_vision=bool(attachments),
            interactive=True,
        )

    def _open(self, state: AgentState) -> None:
        """Start this turn's run row, and never fail a turn over it."""
        try:
            self.runs.open(state)
        except Exception as exc:
            log.warning("could not open a run row for this turn: %s", exc)

    def _checkpoint(
        self,
        state: AgentState,
        phase: str | None = None,
        *,
        budget: AttemptBudget | None = None,
    ) -> None:
        """Move the run to `phase` if given, and write it down.

        Shaped like `_persist` and for the same reason: a locked database or a
        disk that filled is not a reason the user cannot have the answer already
        on their screen. The state is how the turn is remembered, not how it is
        delivered.

        `budget` is read here rather than mirrored at every `spend` call, so the
        attempt count on the row cannot drift from the one the loop is using.
        """
        try:
            if budget is not None:
                state.budget_spent = budget.spent
            if phase is not None and phase != state.phase:
                state.enter(phase)
            self.runs.save(state)
        except IllegalTransition:
            # A loop that thinks a finished turn is still running has a defect,
            # but not one worth ending a turn the user is watching over. Logged
            # loudly and left; `tests/test_agent_state.py` asserts the refusal
            # against `AgentState` directly, where it can be seen.
            log.exception("illegal phase change from %s to %s", state.phase, phase)
        except Exception as exc:
            log.warning("could not checkpoint run %s: %s", state.id, exc)

    def _note_suspension(self, state: AgentState, event: Event) -> None:
        """Record that the turn is waiting on the user, from the event saying so.

        The permission gate and the question service each hold a future in
        process memory, so without this a restart could not tell a turn that had
        been waiting on a person from one waiting on a model -- and the sweep at
        boot would report it the same way either way.

        Read off the events they already publish. Neither service is touched, so
        what the gate allows, what it escalates and what it asks about are
        exactly as they were.
        """
        if event.type == "confirmation_required":
            state.pending.append(
                {
                    "kind": "approval",
                    "id": event.data.get("request_id"),
                    "operation_key": event.data.get("operation_key"),
                }
            )
            self._checkpoint(state, "awaiting_approval")
        elif event.type == "question_required":
            state.pending.append({"kind": "question", "id": event.data.get("id")})
            self._checkpoint(state, "awaiting_input")

    def _persist(self, *args: Any, **kwargs: Any) -> int | None:
        """Write to the transcript, and never fail a turn over it.

        A locked database, a disk that filled, a row that will not encode: none
        of that is a reason the user cannot have the answer that is already on
        their screen. The write is how the turn is remembered, not how it is
        delivered, so a failure here costs the history and nothing else --
        whereas raising cost the whole turn, from inside a `for` loop with no
        handler over it.
        """
        try:
            return self.messages.append(*args, **kwargs)
        except Exception as exc:
            log.warning("could not persist a message for this turn: %s", exc)
            # The row id, for a caller holding a reference to it. `None` means
            # there is no row to point at, which is what a failed write leaves.
            return None

    async def _execute(self, call: ToolCall, context: ToolContext) -> ToolResult:
        """Dispatch, converting anything it raises into a result (ADR-0016).

        `ToolRegistry.dispatch` already catches what the *handler* raises, which
        left everything before the handler uncovered: the permission gate, the
        connector-enabled lookup, the audit write. A raise from any of those
        went up through the dispatch task, out of `_run`, and ended the whole
        turn on an error frame -- the model never heard that one tool failed,
        and the user lost the work of every step before it.

        `CancelledError` is re-raised deliberately. Stop depends on it: the loop
        checks `dispatch.cancelled()` to record the call as interrupted, and
        swallowing it here would turn "the user pressed Stop" into "the tool
        returned an error" and let the turn keep going.
        """
        try:
            return await self.registry.dispatch(call.name, call.arguments, context)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            log.exception("dispatching %s failed outside the tool handler", call.name)
            return ToolResult.error(
                f"'{call.name}' could not be run: {type(exc).__name__}: {exc}."
                " This is a fault in AMETHYST, not in the request. Carry on without this"
                " tool and tell the user which part of the task it cost.",
                recoverable=True,
            )

    @staticmethod
    def _cancel_on_request(
        cancel: asyncio.Event | None, dispatch: asyncio.Task
    ) -> asyncio.Task | None:
        """Cancel an in-flight dispatch the moment the user asks to stop.

        Checking between calls is not enough on its own: the call that matters
        is usually the slow one, and a call suspended on a confirmation would
        otherwise hold the turn open for the gate's full timeout.
        """
        if cancel is None:
            return None

        async def watch() -> None:
            await cancel.wait()
            if not dispatch.done():
                dispatch.cancel()

        return asyncio.create_task(watch())

    @staticmethod
    async def _drain(queue: asyncio.Queue, task: asyncio.Task) -> AsyncIterator[Event]:
        """Yield what the dispatch path publishes, until the dispatch finishes.

        A sentinel queued by the task's own done-callback is what ends this,
        rather than racing the task against a queue read: the queue is FIFO, so
        everything published before the task completed is already ahead of the
        sentinel and cannot be dropped.
        """
        sentinel = object()
        task.add_done_callback(lambda _: queue.put_nowait(sentinel))
        while True:
            item = await queue.get()
            if item is sentinel:
                return
            event_type, data = item
            yield Event(event_type, data)
