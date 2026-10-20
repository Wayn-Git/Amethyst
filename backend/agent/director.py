"""The Director: the single owner of the reason -> act -> observe cycle (ADR-0016).

Nothing else decides what happens next. Tool calls are segmented into parallel
and sequential batches: read-only tools run concurrently for speed, while
writers and interactive tools run sequentially to prevent race conditions.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
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
    compact_consumed_tool_results,
    compress_tool_schemas,
    dropped_summary,
    environment_block,
    estimate_tokens,
    extract_skill_invocations,
    fit_tools_to_budget,
    message_tokens,
    sanitize_client_context,
    to_wire_message,
    to_wire_messages,
    tool_schema_tokens,
)
from backend.agent.state import AgentState, IllegalTransition
from backend.agent.tool_selector import _bare, _server_of, select_tools
from backend.agent.tool_search import (
    ToolSearchConfig,
    assemble_tool_defs,
    dispatch_tool_call,
    dispatch_tool_describe,
    dispatch_tool_search,
)
from backend.agent.intent_router import (
    IntentRoute,
    route_intent_fast,
    resolve_intent_route,
)
from backend.agent.context_compressor import ContextCompressor
from backend.agent.jev import classify_presentation
from backend.agent.trace import (
    finish_turn_trace,
    is_trace_enabled,
    record_step,
    record_tool_dispatch,
    start_turn_trace,
)
from backend.agent.widgets import classify_and_extract, to_envelope, FENCE
from backend.runtime.variant_store import depth_instruction
from backend.security.confirmation import guard_instruction
from backend.db.repositories import (
    AgentRunRepository,
    ConversationRepository,
    MessageRepository,
)
from backend.runtime import availability
from backend.runtime.chain import AttemptBudget, Link, announcement, build_chain, reason_for
from backend.runtime.failures import FailureKind, looks_like_quota, should_fall_back, should_retry
from backend.runtime.http import ProviderError, ProviderHTTPError, ProviderStreamError
from backend.runtime.registry import resolve
from backend.runtime.router import AUTO, RouteRequest, route
from backend.runtime.types import ModelParameters, ModelResponse, ToolCall, ToolSchema
from backend.tools.base import ToolContext, ToolResult
from backend.tools.registry import ToolRegistry
from backend.capabilities import CapabilityService, Kind
from backend.conversations import summaries as convo_summaries
from backend.config import load_memory_model, load_tiers
from backend.db.connection import get_connection
from backend.db.repositories import ArtifactRepository
from backend.mcp import guidance, live
from backend.mcp.composio_service import composio_service
from backend.mcp.provider_ownership import (
    compute_turn_ownership_async,
    forget as forget_ownership,
)
from backend.memory import MemoryService
from backend.retrieval.indexer import Indexer
from backend.retrieval.search import SearchService
from backend.runtime.partial_json import partial_string
from backend.tools.builtin.filesystem import artifact_type

log = logging.getLogger(__name__)

#: Applied to the estimated token count when checking a provider's
#: tokens-per-minute ceiling -- see the comment at its one use site.
TPM_SAFETY_MARGIN = 1.5

#: How long one wait for a dispatch event may block before it looks again.
#:
#: The sentinels that end these waits are posted to the same queue by each
#: task's own done-callback, so a healthy turn never reaches this. It is the
#: bound for the case where one never arrives -- which, unbounded, is a turn
#: that waits forever while `_with_heartbeats` keeps the socket demonstrably
#: alive the whole time, so the interface cannot tell it from slow work.
#: Reduced from 30s. A healthy dispatch posts its sentinel in well under a
#: second; this only bounds the case where one never arrives. Ten seconds is
#: still generous for that, and the old 30s added a full half-minute of dead
#: wait to a turn whenever a callback was lost.
DRAIN_TIMEOUT_SECONDS = 10.0


@dataclass
class Guards:
    # 0 or <= 0 indicates uncapped / no limits for iterations, tool calls, or duration.
    max_iterations: int = 40
    max_tool_calls: int = 120
    max_seconds: float = 0.0  # 0.0 = uncapped duration (no timeout)
    max_repeated_calls: int = 4
    # How many times a turn may be restarted after the model ended it without
    # actually answering -- an empty reply, or one the provider cut off.
    max_continuations: int = 3
    # How many times one answer may be picked up again after the stream carrying
    # it failed halfway. 4 resumes prevents free provider drops from failing the turn.
    max_resumes: int = 4


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

VISUALIZATION_STEER_INSTRUCTIONS: dict[str, str] = {
    "chart": (
        "PRESENTATION STEER (Jev router): The user wants an interactive chart or data visualization. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool. DO NOT output plain markdown tables or text descriptions of charts. "
        "Deliver the working, fully interactive chart via `generate_sandboxed_ui` (e.g. using Chart.js or SVG). "
        "The surrounding container already shows the title banner — do not duplicate large <h1> titles in HTML; start directly with the chart and controls. "
        "Match theme variables var(--canvas), var(--surface), var(--text), var(--text-dim), var(--accent), var(--border)."
    ),
    "calculator": (
        "PRESENTATION STEER (Jev router): The user wants an interactive tool or calculator. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool. DO NOT output plain markdown tables, code explanations, or static text. "
        "Deliver the working, fully interactive application with live inputs, responsive controls, and reactive JavaScript calculation via `generate_sandboxed_ui`. "
        "The surrounding container already shows the title banner — do not duplicate large <h1> titles in HTML; start directly with the controls and result displays. "
        "Aesthetic guidance: use clean modern card layouts, preset pill buttons, formatted currency/numbers, smooth CSS transitions, and Amethyst theme variables (var(--canvas), var(--surface), var(--surface-2), var(--text), var(--text-dim), var(--accent), var(--border))."
    ),
    "diagram": (
        "PRESENTATION STEER (Jev router): The user wants an interactive diagram, flowchart, or architecture view. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool with interactive SVG or HTML/CSS elements. "
        "Do not duplicate large <h1> titles in HTML. Match theme variables var(--canvas), var(--surface), var(--text), var(--accent), var(--border)."
    ),
    "simulation": (
        "PRESENTATION STEER (Jev router): The user wants an interactive simulation, 3D model, or animation. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool with interactive controls (e.g. Canvas or Three.js). "
        "Do not duplicate large <h1> titles in HTML. Match theme variables var(--canvas), var(--surface), var(--text), var(--accent), var(--border)."
    ),
    "comparison": (
        "PRESENTATION STEER (Jev router): The user wants a comparison or scorecard between options or technologies. "
        "CRITICAL: Deliver the response directly as an actual, integrated part of the chat with clear headings, detailed analysis, and a clean markdown comparison table, or call `generate_sandboxed_ui` for an interactive UI. "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested; keep it flowing naturally as conversation."
    ),
    "itinerary": (
        "PRESENTATION STEER (Jev router): The user wants an itinerary or travel route. "
        "CRITICAL: Deliver the response directly as an integrated part of the chat with day-by-day sections, recommendations, driving/travel times, and highlights (or via `generate_sandboxed_ui` for interactive maps/routes). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "recipe": (
        "PRESENTATION STEER (Jev router): The user wants a culinary recipe. "
        "CRITICAL: Deliver directly as an integrated part of the chat with ingredients, step-by-step instructions, and cooking tips (or via `generate_sandboxed_ui` for interactive calculators). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "step_guide": (
        "PRESENTATION STEER (Jev router): The user wants a step-by-step tutorial or technical procedure. "
        "CRITICAL: Deliver directly as an integrated part of the chat with numbered steps, explanations, and code/terminal snippets (or via `generate_sandboxed_ui` for interactive steppers). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "quiz": (
        "PRESENTATION STEER (Jev router): The user wants a quiz, trivia, or knowledge test. "
        "CRITICAL: Call `generate_sandboxed_ui` for a live interactive quiz with score tracking, or present questions directly in the chat. "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "table": (
        "PRESENTATION STEER (Jev router): The user wants a tabular comparison or data view. "
        "CRITICAL: Call `generate_sandboxed_ui` for a rich searchable, sortable interactive table."
    ),
}

def failed_tools_instruction(failures: list[dict[str, str]]) -> str:
    """Told to the model before it writes the answer, when tools failed.

    The failures were already in the transcript, as `tool` messages the model
    read -- and the observed behaviour was to read them and then write a
    confident answer as though the data had arrived. A connector that is down
    is indistinguishable, in the finished reply, from one that returned nothing
    interesting.

    So the failures are restated at the point the answer is written, with the
    one instruction that changes the output: say so. Naming them individually
    rather than counting them, because "a connector failed" is not something
    the reader can act on and "Gmail is not connected" is.
    """
    lines = []
    for failure in failures:
        where = failure.get("server") or "builtin"
        lines.append(f"- {failure['tool']} ({where}): {failure['reason']}")
    return (
        "Some tools failed during this turn:\n"
        + "\n".join(lines)
        + "\n\nYou MUST tell the user which of these failed and what it means for"
        " your answer -- what you could not check, and how that limits what you"
        " are about to say. Do not present partial results as complete, do not"
        " quietly leave the failure out, and do not fill the gap with a plausible"
        " guess. If the answer is still sound without the failed tool, say that"
        " explicitly instead of staying silent about it."
    )


# --- Dispatch hints: injected into the system prompt when the tool selector
#    detects patterns that suggest parallel or delegated work. These are
#    lightweight signals, not hard rules — the model still decides.

_PARALLEL_HINT = (
    "\n\n<dispatch_hint>"
    " You have several independent data-gathering tools available for this"
    " request. If you need to look up multiple things, search several sources,"
    " or read multiple files, use dispatch_parallel_jobs to run them in parallel"
    " rather than calling them one by one — it is faster and costs fewer round"
    " trips."
    "</dispatch_hint>"
)

_SUBAGENT_HINT = (
    "\n\n<subagent_hint>"
    " This looks like a research, analysis, or exploration task. Consider"
    " delegating to a subagent using the task tool — it can work independently"
    " with its own tool access while you continue responding to the user."
    " Use task when: the work is multistep, doesn't need your direct file"
    " access, or can run in the background."
    "</subagent_hint>"
)

# Keywords that signal delegation-eligible work (research, analysis, exploration).
_SUBAGENT_SIGNALS = frozenset({
    "research", "analyze", "analyse", "explore", "investigate", "compare",
    "evaluate", "assess", "review", "summarize", "summarise", "audit",
    "survey", "benchmark", "profile", "study",
})


def _inject_dispatch_hints(
    system_prompt: str,
    tool_schemas: list[Any],
    user_message: str,
) -> str:
    """Append dispatch hints to the system prompt based on tool selection patterns.

    When the tool selector surfaces many independent tools, the model benefits
    from a nudge toward parallel dispatch. When the message signals research or
    analysis work, a subagent hint helps the model delegate appropriately.
    """
    hints = []

    # Parallel hint: count how many data-gathering tools are available
    # (excluding core tools that are always offered regardless of intent).
    data_gathering_tools = {
        "search_web", "fetch_url", "open_url",
        "search_documents", "search_history", "search_library", "search_social",
        "list_files", "view_file", "grep_files",
        "list_calendar", "list_upcoming", "find_free_slot",
    }
    
    def _name(s: Any) -> str | None:
        return s.name if hasattr(s, "name") else s.get("name") if isinstance(s, dict) else None

    available_gathering = sum(
        1 for s in tool_schemas
        if _name(s) in data_gathering_tools
    )
    if available_gathering >= 4:
        hints.append(_PARALLEL_HINT)

    # Subagent hint: check if the message signals research/analysis work.
    words = set(user_message.lower().split())
    if words & _SUBAGENT_SIGNALS:
        hints.append(_SUBAGENT_HINT)

    if hints:
        return system_prompt + "".join(hints)
    return system_prompt


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
    # | question_required | question_settled | widget | connector_failed
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


# ---- smart parallel/sequential segmentation ----
# Tools that must never run concurrently (interactive / user-facing).
_NEVER_PARALLEL = frozenset({"ask_user", "clarify", "manage_connections"})

# Tools that are always safe to run in parallel (read-only, no shared state).
_ALWAYS_PARALLEL = frozenset({
    "read_file", "grep_files", "search_files", "view_file", "list_files",
    "search_web", "web_search", "tavily_search", "research_web", "extract_page",
    "fetch_url", "list_calendar", "list_upcoming",
    # MCP/connector read-only tools follow a naming convention. Listing them
    # explicitly is fragile against new connectors; the prefix check in
    # _plan_tool_segments catches the rest.
    "search_documents", "search_email", "read_email", "search_history",
    "search_library", "search_social", "read_social",
    "search_agentmail", "read_agentmail",
    "index_status", "find_free_slot",
})

#: Name prefixes that indicate a read-only MCP tool safe for parallel dispatch.
#: Checked when a tool is not in _ALWAYS_PARALLEL and not in _PATH_SCOPED.
_PARALLEL_PREFIXES = ("search_", "read_", "list_", "get_", "fetch_")
_READ_VERBS = ("search", "find", "read", "list", "get", "fetch", "query", "scan", "check")
_WRITE_VERBS = (
    "create", "update", "delete", "send", "reply", "add", "post",
    "edit", "write", "patch", "remove", "insert", "drop", "apply", "execute", "run",
)


def _is_parallel_read_tool(name: str) -> bool:
    """True if tool is read-only and safe to run in parallel with other reads."""
    if name in _NEVER_PARALLEL:
        return False
    bare = _bare(name).lower()
    if bare in _ALWAYS_PARALLEL or name in _ALWAYS_PARALLEL:
        return True
    if bare in _PATH_WRITERS or name in _PATH_WRITERS or bare in _NEVER_PARALLEL:
        return False
    tokens = [t for t in re.split(r"[_\-]", bare) if t]
    if any(t in _WRITE_VERBS for t in tokens):
        return False
    if any(bare.startswith(p) for p in _PARALLEL_PREFIXES):
        return True
    if any(t in _READ_VERBS for t in tokens):
        return True
    return False


def _is_composio_call(call: ToolCall, registry: ToolRegistry) -> bool:
    """True if a call targets Composio (excluding meta discovery tools)."""
    b = _bare(call.name)
    if b in ("COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MULTI_EXECUTE_TOOL"):
        return False
    tool = registry.get(call.name)
    if tool and getattr(tool, "server_name", None) == "composio":
        return True
    if _server_of(call.name) == "composio":
        return True
    from backend.mcp.composio_service import ALL_FAST_LANE_SLUGS
    if call.name in ALL_FAST_LANE_SLUGS or b in ALL_FAST_LANE_SLUGS:
        return True
    return False

# Filesystem tools that mutate state — path overlap forces sequential.
_PATH_WRITERS = frozenset({"edit_file", "write_file", "create_file"})
_PATH_READERS = frozenset({"read_file", "grep_files", "view_file"})
_PATH_SCOPED = _PATH_WRITERS | _PATH_READERS


def _canonical_path(raw: str) -> Path:
    """Canonical path for overlap detection (realpath + normcase)."""
    expanded = Path(raw).expanduser()
    candidate = expanded if expanded.is_absolute() else Path.cwd() / expanded
    return Path(os.path.normcase(os.path.realpath(candidate)))


def _extract_paths(call: ToolCall) -> list[Path]:
    """Extract canonical paths from a tool call for overlap detection."""
    if call.name not in _PATH_SCOPED:
        return []
    args = call.arguments if isinstance(call.arguments, dict) else {}
    raw = args.get("path") or args.get("root") or args.get("directory")
    if isinstance(raw, str) and raw.strip():
        return [_canonical_path(raw)]
    return []


def _paths_overlap(left: Path, right: Path) -> bool:
    """True when two canonical paths may refer to the same subtree."""
    lp, rp = left.parts, right.parts
    if not lp or not rp:
        return False
    common = min(len(lp), len(rp))
    return lp[:common] == rp[:common]


def _plan_tool_segments(
    tool_calls: list[ToolCall],
) -> list[tuple[str, list[ToolCall]]]:
    """Split tool calls into ordered (parallel | sequential) segments.

    Barriers: _NEVER_PARALLEL tools, anything not parallel-safe, and
    path-overlap between writers and any overlapping call. Runs shorter
    than 2 calls demote to sequential.
    """
    segments: list[tuple[str, list[ToolCall]]] = []
    current: list[ToolCall] = []
    reserved_paths: list[tuple[Path, bool]] = []  # (path, is_writer)

    def _close_parallel() -> None:
        nonlocal current, reserved_paths
        if len(current) >= 2:
            segments.append(("parallel", current))
        elif current:
            if segments and segments[-1][0] == "sequential":
                segments[-1][1].extend(current)
            else:
                segments.append(("sequential", current))
        current, reserved_paths = [], []

    for call in tool_calls:
        # Never-parallel tools are always barriers
        if call.name in _NEVER_PARALLEL:
            _close_parallel()
            if segments and segments[-1][0] == "sequential":
                segments[-1][1].append(call)
            else:
                segments.append(("sequential", [call]))
            continue

        # Determine if this call is always-parallel or path-scoped
        scoped = _extract_paths(call)
        is_writer = call.name in _PATH_WRITERS

        if not scoped and call.name not in _ALWAYS_PARALLEL and call.name not in _PATH_SCOPED:
            if not _is_parallel_read_tool(call.name):
                _close_parallel()
                if segments and segments[-1][0] == "sequential":
                    segments[-1][1].append(call)
                else:
                    segments.append(("sequential", [call]))
                continue

        # Check path overlap with reserved paths
        if any(
            (is_writer or existing_writer) and _paths_overlap(p, existing)
            for p in scoped
            for existing, existing_writer in reserved_paths
        ):
            _close_parallel()

        reserved_paths.extend((p, is_writer) for p in scoped)
        current.append(call)

    _close_parallel()
    return segments


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
        if getattr(self._director, "guard", None) == "read-only":
            return
        if chunk.tool_name != self._director.ARTIFACT_TOOL:
            return
        raw = chunk.arguments_so_far or ""
        index = chunk.tool_index or 0

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
        depth: str = "standard",
        guard: str = "guard",
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
        # How much answer the user asked for -- brief, standard or deep. Kept
        # beside `mode` and appended to the prompt the same way, rather than
        # passed into `build_system_prompt`: that result is cached across turns
        # by a hash of its inputs, and depth is the one input that changes from
        # one turn to the next in the same conversation.
        self.depth = depth
        # The permission mode this turn runs under, for the prompt rather than
        # for the gate: the gate gets it from the confirmation service wired
        # into the registry, and a model that is not told which mode it is in
        # can only guess at why a call was refused -- and it guesses the
        # strictest mode it knows. Appended like `depth`, for the same reason.
        self.guard = guard
        self.conversations = ConversationRepository()
        self.messages = MessageRepository()
        # Where this turn's own state goes, so it outlives the process
        # running it. See `backend/agent/state.py`.
        self.runs = AgentRunRepository()
        # Context compression engine. Uses a cheap auxiliary LLM to summarize
        # middle turns when the conversation approaches the context window.
        self._context_engine: ContextCompressor | None = None
        # Dispatch tasks this turn started and has not finished with.
        #
        # Held on the instance rather than as a local in `_run` because every
        # exit from `_run` skips the results pass that would have awaited them:
        # a guard returning early, an exception, or the reader closing the
        # generator. An abandoned dispatch keeps running against a turn whose
        # row already says it ended -- holding a confirmation nobody will ever
        # answer, or writing a tool result into a conversation that has moved
        # on. `run`'s `finally` is the one place every exit goes through.
        self._inflight: set[asyncio.Task] = set()

    def _spawn(self, coro: Any) -> asyncio.Task:
        """Start a dispatch task and remember it for that cleanup."""
        task = asyncio.create_task(coro)
        self._inflight.add(task)
        task.add_done_callback(self._inflight.discard)
        return task

    async def run(
        self,
        conversation_id: str,
        user_message: str,
        cancel: asyncio.Event | None = None,
        attachments: list[dict[str, Any]] | None = None,
        client_context: dict[str, Any] | None = None,
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
        _trace, _watchdog, _trace_token = start_turn_trace(conversation_id, user_message)
        try:
            async for event in self._run(
                state, conversation_id, user_message, cancel, attachments, client_context
            ):
                if event.type in ("assistant_delta", "assistant_text"):
                    shown.append(event.data.get("text") or "")
                yield event
        except Exception as exc:
            log.exception("the turn failed outside the loop's own handling")
            partial = "".join(shown).strip()
            sandboxed_ui_env = getattr(state, "sandboxed_ui_envelope", None)
            if not partial and sandboxed_ui_env:
                partial = sandboxed_ui_env
            elif sandboxed_ui_env and FENCE not in partial:
                partial = f"{sandboxed_ui_env}\n\n{partial}".strip()
            raw_str = f"{type(exc).__name__}: {exc}"
            message = (
                "The model stream was interrupted by the provider. Please try again."
                if "input stream" in raw_str.lower()
                else raw_str
            )
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
            #
            # The dispatch tasks go first, because they are the ones still able
            # to *write*: an early return in `_run` (a guard tripping, the user
            # pressing Stop) abandons them without ever reaching the results
            # pass, and one of those would otherwise keep running against a
            # turn whose row has already been checkpointed -- holding a
            # confirmation nobody is left to answer. See `_inflight`.
            for task in list(self._inflight):
                task.cancel()
            self._inflight.clear()
            self._close_open_tool_calls(conversation_id)
            # Nor a run row that still claims to be in flight. Every ordinary
            # exit already reaches a terminal phase; this covers the ones that
            # leave through an exception or a closed generator, which is exactly
            # the case a reader cannot tell from a turn still thinking.
            if not state.terminal:
                # The error must land with the phase: a row of phase='failed'
                # and error=NULL has no reason attached, and the interface can
                # only fall back to "The turn ended without a result". The
                # GeneratorExit path is the common producer -- the reader
                # hung up, the handler re-raises without touching
                # state.error, and the row opened at `_open` is left here.
                if not state.error:
                    state.error = "the turn ended without a result"
                self._checkpoint(state, "failed")
            try:
                await self.runs.flush_async()
            except Exception:
                self.runs.flush()
            try:
                forget_ownership()
            except Exception:
                pass
            finish_turn_trace(_trace, _watchdog, _trace_token)

    async def _run(
        self,
        state: AgentState,
        conversation_id: str,
        user_message: str,
        cancel: asyncio.Event | None = None,
        attachments: list[dict[str, Any]] | None = None,
        client_context: dict[str, Any] | None = None,
    ) -> AsyncIterator[Event]:
        conversation = self.conversations.get(conversation_id)
        if conversation is None:
            yield Event("error", {"message": f"unknown conversation {conversation_id}"})
            return

        try:
            await compute_turn_ownership_async()
        except Exception as exc:
            log.debug("could not compute turn provider ownership: %s", exc)

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
        # Skip the widget classifier for messages that are obviously code/file
        # tasks — the classifier never returns a widget for these, and skipping
        # it saves a model call (0.5-2s) per turn.
        # Fast synchronous intent routing (< 0.02ms)
        history_raw = self.messages.history(conversation_id)
        max_iters_configured = self.guards.max_iterations or 40
        intent_route, need_remote_jev, need_widget_extract = route_intent_fast(
            user_message,
            history_raw=history_raw,
            mode=self.mode,
            attachments=attachments,
            max_iterations=max_iters_configured,
        )

        # Preserve generative UI on short follow-up after a widget turn
        if intent_route.lane != "widget" and history_raw:
            last_assistant = next((m for m in reversed(history_raw) if m.role == "assistant"), None)
            if last_assistant and ("sandboxed_ui" in (last_assistant.content or "") or "generate_sandboxed_ui" in (last_assistant.content or "")):
                clean_lower = user_message.lower().strip(".!? ")
                if clean_lower in ("continue", "proceed", "go on", "next", "more", "keep going", "update", "extend") or len(clean_lower.split()) <= 6:
                    intent_route.lane = "widget"
                    intent_route.presentation = "calculator"
                    intent_route.presentation_steer = VISUALIZATION_STEER_INSTRUCTIONS.get("calculator")
                    need_remote_jev = False
                    need_widget_extract = False

        if intent_route.presentation_steer:
            state.presentation_steer = intent_route.presentation_steer

        # If remote classification is not needed, record zero / skipped immediately
        if not need_remote_jev:
            record_step("classify_presentation", 0.0)
        if not need_widget_extract:
            record_step("classify_and_extract", 0.0, skipped=True)

        # P0 timing: prefetch_ms measures gate to first model call.
        # Run Jev API and widget extraction concurrently with prefetch when needed.
        _prefetch_started = time.monotonic()
        trivial = self._is_trivial_turn(user_message, attachments)
        should_retrieve = self.retrieval and (not trivial) and self._should_retrieve(user_message, attachments)
        should_recall = self.memory and (not trivial)

        async def _run_prefetch():
            if trivial:
                recent_val = await self._recent(conversation_id)
                log.debug("turn prefetch trivial skip in %.0fms", (time.monotonic() - _prefetch_started) * 1000)
                return (None, []), [], recent_val
            elif not should_retrieve and not should_recall:
                recent_val = await self._recent(conversation_id)
                log.debug("turn prefetch direct skip in %.0fms", (time.monotonic() - _prefetch_started) * 1000)
                return (None, []), [], recent_val
            else:
                return await asyncio.gather(
                    self._retrieve(user_message) if should_retrieve else _none(),
                    self._recall(conversation_id, user_message) if should_recall else _empty(),
                    self._recent(conversation_id),
                )

        async def _run_jev():
            if not need_remote_jev:
                return intent_route.presentation
            _t_jev0 = time.perf_counter()
            try:
                recent_msgs = to_wire_messages(history_raw)[-3:]
                recent_msgs.append({"role": "user", "content": user_message})
                j_dec = await classify_presentation(recent_msgs)
                record_step("classify_presentation", (time.perf_counter() - _t_jev0) * 1000.0)
                return j_dec
            except Exception as exc:
                log.debug("Jev classification failed: %s", exc)
                record_step("classify_presentation", (time.perf_counter() - _t_jev0) * 1000.0)
                return "text"

        async def _run_widget_extract():
            if not need_widget_extract:
                return ("none", None, [])
            _t_we0 = time.perf_counter()
            try:
                w_res = await classify_and_extract(user_message)
                record_step("classify_and_extract", (time.perf_counter() - _t_we0) * 1000.0, skipped=False)
                return w_res
            except Exception as exc:
                log.debug("classify_and_extract failed: %s", exc)
                record_step("classify_and_extract", (time.perf_counter() - _t_we0) * 1000.0, skipped=False)
                return ("none", None, [])

        async def _warm_composio():
            try:
                if composio_service.is_configured():
                    await composio_service.get_connections_async()
            except Exception:
                pass

        prefetch_fut = asyncio.ensure_future(
            asyncio.gather(
                _run_prefetch(),
                _run_jev(),
                _run_widget_extract(),
                _warm_composio(),
            )
        )
        done, _ = await asyncio.wait({prefetch_fut}, timeout=0.05)
        if not done:
            if should_retrieve:
                yield Event("status", {"state": "retrieving"})
            elif should_recall:
                yield Event("status", {"state": "recalling"})

        (
            (retrieved, recalled, recent_conversations),
            jev_decision,
            (widget_type, widget_data, widget_media),
            _,
        ) = await prefetch_fut
        if not done:
            yield Event("status", {"state": "thinking"})
        log.debug(
            "turn prefetch retrieve+recall in %.0fms (trivial=%s, memories=%d)",
            (time.monotonic() - _prefetch_started) * 1000, trivial, len(recalled or []),
        )
        record_step("prefetch", (time.monotonic() - _prefetch_started) * 1000.0)

        # If a widget was extracted, deliver it immediately and complete turn without resolving model
        if widget_type != "none" and widget_data is not None:
            full_text = widget_data.pop("_full_text", None)
            envelope = to_envelope(widget_type, widget_data, widget_media)
            delivered_text = full_text or envelope
            self._persist(conversation_id, "assistant", delivered_text)
            self.conversations.touch(conversation_id)
            self._checkpoint(state, "reasoning")
            self._checkpoint(state, "completed")
            yield Event(
                "widget",
                {
                    "widget": {
                        "type": widget_type,
                        "data": widget_data,
                        "media": widget_media,
                    },
                    "text": delivered_text,
                },
            )
            yield Event("status", {"state": "completed"})
            yield Event(
                "done",
                {
                    "text": delivered_text,
                    "iterations": 1,
                    **_cost(1, 0, _prefetch_started),
                },
            )
            return

        # Finalize intent route
        intent_route = resolve_intent_route(
            intent_route,
            jev_decision=jev_decision,
            widget_extracted=False,
            max_iterations=max_iters_configured,
        )
        if intent_route.presentation_steer:
            state.presentation_steer = intent_route.presentation_steer

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
            _t_rt0 = time.perf_counter()
            route_req = self._route_request(user_message, attachments)
            routed = await asyncio.to_thread(route, route_req)
            record_step("route", (time.perf_counter() - _t_rt0) * 1000.0)
        else:
            record_step("route", 0.0)
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

        chain_order = stated if stated is not None else (routed.order if routed else None)
        chain = await asyncio.to_thread(build_chain, head_provider, head_model, order=chain_order)
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
                _t_res0 = time.perf_counter()
                model = await asyncio.to_thread(
                    resolve,
                    chain[state.active].provider,
                    chain[state.active].model,
                    max_retries=max(1, budget.allowance(len(chain) - 1 - state.active) - 1),
                )
                record_step("resolve", (time.perf_counter() - _t_res0) * 1000.0)
                # Which link is actually answering, recorded the moment it is
                # known. The conversation's own provider column is what the user
                # picked, not what replied -- and after a switch those differ.
                state.link = str(chain[state.active])
                try:
                    self.conversations.update(
                        conversation_id,
                        provider=chain[state.active].provider,
                        model=chain[state.active].model,
                    )
                except Exception:
                    log.debug("failed to persist fallback model to conversation", exc_info=True)
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
        # Skip retrieval and memory for trivial turns — short greetings,
        # acknowledgments, and simple questions don't need document search or
        # memory recall, and skipping them saves 1-5s of embedding + DB calls.
        retrieved_context, chunk_refs = retrieved
        # What the turn was given, by reference rather than by copy: the text
        # is already in the vault and in `memories`, and a second copy here is
        # the one that would go stale. See `_memory_references`.
        state.retrieved = [*self._memory_references(recalled), *chunk_refs]
        hidden_servers, ready_servers = await asyncio.gather(
            asyncio.to_thread(self._disabled_connectors, conversation_id),
            asyncio.to_thread(self._ready_connectors),
        )

        # Initialize or update the context compression engine with the
        # resolved model's context window. A model switch mid-turn
        # (fallback chain) changes the window.
        if self._context_engine is None or self._context_engine.context_length != model.capabilities.context_window:
            compression_model = getattr(self, "_compression_model", None)
            self._context_engine = ContextCompressor(
                context_length=model.capabilities.context_window,
                threshold_percent=0.50,
                compression_model=compression_model,
            )

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
        # The system prompt without its mode suffix, built on the first round
        # trip and reused for the rest of the turn. See the assembly below.
        system_base: str | None = None
        # The transcript as wire messages, assembled once and appended to as the
        # turn writes new rows. Reading the full history from SQLite on every
        # round trip -- with `json.loads` on every tool_calls blob -- made a
        # long conversation cost O(rows x iterations) on the event loop.
        history: list[dict[str, Any]] = to_wire_messages(
            self.messages.history(conversation_id)
        )
        state.seen_message_id = self._last_message_id(conversation_id)
        # Cached tool schemas within a turn: rebuilt only when the underlying
        # tool set changes (connector state, planning mode), not every iteration.
        _cached_tool_schemas: list | None = None
        _cached_tool_hash: str | None = None
        self._tool_search_catalog = None  # for bridge tool dispatch in _execute()
        self._promoted_tools: dict[str, ToolSchema] = {}  # promoted from tool_search for live invocation

        base_max_iters = 1000 if (self.guards.max_iterations is None or self.guards.max_iterations <= 0) else self.guards.max_iterations
        effective_budget = intent_route.step_budget
        max_continuations = self.guards.max_continuations or 0
        max_iters = min(base_max_iters, effective_budget + max_continuations)
        wall_clock_cap = min(self.guards.max_seconds, 45.0) if self.guards.max_seconds > 0 else 45.0
        hard_timeout = max(self.guards.max_seconds, 60.0) if self.guards.max_seconds > 0 else 60.0
        final_step_attempted = False

        for iteration in range(max_iters):
            if cancel is not None and cancel.is_set():
                self._checkpoint(state, "cancelled", budget=budget)
                yield _guard("stopped by the user", said, iteration, state.tool_calls_made, started)
                break

            elapsed = time.monotonic() - started
            if (self.guards.max_seconds > 0 and elapsed > self.guards.max_seconds) or elapsed > hard_timeout:
                state.error = "time limit reached"
                self._checkpoint(state, "stopped", budget=budget)
                yield _guard("time limit reached", said, iteration, state.tool_calls_made, started)
                break

            # The final iteration or wall-clock cap forces an answer rather than tool invocation:
            # withholding tool schemas turns a limit into a clean final wrap-up.
            hit_wall_clock = elapsed > wall_clock_cap
            task_step = iteration - state.continuations
            hit_step_limit = (iteration > 0 and task_step >= effective_budget - 1)
            final_step = hit_step_limit or hit_wall_clock

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
                # Assembled once per turn, not once per round trip.
                #
                # This sat inside the provider-retry loop inside the iteration
                # loop, so a fifteen-step turn rescanned the skills directory,
                # re-read the capability table and rebuilt the connector block
                # fifteen times or more -- for a string whose inputs (workspace,
                # pinned skills, retrieved context, memories) are all fixed for
                # the life of the turn. The mode suffixes below are *not* fixed,
                # so they are still appended per iteration to the cached base.
                if system_base is None:
                    try:
                        system_base = await asyncio.to_thread(
                            build_system_prompt,
                            workspace_root=self.workspace_root,
                            conversation_id=conversation_id,
                            pinned_skills=pinned,
                            retrieved_context=retrieved_context,
                            memories=recalled,
                            recent_conversations=recent_conversations,
                            client_context=sanitize_client_context(client_context),
                        )
                    except Exception as exc:
                        # An unreadable skill file, a capability table mid-migration,
                        # a memory row that will not render. None of that is a reason
                        # the user cannot have an answer: the model can work from the
                        # base prompt alone, and it used to lose the whole turn here.
                        log.warning(
                            "system prompt assembly failed, using the base prompt: %s", exc
                        )
                        try:
                            system_base = (
                                f"{BASE_PROMPT}\n\n"
                                f"{environment_block(self.workspace_root, sanitize_client_context(client_context))}"
                            )
                        except Exception:
                            system_base = f"{BASE_PROMPT}\n\n{environment_block(self.workspace_root)}"
                        if not state.degraded:
                            state.degraded = True
                            yield Event(
                                "warning",
                                {"message": "some context could not be assembled for this turn"},
                            )
                system_prompt = system_base
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
                system_prompt = f"{system_prompt}\n\n{depth_instruction(self.depth)}"
                # What the permission mode allows, stated once per iteration the
                # way depth is. A model only ever learned the mode from a
                # refusal, which made every refusal read as "no permission" and
                # made `full-access` sound like `read-only` from the user's
                # side of it -- the mode is the setting, and the model is the
                # one who has to name it.
                system_prompt = f"{system_prompt}\n\n{guard_instruction(self.guard)}"
                # Tool schemas are cached within a turn: the underlying tool set
                # (registry contents, connector state, planning mode) does not
                # change between iterations, so selection + compression runs
                # once instead of up to 24 times per turn.
                if model.capabilities.tools:
                    _is_read_only = planning or (self.guard == "read-only")
                    _tool_hash_key = f"{hidden_servers}:{planning}:{ready_servers}:{self.guard}"
                    if _cached_tool_schemas is None or _tool_hash_key != _cached_tool_hash:
                        raw_schemas = self.registry.schemas(
                            hidden_servers=hidden_servers,
                            read_only=_is_read_only,
                            priority_servers=ready_servers,
                        )
                        # Progressive tool disclosure: when there are many tools
                        # (178+ across connectors), replace deferrable tools with
                        # bridge tools (tool_search, tool_describe, tool_call) so
                        # the model discovers them on demand instead of seeing all
                        # schemas at once (~29K tokens).
                        _ts_config = ToolSearchConfig.from_raw(
                            getattr(self, "_tool_search_config", {})
                        )
                        _t_atd0 = time.perf_counter()
                        tool_schemas, _catalog = assemble_tool_defs(
                            raw_schemas,
                            context_length=model.capabilities.context_window,
                            config=_ts_config,
                            registry=self.registry,
                        )
                        record_step(
                            "assemble_tool_defs",
                            (time.perf_counter() - _t_atd0) * 1000.0,
                            deferral_active=(_catalog is not None),
                            catalog_size=len(_catalog) if _catalog else 0,
                            visible_count=len(tool_schemas),
                        )
                        if _catalog is not None:
                            # Bridge tools were injected; store catalog for dispatch
                            self._tool_search_catalog = _catalog
                        else:
                            self._tool_search_catalog = None

                        # Selection and compression run even under deferral, keeping
                        # visible schemas compact and within token budgets.
                        tool_schemas, withheld = select_tools(
                            tool_schemas,
                            f"{user_message}\n{' '.join(said[-3:])}",
                            lane=intent_route.lane,
                        )
                        if withheld and not state.warned_about_selection:
                            state.warned_about_selection = True
                            log.info(
                                "tool selection offered %d tools, withheld %d",
                                len(tool_schemas), withheld,
                            )
                        # Headline-only cuts to ~8-10K from ~29K with minimal
                        # quality loss -- the model calls tools by name.
                        tool_schemas = compress_tool_schemas(tool_schemas)
                        # Inject dispatch hints when the tool selector surfaces
                        # patterns that suggest parallel or delegated work.
                        if not state.warned_about_selection:
                            system_prompt = _inject_dispatch_hints(
                                system_prompt, tool_schemas, user_message
                            )
                        has_images_tag = any(
                            tag in user_message.lower() for tag in ("@images", "@image", "/images", "/image")
                        )
                        if not has_images_tag and tool_schemas is not None:
                            tool_schemas = [s for s in tool_schemas if getattr(s, "name", "") != "search_images"]
                        _cached_tool_schemas = tool_schemas
                        _cached_tool_hash = _tool_hash_key
                    else:
                        tool_schemas = list(_cached_tool_schemas)

                    # Promote matched bridge tools into active schemas for subsequent iterations
                    if tool_schemas is not None and getattr(self, "_promoted_tools", None):
                        current_names = {getattr(t, "name", "") for t in tool_schemas}
                        promoted_to_add = [
                            schema
                            for name, schema in self._promoted_tools.items()
                            if name not in current_names
                        ]
                        if promoted_to_add:
                            tool_schemas.extend(compress_tool_schemas(promoted_to_add))
                else:
                    tool_schemas = None
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
                        if hit_wall_clock or intent_route.lane != "chat":
                            cap_desc = f"{int(wall_clock_cap)}s" if hit_wall_clock else f"{max_iters}-step"
                            yield Event(
                                "warning",
                                {
                                    "message": (
                                        f"this turn reached its {cap_desc}"
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
                    history = compact_consumed_tool_results(history)
                    # Context compression: when the conversation approaches the
                    # context window, use an auxiliary LLM to summarize middle
                    # turns before budgeting. This preserves more information
                    # than drop-oldest.
                    #
                    # The argument is what the whole request would carry --
                    # system prompt + tool schemas + history. It used to pass
                    # only the first two, a near-constant that never grows
                    # with the conversation, so `should_compress` never fired
                    # and only drop-oldest ran: long chats silently lost
                    # their middle.
                    if (
                        self._context_engine is not None
                        and self._context_engine.should_compress(
                            estimate_tokens(system_prompt)
                            + tool_schema_tokens(tool_schemas)
                            + sum(message_tokens(m) for m in history)
                        )
                    ):
                        history = self._context_engine.compress(history)
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
                if state.presentation_steer:
                    wire.append({"role": "system", "content": state.presentation_steer})
                if final_step:
                    wire.append({"role": "system", "content": FINAL_STEP_INSTRUCTION})
                if state.failed_calls:
                    # Every round trip, not only the final step: the model
                    # decides whether to retry, work around it or report it at
                    # the point it reads the failure, and a reminder that only
                    # arrives at the end arrives after that decision was made.
                    wire.append(
                        {
                            "role": "system",
                            "content": failed_tools_instruction(state.failed_calls),
                        }
                    )

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
                            model = await asyncio.to_thread(
                                resolve,
                                chain[state.active].provider,
                                chain[state.active].model,
                                max_retries=max(1, budget.allowance(len(chain) - 1 - state.active) - 1),
                            )
                            state.link = str(chain[state.active])
                            try:
                                self.conversations.update(
                                    conversation_id,
                                    provider=chain[state.active].provider,
                                    model=chain[state.active].model,
                                )
                            except Exception:
                                log.debug("failed to persist fallback model to conversation", exc_info=True)
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
                streamed_reasoning = []
                # Reset per attempt, and defined whether or not the provider
                # streams: the dispatch loop below asks it how much of a
                # document already reached the panel, and Anthropic and Google
                # never take the streaming branch at all.
                live_artifacts = _LiveArtifacts(self, conversation_id)
                # The turn is about to spend money and time on a model call, so
                # this is the point worth being able to recover to.
                self._checkpoint(state, "reasoning", budget=budget)
                yield Event("status", {"state": "planning" if planning else "thinking"})
                # Set session affinity for provider-side prompt cache. Repeated
                # turns to the same conversation hit the cached prefix instead
                # of re-processing system+tools from scratch.
                if hasattr(model.client, "session_id"):
                    model.client.session_id = conversation_id
                if hasattr(model.client, "_build_payload"):
                    model.client._cache_system = True
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
                                streamed_reasoning.append(chunk.text)
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
                    effective_max_resumes = (
                        self.guards.max_resumes
                        if (self.guards.max_resumes is not None and self.guards.max_resumes > 0)
                        else 4
                    )
                    can_resume = (
                        bool(streamed_text or state.carried)
                        and (should_retry(kind) or kind in (FailureKind.UPSTREAM_UNHEALTHY, FailureKind.RETRYABLE))
                        and kind != FailureKind.NON_RETRYABLE_RATE_LIMIT
                        and not looks_like_quota(raw_message)
                        and state.resumes < effective_max_resumes
                    )
                    is_stream_interruption = (
                        (
                            "input stream" in str(raw_message).lower()
                            or "stream" in str(raw_message).lower()
                            or "connection" in str(raw_message).lower()
                            or "timeout" in str(raw_message).lower()
                            or "peer closed" in str(raw_message).lower()
                            or "stream" in type(exc).__name__.lower()
                            or isinstance(exc, ProviderStreamError)
                            or bool(streamed_reasoning)
                        )
                        and (should_retry(kind) or kind in (FailureKind.UPSTREAM_UNHEALTHY, FailureKind.RETRYABLE))
                        and kind != FailureKind.NON_RETRYABLE_RATE_LIMIT
                        and not looks_like_quota(raw_message)
                        and state.resumes < effective_max_resumes
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
                            effective_max_resumes,
                        )
                        self._checkpoint(state, budget=budget)
                        yield Event("status", {"state": "resuming"})
                        await asyncio.sleep(min(0.5 * state.resumes, 2.0))
                        continue
                    elif is_stream_interruption:
                        state.resumes += 1
                        budget.spend(1)
                        log.info(
                            "%s stream interrupted before answer text (%s); auto-recovering attempt (%d/%d)",
                            chain[state.active].provider,
                            kind,
                            state.resumes,
                            effective_max_resumes,
                        )
                        self._checkpoint(state, budget=budget)
                        yield Event("status", {"state": "resuming"})
                        await asyncio.sleep(min(0.5 * state.resumes, 2.0))
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
                        and (should_fall_back(kind) or state.active > 0 or bool(streamed_text or state.carried))
                    )
                    if can_hand_over:
                        resuming = bool(streamed_text or state.carried)
                        state.carried = merge_partial(state.carried, "".join(streamed_text))
                        failed = chain[state.active]
                        state.active += 1
                        model = await asyncio.to_thread(
                            resolve,
                            chain[state.active].provider,
                            chain[state.active].model,
                            max_retries=max(1, budget.allowance(len(chain) - 1 - state.active) - 1),
                        )
                        state.link = str(chain[state.active])
                        try:
                            self.conversations.update(
                                conversation_id,
                                provider=chain[state.active].provider,
                                model=chain[state.active].model,
                            )
                        except Exception:
                            log.debug("failed to persist fallback model to conversation", exc_info=True)
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
                    sandboxed_ui_env = getattr(state, "sandboxed_ui_envelope", None)
                    if not partial and sandboxed_ui_env:
                        partial = sandboxed_ui_env
                    elif sandboxed_ui_env and FENCE not in partial:
                        partial = f"{sandboxed_ui_env}\n\n{partial}".strip()

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
                    clean_msg = (
                        "The model stream was interrupted by the provider. Please try again."
                        if "input stream" in str(raw_message).lower()
                        or "input stream" in str(message).lower()
                        else message
                    )
                    noted = f"[model error] {clean_msg}"
                    self._persist(conversation_id, "assistant", noted)
                    state.error = clean_msg
                    self._checkpoint(state, "failed", budget=budget)
                    yield Event("status", {"state": "failed"})
                    yield Event("error", {"message": clean_msg, "resumable": True})
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
                # Update the context engine with real usage from the provider.
                if self._context_engine is not None:
                    self._context_engine.update_from_response({
                        "prompt_tokens": response.input_tokens or 0,
                        "completion_tokens": response.output_tokens or 0,
                        "total_tokens": (response.input_tokens or 0) + (response.output_tokens or 0),
                    })
                state.nudge = None
                state.resumes = 0
                budget.spent = 0
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

                sandboxed_ui_env = getattr(state, "sandboxed_ui_envelope", None)
                if sandboxed_ui_env and FENCE not in delivered:
                    delivered = f"{sandboxed_ui_env}\n\n{delivered}".strip()

                gallery_imgs = getattr(state, "gallery_images", None)
                if gallery_imgs and FENCE not in delivered:
                    formatted_imgs = [
                        {
                            "url": r.get("image") or r.get("thumbnail") or r.get("url") or "",
                            "thumbnail": r.get("thumbnail") or r.get("image") or r.get("url") or "",
                            "title": r.get("title") or "",
                            "source": r.get("source_url") or r.get("creator") or r.get("source") or "",
                        }
                        for r in gallery_imgs
                        if (r.get("image") or r.get("thumbnail") or r.get("url"))
                    ]
                    if formatted_imgs:
                        w_json = json.dumps(
                            {"type": "image_gallery", "data": {"title": "Image Gallery", "images": formatted_imgs}},
                            ensure_ascii=False,
                        )
                        w_block = f"\n\n```{FENCE}\n{w_json}\n```\n\n"
                        md_img_pat = re.compile(r"(!\[.*?\]\(.*?\)\s*)+")
                        if md_img_pat.search(delivered):
                            delivered = md_img_pat.sub(w_block, delivered, count=1)
                        else:
                            parts = delivered.split("\n\n", 1)
                            if len(parts) == 2:
                                delivered = f"{parts[0]}{w_block}{parts[1]}"
                            else:
                                delivered = f"{delivered}{w_block}"

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
                        "provider": chain[state.active].provider,
                        "model": chain[state.active].model,
                        **_cost(iteration + 1, state.tool_calls_made, started),
                    },
                )

                # After `done`, deliberately: extraction is a second model call,
                # and blocking the terminal event on it would keep an interface's
                # composer disabled for the length of one. An interface that
                # stops reading at `done` simply skips it.
                # Must never raise to outer loop and mark a completed turn as failed.
                try:
                    async for event in self._remember(
                        conversation_id, user_message, answer, chain[state.active]
                    ):
                        yield event
                    # Conversation summary refresh: deterministic SQLite write, no
                    # LLM, no embed. Keeps recent-conversations block fresh.
                    await asyncio.to_thread(self._refresh_summary, conversation_id)
                except Exception as exc:
                    log.warning("post-turn memory/summary background task failed: %s", exc)
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
                    await asyncio.to_thread(self._refresh_summary, conversation_id)
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

            # ---- segmented dispatch: parallel where safe, sequential where needed ----
            # Tool calls are split into ordered segments. Parallel segments run
            # concurrently (fastest path). Sequential segments run one-by-one
            # (safe for tools that mutate shared state or need user interaction).
            calls = list(response.tool_calls)
            # Separate step notifications (instant) from real dispatches
            step_calls = [c for c in calls if c.name == STEP_TOOL_NAME]
            dispatch_calls = [c for c in calls if c.name != STEP_TOOL_NAME]

            # Handle step calls inline (they are instant, no I/O)
            for call in step_calls:
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

            # Plan segments: parallel for independent reads, sequential for writers/conflicts
            segments = _plan_tool_segments(dispatch_calls) if dispatch_calls else []

            # Execute segments in order, collecting all (call, task) pairs
            dispatch_tasks: list[tuple[ToolCall, asyncio.Task | None]] = []

            for seg_type, seg_calls in segments:
                if seg_type == "parallel":
                    # Check if multiple calls in this segment target Composio
                    mcp_mgr = getattr(self.registry, "mcp_manager", None)
                    composio_calls: list[ToolCall] = []
                    if mcp_mgr and hasattr(mcp_mgr, "execute_composio_batch"):
                        composio_calls = [
                            c for c in seg_calls
                            if _is_composio_call(c, self.registry)
                        ]

                    batch_future: asyncio.Future | None = None
                    if len(composio_calls) >= 2:
                        batch_future = asyncio.get_running_loop().create_future()

                        async def _run_batch(calls=composio_calls, fut=batch_future):
                            try:
                                res = await mcp_mgr.execute_composio_batch(calls)
                                if not fut.done():
                                    fut.set_result(res)
                            except Exception as ex:
                                if not fut.done():
                                    fut.set_exception(ex)

                        self._spawn(_run_batch())

                    seg_tasks: list[asyncio.Task] = []
                    # Launch all calls in this segment concurrently
                    for call in seg_calls:
                        if self.guards.max_tool_calls > 0 and state.tool_calls_made >= self.guards.max_tool_calls:
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
                        if self.guards.max_repeated_calls > 0 and seen > self.guards.max_repeated_calls:
                            dispatch_tasks.append((call, None))
                            continue

                        display_tool_name = call.name
                        if call.name == "tool_call" and isinstance(call.arguments, dict):
                            sub_calls = call.arguments.get("calls", [])
                            if isinstance(sub_calls, list) and sub_calls:
                                names = [c.get("name") for c in sub_calls if isinstance(c, dict) and c.get("name")]
                                if names:
                                    display_tool_name = ", ".join(names)

                        tool = self.registry.get(call.name)
                        server = getattr(tool, "server_name", None)
                        yield Event(
                            "status",
                            {
                                "state": "connector" if server else "tool",
                                "tool": display_tool_name,
                                "server": server,
                            },
                        )
                        yield Event("tool_call", {"name": call.name, "arguments": call.arguments})
                        for event in self._artifact_opening(
                            conversation_id,
                            call,
                            already_sent=live_artifacts.sent_for(call),
                            already_open=live_artifacts.opened(call),
                        ):
                            yield event

                        if batch_future is not None and call in composio_calls:
                            c_idx = composio_calls.index(call)

                            async def _await_batch_item(idx=c_idx, fut=batch_future):
                                res_list = await fut
                                return res_list[idx]

                            task = self._spawn(_await_batch_item())
                        else:
                            task = self._spawn(self._execute(call, context))

                        dispatch_tasks.append((call, task))
                        seg_tasks.append(task)

                    # Drain events from parallel tasks
                    pending = [t for t in seg_tasks if not t.done()]
                    if pending:
                        # One token per task, and only *that* token ends its
                        # wait. Counting "a sentinel arrived" instead is what
                        # produced `InvalidStateError: Result is not set.`:
                        # a leftover from an earlier segment satisfied the
                        # count early, the loop moved on with a task still
                        # running, and the results pass called `.result()` on
                        # it. Dropping unmatched tokens also keeps them out of
                        # the transcript, where a raw `__parallel_done__` frame
                        # would otherwise be rendered as an event.
                        tokens = {object() for _ in pending}
                        for task, token in zip(pending, tokens, strict=True):
                            def _done_cb(_result, s=token):
                                context.events.put_nowait(("__parallel_done__", s))
                            task.add_done_callback(_done_cb)
                        stoppers = [
                            stopper
                            for stopper in (
                                self._cancel_on_request(cancel, task) for task in pending
                            )
                            if stopper is not None
                        ]
                        remaining = len(tokens)
                        try:
                            while remaining > 0:
                                item = await self._drain_next(context)
                                if item is None:
                                    # The bound expired. A task that has
                                    # finished without its callback reaching us
                                    # must not hold the loop open.
                                    if all(t.done() for t in pending):
                                        break
                                    continue
                                if item[0] == "__parallel_done__":
                                    if item[1] in tokens:
                                        remaining -= 1
                                    continue
                                event_type, data = item
                                self._note_suspension(state, Event(event_type, data))
                                yield Event(event_type, data)
                        finally:
                            # Orphaned otherwise: this watcher only ever fires
                            # on a Stop the turn did not live long enough to
                            # see.
                            for stopper in stoppers:
                                stopper.cancel()
                            while not context.events.empty():
                                try:
                                    item = context.events.get_nowait()
                                    if isinstance(item, tuple) and item[0] != "__parallel_done__":
                                        event_type, data = item
                                        self._note_suspension(state, Event(event_type, data))
                                        yield Event(event_type, data)
                                except Exception:
                                    break

                else:
                    # Sequential segment: execute one-by-one
                    for call in seg_calls:
                        if self.guards.max_tool_calls > 0 and state.tool_calls_made >= self.guards.max_tool_calls:
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
                        if self.guards.max_repeated_calls > 0 and seen > self.guards.max_repeated_calls:
                            dispatch_tasks.append((call, None))
                            continue

                        display_tool_name = call.name
                        if call.name == "tool_call" and isinstance(call.arguments, dict):
                            sub_calls = call.arguments.get("calls", [])
                            if isinstance(sub_calls, list) and sub_calls:
                                names = [c.get("name") for c in sub_calls if isinstance(c, dict) and c.get("name")]
                                if names:
                                    display_tool_name = ", ".join(names)

                        tool = self.registry.get(call.name)
                        server = getattr(tool, "server_name", None)
                        yield Event(
                            "status",
                            {
                                "state": "connector" if server else "tool",
                                "tool": display_tool_name,
                                "server": server,
                            },
                        )
                        yield Event("tool_call", {"name": call.name, "arguments": call.arguments})
                        for event in self._artifact_opening(
                            conversation_id,
                            call,
                            already_sent=live_artifacts.sent_for(call),
                            already_open=live_artifacts.opened(call),
                        ):
                            yield event
                        # Execute sequentially and drain events inline
                        task = self._spawn(self._execute(call, context))
                        dispatch_tasks.append((call, task))
                        token = object()
                        def _seq_done(_result, s=token):
                            context.events.put_nowait(("__parallel_done__", s))
                        task.add_done_callback(_seq_done)
                        stopper = self._cancel_on_request(cancel, task) if cancel else None
                        try:
                            # Wait for this task to complete before moving on.
                            while not task.done():
                                item = await self._drain_next(context)
                                if item is None:
                                    continue
                                if item[0] == "__parallel_done__":
                                    # Only this call's own token ends the wait.
                                    # Breaking on any of them -- as this did --
                                    # let a leftover from the previous segment
                                    # end it while the call was still running.
                                    if item[1] is token:
                                        break
                                    continue
                                event_type, data = item
                                self._note_suspension(state, Event(event_type, data))
                                yield Event(event_type, data)
                        finally:
                            if stopper is not None:
                                stopper.cancel()
                            while not context.events.empty():
                                try:
                                    item = context.events.get_nowait()
                                    if isinstance(item, tuple) and item[0] != "__parallel_done__":
                                        event_type, data = item
                                        self._note_suspension(state, Event(event_type, data))
                                        yield Event(event_type, data)
                                except Exception:
                                    break

            # Collect and yield results in original order
            for call, task in dispatch_tasks:
                if state.pending:
                    if getattr(state, "suspended_at", None):
                        started += (time.monotonic() - state.suspended_at)
                        state.suspended_at = None
                    state.pending.clear()
                    self._checkpoint(state, "acting")

                if task is None:
                    # Repeated call sentinel
                    result = ToolResult.error(
                        f"'{call.name}' has been called with identical arguments"
                        f" {state.call_fingerprints.get(_fingerprint(call), 0)} times."
                        " Stop repeating it and try a different approach,"
                        " or tell the user what is blocking you."
                    )
                elif task.cancelled():
                    result = ToolResult.error(
                        f"'{call.name}' was interrupted by the user before it completed."
                    )
                elif not task.done():
                    # A drain that ended for any reason other than this task
                    # finishing. Reading `.result()` here is what raised
                    # `InvalidStateError: Result is not set.` straight out of
                    # the turn; cancelling and saying so keeps it a tool result
                    # like every other failure at this layer.
                    task.cancel()
                    result = ToolResult.error(
                        f"'{call.name}' had not finished when the turn stopped"
                        " waiting for it, so it was cancelled. Check whether it"
                        " changed anything before relying on the absence of a result."
                    )
                elif (exc := task.exception()) is not None:
                    # `_execute` catches everything, but a bridge path that
                    # only catches `Exception` can still let one through, and a
                    # second exception raised here would replace the first.
                    result = ToolResult.error(f"'{call.name}' raised {type(exc).__name__}: {exc}")
                else:
                    result = task.result()
                    if result and result.content:
                        from backend.mcp.composio_sanitizer import cap_tool_result_content
                        result.content = cap_tool_result_content(
                            result.content, tool_name=call.name, arguments=call.arguments
                        )
                        if f"```{FENCE}" in result.content:
                            m = re.search(rf"```{re.escape(FENCE)}\s*\n(.*?)\n```", result.content, re.DOTALL)
                            if m:
                                state.sandboxed_ui_envelope = f"```{FENCE}\n{m.group(1).strip()}\n```"

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
                self._checkpoint(state, budget=budget)
                yield Event(
                    "tool_result",
                    {"name": call.name, "content": result.content, "is_error": result.is_error},
                )
                if call.name == "search_images" and not result.is_error:
                    try:
                        raw_data = json.loads(result.content)
                        if isinstance(raw_data, list) and raw_data:
                            state.gallery_images = raw_data
                    except Exception:
                        pass
                if result.is_error:
                    failed_tool = self.registry.get(call.name)
                    failure = {
                        "tool": call.name,
                        "server": getattr(failed_tool, "server_name", None) or "",
                        "reason": result.content[:300],
                    }
                    state.failed_calls.append(failure)
                    # A separate event from `tool_result`, because the interface
                    # needs to mark the *turn* as having failed something -- a
                    # result card scrolled past on the way to a confident answer
                    # is exactly how a broken connector went unnoticed.
                    yield Event("connector_failed", failure)
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
                max_iters - 1,
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
            service = CapabilityService()
            hidden |= {
                name
                for name in servers
                if service.switched_off(Kind.CONNECTOR, name, conversation_id)
            }
        except Exception as exc:
            log.debug("could not read connector state, advertising all of them: %s", exc)

        unsigned = guidance.unsigned_connectors() & servers
        if unsigned:
            log.info("withholding tools of connectors with no account: %s", sorted(unsigned))

        # Also withhold any connector that is managed by the live manager but not verified usable right now
        try:
            mgr = live.get_manager()
            if mgr is not None and hasattr(mgr, "is_ready"):
                managed = set(getattr(mgr, "servers", {})) | set(getattr(mgr, "connections", {}))
                unusable = {s for s in (servers & managed) if not mgr.is_ready(s)}
                if unusable:
                    log.info("withholding tools of connectors not verified usable: %s", sorted(unusable))
                    hidden |= unusable
        except Exception as exc:
            log.debug("could not verify connector readiness: %s", exc)

        return hidden | unsigned

    @staticmethod
    def _ready_connectors() -> set[str]:
        """Connectors that are connected and signed in, for the schema order.

        Best-effort by construction, and the failure is cheap: an empty set is
        the order this loop has always used.
        """
        try:
            return set(live.ready_connectors())
        except Exception as exc:
            log.debug("could not read connector readiness for this turn: %s", exc)
            return set()

    def _is_trivial_turn(self, user_message: str, attachments: list | None = None) -> bool:
        """Heuristic: should retrieval and memory be skipped for this turn?

        Trivial turns are short greetings, acknowledgments, and conversational pleasantries
        where there's nothing to retrieve and no memories to recall. Skipping
        them saves 1-5s of embedding + DB calls per turn.

        ChatGPT parity: questions always need context, even short ones. Only
        non-questions with ack/greeting shape skip. Target <2s TTFT trivial.
        """
        if attachments:
            return False
        text = user_message.strip()
        if not text:
            return True
        # Any question mark means retrieval/recall may matter.
        if "?" in text:
            return False
        cleaned = text.lower().rstrip(".!? ")
        greetings = {
            "hi", "hello", "hey", "yo", "sup",
            "good morning", "good afternoon", "good evening", "good night",
            "thanks", "thank you", "thx", "ty",
            "ok", "okay", "k", "cool", "great", "nice", "awesome", "perfect",
            "yes", "yeah", "yep", "no", "nope",
            "continue", "proceed", "go on", "next", "more", "keep going",
            "bye", "goodbye", "cya", "see ya",
            "ping", "test",
        }
        if cleaned in greetings:
            return True
        # Interrogatives alone are never trivial ("why", "how", "search x").
        first = cleaned.split()[0] if cleaned.split() else ""
        if first in {
            "what", "why", "how", "when", "where", "who", "which",
            "search", "find", "remember", "recall", "forget",
        }:
            return False
        # Short ack phrases: "thanks a lot", "ok thanks", "got it", "sounds good".
        # Bounded: <=4 words, <=32 chars, every token known-ack.
        ack_tokens = greetings | {
            "a", "lot", "so", "much", "very", "got", "it", "noted",
            "understood", "sure", "will", "do", "sounds", "good",
            "great", "please", "for", "that", "this", "my", "all",
        }
        words = re.findall(r"[a-z']+", cleaned)
        if 0 < len(words) <= 4 and len(cleaned) <= 32 and all(w in ack_tokens for w in words):
            return True
        return False

    def _should_retrieve(self, user_message: str, attachments: list | None = None) -> bool:
        """Heuristic: does this prompt target vault note retrieval?

        Direct code tasks, command executions, component building, UI/widget generation,
        and follow-up continuations do not need vault document retrieval unless
        notes/vault/documents are explicitly mentioned.
        Skipping unneeded retrieval saves ~400ms TTFT per turn.
        """
        if not self.retrieval or not user_message.strip():
            return False
        text = user_message.strip().lower()
        if any(k in text for k in ("note", "notes", "vault", "doc", "docs", "document", "documents", "readme", "spec", "journal", "briefing")):
            return True

        # UI/widget tasks, calculators, and interactive presentation prompts never need vault notes
        ui_widget_terms = (
            "calculator", "calc", "splitter", "tip", "mortgage", "chart", "graph",
            "simulation", "simulator", "diagram", "widget", "sandboxed", "game",
            "dashboard", "visualizer", "app", "counter", "convert", "converter",
        )
        if any(k in text for k in ui_widget_terms):
            return False

        # Continuations and short follow-up prompts
        clean_word = text.strip(".!? ")
        if clean_word in (
            "continue", "proceed", "go on", "next", "more", "keep going", "again",
            "retry", "update", "extend", "fix it", "make it better", "looks good",
        ):
            return False

        code_task_starters = (
            "write ", "create ", "build ", "fix ", "debug ", "refactor ", "implement ",
            "run ", "exec ", "npm ", "git ", "pip ", "cd ", "mkdir ", "touch ", "rm ",
            "add unit test", "add test", "update component", "edit file", "make a ", "make ",
            "can you make", "can you build", "can you create", "could you make", "could you build",
            "give me ", "gimme ", "show me "
        )
        if text.startswith(code_task_starters):
            return False
        return True

    async def _recent(self, conversation_id: str) -> str | None:
        """Recent-conversation summaries for continuity, precomputed.

        Single SQLite read, no embedding, no model call. Best-effort like
        recall: never fails a turn. Excludes current conversation.
        """
        try:
            return await asyncio.to_thread(
                convo_summaries.recent_block, conversation_id, 15,
            )
        except Exception as exc:
            log.debug("recent conversations unavailable for this turn: %s", exc)
            return None

    def _refresh_summary(self, conversation_id: str) -> None:
        """Update this conversation's summary post-turn. Sync SQLite, no LLM."""
        try:
            convo_summaries.refresh_conversation_summary(conversation_id)
        except Exception as exc:
            log.debug("conversation summary refresh failed: %s", exc)

    async def _recall(self, conversation_id: str, user_message: str) -> list[str]:
        """Standing facts about the user, for the top of the prompt.

        Best-effort like retrieval: memory that can fail a turn is worse than no
        memory. The service itself decides whether it is switched on and returns
        nothing when it is not.
        """
        if not self.memory:
            return []
        try:
            return await asyncio.wait_for(
                MemoryService().recall(user_message, conversation_id), timeout=0.4
            )
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
            service = MemoryService()
            if not service.store.is_enabled(conversation_id):
                return
            client = self._memory_client(conversation_id, answered_with)
            if client is None:
                return

            diff = None
            clients_to_try = [client]
            seen_clients = {client}

            if answered_with is not None:
                with contextlib.suppress(Exception):
                    c = resolve(answered_with.provider, answered_with.model).client
                    if c not in seen_clients:
                        seen_clients.add(c)
                        clients_to_try.append(c)

            with contextlib.suppress(Exception):
                tiers = load_tiers()
                for tier_key in ("fast", "default"):
                    tier = tiers.get(tier_key)
                    if tier and getattr(tier, "provider", None) and getattr(tier, "model", None):
                        c = resolve(tier.provider, tier.model).client
                        if c not in seen_clients:
                            seen_clients.add(c)
                            clients_to_try.append(c)

            for candidate_client in clients_to_try:
                try:
                    diff = await service.extract(conversation_id, user_message, answer, candidate_client)
                    if diff:
                        break
                except Exception as exc:
                    log.warning("memory extraction candidate failed: %s", exc)
        except Exception as exc:
            log.warning("memory extraction failed: %s", exc)
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
            stats = await asyncio.to_thread(lambda: Indexer().stats())
            if stats.get("chunks", 0) == 0:
                return None, []
            context, hits = await asyncio.wait_for(
                SearchService().context_and_hits(user_message), timeout=0.4
            )
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

        artifact_id = ArtifactRepository.identify(conversation_id, path)
        if result.is_error:
            yield Event(
                "artifact_done",
                {
                    "id": artifact_id,
                    "path": path,
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
            self.runs.save_background(state)
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
        if event.type in ("confirmation_required", "question_required"):
            if not getattr(state, "suspended_at", None):
                state.suspended_at = time.monotonic()
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

        Bridge tools (tool_search, tool_describe, tool_call) are intercepted
        here and dispatched through the tool search module instead of the
        normal registry dispatch. This lets the model discover and invoke
        deferred tools without having their full schemas in context.

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
        _t_disp0 = time.perf_counter()
        _is_bridge = False
        try:
            # --- Bridge tool dispatch (progressive tool disclosure) ---
            catalog = getattr(self, "_tool_search_catalog", None)
            if call.name == "tool_search" and catalog is not None:
                _is_bridge = True
                try:
                    queries = call.arguments.get("queries")
                    if queries is None:
                        queries = call.arguments.get("query") or call.arguments.get("use_case") or []
                    if isinstance(queries, str):
                        queries = [queries]
                    result = await dispatch_tool_search(queries, catalog)
                    # Promote matched tools to live tool array for subsequent iterations
                    if not hasattr(self, "_promoted_tools") or self._promoted_tools is None:
                        self._promoted_tools = {}
                    for r in result.get("results", []):
                        for m in r.get("matches", []):
                            m_name = m.get("name")
                            if m_name and m_name not in self._promoted_tools:
                                self._promoted_tools[m_name] = ToolSchema(
                                    name=m_name,
                                    description=m.get("description", ""),
                                    parameters=m.get("parameters", {}),
                                )
                    return ToolResult.ok(json.dumps(result, indent=2))
                except Exception as exc:
                    return ToolResult.error(f"tool_search failed: {exc}")

            if call.name == "tool_describe" and catalog is not None:
                _is_bridge = True
                try:
                    names = call.arguments.get("names")
                    if names is None:
                        names = call.arguments.get("name") or call.arguments.get("tool_name") or []
                    if isinstance(names, str):
                        names = [names]
                    result = await dispatch_tool_describe(names, catalog)
                    return ToolResult.ok(json.dumps(result, indent=2))
                except Exception as exc:
                    return ToolResult.error(f"tool_describe failed: {exc}")

            if call.name == "tool_call" and catalog is not None:
                _is_bridge = True
                try:
                    calls = call.arguments.get("calls")
                    if calls is None:
                        if "name" in call.arguments or "tool_slug" in call.arguments:
                            calls = [call.arguments]
                        else:
                            calls = []
                    elif isinstance(calls, dict):
                        calls = [calls]
                    results = await dispatch_tool_call(
                        calls, catalog, self.registry, context
                    )
                    return ToolResult.ok(json.dumps(results, indent=2))
                except Exception as exc:
                    return ToolResult.error(f"tool_call failed: {exc}")

            # --- Normal dispatch ---
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
        finally:
            record_tool_dispatch(
                call.name,
                (time.perf_counter() - _t_disp0) * 1000.0,
                arguments=call.arguments,
                is_bridge=_is_bridge,
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
    async def _drain_next(context) -> tuple[str, Any] | None:
        """The next dispatch event, or None when none arrived in time.

        Bounded rather than bare `queue.get()`: see `DRAIN_TIMEOUT_SECONDS`.
        A caller that gets None re-checks whatever it is actually waiting for,
        so a lost sentinel costs a delay rather than the turn.
        """
        try:
            return await asyncio.wait_for(context.events.get(), timeout=DRAIN_TIMEOUT_SECONDS)
        except TimeoutError:
            return None

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
