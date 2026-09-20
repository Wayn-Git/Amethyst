"""MCP lifecycle and registration into the flat tool registry.

Once a server's tools are registered, the agent loop cannot tell them apart from
builtin tools -- that indistinguishability is the point (ADR-0005). The two facts
the dispatcher does know are that MCP servers run outside AMETHYST's sandbox and that
a new server needs a one-time trust confirmation, both handled by the permission
gate rather than here.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from backend.mcp import guidance
from backend.mcp.client import (
    MCPConnection,
    MCPConnectionError,
    OAuthRequired,
    _is_auth_failure,
    is_auth_failure_text,
)
from backend.mcp.config import ServerConfig, load_servers
from backend.mcp.risk import classify
from backend.mcp.status import AuthoritativeMCPStatus, HealthStatus, MCPState
from backend.tools.base import Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry, mcp_tool_key

log = logging.getLogger(__name__)

MAX_TOOLS_PER_SERVER = 128

#: The longest anything waits for connectors to come up, when the caller named
#: no deadline of its own. A connector's own ceilings -- 180s to answer, 300s
#: waiting on a sign-in -- are right for the connector and wrong for every
#: caller: the ones that pass no deadline are the boot pass and the background
#: loops, and they hold the API's registry lock while they wait, so an
#: unbounded one of those is a turn that cannot start. Nothing is cancelled at
#: the deadline; the connect keeps going and lands when it lands.
STARTUP_DEADLINE_SECONDS = 30.0

# How long reconcile leaves a failed server alone, by consecutive failure. The
# last value repeats, so a server that is genuinely gone is retried twice an
# hour rather than at the head of every turn.
RETRY_BACKOFF_SECONDS = (60.0, 300.0, 1800.0)

# Once a server's tools are in the registry it is *working*, and a later error
# string is a claim about the future rather than a fact about the present. For
# this long after registration, one is treated as transient and does not unsay
# what the registry can still be asked directly. Long enough to cover a spawn
# retry, a first-discovery hiccup and an OAuth refresh; short enough that a
# server which really has died stops claiming otherwise within one coffee.
READY_COOLDOWN_SECONDS = 300.0

# How long a liveness probe's answer is trusted before another is worth making.
#
# The connectors page polls every 3 seconds and the health tick every 8, and a
# probe per server per poll would be a steady drip of traffic to every connected
# server for a screen nobody is necessarily looking at. 30 seconds is short
# enough that a server which died is caught within one poll cycle of a page the
# user is actually on, and long enough that the polling itself costs nothing.
PROBE_CACHE_SECONDS = 30.0

# How many consecutive hard failures it takes to withdraw "ready" from a server
# whose tools are still registered. Three, not one: a single refused DNS lookup
# or a single connect timeout at the head of a turn is exactly the transient
# that used to leave a working connector reading "failed to start" forever.
DEMOTE_AFTER_FAILURES = 3


def normalize_result(result: Any) -> ToolResult:
    """MCP content blocks into AMETHYST's uniform envelope.

    Every provider receives plain text; images and other binary blocks become
    artifacts so they never bloat the text the model reads.
    """
    text_parts: list[str] = []
    artifacts: list[dict[str, Any]] = []

    for block in getattr(result, "content", None) or []:
        kind = getattr(block, "type", None)
        if kind == "text":
            text_parts.append(getattr(block, "text", "") or "")
        elif kind == "image":
            artifacts.append(
                {
                    "type": "image",
                    "mime_type": getattr(block, "mime_type", "image/png"),
                    "data": getattr(block, "data", ""),
                }
            )
            text_parts.append("[image returned]")
        elif kind == "resource":
            resource = getattr(block, "resource", None)
            uri = getattr(resource, "uri", "")
            inline = getattr(resource, "text", None)
            text_parts.append(inline if inline else f"[resource: {uri}]")
            if not inline:
                artifacts.append({"type": "resource", "uri": str(uri)})
        else:
            text_parts.append(str(block))

    structured = getattr(result, "structured_content", None)
    if structured and not text_parts:
        text_parts.append(str(structured))

    content = "\n".join(p for p in text_parts if p) or "(no content returned)"
    return ToolResult(
        content=content, artifacts=artifacts, is_error=bool(getattr(result, "is_error", False))
    )


# What a dead transport looks like coming back out of the SDK. Matched on the
# message because the exception types are anyio's and vary by transport, and
# because a `TaskGroup` wrapper hides them anyway.
_TRANSPORT_FAILURES = (
    "connection closed",
    "closedresourceerror",
    "brokenresourceerror",
    "broken pipe",
    "server has been shut down",
    "transport is closed",
    "endofstream",
    # A dead session phrases itself many ways across stdio/sse/http transports
    # and anyio wrappers; these are the ones observed leaking through as plain
    # tool errors, which then failed every later call in the turn silently.
    "connection reset",
    "connection lost",
    "connection aborted",
    "session closed",
    "session is closed",
    "server disconnected",
    "eof occurred",
    "peer closed",
    "process exited",
    "process has exited",
)


def _is_transport_failure(exc: BaseException) -> bool:
    """Whether this failure means the session died, rather than the call failing.

    The distinction matters: a tool that raises is information for the model,
    while a dead session makes every later call in the turn fail identically
    until something reconnects.
    """
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in text for marker in _TRANSPORT_FAILURES)


class _ServerLock:
    """Reentrant asyncio lock per server, so connect_server can call disconnect_server."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._owner: asyncio.Task[Any] | None = None
        self._count = 0

    async def acquire(self) -> bool:
        current_task = asyncio.current_task()
        if self._owner is not None and self._owner is current_task:
            self._count += 1
            return True
        await self._lock.acquire()
        self._owner = current_task
        self._count = 1
        return True

    def release(self) -> None:
        current_task = asyncio.current_task()
        if self._owner is not current_task:
            raise RuntimeError("Cannot release un-acquired lock")
        self._count -= 1
        if self._count == 0:
            self._owner = None
            self._lock.release()

    async def __aenter__(self) -> "_ServerLock":
        await self.acquire()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()

    def locked(self) -> bool:
        return self._lock.locked()


