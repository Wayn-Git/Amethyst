"""Tool contract and result envelope (ADR-0005).

Every tool -- builtin, integration, or MCP -- has the same shape. Above the
dispatcher nothing knows the difference; the source only affects how the call is
implemented and which permission rules apply.
"""

from __future__ import annotations

import asyncio
import enum
import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any


def compute_idempotency_key(
    turn_id: str | None,
    tool_name: str | None,
    arguments: dict[str, Any] | None,
) -> str:
    """Generate a deterministic idempotency key: turn_id + tool + hash(args).

    Deliberately excludes call_id so that re-issuing an identical write operation
    with a different call_id in the same turn is identified as duplicate and blocked.
    """
    t_id = str(turn_id or "")
    t_name = str(tool_name or "").strip()
    try:
        args_str = json.dumps(arguments or {}, sort_keys=True, default=str)
    except Exception:
        args_str = str(sorted((arguments or {}).items()))
    args_hash = hashlib.sha256(args_str.encode("utf-8")).hexdigest()[:16]
    return f"{t_id}:{t_name}:{args_hash}"


class RiskLevel(enum.StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

    def at_least(self, other: RiskLevel) -> RiskLevel:
        order = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH]
        return other if order.index(other) > order.index(self) else self


class ToolSource(enum.StrEnum):
    BUILTIN = "builtin"
    INTEGRATION = "integration"
    MCP = "mcp"


@dataclass
class ToolResult:
    """The uniform envelope. Errors are data, never exceptions."""

    content: str
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    is_error: bool = False
    #: Whether the agent loop may carry on after this. True for every error a
    #: tool can produce -- a refused permission, a missing file, a dead
    #: connector -- because all of them are information the model can act on
    #: (ADR-0016). It exists so that a failure the loop converts on the model's
    #: behalf can say so explicitly rather than being inferred from `is_error`,
    #: which says nothing about whether continuing is safe.
    recoverable: bool = True

    @classmethod
    def ok(cls, content: str, artifacts: list[dict[str, Any]] | None = None) -> ToolResult:
        return cls(content=content, artifacts=artifacts or [])

    @classmethod
    def error(cls, message: str, *, recoverable: bool = True) -> ToolResult:
        return cls(content=message, is_error=True, recoverable=recoverable)


@dataclass
class ToolContext:
    """Passed to every tool implementation at call time."""

    conversation_id: str | None = None
    workspace_root: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    # Plan mode. The schemas of every mutating tool are withheld from the model,
    # and this is the second half of that: a tool named anyway -- from an
    # earlier turn, or invented -- is refused here rather than run. Withholding
    # alone is a request; this is the enforcement.
    read_only: bool = False
    # Where the dispatch path publishes anything the interface must see while a
    # call is still in flight -- today only a confirmation prompt, which
    # suspends the turn and cannot wait for the tool result to be reported.
    # Items are (event_type, data) pairs; the agent loop drains them.
    events: asyncio.Queue | None = None
    turn_id: str | None = None
    call_id: str | None = None
    idempotency_key: str | None = None

    def clone_for_call(self, call_id: str, idempotency_key: str | None = None) -> ToolContext:
        """Create a dedicated ToolContext for a specific tool call with deterministic idempotency key."""
        new_extra = dict(self.extra)
        if idempotency_key:
            new_extra["idempotency_key"] = idempotency_key
        return ToolContext(
            conversation_id=self.conversation_id,
            workspace_root=self.workspace_root,
            extra=new_extra,
            read_only=self.read_only,
            events=self.events,
            turn_id=self.turn_id,
            call_id=call_id,
            idempotency_key=idempotency_key or self.idempotency_key,
        )


def mark_gate_suspension(
    context: ToolContext | None, gate_id: str, kind: str
) -> None:
    """Record that this call is parked on a gate, so the tool timeout knows
    which exponential shape to expect: a parked call is not a wedge.

    Confirmations, questions, and connection cards all answer on human time --
    the permission gate promises six hours, the connection gate ten minutes --
    while `tool_timeout_seconds` is written for machine errors. Announcement
    and wait below share the same `extra` dict, and the reader (`_execute`) is
    the dispatcher that built it, so this is a pure runtime signal: nothing is
    persisted, and a cancelled dispatch leaves one entry at most until its own
    `finally` clears it.
    """
    if context is None or not isinstance(getattr(context, "extra", None), dict):
        return
    waiters = context.extra.setdefault("gate_suspensions", {})
    if isinstance(waiters, dict):
        waiters[gate_id] = kind


def clear_gate_suspension(context: ToolContext | None, gate_id: str) -> None:
    if context is None or not isinstance(getattr(context, "extra", None), dict):
        return
    waiters = context.extra.get("gate_suspensions")
    if isinstance(waiters, dict):
        waiters.pop(gate_id, None)


def gate_suspensions_live(context: ToolContext | None) -> bool:
    if context is None:
        return False
    extra = getattr(context, "extra", None)
    return isinstance(extra, dict) and bool(extra.get("gate_suspensions"))


ToolHandler = Callable[[dict[str, Any], ToolContext], Awaitable[ToolResult]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler
    risk: RiskLevel = RiskLevel.MEDIUM
    source: ToolSource = ToolSource.BUILTIN
    server_name: str | None = None  # MCP tools only
    touches_paths: bool = False  # triggers the sensitive-path check
    # Overrides how a call is keyed for "don't ask again". A tool needs this
    # when the arguments alone do not describe what will actually happen -- the
    # shell's sandbox mode is not sandboxed on a machine with no sandbox, and a
    # preference granted to contained commands must not cover uncontained ones.
    subtype: Callable[[dict[str, Any]], str | None] | None = None
    # Seconds one call may run before the registry stops it. None defers to the
    # registry's default rather than to nothing: a call that never returns holds
    # the turn open, and the turn's own guards are checked *between*
    # iterations -- they cannot reach a call that is inside one.
    timeout: float | None = None

    def operation_key(self, arguments: dict[str, Any]) -> str:
        """Key for 'don't ask again' preferences: operation[:subtype]."""
        if self.subtype is not None:
            subtype = self.subtype(arguments)
        else:
            subtype = arguments.get("operation_type") or arguments.get("execution_mode")
        return f"{self.name}:{subtype}" if subtype else self.name
