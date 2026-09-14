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
from backend.mcp.client import MCPConnection, MCPConnectionError, OAuthRequired
from backend.mcp.config import ServerConfig, load_servers
from backend.mcp.risk import classify
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

    def is_ready(self, name: str, *, registered: int | None = None) -> bool:
        """Whether this connector is working, judged by what it put in the registry.

        The old answer was "no error is recorded", which inverts the burden of
        proof: a transient spawn, discovery or OAuth failure wrote a string that
        nothing cleared, and a connector serving 122 tools reported "failed to
        start" beside them. Tools in the registry is a fact; an error from four
        minutes ago is a memory.

        So readiness is: tools are registered, fewer than
        `DEMOTE_AFTER_FAILURES` hard failures have happened in a row since they
        were, and either the session is still live or the registration is recent
        enough to still vouch for it. A connector that is genuinely gone loses
        its session *and* accumulates failures, so it demotes on the third pass.

        `registered` lets a caller looping every server pass a count it has
        already computed, rather than making this rescan the whole registry.
        """
        if registered is None:
            registered = self.registered_tool_count(name)
        if registered <= 0:
            return False
        if self.hard_failures.get(name, 0) >= DEMOTE_AFTER_FAILURES:
            return False
        connection = self.connections.get(name)
        if connection is not None and connection.connected:
            return True
        registered_at = self.ready_since.get(name)
        if registered_at is None:
            return False
        return time.monotonic() - registered_at < READY_COOLDOWN_SECONDS

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
            raise
        except Exception as exc:
            self.errors[config.name] = str(exc)
            self._hold_off(config.name)
            raise MCPConnectionError(f"'{config.name}' failed to connect: {exc}") from exc

        self.connections[config.name] = connection
        self._clear_failure(config.name)
        return self._register_tools(config, connection)

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
        for discovered in connection.tools[:MAX_TOOLS_PER_SERVER]:
            key = mcp_tool_key(discovered.name, config.name)
            if self.registry.get(key):
                continue
            self.registry.register(
                Tool(
                    name=key,
                    description=self._describe(config, discovered.description),
                    parameters=discovered.input_schema,
                    handler=self._make_handler(config.name, discovered.name),
                    # From the server's own `annotations`, falling back to what
                    # the name says -- see `backend/mcp/risk.py`. This was a flat
                    # `MEDIUM` until 2026-08-29, on the reasoning that AMETHYST
                    # cannot inspect somebody else's server. It can: MCP tools
                    # carry `readOnlyHint` and `destructiveHint`, and discovery
                    # was throwing the field away. The cost of not reading it
                    # was a confirmation prompt on every search and every list,
                    # which is how a permission gate stops being read.
                    risk=classify(discovered.name, discovered.annotations),
                    source=ToolSource.MCP,
                    server_name=config.name,
                )
            )
            registered += 1

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
            if connection is None:
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
                return ToolResult.error(guidance.sign_in_instruction(server_name))
            except TimeoutError:
                return ToolResult.error(f"'{tool_name}' on '{server_name}' timed out.")
            except Exception as exc:
                if not _is_transport_failure(exc):
                    connection.breaker.record_failure()
                    return ToolResult.error(f"[{server_name}] {tool_name} failed: {exc}")

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
                    return ToolResult.error(
                        guidance.dropped_instruction(server_name, str(retry_exc))
                    )
                connection = revived
            connection.breaker.record_success()
            return normalize_result(raw)

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
        """What is actually running, per server.

        An interface that reports the capability row alone is reporting an
        intention: the row says "on" whether the process started, died, or was
        never asked to start. This is the fact to render instead.

        The tool count comes from the registry rather than from the connection,
        and a recorded error is withheld while the server is ready. Both are the
        same correction: the question a reader is asking is "can the agent use
        this right now", and the registry answers it directly while an error
        string only says something went wrong at some point. The string is still
        in `self.errors` for the log and for `is_ready`'s own demotion count --
        it is suppressed from the *report*, not forgotten.
        """
        counts = self._tool_counts()
        out: dict[str, dict[str, Any]] = {}
        for name in set(load_servers()) | set(self.connections) | set(self.errors):
            connection = self.connections.get(name)
            connected = bool(connection and connection.connected)
            registered = counts.get(name, 0)
            ready = self.is_ready(name, registered=registered)
            out[name] = {
                # Ready means the agent can call its tools, which is what every
                # reader of this field actually wants to know.
                "connected": connected or ready,
                # The registry, with no fallback to `connection.tools`. A
                # session that answered `initialize` but registered nothing is
                # a connector the agent cannot call, and reporting its discovery
                # list would be the same lie in the other direction.
                "tools": registered,
                "error": None if ready else self.errors.get(name),
                "ready": ready,
                # Tools this server exposed past the per-server cap; 0 normally.
                "truncated": self.truncated.get(name, 0),
                # Seconds until the next reconnect attempt, when backing off. The
                # UI turns this into "reconnecting in Ns" instead of a bare
                # "failed" that looks stuck.
                "retry_in": self._retry_in(name, ready),
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

        for name, config in configured.items():
            connection = self.connections.get(name)
            connected = bool(connection and connection.connected)

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
            connection = self.connections.get(name)
            registered = counts.get(name, 0)
            ready = self.is_ready(name, registered=registered)
            out.append(
                {
                    "name": name,
                    "transport": str(config.transport),
                    "enabled": config.enabled,
                    "connected": bool(connection and connection.connected) or ready,
                    "tools": registered,
                    "oauth": config.oauth,
                    "source": str(config.source),
                    # Withheld while ready, exactly as in `state()` -- the CLI
                    # and the interface must not reach different conclusions
                    # from the same manager.
                    "error": None if ready else self.errors.get(name),
                    "ready": ready,
                    "truncated": self.truncated.get(name, 0),
                    "retry_in": self._retry_in(name, ready),
                }
            )
        return out