class MCPManager:
    """Owns every MCP connection and keeps the registry in step with them."""

    def __init__(self, registry: ToolRegistry, *, open_browser: bool = True):
        self.registry = registry
        self.open_browser = open_browser
        self.connections: dict[str, MCPConnection] = {}
        self.errors: dict[str, str] = {}
        # One lock per server, serialising connect/disconnect for that server
        # only. Without it, a mid-turn reconnect racing a turn-start reconcile
        # interleaved disconnect -> spawn -> register for the same name: the
        # loser's teardown unregistered the winner's live tools mid-call, or
        # its registry.register raised "already registered" -- the subprocess
        # churn the API's global lock exists to prevent, reachable through a
        # path the API's lock does not cover.
        self._server_locks: dict[str, _ServerLock] = {}
        # When reconcile may next try a failed server again, and how many times
        # in a row it has failed -- see `_hold_off`.
        self.retry_after: dict[str, float] = {}
        self.attempts: dict[str, int] = {}
        # When this server last put tools into the registry, and how many hard
        # failures it has had since. Together these are what let a working
        # connector shrug off a transient error -- see `is_ready`.
        self.ready_since: dict[str, float] = {}
        self.hard_failures: dict[str, int] = {}
        # The last liveness probe per server: (monotonic time, alive). This is
        # the only *fact* about a session's health -- `connected` and
        # `ready_since` are both inferences that stay true over a dead pipe --
        # so a recorded `False` outranks either of them in `is_ready`.
        self.probes: dict[str, tuple[float, bool]] = {}
        # How many tools a server exposed beyond MAX_TOOLS_PER_SERVER, so the
        # truncation is surfaced instead of silently swallowing the overflow.
        self.truncated: dict[str, int] = {}
        # Connects that outran the caller's deadline and were left to finish on
        # their own. Held only so the event loop does not garbage-collect a
        # running task; each removes itself when it settles. A connector that
        # comes up late registers its tools into the same registry, so the turn
        # after this one has them without anything having waited.
        self._starting: set[asyncio.Task] = set()
        # Whether one full reconcile pass has ever completed. Existing merely
        # used to mean "the manager object exists", but the manager is created
        # lazily on the first turn and stdio servers take seconds to spawn --
        # so in that window every row read "failed / Not running" when the
        # honest answer was "not started yet". This is the signal `state_of`
        # actually wants: until it is true, an unconnected server reports
        # `starting` rather than `failed`.
        self.reconciled_once = False
        # Cached Tool objects per server for fast rebind. When the workspace
        # root changes, rebind() is called to move live connections onto a new
        # registry. Without this cache, every tool would be recreated from the
        # discovered schema. With it, rebind reuses the cached objects (same
        # handler closure, same risk classification) and only updates the
        # registry pointer.
        self._tool_cache: dict[str, list[Tool]] = {}

    def _hold_off(self, name: str) -> None:
        """Back a failed server off, rather than writing it off.

        `reconcile` used to skip anything with an error forever, so one refused
        DNS lookup left a connector reading "failed to start" until something
        explicitly cleared it. Backing off keeps the property that comment was
        protecting -- no connect timeout at the head of every turn -- without
        making a bad minute permanent.
        """
        self.attempts[name] = self.attempts.get(name, 0) + 1
        self.hard_failures[name] = self.hard_failures.get(name, 0) + 1
        delay = RETRY_BACKOFF_SECONDS[min(self.attempts[name] - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
        self.retry_after[name] = time.monotonic() + delay

    def _clear_failure(self, name: str) -> None:
        self.errors.pop(name, None)
        self.retry_after.pop(name, None)
        self.attempts.pop(name, None)
        # A probe is a verdict on one session. Anything that clears a failure
        # either replaced that session or is about to, so keeping the old
        # verdict would let a dead-probe result outlive the pipe it described
        # and hold a freshly connected server down for the rest of its TTL.
        self.probes.pop(name, None)
        self.hard_failures.pop(name, None)

    # -------------------------------------------------------------- readiness

    def registered_tool_count(self, name: str) -> int:
        """How many of this server's tools the agent loop can actually call.

        The registry, not the connection object, because the registry is what
        dispatch reads. A connection holding a `tools` list it never managed to
        register is not usable; a server whose tools are registered is, whatever
        an old error string says about it.
        """
        return sum(1 for tool in self.registry.list() if tool.server_name == name)

    def _tool_counts(self) -> dict[str, int]:
        """Every server's registered tool count, in one pass over the registry.

        `state()` and `status()` loop servers and used to ask
        `registered_tool_count` (a full scan) twice per server -- once directly
        and once inside `is_ready` -- which is quadratic in the number of
        servers. One pass here, handed to `is_ready`, makes it linear.
        """
        counts: dict[str, int] = {}
        for tool in self.registry.list():
            if tool.server_name:
                counts[tool.server_name] = counts.get(tool.server_name, 0) + 1
        return counts

    def _log_connector_event(
        self,
        name: str,
        event: str,
        *,
        error: str | None = None,
        detail: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Write a connector lifecycle event to the same audit table as tool calls.

        Every tool *call* left a row; connecting, dropping and dying left only a
        stderr line, so "when did this connector break, and how often does it"
        had no answer at all. Reusing `execution_logs` rather than adding a
        table means `/api/logs` and `/api/metrics` pick these up as they are.

        `__connector__<name>` cannot collide with a tool key, which is always
        `<tool>__mcp__<server>`. Never raises: an audit row is not worth failing
        a connect over.
        """
        try:
            from backend.db.connection import connect
            from backend.db.repositories import ExecutionLogRepository

            ExecutionLogRepository(connect()).record(
                tool_name=f"__connector__{name}",
                tool_source="mcp",
                arguments={"event": event},
                result_summary=detail or (None if error else event),
                error=error,
                duration_ms=duration_ms,
            )
        except Exception:  # pragma: no cover - auditing must never break a connect
            log.debug("could not record connector event %s for %s", event, name, exc_info=True)

    async def probe_server(self, name: str, *, max_age: float = PROBE_CACHE_SECONDS) -> bool:
        """Ask this server whether it is alive, and remember the answer briefly.

        Everything else in this class infers health: `connected` means the
        serving task has not finished, `ready_since` means tools were registered
        recently. Both stay true over a stdio server that exited, which is
        exactly the failure that had the interface reporting "ready" beside a
        connector whose every tool call was failing.

        `max_age=0` forces a fresh probe. Only meaningful for a server that
        currently has a connection; anything else is answered False without
        traffic.
        """
        connection = self.connections.get(name)
        if connection is None or not connection.connected:
            return False
        cached = self.probes.get(name)
        if cached is not None and time.monotonic() - cached[0] < max_age:
            return cached[1]
        alive = await connection.probe()
        self.probes[name] = (time.monotonic(), alive)
        if not alive:
            log.warning("MCP server %s failed its liveness probe", name)
            self.errors[name] = connection.last_error or "stopped responding"
            self._log_connector_event(name, "probe_failed", error=self.errors[name])
        return alive

    async def _probe_live_servers(self) -> list[str]:
        """Probe every connected server at once; return the names that failed.

        Concurrent because this sits on the turn's critical path: serial probes
        over a dozen connectors would add a dozen round trips to the start of
        every turn, and the whole point is to cost less than the failures it
        prevents.
        """
        names = [n for n, c in self.connections.items() if c.connected]
        if not names:
            return []
        results = await asyncio.gather(
            *(self.probe_server(n) for n in names), return_exceptions=True
        )
        return [n for n, alive in zip(names, results) if alive is not True]

    def probed_dead(self, name: str) -> bool:
        """Whether a still-valid probe says this server is gone.

        Read by `is_ready`, which must not be async -- it is called from
        `state()` and `status()` on paths that cannot await. So the probing
        happens elsewhere (at reconcile, and on the status endpoints) and this
        only reads what was recorded.
        """
        cached = self.probes.get(name)
        if cached is None:
            return False
        return time.monotonic() - cached[0] < PROBE_CACHE_SECONDS and not cached[1]

    def authoritative_status(
        self, name: str, *, registered: int | None = None
    ) -> AuthoritativeMCPStatus:
        """Evaluate the authoritative status for this connector without guessing."""
        from backend.capabilities import CapabilityService, Kind
        from backend.mcp.commands import (
            missing_credentials,
            verify_account,
            verify_token_health,
        )
        from backend.mcp.oauth import PENDING

        configured = load_servers()
        config = configured.get(name)
        if config is None:
            conn = self.connections.get(name)
            if conn is not None:
                config = getattr(conn, "config", None) or ServerConfig(
                    name=name, transport=getattr(conn, "transport", "stdio")
                )
            elif name in self.ready_since or self.registered_tool_count(name) > 0:
                config = ServerConfig(name=name, transport="stdio")
            else:
                return AuthoritativeMCPStatus(
                    name=name,
                    state=MCPState.NOT_CONFIGURED,
                    detail="Not configured in mcp.yaml.",
                    health=HealthStatus.UNKNOWN,
                )

        # 1. Switched off check
        is_enabled = config.enabled
        try:
            if CapabilityService().switched_off(Kind.CONNECTOR, name):
                is_enabled = False
        except Exception:
            pass

        if not is_enabled:
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.OFF,
                detail="Switched off.",
                action="connect",
                health=HealthStatus.UNKNOWN,
            )

        # 2. OAuth pending authorization check
        p = PENDING.get(name)
        if p is not None:
            if p.status == "waiting":
                return AuthoritativeMCPStatus(
                    name=name,
                    state=MCPState.AUTHENTICATING,
                    detail="Waiting for provider authorization...",
                    action=None,
                    health=HealthStatus.UNKNOWN,
                )
            elif p.status == "failed":
                return AuthoritativeMCPStatus(
                    name=name,
                    state=MCPState.AUTH_ERROR,
                    detail=p.message or "Sign-in failed.",
                    action="sign_in",
                    error=p.message,
                    health=HealthStatus.UNHEALTHY,
                )

        # 3. Missing credentials check
        missing = missing_credentials(config)
        if missing:
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.AUTH_REQUIRED,
                detail=f"Needs credentials before it can start: {', '.join(missing)}",
                action="credentials",
                health=HealthStatus.UNKNOWN,
            )

        # 4. OAuth sign-in needed check
        if self.needs_sign_in(config):
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.AUTH_REQUIRED,
                detail="Sign in required.",
                action="sign_in",
                health=HealthStatus.UNKNOWN,
            )

        # 5. Check authentication and token health
        from backend.mcp.commands import is_signed_in, auth_kind

        signed_in = is_signed_in(config)
        actual_account, mismatch = verify_account(name, config.account)
        token_healthy, token_err = verify_token_health(config)

        if not token_healthy and (config.oauth or signed_in is True):
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.TOKEN_EXPIRED,
                detail=token_err or "Token expired or revoked.",
                action="sign_in",
                error=token_err,
                is_connected=False,
                is_authenticated=False,
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                health=HealthStatus.UNHEALTHY,
            )

        if mismatch:
            connection = self.connections.get(name)
            is_conn = bool(connection and connection.connected)
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.ACCOUNT_MISMATCH,
                detail=f"Authenticated account '{actual_account}' does not match expected '{config.account}'.",
                action="sign_in",
                is_connected=is_conn,
                is_authenticated=True,
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                account_mismatch=True,
                health=HealthStatus.DEGRADED,
                tools_count=self.registered_tool_count(name) if is_conn else 0,
            )

        # 6. Check hard failures
        if self.hard_failures.get(name, 0) >= DEMOTE_AFTER_FAILURES:
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.SERVER_ERROR,
                detail=self.errors.get(name) or f"Exceeded {DEMOTE_AFTER_FAILURES} consecutive failures.",
                action="retry",
                is_connected=False,
                is_authenticated=bool(signed_in or actual_account),
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                health=HealthStatus.UNHEALTHY,
                retry_in=self._retry_in(name, False),
            )

        # 7. Connection state check
        connection = self.connections.get(name)
        is_connected = bool(connection and connection.connected)
        reg_count = (
            registered if registered is not None else self.registered_tool_count(name)
        )

        is_auth = bool(signed_in is True or actual_account is not None or auth_kind(config) == "none")

        if not is_connected:
            err = self.errors.get(name)
            retry_in = self._retry_in(name, False)
            registered_at = self.ready_since.get(name)
            in_cooldown = (
                registered_at is not None
                and (time.monotonic() - registered_at < READY_COOLDOWN_SECONDS)
                and not self.probed_dead(name)
                and (self.hard_failures.get(name, 0) < DEMOTE_AFTER_FAILURES)
                and (reg_count > 0)
            )
            if in_cooldown:
                return AuthoritativeMCPStatus(
                    name=name,
                    state=MCPState.CONNECTING if not err else MCPState.SERVER_ERROR,
                    detail="Reconnecting..." if not err else err,
                    is_connected=False,
                    is_authenticated=is_auth,
                    is_usable=True,
                    account=actual_account,
                    expected_account=config.account,
                    tools_count=reg_count,
                    health=HealthStatus.DEGRADED,
                    retry_in=retry_in,
                )

            if err:
                lowered_err = err.lower()
                if any(
                    m in lowered_err
                    for m in (
                        "auth",
                        "unauthorized",
                        "401",
                        "forbidden",
                        "invalid credentials",
                        "token",
                    )
                ):
                    state = MCPState.AUTH_ERROR
                    action = "sign_in"
                elif any(
                    m in lowered_err
                    for m in ("enoent", "not found", "refused", "unreachable", "timed out")
                ):
                    state = MCPState.UNAVAILABLE
                    action = "retry"
                else:
                    state = MCPState.SERVER_ERROR
                    action = "retry"
                return AuthoritativeMCPStatus(
                    name=name,
                    state=state,
                    detail=err,
                    action=action,
                    error=err,
                    is_connected=False,
                    is_authenticated=bool(signed_in),
                    is_usable=False,
                    account=actual_account,
                    expected_account=config.account,
                    health=HealthStatus.UNHEALTHY,
                    retry_in=retry_in,
                )
            if not self.reconciled_once:
                detail_msg = f"Signed in as {actual_account}. Starting up..." if actual_account else "Starting up..."
                return AuthoritativeMCPStatus(
                    name=name,
                    state=MCPState.STARTING,
                    detail=detail_msg,
                    action=None,
                    is_connected=False,
                    is_authenticated=is_auth,
                    is_usable=False,
                    account=actual_account,
                    expected_account=config.account,
                    health=HealthStatus.UNKNOWN,
                )
            detail_msg = f"Signed in as {actual_account}." if actual_account else "Disconnected."
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.DISCONNECTED,
                detail=detail_msg,
                action="connect",
                is_connected=False,
                is_authenticated=is_auth,
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                health=HealthStatus.UNKNOWN,
            )

        # 8. Check liveness probe
        if self.probed_dead(name):
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.HEALTH_CHECK_FAILED,
                detail="Failed liveness probe; server stopped responding.",
                action="retry",
                error="Server stopped responding to health check.",
                is_connected=False,
                is_authenticated=is_auth,
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                health=HealthStatus.UNHEALTHY,
                retry_in=self._retry_in(name, False),
            )

        # 9. Check tool registration count
        reg_count = (
            registered if registered is not None else self.registered_tool_count(name)
        )
        if reg_count <= 0:
            err = self.errors.get(name)
            return AuthoritativeMCPStatus(
                name=name,
                state=MCPState.SERVER_ERROR if err else MCPState.CONNECTED,
                detail=err or "Connected, but no tools registered.",
                action="retry" if err else None,
                error=err,
                is_connected=is_connected,
                is_authenticated=is_auth,
                is_usable=False,
                account=actual_account,
                expected_account=config.account,
                tools_count=0,
                health=HealthStatus.UNHEALTHY if err else HealthStatus.DEGRADED,
            )

        # 10. Everything verified authoritative and healthy
        return AuthoritativeMCPStatus(
            name=name,
            state=MCPState.CONNECTED,
            detail=f"Connected and ready ({reg_count} tools).",
            is_connected=True,
            is_authenticated=True,
            is_usable=True,
            account=actual_account,
            expected_account=config.account,
            account_mismatch=False,
            tools_count=reg_count,
            health=HealthStatus.HEALTHY,
        )

    def is_ready(self, name: str, *, registered: int | None = None) -> bool:
        """Whether this connector is working right now with authoritative evidence."""
        status = self.authoritative_status(name, registered=registered)
        return status.is_usable

    def forget_error(self, name: str) -> None:
        """Let the next reconcile retry this server immediately.

        Called when the user does something that means "try again now" -- a
        sign-in, a toggle, an explicit connect -- which should not have to wait
        out a backoff the user has no way of seeing.
        """
        self._clear_failure(name)
        # The same events that mean "try again" are the ones that change whether
        # an account is attached, and a cached "not signed in" outliving the
        # sign-in is how a connector stays hidden after the user fixed it.
        guidance.forget()

    # ------------------------------------------------------------------ connect

    def needs_sign_in(self, config: ServerConfig) -> bool:
        """Whether connecting this server would start an interactive sign-in.

        Only asked of OAuth servers, and answered from the keychain rather than
        by trying: the whole point is to avoid the attempt.
        """
        from backend.mcp.oauth import has_stored_token

        return bool(config.oauth) and not has_stored_token(config.name)

    async def connect_server(
        self, config: ServerConfig, *, interactive: bool = True, force: bool = False
    ) -> int:
        """Connect, discover, and register. Returns the number of tools added.

        `interactive=False` refuses to begin a sign-in rather than opening a
        browser. See `needs_sign_in`.

        **Idempotent.** A server that is already connected with its tools in the
        registry is already at `ready`, and asking again returns that count
        rather than tearing the session down and building it back. It used to
        reconnect unconditionally, so every reconcile -- one per turn -- gave a
        working connector a fresh window in which to fail transiently, which is
        half of why "failed to start" appeared next to tools that worked. A
        person pressing Connect or Reconnect passes `force=True`, which is the
        one context where rebuilding the session is the point.
        """
        if not config.enabled:
            return 0

        lock = self._server_locks.setdefault(config.name, _ServerLock())
        async with lock:
            return await self._connect_server_locked(config, interactive=interactive, force=force)

    async def _connect_server_locked(
        self, config: ServerConfig, *, interactive: bool = True, force: bool = False
    ) -> int:
        live = self.connections.get(config.name)
        if (
            not force
            and live is not None
            and live.connected
            and self.registered_tool_count(config.name) > 0
        ):
            # Already at `ready`. Deliberately *not* `is_ready`, which stays true
            # for a while after a session dies: a dead session is exactly the
            # case reconcile must be allowed to rebuild.
            self._clear_failure(config.name)
            return self.registered_tool_count(config.name)

        if not interactive and self.needs_sign_in(config):
            message = (
                f"'{config.name}' has not been signed in to. Open it in Connectors"
                " and press Connect."
            )
            # Not recorded in self.errors, and this is the fix. A sign-in
            # state is not a connection error: non-interactive boots used to
            # write it as one, and the string then flowed live.error ->
            # lifecycle -> "failed to start" -- for a connector nobody had
            # tried to start, on a server where the correct rendering is a
            # Sign in button. `state_of` already gets this right from
            # `signed_in is False`; recording an error here was the only thing
            # that overrode it.
            raise OAuthRequired(message)

        await self.disconnect_server(config.name)
        connect_started = time.monotonic()
        connection = MCPConnection(
            config, open_browser=self.open_browser and interactive, interactive=interactive
        )

        try:
            await connection.connect()
        except MCPConnectionError as exc:
            # Already classified (OAuthRequired, OAuthRegistrationUnsupported, ...).
            # Re-wrapping would erase the type callers branch on.
            self.errors[config.name] = str(exc)
            self._hold_off(config.name)
            self._log_connector_event(config.name, "connect_failed", error=str(exc))
            raise
        except Exception as exc:
            self.errors[config.name] = str(exc)
            self._hold_off(config.name)
            self._log_connector_event(config.name, "connect_failed", error=str(exc))
            raise MCPConnectionError(f"'{config.name}' failed to connect: {exc}") from exc

        self.connections[config.name] = connection
        self._clear_failure(config.name)
        count = self._register_tools(config, connection)
        self._log_connector_event(
            config.name,
            "connected",
            detail=f"{count} tools",
            duration_ms=int((time.monotonic() - connect_started) * 1000),
        )
        return count

    def rebind(self, registry: ToolRegistry) -> int:
        """Move live connections onto a new registry without reconnecting them.

        The workspace root is baked into the *builtin* tools -- it is what the
        file tools are sandboxed to -- so changing it needs a new registry. It
        has nothing to do with MCP: a connector is a process holding a session,
        and which folder the file tools point at is not its business.

        Rebuilding both together meant every connector was torn down and
        respawned whenever the root changed, which it did constantly, because
        the root was the cache key and half the callers had no workspace to pass.
        A browser lost its pages, a signed-in server lost its session, and every
        tool call in flight came back "Connection closed".
        """
        self.registry = registry
        configured = load_servers()
        total = 0
        for name, connection in self.connections.items():
            config = configured.get(name)
            if config is None or not connection.connected:
                continue
            total += self._register_tools(config, connection)
        return total

    def _register_tools(self, config: ServerConfig, connection: MCPConnection) -> int:
        registered = 0
        overflow = len(connection.tools) - MAX_TOOLS_PER_SERVER
        if overflow > 0:
            self.truncated[config.name] = overflow
            log.warning(
                "%s exposes %d tools; capping at %d, %d not registered",
                config.name,
                len(connection.tools),
                MAX_TOOLS_PER_SERVER,
                overflow,
            )
        else:
            self.truncated.pop(config.name, None)
        # Use cached Tool objects when available (fast rebind path).
        cached_tools = self._tool_cache.get(config.name)
        cached_by_name = {t.name: t for t in cached_tools} if cached_tools else {}
        tools_for_cache: list[Tool] = []
        for discovered in connection.tools[:MAX_TOOLS_PER_SERVER]:
            key = mcp_tool_key(discovered.name, config.name)
            if self.registry.get(key):
                tools_for_cache.append(self.registry.get(key))
                continue
            # Reuse cached Tool if the key matches (avoids re-classifying risk,
            # re-closing over server_name, etc.).
            cached = cached_by_name.get(key)
            if cached is not None:
                self.registry.register(cached)
                tools_for_cache.append(cached)
            else:
                tool = Tool(
                    name=key,
                    description=self._describe(config, discovered.description),
                    parameters=discovered.input_schema,
                    handler=self._make_handler(config.name, discovered.name),
                    risk=classify(discovered.name, discovered.annotations),
                    source=ToolSource.MCP,
                    server_name=config.name,
                )
                self.registry.register(tool)
                tools_for_cache.append(tool)
            registered += 1
        # Update cache for this server.
        if tools_for_cache:
            self._tool_cache[config.name] = tools_for_cache

        # Recorded on registry *presence*, not on `registered > 0`: a rebind
        # that adds nothing because the tools are already there has still just
        # confirmed this server is serving them.
        if self.registered_tool_count(config.name) > 0:
            self.ready_since[config.name] = time.monotonic()
            self.hard_failures.pop(config.name, None)
        return registered

    def _describe(self, config: ServerConfig, description: str) -> str:
        label = config.description or config.name
        return (
            f"[{config.name}] {description}".strip() if description else f"[{config.name}] {label}"
        )

    def _make_handler(self, server_name: str, tool_name: str):
        async def handler(arguments: dict[str, Any], _: ToolContext) -> ToolResult:
            connection = self.connections.get(server_name)
            if connection is None or not connection.connected:
                # Named the server and told the model to "reconnect it", which
                # it cannot do -- naming the screen and the button is what makes
                # this relayable to the person who can.
                return ToolResult.error(guidance.not_connected_instruction(server_name))
            try:
                raw = await connection.call(tool_name, arguments)
            except OAuthRequired:
                # Was a CLI command. The user is in a browser; sending them to a
                # terminal for a button that is two clicks away is the interface
                # telling on itself.
                self.errors[server_name] = f"Authentication required for {server_name}"
                await self.disconnect_server(server_name)
                self._hold_off(server_name)
                self._log_connector_event(server_name, "auth_failed", error="OAuthRequired")
                guidance.forget()
                return ToolResult.error(guidance.sign_in_instruction(server_name))
            except TimeoutError:
                return ToolResult.error(f"'{tool_name}' on '{server_name}' timed out.")
            except Exception as exc:
                if _is_auth_failure(exc):
                    log.warning("%s failed authentication during %s: %s", server_name, tool_name, exc)
                    self.errors[server_name] = f"Authentication failed: {exc}"
                    await self.disconnect_server(server_name)
                    self._hold_off(server_name)
                    self._log_connector_event(server_name, "auth_failed", error=str(exc))
                    guidance.forget()
                    return ToolResult.error(guidance.sign_in_instruction(server_name))

                if not _is_transport_failure(exc):
                    # `_is_transport_failure` matches wordings that have been
                    # seen before. A transport nobody has met yet invents its
                    # own, and reading a dead session as an ordinary tool error
                    # is precisely what left a connector failing every call for
                    # the rest of the turn with nothing reconnecting it.
                    #
                    # So when the string list says no, ask the session instead
                    # of taking its word for it. A live server answers a ping in
                    # milliseconds, so this costs a genuine tool error nothing;
                    # a dead one falls through to the reconnect below, which is
                    # where it should have gone in the first place.
                    if await self.probe_server(server_name, max_age=0):
                        connection.breaker.record_failure()
                        return ToolResult.error(f"[{server_name}] {tool_name} failed: {exc}")
                    log.info(
                        "%s failed its probe after %s raised %s; treating as a dropped session",
                        server_name,
                        tool_name,
                        type(exc).__name__,
                    )

                # The session is gone, not the tool. A stdio server that exited
                # -- restarted, killed, crashed -- leaves the serving task alive
                # on a dead pipe, so `connected` stays true and every call from
                # here on answers "Connection closed" forever. Nothing retried,
                # and the model spent its turn calling three tools that could
                # not have worked. Reconnect once and try the call again.
                log.info(
                    "%s lost its connection during %s; reconnecting once",
                    server_name,
                    tool_name,
                )
                config = load_servers().get(server_name)
                if config is None:
                    return ToolResult.error(
                        f"[{server_name}] {tool_name} failed: {exc}"
                        f" (and '{server_name}' is no longer configured)"
                    )
                try:
                    self.forget_error(server_name)
                    await self.connect_server(config, interactive=False)
                    revived = self.connections.get(server_name)
                    if revived is None:
                        raise MCPConnectionError("reconnect produced no connection")
                    raw = await revived.call(tool_name, arguments)
                except Exception as retry_exc:
                    # Deliberately not a third attempt: a server that cannot be
                    # brought back is a fact to report, not one to keep paying a
                    # connect timeout for on every tool call in the turn.
                    #
                    # Demote it *now* rather than letting `is_ready`'s cooldown
                    # keep vouching for a dead session for up to five minutes --
                    # otherwise `ready_connectors_block` goes on advertising it
                    # to the model, which calls it and fails again. Dropping the
                    # dead connection (and its tools) makes readiness false
                    # immediately; the backoff schedules an honest retry.
                    await self.disconnect_server(server_name)
                    self._hold_off(server_name)
                    self.errors[server_name] = str(retry_exc)
                    self._log_connector_event(
                        server_name,
                        "dropped",
                        error=str(retry_exc),
                        detail=f"during {tool_name}",
                    )
                    return ToolResult.error(
                        guidance.dropped_instruction(server_name, str(retry_exc))
                    )
                connection = revived

            result = normalize_result(raw)
            if result.is_error and is_auth_failure_text(result.content):
                log.warning("%s returned an authentication error in tool result: %s", server_name, result.content)
                self.errors[server_name] = f"Authentication error: {result.content}"
                await self.disconnect_server(server_name)
                self._hold_off(server_name)
                self._log_connector_event(server_name, "auth_failed", error=result.content)
                guidance.forget()
                return ToolResult.error(guidance.sign_in_instruction(server_name))

            connection.breaker.record_success()
            return result

        return handler

    # --------------------------------------------------------------- lifecycle

    async def disconnect_server(self, name: str) -> None:
        lock = self._server_locks.setdefault(name, _ServerLock())
        async with lock:
            connection = self.connections.pop(name, None)
            if connection is not None and hasattr(connection, "disconnect"):
                await connection.disconnect()
            self.registry.unregister_server(name)

    async def connect_all(
        self,
        *,
        conversation_id: str | None = None,
        interactive: bool = False,
        deadline: float | None = None,
    ) -> dict[str, int | str]:
        """Connect every switched-on server. Failures are reported, never raised.

        **Concurrent, and non-interactive by default.** Serially was costing
        minutes rather than the seconds the connections themselves take: on this
        machine seven working connectors come up in about eight seconds, while
        two switched-on-but-unauthorised ones each blocked the whole queue for
        `auth_timeout_seconds` (300s) waiting on a browser nobody had opened.
        A scheduled run's entire budget went on that before it reached a model.

        So: a server needing a sign-in is reported, not waited on, and the rest
        start together. `interactive=True` is for a person pressing Connect,
        which is the only context where opening a browser is an answer.

        `deadline` bounds how long the *caller* waits, not how long a connector
        gets. A turn passes one so the agent starts answering on the connectors
        that are up; anything slower keeps starting in the background and is
        there for the next turn. Without a deadline this waits for all of them,
        which is what a boot or a person pressing Connect wants.
        """
        from backend.capabilities import CapabilityService

        live = CapabilityService().enabled_connector_names(conversation_id)
        wanted = [
            config
            for name, config in load_servers().items()
            if config.enabled and name in live
        ]

        settled: dict[str, int | str] = {}

        async def one(config: ServerConfig) -> None:
            try:
                settled[config.name] = await self.connect_server(config, interactive=interactive)
            except Exception as exc:
                settled[config.name] = str(exc)

        await self._settle(
            [asyncio.ensure_future(one(config)) for config in wanted], deadline
        )
        self.reconciled_once = True
        return settled

    async def _settle(
        self, tasks: list[asyncio.Task], deadline: float | None
    ) -> None:
        """Wait for `tasks`, but never longer than `deadline`.

        A connector's own ceiling is `timeout_seconds` (180s), and an
        unauthorised one can hold `auth_timeout_seconds` (300s) waiting on a
        browser nobody opened. Both are the right ceilings for the connector
        and the wrong ones for a caller that has a user waiting: starting
        connectors ran at the head of every turn under the API's registry lock,
        so one server that never answered bought the whole turn five minutes of
        silence before a single byte reached the browser.

        Whatever has not finished by the deadline is left running rather than
        cancelled -- cancelling a half-built stdio session leaks the subprocess
        it has already spawned, and the connection is usually seconds from
        being useful. It registers its tools when it lands.
        """
        if not tasks:
            return
        _, unfinished = await asyncio.wait(
            tasks, timeout=STARTUP_DEADLINE_SECONDS if deadline is None else deadline
        )
        for task in unfinished:
            self._starting.add(task)
            task.add_done_callback(self._starting.discard)

    def state(self) -> dict[str, dict[str, Any]]:
        """What is actually running, per server, based on authoritative evidence.

        An interface that reports the capability row alone is reporting an
        intention: the row says "on" whether the process started, died, or was
        never asked to start. This is the fact to render instead.

        The connection state is strictly True only when the connection is live.
        """
        counts = self._tool_counts()
        out: dict[str, dict[str, Any]] = {}
        for name in set(load_servers()) | set(self.connections) | set(self.errors):
            auth_status = self.authoritative_status(name, registered=counts.get(name, 0))
            registered = counts.get(name, 0)
            out[name] = {
                # Strictly True ONLY when transport connection is confirmed live right now
                "connected": auth_status.is_connected,
                "tools": registered,
                "error": None if auth_status.is_usable else (auth_status.error or self.errors.get(name)),
                "ready": auth_status.is_usable,
                "truncated": self.truncated.get(name, 0),
                "retry_in": auth_status.retry_in,
                "is_connected": auth_status.is_connected,
                "is_authenticated": auth_status.is_authenticated,
                "is_usable": auth_status.is_usable,
                "state": str(auth_status.state),
                "health": str(auth_status.health),
                "account": auth_status.account,
                "expected_account": auth_status.expected_account,
                "account_mismatch": auth_status.account_mismatch,
                "authoritative": auth_status.as_dict(),
            }
        return out

    def _retry_in(self, name: str, ready: bool) -> int:
        """Whole seconds until this server's backoff lets it retry, else 0."""
        if ready:
            return 0
        due = self.retry_after.get(name)
        if due is None:
            return 0
        return max(0, round(due - time.monotonic()))

    async def start_one(self, config: ServerConfig, *, deadline: float | None = None) -> None:
        """Bring one server up, waiting no longer than `deadline`.

        The single-server counterpart of `connect_all`, and for the same
        reason: the API holds its registry lock across this call, so an
        unbounded wait here is a lock nothing else can have. The reminder loop
        asks for the To Do connector on every tick, and a To Do server that had
        stopped answering held that lock for its full 180s ceiling -- during
        which any turn that started queued behind it with nothing bounding the
        wait. See `_settle` for why the connect is left running rather than
        cancelled.
        """

        async def one() -> None:
            try:
                await self.connect_server(config, interactive=False)
            except Exception as exc:
                # Recorded on the manager; the caller reports it in its own
                # words -- SyncUnavailable for a sync, a toast for a toggle.
                log.info("could not start %s on demand: %s", config.name, exc)
                self.errors[config.name] = str(exc)

        await self._settle([asyncio.ensure_future(one())], deadline)

    async def reconcile(self, *, deadline: float | None = None) -> dict[str, int | str]:
        """Bring live connections in line with what is currently switched on.

        One manager serves the whole process for its lifetime, so without this a
        connector switched on in the interface stayed dark until AMETHYST was
        restarted -- the toggle wrote a row nothing acted on.

        A server that already failed is left alone until its backoff expires:
        retrying a dead one on every pass would spend its connect timeout at the
        start of every turn, before the model is even called. But it *is*
        retried eventually -- skipping it forever meant one transient DNS
        failure disabled a connector for the rest of the session.

        `deadline` bounds the caller's wait. This runs at the head of every
        turn under the API's registry lock, so without one a single server that
        never answers held the turn for its full connect timeout -- 180s, or
        300s if it claimed to be waiting on a sign-in -- and the browser saw an
        open request with no bytes in it. See `_settle`.
        """
        from backend.capabilities import CapabilityService, Kind

        service = CapabilityService()
        configured = load_servers()
        results: dict[str, int | str] = {}
        pending_disconnect: list[str] = []
        pending_connect: list[ServerConfig] = []

        for name in [n for n in set(self.connections) | set(self.errors) if n not in configured]:
            # Removed from mcp.yaml. Its failure has to go with it, or health
            # stays degraded forever over a connector that no longer exists.
            pending_disconnect.append(name)
            results[name] = 0

        # Probe everything that currently claims to be up, before deciding what
        # needs connecting. This runs at the head of every turn, which is the
        # moment immediately before the model is told which connectors are live
        # -- so a session that died since the last turn is caught here rather
        # than being advertised and then failing every call the model makes to
        # it. Concurrent and cached, so the common case where everything is fine
        # costs one round trip per server and usually not even that.
        await self._probe_live_servers()

        for name, config in configured.items():
            connection = self.connections.get(name)
            connected = bool(connection and connection.connected)
            if connected and self.probed_dead(name):
                # Answered the probe with silence. Drop it now so the branch
                # below sees a disconnected server and rebuilds it, instead of
                # "already connected" leaving the dead session in place.
                pending_disconnect.append(name)
                connected = False

            if not config.enabled or service.switched_off(Kind.CONNECTOR, name):
                if connected:
                    results[name] = 0
                    pending_disconnect.append(name)
                continue

            # Only an explicit "on" starts a process. A server connected by hand
            # is left connected: no opinion is not the same as "switch it off".
            if not connected and service.is_enabled(Kind.CONNECTOR, name):
                if name in self.errors and time.monotonic() < self.retry_after.get(name, 0.0):
                    continue
                lock = self._server_locks.get(name)
                if lock is not None and lock.locked():
                    # A connect for this server is already in flight -- almost
                    # always one left running by an earlier pass that outran its
                    # deadline. Queuing a second one only waits on that same
                    # per-server lock, so every later turn paid its whole
                    # startup deadline waiting for a connect it was not going to
                    # be the one to finish.
                    continue
                pending_connect.append(config)

        # Disconnects and connects run concurrently, exactly as `connect_all`
        # does: the serial loop this replaces could hold every turn's start for
        # N x connect-timeout seconds, because reconcile runs at the head of
        # every turn under the registry lock.
        async def connect_one(config: ServerConfig) -> None:
            try:
                await self.connect_server(config, interactive=False)
            except Exception:
                # Recorded on the connection itself by `_connect_server_locked`;
                # the read-back below is what this pass reports.
                pass

        if pending_disconnect or pending_connect:
            await self._settle(
                [
                    asyncio.ensure_future(self.disconnect_server(name))
                    for name in pending_disconnect
                ]
                + [
                    asyncio.ensure_future(connect_one(config))
                    for config in pending_connect
                ],
                deadline,
            )
            for name in pending_disconnect:
                self._clear_failure(name)
                results[name] = 0
            for config in pending_connect:
                # A connect that raced its own disconnect records its outcome
                # through the connection state; read it back rather than
                # trusting the pre-gather snapshot.
                results[config.name] = self.registered_tool_count(config.name) or self.errors.get(
                    config.name, 0
                )
        self.reconciled_once = True
        return results

    async def shutdown(self) -> None:
        # Concurrent: disconnect is bounded by a 5s+5s timeout per server, and a
        # serial shutdown over N dead servers paid N times that on the exit
        # path while the API was already trying to stop.
        if self.connections:
            await asyncio.gather(
                *(self.disconnect_server(name) for name in list(self.connections))
            )

    def status(self) -> list[dict[str, Any]]:
        counts = self._tool_counts()
        out = []
        for name, config in load_servers().items():
            auth_status = self.authoritative_status(name, registered=counts.get(name, 0))
            registered = counts.get(name, 0)
            out.append(
                {
                    "name": name,
                    "transport": str(config.transport),
                    "enabled": config.enabled,
                    "connected": auth_status.is_connected,
                    "tools": registered,
                    "oauth": config.oauth,
                    "source": str(config.source),
                    "error": None if auth_status.is_usable else (auth_status.error or self.errors.get(name)),
                    "ready": auth_status.is_usable,
                    "truncated": self.truncated.get(name, 0),
                    "retry_in": auth_status.retry_in,
                    "is_connected": auth_status.is_connected,
                    "is_authenticated": auth_status.is_authenticated,
                    "is_usable": auth_status.is_usable,
                    "state": str(auth_status.state),
                    "health": str(auth_status.health),
                    "account": auth_status.account,
                    "expected_account": auth_status.expected_account,
                    "account_mismatch": auth_status.account_mismatch,
                    "authoritative": auth_status.as_dict(),
                }
            )
        return out
