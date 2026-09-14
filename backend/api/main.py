"""FastAPI surface for the React frontend.

The interface layer knows nothing below it except this contract: conversations,
a streaming turn endpoint, pending confirmations, and the audit log.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import shutil
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, ValidationError

from backend import jobs
from backend.agent.director import Director, close_open_tool_calls
from backend.automation import (
    JOB_KIND as AUTOMATION_JOB_KIND,
)
from backend.automation import (
    RUN_TIMEOUT_SECONDS,
    AutomationError,
    AutomationRepository,
    AutomationRunner,
)
from backend.automation import (
    run_job as run_automation_job,
)
from backend.browser.runner import BrowserRunner
from backend.config import configured_providers, load_tiers, paths
from backend.db.connection import get_connection
from backend.db.repositories import (
    AgentRunRepository,
    ConversationRepository,
    ExecutionLogRepository,
    MessageRepository,
)
from backend.instagram.runner import InstagramRunner
from backend.journal.runner import JournalRunner
from backend.mcp import live
from backend.mcp.manager import STARTUP_DEADLINE_SECONDS, MCPManager
from backend.reminders import ReminderRunner
from backend.runtime import availability
from backend.runtime.http import close_clients
from backend.runtime.providers import openai_compat
from backend.runtime.registry import is_known_provider
from backend.runtime.router import AUTO, auto_routable, is_core
from backend.security.confirmation import ConfirmationRequest, ConfirmationService
from backend.skills.loader import scan
from backend.tools.registry import build_default_registry
from backend.workers import batch as worker_batch

# The frontend is served from Vite's dev server on another port, so every
# browser request is cross-origin. Override for a different port or a built
# bundle with AMETHYST_CORS_ORIGINS as a comma-separated list. No wildcard: AMETHYST
# binds to localhost for one user, and a wildcard would let any page that user
# visits drive their machine through this API.
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

log = logging.getLogger(__name__)


def _cors_origins() -> list[str]:
    configured = os.environ.get("AMETHYST_CORS_ORIGINS", "").strip()
    if not configured:
        return DEV_ORIGINS
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


# One manager for the process, so stdio servers are spawned once rather than
# per request. The CLI already held connections for a session; the API did not,
# which meant MCP tools never reached the agent through the HTTP path at all.
_mcp: dict[str, Any] = {"manager": None, "registry": None, "workspace": None, "errors": {}}

# Rebuilding the registry tears down the live MCP manager. Two turns starting at
# once would each build one, orphaning a set of stdio subprocesses -- or worse,
# shut down the manager the other turn was mid-tool-call against.
_registry_lock = asyncio.Lock()

# Sign-ins running in the background, keyed by server. A flow outlives the
# request that started it, so the task has to be held somewhere -- both to keep
# it from being garbage collected and to refuse a second sign-in to a server
# already in the middle of one.
_login_tasks: dict[str, asyncio.Task] = {}

# Big enough for a document or a screenshot, small enough that a stray upload
# cannot fill the disk.
MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024

# Iterations an unattended run may take. Higher than the interactive default
# because a multi-step browser task spends one per tool call and nobody is
# there to tell it to continue; still bounded, and `RUN_TIMEOUT_SECONDS` and
# `Guards.max_seconds` remain the real stops. Twenty rather than thirty, to sit
# under the tightened 180s run timeout: thirty iterations that cannot finish
# inside the timeout is a budget that only ever ends in a cancellation.
AUTOMATION_MAX_ITERATIONS = 20


async def _unattended_director(callback):
    """A director whose tools refuse anything a person has not pre-approved.

    Shares the live registry, so a scheduled turn reaches the same connected
    MCP tools an interactive one does -- but through its own gate, so swapping
    the callback here cannot change the rules for a turn someone is watching.
    """
    from backend.agent.director import Guards
    from backend.security.confirmation import ConfirmationService

    registry, root = await _registry_for(None, reuse_any=True)
    gated = registry.with_confirmation(ConfirmationService(callback=callback))
    return Director(
        gated,
        workspace_root=root,
        # Nobody is watching, but streaming is not only for watching: a
        # non-streamed call is one 120s request that retries the *whole*
        # response up to four times, so a slow model turns into eight minutes of
        # the same answer being re-requested. Retries on a stream stop once
        # tokens are flowing.
        stream=True,
        # A browser task is fifteen or more steps, and each one costs an
        # iteration: a measured run reached "go to google, search, click, search,
        # play" and died at twelve with `iteration limit reached`, having done
        # most of the work. The interactive default stays where it is; unattended
        # work is exactly where nobody is there to say "carry on".
        guards=Guards(max_iterations=AUTOMATION_MAX_ITERATIONS),
    )


_runner = AutomationRunner(lambda callback: _LazyDirector(callback))

# The lane that actually runs automations, and the handler that tells it how.
#
# Separate from the runner above on purpose: that one decides what is *due*,
# which is a schedule question and takes milliseconds; this one runs a turn,
# which takes minutes. They were one thing, and a crash during the minutes took
# the whole run with no record that it had started.
#
# `auto_retry_after_crash=False` because the model chooses the tool calls. A
# handler that wraps every outward call in a step can promise a replay is a
# no-op; one that hands the choice to a model cannot, so a run whose process
# died is checked against `execution_logs` before anything repeats it. See
# `backend.jobs.replayable_after_crash`.
jobs.register(
    jobs.Handler(
        kind=AUTOMATION_JOB_KIND,
        run=lambda job, store: run_automation_job(
            job, store, director_for=lambda callback: _LazyDirector(callback)
        ),
        # Minutes, not seconds. An automation's inputs change slowly, and its
        # own geometric backoff already governs how often the *schedule* is
        # tried again -- this is only for a provider having a bad minute.
        backoff_base=60.0,
        backoff_cap=1800.0,
        max_attempts=2,
        # Longer than any single turn is allowed to take, so a run that is
        # merely slow is never mistaken for one whose process died.
        lease_seconds=RUN_TIMEOUT_SECONDS + 60.0,
        auto_retry_after_crash=False,
    )
)
_automation_lane = jobs.JobRunner([AUTOMATION_JOB_KIND], name="automations")
_runner.lane = _automation_lane

# Fan-out batches (`backend/workers/batch.py`). Its own lane, and that is the
# point: a batch is enqueued *by* an automation turn as often as by a person, and
# putting both on one lane would deadlock -- the automation holding the lane
# while it waits for a batch that cannot be claimed until the automation lets go.
#
# `auto_retry_after_crash=True` is honest here where it is not for an automation:
# every node's outcome is written to the step ledger the moment it settles and
# every dispatch to GitHub goes through `JobStore.step`, so a reclaimed batch
# re-runs only what had not finished and never sends a second workflow_dispatch.
jobs.register(
    jobs.Handler(
        kind=worker_batch.KIND,
        run=worker_batch.run,
        backoff_base=30.0,
        backoff_cap=600.0,
        # One. The graph does its own per-node retries against its own lanes, and
        # replaying a whole batch from the top would re-do settled nodes' work.
        max_attempts=1,
        # Longer than the longest batch may run, so a slow fan-out is never
        # mistaken for one whose process died. The handler renews this on every
        # heartbeat anyway; this is the ceiling if it stops heartbeating.
        lease_seconds=worker_batch.DEFAULT_BATCH_TIMEOUT + 120.0,
    )
)
_worker_lane = jobs.JobRunner([worker_batch.KIND], name="workers")
worker_batch.lane = _worker_lane


async def _live_manager():
    """The running MCP manager, building one if no turn has needed it yet.

    Only for work the user has just asked for, and only off the request path:
    building the registry starts every switched-on connector serially, which on
    a machine with a dozen of them is minutes, not seconds.
    """
    if _mcp["manager"] is None:
        await _registry_for(None)
    return _mcp["manager"]


async def _connect_into_live_registry(name: str) -> None:
    """Bring a just-signed-in connector into the registry turns run against.

    Signing in stores a token; it does not make the connector reachable.
    Without this the interface goes on listing a connector it has a valid
    account for under "added, not running", which is what made a successful
    sign-in look like a failed one.
    """
    from backend.mcp.config import load_servers

    config = load_servers().get(name)
    if config is None:
        return
    manager = await _live_manager()
    async with _registry_lock:
        manager.forget_error(name)
        try:
            # A sign-in that just landed means "rebuild it with this account",
            # which is exactly what the idempotent path must not do by itself.
            await manager.connect_server(config, force=True)
            _mcp["errors"].pop(name, None)
        except Exception as exc:
            # The account is good even if the connection is not; say so rather
            # than reporting the sign-in itself as failed.
            log.warning("signed in to %s but could not connect it: %s", name, exc)
            _mcp["errors"][name] = str(exc)


async def _started_manager():
    """The manager if connectors are already running, otherwise None.

    The counterpart to `_live_manager`, for background work and for anything
    answering a request. A sync is not worth starting twelve subprocesses for:
    if nothing has reconciled yet there is nothing signed in to sync from, and
    saying so at once beats a request that hangs for minutes and then reports
    that the connector is not running anyway.
    """
    return _mcp["manager"]


async def _manager_with(name: str):
    """The manager, with one named connector started if it was not already.

    Between "start nothing" and "start everything" there is the thing the caller
    actually needs. Syncing tasks used to take the first branch and answer 409
    until some unrelated turn had happened to reconcile -- so a freshly started
    AMETHYST showed an empty Tasks page and "not running", with no way to fix it
    from that page. Taking the second branch instead would spawn a dozen
    subprocesses, and on this machine five of them contend for one port.

    One connector, on demand. Still non-interactive: if it has never been signed
    in to, that is a sentence to show the user, not a browser to open behind
    their back.
    """
    manager = _mcp["manager"]
    if manager is None:
        await _registry_for(None, reuse_any=True, start_connectors=False)
        manager = _mcp["manager"]
    if manager is None:
        return None

    connection = manager.connections.get(name)
    if connection is not None and connection.connected:
        return manager

    from backend.mcp.config import load_servers

    config = load_servers().get(name)
    if config is None:
        return manager
    # Deliberately outside `_registry_lock`. That lock exists to stop two
    # callers *rebuilding the registry* at once; starting one named server is
    # already serialised by the manager's own per-server lock, which is what it
    # was added for. Holding the global one here made the reminder loop -- which
    # asks for the To Do connector on every tick -- take the lock a turn needs,
    # on a timer, for as long as that connector took to answer.
    #
    # Bounded as well, and not cancelled at the deadline: it lands when it
    # lands, and `_mcp["errors"]` is resynced by the next reconcile.
    await manager.start_one(config, deadline=STARTUP_DEADLINE_SECONDS)
    if name in manager.errors:
        _mcp["errors"][name] = manager.errors[name]
    return manager


async def _task_sync_manager():
    """What the background sync asks for: the To Do connector, started if need be.

    The loop used to take whatever had already reconciled, which on a freshly
    started AMETHYST is nothing -- so the fifteen-minute sync did nothing at all
    until some unrelated turn happened to start connectors, and the Tasks page
    sat empty in the meantime.
    """
    from backend.sync.microsoft_todo import SERVER

    return await _manager_with(SERVER)


_reminders = ReminderRunner(_task_sync_manager)

# The journal's clock. A third runner rather than a job on either of the others:
# a briefing is a wall-clock time (automations are intervals that drift), and it
# makes a model call that can take a minute (a reminder queued behind one is not
# a reminder). See backend/journal/runner.py.
_journal = JournalRunner()

# The Instagram drain. A fourth runner for the reason each of the others is
# separate: its work is minutes long, and a reminder queued behind a video
# download is not a reminder.
_instagram = InstagramRunner()

# The bookmark watcher. A fifth, and the cheapest: it copies a SQLite file every
# few minutes and usually finds nothing new. Separate anyway, because capturing
# a bookmark fetches a page and summarises it, and that is minutes of work the
# other loops should not be waiting behind.
_browser = BrowserRunner()


@asynccontextmanager
async def _lifespan(_: FastAPI):
    global _control_loop
    _control_loop = asyncio.get_running_loop()
    paths().ensure()
    get_connection()
    # Shipped skills, brought up to date on every boot rather than only by
    # `amethyst init`. Init runs once in a lifetime, so before this a fix to a
    # builtin skill reached new installs and nobody else -- the agent went on
    # reading whatever was copied into `~/.amethyst/skills` the first time the
    # application ever started. Edited copies are never touched; see the loader.
    from backend.skills.loader import seed_builtin_skills

    updated = seed_builtin_skills()
    if updated:
        log.info("built-in skills updated: %s", ", ".join(updated))
    # First, and deliberately before any runner starts: features that switch
    # themselves on when their inputs already exist (backend/runtime/autostart).
    # Running it first means the bookmark watcher starts its first tick already
    # enabled rather than idling one poll behind. It says what it changed in the
    # log, once, and never asks -- see that module for what it will not touch.
    from backend.runtime.autostart import auto_setup

    for note in auto_setup():
        log.info("auto-setup: %s", note)
    # Turns the last process did not finish.
    #
    # One uvicorn worker is a non-negotiable (see CLAUDE.md), so a run still in a
    # live phase at boot cannot be one somebody else is driving: its process is
    # gone. Left alone it reads as permanently in flight -- the "Thinking
    # forever" a dropped stream used to show -- and its conversation may also be
    # holding a tool call nothing answered, because a killed process skips the
    # `finally` in `Director.run` that repairs that.
    #
    # Before the runners, so an automation's first tick cannot be attributed to a
    # run the sweep was about to close.
    try:
        interrupted = AgentRunRepository().interrupt_live()
    except Exception as exc:
        log.warning("could not recover the last session's turns: %s", exc)
        interrupted = []
    for conversation_id in interrupted:
        closed = close_open_tool_calls(conversation_id)
        log.info(
            "recovered an interrupted turn in %s (%d unanswered tool call(s) closed)",
            conversation_id,
            closed,
        )
    # And the background work the last process was part-way through. A job left
    # holding a lease goes back on the board with its step ledger intact, so
    # whatever it had already finished is not done twice -- and a job whose last
    # attempt ran something that may have changed state waits for a person
    # rather than repeating it. See `backend.jobs.replayable_after_crash`.
    try:
        store = jobs.JobStore()
        recovered = store.recover_orphans(note="AMETHYST restarted while this was running")
    except Exception as exc:
        log.warning("could not recover the last session's jobs: %s", exc)
        recovered = []
    for job in recovered:
        # Per job, not around the loop. One job the guard cannot answer for must
        # not stop the others being recovered -- which is exactly what a single
        # try/except here did the first time this ran against a real database.
        try:
            safe, why = jobs.replayable_after_crash(job, store)
            if not safe and job.state == "queued":
                store.block(job, why)
            log.info("recovered %s job %s (%s)", job.kind, job.id, job.state)
        except Exception as exc:
            log.warning("could not settle recovered job %s: %s", job.id, exc)
    with contextlib.suppress(Exception):
        jobs.JobStore().prune()
    # Automations run while this process is up, and only while it is up. A
    # separate daemon would keep them running with nothing able to answer a
    # permission prompt, which is a worse promise than "they run while AMETHYST is
    # open" -- a rule that fits in a sentence and is true.
    _runner.start()
    # The lane the runner above puts work into. Started after it, so a tick that
    # fires in the same millisecond finds somewhere to put a job.
    _automation_lane.start()
    # The fan-out lane. Separate from the one above so a batch a scheduled turn
    # asked for cannot queue behind the turn that is waiting for it.
    _worker_lane.start()
    # Reminders take the same rule, for the same reason. Deliberately a second
    # runner rather than another job on the first: the automation loop
    # serializes model turns that can take five minutes, and a reminder queued
    # behind one of those is not a reminder.
    _reminders.start()
    # Third and last: files the morning briefing and the evening review at the
    # hours the user set. Sleeps before its first check, so starting the process
    # never files an entry in the same breath.
    _journal.start()
    # Fourth, and stopped first: it holds the longest-running work.
    _instagram.start()
    # Fifth. A no-op on every tick until someone switches the browser on.
    _browser.start()
    # Sixth, and first to be stopped after the browser: connectors.

    # Switched-on connectors start at boot rather than on the first turn.
    # The manager used to be built lazily by the first chat request, so on a
    # fresh `amethyst serve` every connector sat dark -- "starting", "not
    # running" -- until somebody opened a conversation or pressed Connect,
    # and the Connectors page showed nothing working for the whole first
    # session. Starting here means the page tells the truth from the first
    # render, and `reconciled_once` (which the lifecycle reads) flips when
    # this pass completes rather than when a manager object merely exists.
    #
    # Background, not awaited: stdio servers take seconds each, and the
    # app should answer /api/ping while they come up. The unconnected
    # rows read `starting` in the meantime, which is exactly what that
    # state exists to say.
    async def _start_connectors() -> None:
        began = time.monotonic()
        try:
            await _registry_for(None, reconcile_deadline=BOOT_STARTUP_SECONDS)
            log.info("connectors started in %.1fs", time.monotonic() - began)
        except Exception:
            log.exception("the boot-time connector start failed")

    _boot_connectors = asyncio.create_task(_start_connectors())
    yield
    # First: these are the only responses that would otherwise still be open when
    # the grace period expires.
    close_control_streams()
    await _browser.stop()
    await _instagram.stop()
    await _journal.stop()
    await _reminders.stop()
    await _runner.stop()
    # After the scheduler that feeds it, so nothing is enqueued into a lane that
    # has already stopped. A job in flight is cancelled and put back with its
    # ledger intact, which is the difference between a shutdown and a loss.
    await _automation_lane.stop()
    await _worker_lane.stop()
    with contextlib.suppress(asyncio.CancelledError):
        _boot_connectors.cancel()
        await _boot_connectors
    if _mcp["manager"] is not None:
        await _mcp["manager"].shutdown()
    await close_clients()


app = FastAPI(title="AMETHYST", version="0.1.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Confirmations awaiting a decision from the interface, keyed by request id.
_pending: dict[str, dict[str, Any]] = {}

# The frames after which a turn is over as far as anything outside the loop is
# concerned. `done` is followed by the memory frame, which is a second model
# call and not part of the turn.
TERMINAL_EVENTS = frozenset({"done", "error", "guard"})

#: A turn faster than this is one the user sat and watched. Telling somebody what
#: they just saw happen is noise, and notifications that are noise get switched
#: off -- along with the ones that were worth having.
#:
#: ponytail: a plain duration, no focus tracking. Gate it on whether a window is
#: actually in front if this ever fires while somebody is watching it.
NOTIFY_AFTER_SECONDS = 20.0


async def _say_the_agent_is_done(conversation_id: str, event: Any, elapsed: float) -> None:
    """Tell the desktop a long turn has finished.

    The point of a daemon is that work outlives the window it was started from:
    a question asked from the palette and then walked away from has nowhere to
    land, and this is where it lands. Never raises -- a machine with no notifier
    is a normal one, and a turn that finished is finished either way.
    """
    if elapsed < NOTIFY_AFTER_SECONDS:
        return
    from backend import notify as desktop

    try:
        row = ConversationRepository().get(conversation_id)
        title = (row["title"] if row and row["title"] else None) or "AMETHYST"
        if event.type == "error":
            body = str(event.data.get("message") or "the turn did not finish")
        else:
            body = "Done — your answer is ready."
        await desktop.notify(title, body)
    except Exception:
        log.debug("could not notify that the turn finished", exc_info=True)


# How often the stream emits a keepalive while the turn is producing nothing.
# A long tool call -- a bash command, a slow model -- puts no bytes on the SSE
# stream between its `tool_call` and `tool_result` frames, and a silent stream
# is one a proxy drops and the interface's watchdog gives up on. A frame every
# few seconds keeps the socket demonstrably alive without inventing progress.
HEARTBEAT_SECONDS = 10.0

# How long the head of a turn waits for connectors to come up before answering
# on the ones that are ready. Their own ceilings (180s to answer, 300s waiting
# on a sign-in) are the right ceilings for a connector and the wrong ones for
# somebody who has just pressed Enter -- see `MCPManager._settle`. Anything
# slower keeps starting in the background and is there for the next turn.
TURN_STARTUP_SECONDS = 8.0

# The same ceiling for the boot-time connector start. It holds the registry
# lock while it runs, and a turn that arrives during it queues behind that
# lock -- so an unbounded boot pass made the *first* message of a session wait
# out the slowest connector's 180s (or 300s) ceiling even though the turn's own
# reconcile was bounded. Slower servers keep coming up in the background.
BOOT_STARTUP_SECONDS = 10.0

_HEARTBEAT = object()


async def _with_heartbeats(events, interval: float = HEARTBEAT_SECONDS):
    """Yield the turn's events, plus a `_HEARTBEAT` sentinel through any gap.

    The turn's own generator can legitimately go quiet for a minute or two
    while a tool runs; this races each `__anext__` against a timer and emits a
    keepalive when the wait wins, so the stream never actually falls silent.
    """
    iterator = events.__aiter__()
    pending = asyncio.ensure_future(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield _HEARTBEAT
                continue
            try:
                item = pending.result()
            except StopAsyncIteration:
                return
            yield item
            pending = asyncio.ensure_future(iterator.__anext__())
    finally:
        # A client that hung up, or a turn that ended: stop the in-flight pull
        # rather than leaving it to a garbage collector. The director handles
        # the cancellation as its own stop.
        pending.cancel()
        with contextlib.suppress(asyncio.CancelledError, StopAsyncIteration, Exception):
            await pending


def _frame(event_type: str, **data: Any) -> str:
    """One SSE frame. `default=str` so an odd value degrades rather than
    killing the response mid-stream."""
    return f"data: {json.dumps({'type': event_type, **data}, default=str)}\n\n"

# Turns currently streaming, keyed by conversation. The event is how "stop" gets
# from a second request into the loop: aborting the browser's read only closes
# the response, and the turn behind it would keep calling models and tools.
_active_turns: dict[str, asyncio.Event] = {}


class PendingConfirmation(BaseModel):
    id: str
    tool_name: str
    # operation[:subtype], the key "don't ask again" is stored under. Carried
    # here because the bare tool name is the wrong key: remembering
    # run_shell_command would silently approve destructive use after the user
    # approved a read-only command. See security.md.
    operation_key: str
    risk: str
    reason: str
    arguments: dict[str, Any]
    # Pending prompts are process-wide. An interface recovering one after a
    # reload has to know whether the suspended turn is the conversation on
    # screen or a different one, or it raises another conversation's prompt
    # over the transcript the user is reading.
    conversation_id: str | None = None


async def _await_confirmation(request: ConfirmationRequest) -> bool:
    """Suspend the loop until the interface answers, or time out generously.

    The long timeout is deliberate: a scheduled or unattended run should still be
    approvable when the user next opens AMETHYST.
    """
    # The request carries its own id, already announced to the interface as a
    # confirmation_required event. Minting a second one here would leave the UI
    # holding an id the decision endpoint has never heard of.
    request_id = request.id
    loop = asyncio.get_running_loop()
    future: asyncio.Future[bool] = loop.create_future()
    _pending[request_id] = {
        "future": future,
        "loop": loop,
        "payload": PendingConfirmation(
            id=request_id,
            tool_name=request.tool_name,
            operation_key=request.operation_key,
            risk=request.risk.value,
            reason=request.reason,
            arguments=request.arguments,
            conversation_id=request.conversation_id,
        ),
    }
    try:
        return await asyncio.wait_for(future, timeout=60 * 60 * 6)
    except TimeoutError:
        return False
    finally:
        _pending.pop(request_id, None)


async def _registry_for(
    workspace: str | None,
    *,
    reuse_any: bool = False,
    start_connectors: bool = True,
    reconcile_deadline: float | None = None,
):
    """The tool registry for a workspace, building or rebuilding it if needed.

    `reuse_any` takes whatever registry is already built, whatever root it was
    built for. An unattended run has no workspace of its own, so it resolved to
    `cwd()` -- which is rarely the root the interface is using. The two then
    alternated, and every automation tick tore down and serially respawned every
    MCP subprocess, killing the live browser with them, twice each interval.
    A scheduled turn wants the tools that are already running, not a workspace
    of its own.

    `reconcile_deadline` bounds *the caller's* wait, including the wait for the
    lock itself.

    Bounding only the reconcile was not enough. The lock serialises every
    caller, and the ones that are not on a request path -- the boot pass, the
    browser loop, a connector being brought into the live registry -- pass no
    deadline because waiting is fine for them. A turn arriving behind one of
    those queued on the lock with nothing bounding it, which is the shape of
    the bug this exists to stop: the browser held an open request, no bytes in
    it, until the fetch failed. A caller that has a user waiting answers on the
    tools that are already up instead, and the connectors still coming up land
    in the registry for the next turn.
    """
    root = str(Path(workspace).expanduser().resolve()) if workspace else str(Path.cwd())

    if reconcile_deadline is None:
        async with _registry_lock:
            return await _registry_locked(root, reuse_any, start_connectors, None)

    try:
        await asyncio.wait_for(_registry_lock.acquire(), reconcile_deadline)
    except TimeoutError:
        if _mcp["registry"] is not None:
            log.info("registry busy; answering on the connectors already up")
            return _mcp["registry"], _mcp["workspace"]
        # Nothing has been built yet and somebody else is building it. The
        # builtins alone are 30 tools and cost a tenth of a second, which is a
        # far better answer than a turn that never starts. Deliberately not
        # stored in `_mcp`: the pass holding the lock owns that.
        log.info("registry busy and none built yet; answering on builtins alone")
        return build_default_registry(
            ConfirmationService(callback=_await_confirmation), workspace_root=root
        ), root
    try:
        return await _registry_locked(root, reuse_any, start_connectors, reconcile_deadline)
    finally:
        _registry_lock.release()


async def _registry_locked(
    root: str,
    reuse_any: bool,
    start_connectors: bool,
    reconcile_deadline: float | None,
):
    """`_registry_for`'s body, with the registry lock already held."""
    if not start_connectors:
        if _mcp["registry"] is not None:
            # Somebody has already built one, and this caller said to start
            # nothing. Falling through to the reconcile below started every
            # switched-on connector -- which is precisely what
            # `start_connectors=False` exists to prevent -- and held the API's
            # registry lock for as long as that took. The reminder loop asks
            # for the To Do connector on every tick through this path, so that
            # was a lock a turn could not have, on a timer, for the life of the
            # process. Hand back what is already built.
            return _mcp["registry"], (_mcp["workspace"] if reuse_any else root)

        # Build the registry and the manager, and start nothing. The caller
        # wants one named connector, not twelve subprocesses -- and on this
        # machine five of those contend for a single port, so "start
        # everything" is not a cheap default to fall back on.
        registry = build_default_registry(
            ConfirmationService(callback=_await_confirmation), workspace_root=root
        )
        manager = MCPManager(registry, open_browser=False)
        _mcp.update(
            {"manager": manager, "registry": registry, "workspace": root, "errors": {}}
        )
        live.set_manager(manager)
        return registry, root

    if reuse_any and _mcp["registry"] is not None:
        root = _mcp["workspace"]

    # A different workspace root needs different *builtin* tools, and
    # nothing else. Connectors are processes holding sessions; which folder
    # the file tools are sandboxed to is not their business. This used to
    # rebuild both, so every alternation between a turn's workspace and the
    # `None` every other caller passes tore down every connector and
    # respawned it -- which is what put "Connection closed" behind three
    # tool calls in a row, for three different servers at once.
    if _mcp["registry"] is not None and _mcp["workspace"] != root:
        log.info("workspace changed to %s; rebuilding builtins, keeping connectors", root)
        registry = build_default_registry(
            ConfirmationService(callback=_await_confirmation), workspace_root=root
        )
        _mcp["manager"].rebind(registry)
        _mcp.update({"registry": registry, "workspace": root})

    if _mcp["registry"] is not None and _mcp["workspace"] == root:
        # Pick up connectors switched on or off since the registry was
        # built. Without this the toggle only took effect on restart, so a
        # connector the user turned on in the interface stayed unusable.
        for name, outcome in (
            await _mcp["manager"].reconcile(deadline=reconcile_deadline)
        ).items():
            # A connector whose tools are in the registry is working, whatever
            # this pass reported. Recording the failure anyway is what put a
            # permanently degraded banner over connectors the agent was
            # calling successfully -- see `MCPManager.is_ready`.
            if isinstance(outcome, int) or _mcp["manager"].is_ready(name):
                _mcp["errors"].pop(name, None)
            else:
                _mcp["errors"][name] = str(outcome)
        # A server that is no longer configured cannot be degraded.
        for name in [n for n in _mcp["errors"] if n not in _mcp["manager"].state()]:
            del _mcp["errors"][name]
        return _mcp["registry"], root

    if _mcp["manager"] is not None:
        await _mcp["manager"].shutdown()

    registry = build_default_registry(
        ConfirmationService(callback=_await_confirmation), workspace_root=root
    )
    manager = MCPManager(registry, open_browser=False)
    errors: dict[str, str] = {}
    try:
        # connect_all reports per-server outcomes rather than raising: an int
        # tool count on success, a message on failure. Keep the failures so
        # /api/health can say which connector is down instead of the
        # interface seeing a shorter tool list for no stated reason.
        for name, outcome in (
            await manager.connect_all(deadline=reconcile_deadline)
        ).items():
            if not isinstance(outcome, int) and not manager.is_ready(name):
                errors[name] = str(outcome)
    except Exception as exc:  # a broken server must not take the API down
        errors["*"] = f"{type(exc).__name__}: {exc}"

    _mcp.update(
        {"manager": manager, "registry": registry, "workspace": root, "errors": errors}
    )
    # Published so anything that is not the API can reach a connected server
    # -- the task tools write to Microsoft To Do through this rather than
    # spawning a second copy of it with a second sign-in.
    live.set_manager(manager)
    return registry, root


class _LazyDirector:
    """Bridge for the runner, which is synchronous about how it gets a director.

    `AutomationRunner` calls `director_for(callback)` and expects something with
    `.run(...)` straight away; building a real one needs the registry, which is
    awaited. This defers that to the first frame.
    """

    def __init__(self, callback):
        self.callback = callback

    async def run(self, conversation_id: str, message: str):
        director = await _unattended_director(self.callback)
        async for event in director.run(conversation_id, message):
            yield event


async def _director(
    workspace: str | None = None,
    mode: str = "chat",
    *,
    reconcile_deadline: float | None = None,
) -> Director:
    from backend.agent.director import Guards
    from backend.config import load_max_iterations

    registry, root = await _registry_for(workspace, reconcile_deadline=reconcile_deadline)
    # The loop ceiling is a user setting now (Settings -> General), read per
    # turn so a change lands on the next message. Everything else in Guards
    # keeps its default -- the wall-clock and tool-call stops are not the ones
    # people hit, the iteration count is.
    guards = Guards(max_iterations=load_max_iterations())
    return Director(registry, workspace_root=root, stream=True, mode=mode, guards=guards)


@app.get("/api/ping")
def ping() -> dict[str, Any]:
    """Alive, and nothing else.

    The interface fires this before React has mounted, because a container that
    has been stopped for want of traffic takes tens of seconds to come back and
    the request that wakes it is the one that waits. `/api/health` is the wrong
    thing to make that request: it surveys every provider over the network, so
    a cold start would wait for a boot *and* a round of probes. This touches
    nothing.
    """
    return {"status": "ok", "version": app.version}


# ------------------------------------------------------------------ control
# Interfaces listening for a nudge from the daemon. One queue per open window.
#
# The tray process (backend/desktop.py) pushes here when the global hotkey
# fires, which is how a keystroke pressed while the browser is not even focused
# opens the palette in a window that already exists. It is deliberately one-way
# and one command: the interface owns the palette, so the daemon cannot open it
# -- it can only say that it should be open.
#
# No subscribers means no window is open. The POST reports that rather than
# silently succeeding, and the tray opens a window itself instead.
_control_subscribers: set[asyncio.Queue[Any]] = set()

#: Put on a queue to end its stream. A control response never finishes on its own
#: -- that is what it is for -- so a shutdown would otherwise wait on every open
#: one until its grace period ran out and then cancel it mid-flight, which logs a
#: traceback and tears down whatever was reading it in the middle of a request.
_CONTROL_CLOSE = object()

#: The loop the queues belong to, so the tray can close them from the thread that
#: handled the signal. Set when the application starts.
_control_loop: asyncio.AbstractEventLoop | None = None

# Listeners inside this process rather than on the other end of a stream: the
# tray's own native window, which has an OS window to raise as well as a palette
# to open. A browser tab can only be told; a window we own can be shown.
_control_listeners: list[Any] = []


def on_palette(callback: Any) -> None:
    """Run `callback` whenever a palette is asked for. Used by backend/desktop.py."""
    _control_listeners.append(callback)


def close_control_streams() -> None:
    """End every open control stream, so a shutdown has nothing to wait for.

    Safe to call from another thread -- the tray calls it from the one that took
    the signal -- because an asyncio queue may only be touched from its own loop.
    """

    def _close() -> None:
        for queue in list(_control_subscribers):
            queue.put_nowait(_CONTROL_CLOSE)

    loop = _control_loop
    if loop is not None and not loop.is_closed():
        loop.call_soon_threadsafe(_close)
    else:
        _close()

#: Long enough to cost nothing, short enough that a proxy or a sleeping laptop
#: does not mistake an idle stream for a dead one.
_CONTROL_KEEPALIVE_SECONDS = 25.0


@app.get("/api/control/stream")
async def control_stream() -> StreamingResponse:
    """Commands from the daemon to whichever interface is open."""
    queue: asyncio.Queue[str] = asyncio.Queue()
    _control_subscribers.add(queue)

    async def stream():
        try:
            # Says the channel is live, so the interface can tell "connected and
            # quiet" from "never connected" without waiting for a first command.
            yield _frame("ready")
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), _CONTROL_KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield ": keepalive\n\n"  # an SSE comment; EventSource ignores it
                    continue
                if frame is _CONTROL_CLOSE:
                    return  # the server is going down; end the response politely
                yield frame
        finally:
            _control_subscribers.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/control/palette")
def open_palette() -> dict[str, Any]:
    """Ask every open interface to show the command palette.

    `delivered` is how the caller knows whether anything heard it: zero means
    nothing is open, and the tray answers that by opening a window at
    `/?cmd=palette` instead.
    """
    frame = _frame("palette")
    for queue in list(_control_subscribers):
        queue.put_nowait(frame)
    for callback in list(_control_listeners):
        try:
            callback()
        except Exception:
            # A window that cannot be raised is not a reason to fail the request:
            # the palette still went to every stream that was listening.
            log.exception("a control listener failed")
    return {"delivered": len(_control_subscribers) + len(_control_listeners)}


# A registry built only to count tools for /api/health and /api/tools before
# the first turn has built the real one. Constructing the full builtin tool set
# on every poll was seconds of throwaway work per request on the event loop;
# the real registry replaces it on the first turn, and this one is never
# rebuilt until then.
_THROWAWAY_REGISTRY: dict[str, Any] = {"registry": None}


def _listing_registry() -> Any:
    from backend.tools.registry import build_default_registry

    if _mcp["registry"] is not None:
        return _mcp["registry"]
    if _THROWAWAY_REGISTRY["registry"] is None:
        _THROWAWAY_REGISTRY["registry"] = build_default_registry()
    return _THROWAWAY_REGISTRY["registry"]


@app.get("/api/health")
async def health() -> dict[str, Any]:
    """Component health, reported from the live registry where one exists.

    Building a throwaway registry here counted builtins only, so the number
    never included MCP tools and never moved when a connector failed -- the one
    thing a health check on this system is for.
    """
    registry = _listing_registry()
    skills, errors = scan()
    connector_errors = dict(_mcp["errors"])
    # Only providers that could answer. An entry with no key parses fine and
    # then fails on the first round trip, and a model picker offering one turns
    # a missing credential into "AMETHYST is broken".
    providers = configured_providers()
    # Having a key is not the same as being able to answer. A local endpoint
    # declares no key at all, so `has_key` calls it configured by definition and
    # the picker offered Ollama while nothing was listening on its port -- nine
    # consecutive `All connection attempts failed` in the real database. Probed
    # where the credential says nothing, remembered from real turns otherwise.
    reachable = await availability.survey(providers)
    unavailable = {
        name: state.reason for name, state in reachable.items() if not state.available
    }

    # A connector nobody has signed in to is not a fault. It used to count as
    # one, so a machine with one un-signed-in connector reported the whole
    # system degraded -- which makes the word mean nothing on the day something
    # is actually broken.
    waiting = {
        name: message
        for name, message in connector_errors.items()
        if "SignInRequired" in message or "signed in" in message
    }
    broken = {k: v for k, v in connector_errors.items() if k not in waiting}
    return {
        "status": "degraded" if broken else "ok",
        # Kept separate so an interface can say "sign in to Vercel" rather than
        # colouring it the same red as a server that will not start.
        "connectors_awaiting_sign_in": sorted(waiting),
        # In providers.yaml's own order, not alphabetical. The interface takes
        # the first entry as the house default for a new conversation, so
        # sorting made that an accident of spelling -- "groq" outranked
        # "nvidia" by the letter g, and the file's stated preference was never
        # consulted. The chain reads the same order for fallback
        # (`backend/runtime/chain.py`), so the two now agree.
        #
        # Providers the user has switched off are left out. They stay in
        # Settings, with their entry and their key -- that is the whole point
        # of the flag -- but a picker that offered one would be a setting that
        # took effect everywhere except where the user can see it.
        "providers": [name for name, config in providers.items() if config.enabled],
        # So the picker can offer routing without a second round trip. False on
        # a machine with nothing switched on, where "Auto" would be a button
        # that only ever produces an error.
        "routing": any(config.enabled for config in providers.values()),
        # The providers this install leans on, so the picker can group them
        # above the user's own rather than showing one flat list in which the
        # backbone and a half-tested endpoint look identical. A grouping, not a
        # restriction: everything in `providers` above is selectable.
        "provider_core": [
            name for name, config in providers.items() if config.enabled and is_core(config)
        ],
        # Configured, selectable by hand, and never chosen by Auto.
        "provider_no_auto": [
            name
            for name, config in providers.items()
            if config.enabled and not auto_routable(config)
        ],
        # Listed above and known not to answer. Kept as a separate key rather
        # than filtered out of `providers`: a provider the user configured on
        # purpose should stay visible with a reason, not vanish.
        "providers_unavailable": unavailable,
        # Which model does which job, so the interface can name one rather than
        # saying "a bigger one". Empty on a machine that has not tiered
        # anything, which is not a fault: every caller falls back to the
        # conversation's own model.
        "tiers": {
            name: {"provider": tier.provider, "model": tier.model}
            for name, tier in load_tiers().items()
        },
        # So an interface can prefill the model a provider already declares
        # rather than making the user retype what providers.yaml already says.
        "provider_defaults": {
            name: config.default_model
            for name, config in providers.items()
            if config.default_model and config.enabled
        },
        "tools": len(registry.list()),
        "mcp_tools": len([t for t in registry.list() if t.server_name]),
        # Whether connectors have been started at all in this process. Without
        # it "not running" and "nothing has asked it to run yet" are the same
        # string, and on a server that has not had a turn they all read as
        # broken when none of them is.
        "mcp_reconciled": _mcp["manager"] is not None,
        "connector_errors": connector_errors,
        "skills": len(skills),
        "skill_errors": len(errors),
    }


@app.get("/api/git-status")
async def git_status() -> dict[str, Any]:
    """Git status for the current workspace."""
    workspace = _mcp.get("workspace") or os.getcwd()
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "status", "--porcelain",
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            return {"error": stderr.decode(), "path": workspace, "clean": True, "files": []}
        
        lines = stdout.decode().strip().split("\n") if stdout.decode().strip() else []
        return {
            "path": workspace,
            "changed_files": len(lines),
            "files": lines[:50],
            "clean": len(lines) == 0,
        }
    except Exception as exc:
        return {"error": str(exc), "path": workspace, "clean": True, "files": []}


# --- providers ---------------------------------------------------------------
#
# The Settings panel used to say "configured in ~/.amethyst/config/providers.yaml",
# which is a strange thing for an interface to say about a file whose every
# field it knows. These three routes are what let it write that file instead of
# describing it.

#: providers.yaml keys the model picker and the conversation rows by this name,
#: so it has to survive a URL and a YAML mapping key without surprises.
_PROVIDER_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")


class AddProvider(BaseModel):
    name: str
    base_url: str | None = None
    default_model: str | None = None
    context_window: int | None = None
    adapter: str | None = None
    #: Stored in the OS keychain and never returned by any route. Omitted when
    #: the key is already there, or when the endpoint needs none.
    api_key: str | None = None


@app.get("/api/providers")
async def list_providers() -> dict[str, Any]:
    """What is configured, what could be, and what is actually answering."""
    from backend.config import has_key, load_providers
    from backend.provider_catalogue import PROVIDER_PRESETS

    listed = load_providers()
    usable = configured_providers()
    reachable = await availability.survey(usable)

    return {
        "configured": [
            {
                "name": name,
                "base_url": cfg.base_url,
                "default_model": cfg.default_model,
                "context_window": cfg.context_window,
                # Whether the key it says it needs exists -- never the key.
                "has_key": has_key(cfg),
                "enabled": cfg.enabled,
                # Grouping for the interface: the providers this install leans
                # on, and the ones Auto is not allowed to choose on its own.
                "core": is_core(cfg),
                "auto_route": auto_routable(cfg),
                "available": name not in reachable or reachable[name].available,
                "unavailable_reason": (
                    "" if name not in reachable else reachable[name].reason
                ),
                "api_key_ref": cfg.api_key_ref,
            }
            for name, cfg in listed.items()
        ],
        "catalogue": [
            {
                "slug": preset.slug,
                "label": preset.label,
                "base_url": preset.base_url,
                "default_model": preset.default_model,
                "context_window": preset.context_window,
                "keys_url": preset.keys_url,
                "docs_url": preset.docs_url,
                "local": preset.local,
                "note": preset.note,
                "listed": preset.slug in listed,
            }
            for preset in PROVIDER_PRESETS
        ],
    }


@app.post("/api/providers")
def add_provider_route(body: AddProvider) -> dict[str, Any]:
    """Add or update one providers.yaml entry, and store its key if given."""
    from backend.config import add_provider, has_key, load_providers
    from backend.provider_catalogue import entry_for
    from backend.provider_catalogue import preset as find_preset
    from backend.secrets import CredentialError, get_secret, set_secret

    name = body.name.strip().lower()
    if not _PROVIDER_NAME.match(name):
        raise HTTPException(
            400,
            f"'{body.name}' is not a usable provider name."
            " Use lower-case letters, digits, dots, dashes or underscores.",
        )

    preset = find_preset(name)
    entry = entry_for(preset) if preset else {"name": name}
    for field, value in (
        ("base_url", body.base_url),
        ("default_model", body.default_model),
        ("context_window", body.context_window),
        ("provider", body.adapter),
    ):
        if value:
            entry[field] = value

    # Without a base URL the OpenAI-compatible adapter silently posts to
    # OpenAI, which fails as an authentication error and reads as a bad key.
    #
    # "Has a preset" was the wrong test for this. A preset is a set of facts
    # about a provider, and some of those presets do not include an endpoint --
    # a gateway whose URL nobody has confirmed is listed precisely so the form
    # can ask for it. Those slipped straight through to OpenAI. What actually
    # decides it is whether the *adapter* knows its own endpoint, which is the
    # same question `availability.resolve_base_url` answers, keyed the same way
    # `registry.resolve` keys adapters.
    from backend.runtime.availability import _DEFAULT_BASE_URLS

    adapter_key = entry.get("provider") or name
    if not entry.get("base_url") and adapter_key not in _DEFAULT_BASE_URLS:
        raise HTTPException(
            400,
            f"'{name}' needs a base URL: no adapter supplies one for it."
            " Paste the endpoint the provider documents, ending in /v1.",
        )

    default_ref = None if (preset and preset.local) else f"amethyst/{name}"
    api_key_ref = entry.get("api_key_ref") or default_ref
    if body.api_key is not None:
        value = body.api_key
        if not value.strip():
            raise HTTPException(400, "a key cannot be empty")
        if value != value.strip():
            raise HTTPException(
                400,
                "that key has whitespace around it, which would be sent verbatim."
                " Paste it again without the leading or trailing space.",
            )
        try:
            set_secret(api_key_ref, value)
        except CredentialError as exc:
            # A host with no keychain -- a container, most often. The message
            # names the way out; a 500 with a traceback named nothing.
            raise HTTPException(503, str(exc)) from exc
        entry["api_key_ref"] = api_key_ref
    elif api_key_ref and get_secret(api_key_ref):
        entry["api_key_ref"] = api_key_ref

    add_provider(entry)
    # A newly reachable endpoint should not be judged by what was remembered
    # about it before it existed.
    availability.forget(name)

    stored = load_providers().get(name)
    ready = stored is not None and has_key(stored) and bool(stored.default_model)
    return {
        "status": "added",
        "name": name,
        # What the interface needs in order to say what is still missing --
        # never anything derived from the key itself.
        "ready": ready,
        "needs_key": stored is not None and not has_key(stored),
        "needs_model": stored is not None and not stored.default_model,
        "api_key_ref": entry.get("api_key_ref"),
    }


class ProviderEnabled(BaseModel):
    enabled: bool


@app.patch("/api/providers/{name}")
def set_provider_enabled_route(name: str, body: ProviderEnabled) -> dict[str, Any]:
    """Switch one provider on or off, keeping its entry and its key.

    The middle state DELETE cannot express. Dropping an entry throws away the
    base URL and the model id and offers to re-add it from the catalogue on the
    next Settings visit, so "stop using this one for now" and "I have never
    heard of this one" were the same button.
    """
    from backend.config import set_provider_enabled

    if not set_provider_enabled(name, body.enabled):
        raise HTTPException(404, f"'{name}' is not in providers.yaml")
    # A provider coming back on should be believed immediately rather than
    # after a five-minute failure TTL: the user just told us something changed.
    if body.enabled:
        availability.forget(name)
    return {"status": "updated", "name": name, "enabled": body.enabled}


@app.get("/api/routing")
async def routing() -> dict[str, Any]:
    """Why the router would pick what it picks, right now.

    The explanation surface. Routing that cannot be inspected is routing nobody
    can trust: "why did it not use Groq" has an answer -- out of quota, over its
    window, switched off, 12% of its minute left -- and that answer exists
    whether or not anything shows it.

    Scored against a default request, so this describes the ordinary
    interactive turn rather than any particular one. A turn's own decision is
    recorded on its `agent_runs` row, where the figures it was actually scored
    against are kept with it.
    """
    from backend.config import load_providers
    from backend.runtime.router import RouteRequest, is_local, route, strengths_for

    listed = load_providers()
    usable = configured_providers()
    await availability.survey(usable)
    decision = route(RouteRequest())

    return {
        "decision": decision.explain(),
        "providers": [
            {
                "name": name,
                "enabled": cfg.enabled,
                "core": is_core(cfg),
                "auto_route": auto_routable(cfg),
                "local": is_local(cfg),
                "strengths": sorted(strengths_for(cfg)),
                # The declared ceiling, never a guessed one. None means nobody
                # has told AMETHYST what this account's limit is, which is not
                # the same as there being none -- and the interface has to say
                # the difference or the empty bar reads as "no headroom".
                "tokens_per_minute": cfg.tokens_per_minute,
                "headroom": round(availability.headroom(cfg), 3),
                "spent_tokens": availability.spent(name)[0],
                "spent_requests": availability.spent(name)[1],
                "available": (known := availability.cached(name)) is None or known.available,
                "reason": known.reason if known else "",
                "exhausted": bool(known and known.exhausted),
                "clears_in": availability.clears_in(name),
            }
            for name, cfg in listed.items()
        ],
    }


class TierAssignment(BaseModel):
    provider: str
    model: str


@app.get("/api/tiers")
def list_tiers() -> dict[str, Any]:
    """Which model does which job, plus what a picker needs to reassign one.

    A tier answers "how hard is this work": `fast` for a quick cheap turn,
    `default` for the everyday go-to model, `heavy` for the slow careful one.
    Empty tiers are the ordinary case, not a fault -- a caller with no
    assignment falls back to the conversation's own model.
    """
    from backend.config import TIERS, configured_providers, load_tiers

    providers = configured_providers()
    return {
        "roles": list(TIERS),
        "tiers": {
            name: {"provider": tier.provider, "model": tier.model}
            for name, tier in load_tiers().items()
        },
        "providers": list(providers),
        "provider_defaults": {
            name: cfg.default_model for name, cfg in providers.items() if cfg.default_model
        },
    }


@app.put("/api/tiers/{tier}")
def set_tier_route(tier: str, body: TierAssignment) -> dict[str, Any]:
    """Assign a tier a provider and model. The go-to model is the `default` tier."""
    from backend.config import set_tier

    try:
        set_tier(tier, body.provider, body.model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "set", "tier": tier, "provider": body.provider, "model": body.model}


@app.delete("/api/tiers/{tier}")
def clear_tier_route(tier: str) -> dict[str, str]:
    """Unassign a tier, so its callers fall back to the conversation's own model."""
    from backend.config import clear_tier

    try:
        clear_tier(tier)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "cleared", "tier": tier}


@app.post("/api/providers/ping-all")
async def ping_all_providers() -> dict[str, Any]:
    """Re-check every configured provider now, and report each.

    Registered above the `{name}` routes: Starlette matches in registration
    order, so this literal path has to win over `/providers/{name}` before a
    provider named "ping-all" could ever shadow it.
    """
    from backend.config import configured_providers

    providers = configured_providers()

    async def one(name: str, cfg) -> tuple[str, dict[str, Any]]:
        started = time.monotonic()
        try:
            result = await availability.ping(cfg)
            return name, {
                "available": result.available,
                "reason": result.reason,
                "latency_ms": int((time.monotonic() - started) * 1000),
            }
        except Exception as exc:
            return name, {"available": False, "reason": str(exc), "latency_ms": None}

    settled = await asyncio.gather(*(one(name, cfg) for name, cfg in providers.items()))
    return {"results": dict(settled)}


@app.post("/api/providers/{name}/ping")
async def ping_provider(name: str) -> dict[str, Any]:
    """A fresh liveness check for one provider, on demand.

    Distinct from the passive survey behind the picker's badge: a person
    pressing Ping means "check this one now", so the cache is dropped and the
    endpoint hit whatever its credential. Any status answering is reachable.
    """
    from backend.config import load_providers

    config = load_providers().get(name)
    if config is None:
        raise HTTPException(404, f"no provider named '{name}' in providers.yaml")
    started = time.monotonic()
    result = await availability.ping(config)
    return {
        "name": name,
        "available": result.available,
        "reason": result.reason,
        "source": result.source,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }


@app.get("/api/providers/{name}/models")
async def provider_models(name: str) -> dict[str, Any]:
    """The models this provider's own API lists right now, for the picker.

    So the user chooses from what the endpoint actually serves rather than
    retyping an id from its docs. Read live from the OpenAI-compatible
    `GET /models` with the provider's key -- the same list the provider's own
    dashboard shows, and always current, where hand-kept lists go stale the week
    a provider retires a model.

    `free` is best-effort: OpenRouter's `/models` carries pricing, so a
    zero-cost model can be flagged; most endpoints say nothing about price, and
    a free-tier provider (Groq, Cerebras) serves its whole list on the free
    tier anyway. Never raises -- an endpoint that will not answer returns an
    empty list with a reason, and the picker keeps its free-text field.
    """
    from backend.config import load_providers
    from backend.secrets import resolve_api_key

    config = load_providers().get(name)
    if config is None:
        raise HTTPException(404, f"no provider named '{name}' in providers.yaml")

    # The same URL a turn would hit -- an entry with no `base_url` still has an
    # endpoint, the adapter's own default, and this list used to come back
    # empty with a reason that blamed the user for a field the adapter fills in.
    base = availability.resolve_base_url(config)

    # How this endpoint wants to be asked, and how to read what it says back,
    # both come from the adapter. Bearer-and-`{"data":[...]}` is the common
    # shape and the default; Google takes its key in `x-goog-api-key` and
    # answers a different body, and hard-coding either of those here would put
    # a provider's name outside `runtime/providers/` (ADR-0001).
    from backend.runtime.registry import model_lister

    key = resolve_api_key(ref=config.api_key_ref, env=config.api_key_env)
    headers, parse = model_lister(config)
    try:
        import httpx

        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(f"{base}/models", headers=headers(key))
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return {"name": name, "models": [], "reason": f"{type(exc).__name__}: {exc}"}

    return {"name": name, "models": parse(payload), "reason": ""}


#: The OpenAI-shaped `/models` parser, which belongs to the adapter that owns
#: that shape. Re-exported under its old name because it is what the picker's
#: parsing test imports, and moving a function is not a reason to rewrite a test
#: that is about the parsing rather than about where it lives.
_model_list = openai_compat.list_models


@app.delete("/api/providers/{name}")
def remove_provider_route(name: str) -> dict[str, Any]:
    """Drop an entry. The key stays in the keychain, deliberately.

    Removing a provider from a list and destroying the credential behind it are
    different decisions, and only one of them is reversible from this screen.
    `amethyst secrets delete` is the other one.
    """
    from backend.config import remove_provider

    if not remove_provider(name):
        raise HTTPException(404, f"no provider named '{name}' in providers.yaml")
    availability.forget(name)
    return {"status": "removed", "name": name}


class CreateConversation(BaseModel):
    provider: str
    model: str
    title: str | None = None


@app.get("/api/conversations")
def list_conversations(include_automations: bool = False) -> list[dict[str, Any]]:
    """Conversations for the rail. Scheduled runs are listed per automation instead.

    They shared this list's fixed limit, so a pair of 15-minute automations
    filled it and pushed real conversations off the end.
    """
    return [dict(r) for r in ConversationRepository().list(
        include_automations=include_automations
    )]


# A model name no interface should ever send. It was a frontend fallback for
# "health has not answered yet, so I do not know this provider's default", and
# it went to the provider verbatim: NVIDIA answers `404 page not found`, and
# every turn in that conversation fails forever with no way to correct it.
PLACEHOLDER_MODELS = frozenset({"default", "", "null", "undefined", "none"})


def _validate_model(provider: str, model: str) -> str:
    """The model to store, or a 400 saying why not.

    Checked here rather than on the first turn, where the failure lands inside
    an already-open SSE stream and the interface has to explain a broken
    conversation instead of a rejected form.
    """
    if not is_known_provider(provider):
        raise HTTPException(400, f"provider '{provider}' is not configured")

    name = (model or "").strip()
    if provider == AUTO:
        # "auto" declares no model, because choosing one is the whole point of
        # it. A name sent alongside is kept rather than rejected -- it is what
        # the picker falls back to if routing is switched off again -- but it
        # is not required, and no default can be filled in from a provider
        # entry that does not exist.
        return name
    if name.casefold() in PLACEHOLDER_MODELS:
        default = configured_providers().get(provider)
        fallback = getattr(default, "default_model", None)
        if not fallback:
            raise HTTPException(
                400,
                f"no model given, and provider '{provider}' declares no default_model"
                " in providers.yaml. Pick one in the model menu.",
            )
        log.info("filled in %s's declared default model for a request that sent %r",
                 provider, model)
        return fallback
    return name


@app.post("/api/conversations")
def create_conversation(body: CreateConversation) -> dict[str, str]:
    model = _validate_model(body.provider, body.model)
    cid = ConversationRepository().create(body.provider, model, body.title)
    return {"id": cid}


class UpdateConversation(BaseModel):
    title: str | None = None
    provider: str | None = None
    model: str | None = None
    #: Provider names to try, in order, when this conversation's own provider
    #: cannot answer. `[]` means "do not fall back here"; omitting the field
    #: leaves whatever was set, and null is not accepted for the same reason --
    #: "no opinion" and "never" are different answers and a caller that meant
    #: one must not get the other.
    fallback: list[str] | None = None


@app.patch("/api/conversations/{conversation_id}")
def update_conversation(conversation_id: str, body: UpdateConversation) -> dict[str, Any]:
    """Rename, or switch provider/model mid-conversation.

    The loop resolves the adapter fresh every turn, so this write is the whole
    of "use a different model for this conversation".
    """
    repo = ConversationRepository()
    model = body.model
    if body.provider is not None or body.model is not None:
        existing = repo.get(conversation_id)
        if existing is None:
            raise HTTPException(404, "no such conversation")
        provider = body.provider or existing["provider"]
        # Validated together: switching provider without naming a model has to
        # land on THAT provider's own default, not carry the old provider's
        # model name across to an endpoint that has never heard of it. This
        # used to fall back to `existing["model"]` whenever the picker sent no
        # model (which it does for any provider with no declared default) --
        # a real model name is not a PLACEHOLDER_MODELS entry, so it passed
        # `_validate_model` unchanged and every later turn failed against a
        # model the new provider has never heard of.
        switching_provider = body.provider is not None and body.provider != existing["provider"]
        model_in = "" if switching_provider and body.model is None else (
            body.model if body.model is not None else existing["model"]
        )
        model = _validate_model(provider, model_in)

    if body.fallback is not None:
        # Rejected here rather than at turn time: a chain naming a provider that
        # does not exist would fail silently by being skipped, and the user would
        # never learn the name was wrong.
        for name in body.fallback:
            if not is_known_provider(name):
                raise HTTPException(400, f"provider '{name}' is not configured")

    if not repo.update(
        conversation_id,
        title=body.title,
        provider=body.provider,
        model=model,
        fallback=body.fallback,
    ):
        raise HTTPException(404, "no such conversation")
    return dict(repo.get(conversation_id))


@app.delete("/api/conversations")
def delete_all_conversations(include_automations: bool = False) -> dict[str, Any]:
    """Delete every conversation and every transcript.

    Refused outright while any turn is streaming, rather than skipping the busy
    one: "clear everything" that quietly left one conversation behind would be a
    worse answer than "stop that turn first".

    Extracted memories survive this, exactly as they survive a single delete --
    a fact learned in a conversation outlives it. Clearing those is
    `DELETE /api/memory`, deliberately a separate decision.
    """
    if _active_turns:
        raise HTTPException(
            409,
            f"{len(_active_turns)} turn(s) still running; stop them before clearing",
        )
    deleted = ConversationRepository().delete_all(include_automations=include_automations)
    return {"status": "deleted", "deleted": deleted}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, str]:
    """Delete a conversation and its transcript.

    Refused while a turn is streaming: the loop holds the id, may be suspended
    on a confirmation, and would go on writing messages into a row that no
    longer exists. Stop the turn first.
    """
    if conversation_id in _active_turns:
        raise HTTPException(409, "a turn is running in this conversation; stop it first")
    if not ConversationRepository().delete(conversation_id):
        raise HTTPException(404, "no such conversation")
    return {"status": "deleted"}


@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str) -> list[dict[str, Any]]:
    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "tool_calls": m.tool_calls,
            "tool_name": m.tool_name,
            "is_error": m.is_error,
            "pinned": m.pinned,
        }
        for m in MessageRepository().history(conversation_id)
    ]


class QuestionAnswers(BaseModel):
    answers: list[str]


@app.get("/api/questions")
def outstanding_questions(conversation_id: str | None = None) -> list[dict[str, Any]]:
    """Questions a turn is currently suspended on.

    A turn survives the page and the card that asked does not, so a reload
    would otherwise leave the user watching a turn that never finishes with
    nothing on screen explaining what it is waiting for. Same recovery the
    confirmation prompt already has.
    """
    from backend.agent import questions

    return questions.outstanding(conversation_id)


@app.post("/api/questions/{ask_id}")
def answer_question(ask_id: str, body: QuestionAnswers) -> dict[str, str]:
    """Hand the answers back to the turn waiting on them."""
    from backend.agent import questions

    if not questions.answer(ask_id, list(body.answers)):
        # Gone rather than never-existed: the turn was stopped, or it timed out
        # and carried on. Either way the answer has nowhere to go, and saying
        # so beats a silent 200 that looks like it landed.
        raise HTTPException(404, "no question is waiting on that answer")
    return {"status": "ok"}


@app.get("/api/providers/availability")
async def provider_availability() -> dict[str, Any]:
    """Which providers can answer right now, and when the rest come back.

    The debugging surface for routing. `/api/health` already said *whether* a
    provider was usable; it could not say why, could not tell "out of quota"
    from "the endpoint is down", and never said when the first of those clears
    -- so the only way to find out was to send a turn and watch it fail.

    `order` is the chain a new turn would walk, so what the router will
    actually do can be read off rather than inferred from the config.
    """
    from backend.runtime import availability
    from backend.runtime.chain import declared_order

    configs = configured_providers()
    surveyed = await availability.survey(configs)
    rows = []
    for name, config in configs.items():
        state = surveyed.get(name)
        known = availability.cached(name)
        rows.append(
            {
                "name": name,
                "model": config.default_model,
                "available": bool(state.available) if state else True,
                "exhausted": bool(known.exhausted) if known else False,
                "reason": state.reason if state else "",
                "source": state.source if state else "assumed",
                # Seconds until a remembered failure stops being believed.
                # Null when nothing is remembered against this provider.
                "clears_in": availability.clears_in(name),
            }
        )
    return {
        "providers": rows,
        "order": declared_order() or list(configs),
        "exhausted": [r["name"] for r in rows if r["exhausted"]],
    }


@app.get("/api/conversations/{conversation_id}/artifacts")
def list_artifacts(conversation_id: str) -> list[dict[str, Any]]:
    """Every artifact this conversation produced, newest first.

    Metadata only. The file is the artifact (ADR-0020), so a list of twenty
    documents costs twenty rows rather than twenty documents.
    """
    from backend.db.repositories import ArtifactRepository

    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    return ArtifactRepository().list(conversation_id)


@app.get("/api/artifacts/{artifact_id}")
def read_artifact(artifact_id: str) -> dict[str, Any]:
    """One artifact, with its content read from disk.

    Read rather than stored, which is what makes reopening one from a previous
    session tell the truth: if the user edited the file in their own editor
    after the agent wrote it, this returns what is actually there. A row whose
    file has since been deleted or moved says so rather than 404ing -- the
    artifact was real, and "it was written and is now gone" is a different fact
    from "no such artifact".
    """
    from backend.db.repositories import ArtifactRepository

    row = ArtifactRepository().get(artifact_id)
    if row is None:
        raise HTTPException(404, "no such artifact")

    path = Path(row["path"])
    content, missing = "", None
    try:
        content = path.read_text(errors="replace")
    except FileNotFoundError:
        missing = f"{path} is no longer on disk"
    except OSError as exc:
        missing = f"cannot read {path}: {exc}"
    return {**row, "content": content, "missing": missing}


@app.get("/api/conversations/{conversation_id}/run")
def conversation_run(conversation_id: str) -> dict[str, Any]:
    """How this conversation's most recent turn ended, read from disk.

    The interface used to be the only thing that knew. `resumable` arrived on the
    terminal `error` frame and lived in component state, so a reload lost it --
    and nothing anywhere said a turn had been interrupted rather than answered.
    A reader that has just opened the page asks this instead of trusting what it
    remembers, which is the whole point of the run row.

    `{}` for a conversation that has never taken a turn, or whose run row this
    build cannot read: an interface renders the transcript either way, and a 404
    here would make "no turn yet" look like "no such conversation".
    """
    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    state = AgentRunRepository().latest(conversation_id)
    if state is None:
        return {}
    return {
        "run_id": state.id,
        "phase": state.phase,
        "resumable": state.resumable,
        "carried": state.carried,
        "checkpoint": state.checkpoint,
        "iterations": state.iteration + 1,
        "tool_calls": state.tool_calls_made,
        "link": state.link,
        "error": state.error,
        "pending": state.pending,
        "updated_at": state.updated_at,
    }


class PinConversation(BaseModel):
    pinned: bool = True


@app.post("/api/conversations/{conversation_id}/pin")
def pin_conversation(conversation_id: str, body: PinConversation) -> dict[str, Any]:
    """Keep a conversation at the top of the history column, or stop.

    A different thing from pinning a *message*, which is the route below: this
    is about finding the conversation again, that one is about finding an answer
    inside it. The interface offered both under one star and wired the star to
    the message route, so the starred section filtered on a conversation field
    that did not exist and was empty no matter how much was pinned.
    """
    if not ConversationRepository().set_pinned(conversation_id, body.pinned):
        raise HTTPException(404, "no such conversation")
    return {"id": conversation_id, "pinned": body.pinned}


class PinMessage(BaseModel):
    pinned: bool = True


@app.post("/api/conversations/{conversation_id}/messages/{message_id}/pin")
def pin_message(conversation_id: str, message_id: int, body: PinMessage) -> dict[str, Any]:
    """Mark one message as worth keeping in reach, or take the mark off.

    A pin changes nothing about the turn: it is not sent to the model, does not
    affect what is recalled, and does not pin the model's attention. It is a
    bookmark in a transcript that scrolls, which is the whole of what it claims
    to be.
    """
    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    if not MessageRepository().set_pinned(conversation_id, message_id, body.pinned):
        raise HTTPException(404, "no such message in this conversation")
    return {"id": message_id, "pinned": body.pinned}


@app.get("/api/conversations/{conversation_id}/pins")
def list_pins(conversation_id: str) -> list[dict[str, Any]]:
    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    return [
        {"id": m.id, "role": m.role, "content": m.content}
        for m in MessageRepository().pinned(conversation_id)
    ]


#: "chat" acts; "plan" looks and hands back steps for approval. A field rather
#: than a sentence prepended to the message: the sentence was persisted into the
#: transcript and replayed on every later turn, and nothing on this side even
#: knew the mode existed -- so the only thing stopping a write in plan mode was
#: the model choosing to obey prose. See `backend/agent/planning.py`.
TURN_MODES = frozenset({"chat", "plan"})


class Attachment(BaseModel):
    """One file the user attached to this turn.

    `media_type` is what decides whether the model is shown the file or told
    where it is: an image becomes a content block it can actually look at,
    anything else stays a path plus a nudge toward `view_file`.
    """

    path: str
    name: str | None = None
    media_type: str | None = None
    bytes: int | None = None


class TurnRequest(BaseModel):
    message: str
    workspace: str | None = None
    mode: str = "chat"
    attachments: list[Attachment] = []
    guard: str | None = None
    effort: str | None = None
    model: str | None = None


@app.post("/api/conversations/{conversation_id}/turn")
async def run_turn(conversation_id: str, body: TurnRequest) -> StreamingResponse:
    if ConversationRepository().get(conversation_id) is None:
        raise HTTPException(404, "no such conversation")
    if body.mode not in TURN_MODES:
        # Rejected before the stream opens, like an unknown provider: a mode
        # nobody honours would silently act when the user asked for a plan.
        raise HTTPException(400, f"unknown mode '{body.mode}'")

    # Registered *before* the director is built. Building it can start
    # connectors, which takes seconds -- and during that window the browser has
    # an open fetch with no bytes yet, while `POST .../turn/stop` answered 404
    # because nothing had registered. Pressing Stop on a turn that had not
    # visibly begun was the one case Stop genuinely could not work.
    if conversation_id in _active_turns:
        # Two directors on one conversation interleave transcript writes and
        # bill two model streams, and the first turn's cancel event is silently
        # replaced -- Stop can only ever reach the second. The delete endpoints
        # already refuse for exactly this reason; the turn endpoint must too.
        raise HTTPException(409, "a turn is already running for this conversation")
    cancel = asyncio.Event()
    _active_turns[conversation_id] = cancel

    def release() -> None:
        if _active_turns.get(conversation_id) is cancel:
            del _active_turns[conversation_id]

    async def stream():
        # Whether the reader has been told how the turn ended.
        settled = False
        try:
            # The first frame goes out before anything that can be slow.
            #
            # Building the director starts connectors, and a connector is
            # allowed 180s to answer -- 300s if it says it is waiting on a
            # sign-in. That await used to sit above this generator, so the
            # response had not begun: the browser held an open request with no
            # bytes in it for minutes and then failed the fetch outright
            # ("NetworkError when attempting to fetch resource"), while this
            # conversation stayed registered in `_active_turns` and answered
            # every retry with 409. Moving it inside the stream means the
            # socket is alive from the first millisecond, the wait is covered
            # by keepalives, and a failure to build is an `error` frame the
            # interface can render rather than a dead connection.
            yield _frame("status", state="starting")
            began = time.monotonic()
            build = asyncio.ensure_future(
                _director(body.workspace, body.mode, reconcile_deadline=TURN_STARTUP_SECONDS)
            )
            try:
                while True:
                    done, _ = await asyncio.wait({build}, timeout=HEARTBEAT_SECONDS)
                    if done:
                        break
                    yield _frame("ping")
                director = build.result()
                # Logged because this is the stretch a user reads as "nothing
                # is happening": it covers the registry lock and every
                # connector coming up, and until it appeared in the log there
                # was no way to tell a slow start from a wedged one.
                log.info("agent ready in %.1fs", time.monotonic() - began)
            except asyncio.CancelledError:
                build.cancel()
                raise
            except Exception as exc:
                log.exception("could not build the agent for this turn")
                settled = True
                release()
                yield _frame("error", message=f"{type(exc).__name__}: {exc}")
                return

            async for event in _with_heartbeats(
                # Passed only when there is something to pass. `run` grew this
                # parameter; anything implementing the older three-argument
                # shape -- the unattended runner, the doubles in the tests --
                # stays callable, which is the whole point of it being optional.
                director.run(
                    conversation_id,
                    body.message,
                    cancel,
                    **({"attachments": [a.model_dump() for a in body.attachments]}
                       if body.attachments else {}),
                )
            ):
                if event is _HEARTBEAT:
                    # A keepalive, not progress. It carries the elapsed seconds
                    # so an interface *could* show "still working", but its only
                    # job is to keep the stream from going silent through a long
                    # tool call -- which is what a proxy drops and the client's
                    # watchdog gives up on.
                    yield _frame("ping")
                    continue
                # default=str so one unexpected value in a tool argument degrades
                # to a string instead of killing the response mid-stream.
                payload = json.dumps({"type": event.type, **event.data}, default=str)
                yield f"data: {payload}\n\n"
                # The stream outlives the answer: memory extraction is a second
                # model call the loop makes after `done`, and it is not part of
                # the turn anyone can stop. Holding the registration open across
                # it left the conversation looking busy for seconds after the
                # reply had landed -- long enough that deleting it came back a
                # 409, and "stop" stayed armed with nothing to interrupt.
                if event.type in TERMINAL_EVENTS:
                    settled = True
                    release()
                    await _say_the_agent_is_done(
                        conversation_id, event, time.monotonic() - began
                    )
            if not settled:
                # The loop returned without saying how it ended. An interface
                # keys its composer off a terminal frame, so a body that just
                # stops leaves the field disabled with nothing on screen to
                # explain it -- which is the "no response at all" this turn
                # looks like from the outside.
                yield _frame("error", message="the turn ended without a result")
        except asyncio.CancelledError:
            # A shutdown, a reload, or Starlette dropping the task. The reader
            # is still there for one more frame.
            if not settled:
                yield _frame("error", message="the server stopped this turn")
            raise
        finally:
            # A backstop for the stream that ends without a terminal frame at
            # all -- a client that hangs up, or a generator closed early.
            release()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        # Proxies that buffer a response defeat streaming entirely; the answer
        # then lands in one lump when the turn ends.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/conversations/{conversation_id}/turn/stop")
def stop_turn(conversation_id: str) -> dict[str, str]:
    """Interrupt the turn streaming for this conversation.

    The loop stops before its next model call, cancels whatever tool call is in
    flight -- including one suspended on a confirmation -- and records it as
    interrupted rather than leaving the history claiming a call that never
    finished.

    Async on purpose, like `decide_confirmation`: a sync endpoint runs in a
    threadpool, and `Event.set` off the loop thread does not wake the waiters
    promptly -- Stop could sit unread until some unrelated I/O poked the loop.
    """
    cancel = _active_turns.get(conversation_id)
    if cancel is None:
        raise HTTPException(404, "no turn is running for this conversation")
    cancel.set()
    return {"status": "stopping"}


@app.get("/api/confirmations")
async def list_confirmations() -> list[PendingConfirmation]:
    # Async so the snapshot cannot race a turn registering a confirmation
    # mid-iteration from the loop: a sync endpoint runs in a threadpool, and
    # iterating a dict the loop is mutating raises RuntimeError.
    return [entry["payload"] for entry in list(_pending.values())]


class ConfirmationDecision(BaseModel):
    allow: bool
    remember: bool = False


@app.get("/api/confirmations/preferences")
def list_confirmation_preferences() -> list[dict[str, Any]]:
    """Standing "don't ask again" decisions, keyed by operation.

    Declared above the decision endpoint so `preferences` is not read as a
    request id -- FastAPI matches in declaration order.
    """
    from backend.db.repositories import ConfirmationPreferenceRepository

    return [dict(row) for row in ConfirmationPreferenceRepository().list()]


@app.delete("/api/confirmations/preferences/{operation_key}")
def revoke_confirmation_preference(operation_key: str) -> dict[str, str]:
    """Take back a standing approval, so that operation asks again."""
    from backend.db.repositories import ConfirmationPreferenceRepository

    repo = ConfirmationPreferenceRepository()
    if repo.get(operation_key) is None:
        raise HTTPException(404, f"no standing decision for '{operation_key}'")
    repo.clear(operation_key)
    return {"status": "revoked", "operation_key": operation_key}


@app.post("/api/confirmations/{request_id}")
async def decide_confirmation(request_id: str, body: ConfirmationDecision) -> dict[str, str]:
    entry = _pending.get(request_id)
    if entry is None:
        raise HTTPException(404, "no such pending confirmation")
    if body.remember:
        from backend.db.repositories import ConfirmationPreferenceRepository

        payload = entry["payload"]
        # operation_key, not tool_name: the gate reads preferences back under
        # operation[:subtype], so storing the bare name both failed to match on
        # any tool that reports a subtype -- making "don't ask again" a silent
        # no-op through this API -- and would have collapsed read-only and
        # destructive shell use into one standing approval if it had matched.
        ConfirmationPreferenceRepository().remember(
            payload.operation_key, "allow" if body.allow else "deny", payload.risk
        )
    future = entry["future"]
    if not future.done():
        # Resolve on the loop that created the future. asyncio futures are not
        # thread-safe, and a sync endpoint would run here in a threadpool, so
        # setting the result directly recorded the decision without ever waking
        # the waiting turn -- every gated tool call hung forever.
        entry["loop"].call_soon_threadsafe(future.set_result, body.allow)
    return {"status": "recorded"}


# ------------------------------------------------------------- automations
#
# BETA. A turn that runs without anyone typing: a prompt, an interval, and a
# record of what happened. Two things are deliberately not here -- cron
# expressions and any trigger that is not the clock -- and one thing is
# deliberately refused: an unattended turn cannot answer a permission prompt,
# so it runs with the gate denying anything the user has not already approved
# standing, and reports `blocked` naming the operation it wanted.


class CreateAutomation(BaseModel):
    name: str
    prompt: str
    every_minutes: int
    provider: str | None = None
    model: str | None = None
    enabled: bool = True
    capability_profile: str | None = None


class UpdateAutomation(BaseModel):
    name: str | None = None
    prompt: str | None = None
    every_minutes: int | None = None
    enabled: bool | None = None
    provider: str | None = None
    model: str | None = None
    capability_profile: str | None = None


def _check_capability_profile(name: str | None) -> None:
    if name is None:
        return
    from backend.capabilities import CapabilityService

    if name not in {p["name"] for p in CapabilityService().profiles()}:
        raise HTTPException(400, f"no capability profile called '{name}'")


@app.get("/api/automations")
def list_automations() -> dict[str, Any]:
    return {
        "beta": True,
        "running_while_server_is_up": True,
        "automations": [a.to_json() for a in AutomationRepository().list()],
    }


@app.post("/api/automations")
def create_automation(body: CreateAutomation) -> dict[str, Any]:
    if body.provider is not None and not is_known_provider(body.provider):
        raise HTTPException(400, f"provider '{body.provider}' is not configured")
    _check_capability_profile(body.capability_profile)
    try:
        automation = AutomationRepository().create(
            body.name,
            body.prompt,
            body.every_minutes,
            provider=body.provider,
            model=body.model,
            enabled=body.enabled,
            capability_profile=body.capability_profile,
        )
    except AutomationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return automation.to_json()


@app.patch("/api/automations/{automation_id}")
def update_automation(automation_id: int, body: UpdateAutomation) -> dict[str, Any]:
    if body.provider is not None and not is_known_provider(body.provider):
        raise HTTPException(400, f"provider '{body.provider}' is not configured")
    _check_capability_profile(body.capability_profile)
    repo = AutomationRepository()
    if repo.get(automation_id) is None:
        raise HTTPException(404, "no such automation")
    try:
        # `enabled` is the one field where False is a value, not an omission.
        updated = repo.update(
            automation_id,
            name=body.name,
            prompt=body.prompt,
            every_minutes=body.every_minutes,
            enabled=body.enabled,
            provider=body.provider,
            model=body.model,
            capability_profile=body.capability_profile,
        )
    except AutomationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return updated.to_json()  # type: ignore[union-attr]


@app.get("/api/automations/{automation_id}/runs")
def list_automation_runs(automation_id: int) -> list[dict[str, Any]]:
    """Every run this automation has kept, newest first.

    Only the newest was reachable before: `record` overwrites
    `last_conversation_id`, so every earlier run became unreferenced the moment
    the next one finished, findable only by scrolling the rail it was flooding.
    """
    return [dict(r) for r in ConversationRepository().runs_of(str(automation_id))]


@app.delete("/api/automations/{automation_id}")
def delete_automation(automation_id: int, delete_runs: bool = False) -> dict[str, Any]:
    """Delete an automation. Its runs are kept unless `delete_runs` is set."""
    removed = 0
    if delete_runs:
        repo = ConversationRepository()
        for row in repo.runs_of(str(automation_id), limit=10_000):
            repo.delete(row["id"])
            removed += 1
    if not AutomationRepository().delete(automation_id):
        raise HTTPException(404, "no such automation")
    return {"status": "deleted", "runs_deleted": removed}


@app.post("/api/automations/{automation_id}/run")
def run_automation(automation_id: int) -> dict[str, Any]:
    """Put one on the board now, on the same path the scheduler uses.

    The same path deliberately: a "test run" that used a different gate, or a
    different director, would tell you nothing about whether the scheduled one
    will work.

    It answers with a job rather than a result. This used to await the whole run
    -- up to three minutes with the browser holding an open request, which a
    proxy times out and a person reads as a failure while the run carries on
    unseen. And if a run was already going, pressing the button queued a second
    one behind a lock. Now it hands back the job that is running, or starts one,
    and the page follows it; a reload reconnects to the same job instead of
    asking for another run.
    """
    automation = AutomationRepository().get(automation_id)
    if automation is None:
        raise HTTPException(404, "no such automation")
    return _runner.run_now(automation).to_json()


@app.get("/api/automations/{automation_id}/job")
def automation_job(automation_id: int) -> dict[str, Any]:
    """The run in flight for this automation, or the last one. `{}` if never run.

    What the interface asks on open, so a page that was reloaded mid-run shows
    the run rather than an idle button.
    """
    from backend.automation import job_prefix

    store = jobs.JobStore()
    live = store.live_for(job_prefix(automation_id))
    if live is not None:
        return live.to_json()
    recent = store.conn.execute(
        "SELECT * FROM jobs WHERE idempotency_key LIKE ?"
        " ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (f"{job_prefix(automation_id)}%",),
    ).fetchone()
    return jobs.Job.from_row(recent).to_json() if recent else {}


# ------------------------------------------------------------------- jobs
#
# Background work that has to survive the process running it: automation runs
# and Instagram ingests. A conversation turn is deliberately not here -- it is
# interactive, `agent_runs` already records it, and putting it on a queue would
# cost a round trip for something a person is watching arrive.


@app.get("/api/jobs")
def list_jobs(kind: str | None = None, state: str | None = None,
              limit: int = 50) -> dict[str, Any]:
    store = jobs.JobStore()
    return {
        "jobs": [job.to_json() for job in store.list(kind=kind, state=state, limit=limit)],
        "counts": store.counts(kind=kind),
        "kinds": jobs.registered_kinds(),
    }


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    store = jobs.JobStore()
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job")
    # The steps are what makes a retry safe, so they are what a person needs to
    # see before deciding to ask for one.
    return {**job.to_json(), "steps": store.steps(job)}


class JobAction(BaseModel):
    #: Only meaningful for a retry. Dropping the ledger means every step runs
    #: again, including the ones that sent something -- so it is never the
    #: default and never inferred.
    reset_steps: bool = False


@app.post("/api/jobs/{job_id}/{action}")
def act_on_job(job_id: str, action: str, body: JobAction | None = None) -> dict[str, Any]:
    """Pause, resume, cancel or retry one job.

    `retry` keeps the step ledger unless asked otherwise, which is the whole
    point: retrying a job that sent a confirmation and then failed must not send
    it twice. Only a person can know whether an operation should be repeated,
    so only a person can clear it.
    """
    store = jobs.JobStore()
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job")
    try:
        if action == "pause":
            job = store.pause(job)
        elif action == "resume":
            job = store.resume(job)
        elif action == "cancel":
            job = store.cancel(job)
        elif action == "retry":
            job = store.retry(job, reset_steps=bool(body and body.reset_steps))
        else:
            raise HTTPException(400, f"unknown action '{action}'")
    except jobs.state.IllegalTransition as exc:
        # A refusal, not a fault: a finished job cannot be paused, and saying so
        # is better than a 500 or a silent no-op.
        raise HTTPException(409, f"cannot {action} a {job.state} job ({exc})") from exc
    if job.state == "queued" and job.kind == AUTOMATION_JOB_KIND:
        _automation_lane.nudge()
    if job.state == "queued" and job.kind == worker_batch.KIND:
        _worker_lane.nudge()
    return job.to_json()


# ---------------------------------------------------------------- workers
#
# Where work runs when it does not run here: the two GitHub accounts, the
# collectors they can be asked for, and what the execution router would decide.
# Read-mostly -- a batch is created by the agent tool or an automation, not by a
# request, and it is then an ordinary job at `/api/jobs`.


class WorkerAccountPatch(BaseModel):
    owner: str | None = None
    repo: str | None = None
    workflow: str | None = None
    ref: str | None = None
    source_repo: str | None = None
    source_ref: str | None = None
    enabled: bool | None = None


class WorkerSettingsPatch(BaseModel):
    automation: WorkerAccountPatch | None = None
    subagent: WorkerAccountPatch | None = None
    relay_url: str | None = None
    allow_paid_models: bool | None = None


@app.get("/api/workers")
def get_workers() -> dict[str, Any]:
    """The two accounts, what they can run, and whether they are set up.

    No credential is withheld here because none is held here: the token refs are
    named so a person knows what to run `amethyst secrets set` on, and the
    values live in the OS keychain.
    """
    from backend.workers import collectors
    from backend.workers.accounts import ACCOUNTS, load_workers
    from backend.workers.router import LANES

    settings = load_workers()
    return {
        "accounts": [settings.account(name).as_json() for name in ACCOUNTS],
        "relay_url": settings.relay_url,
        "allow_paid_models": settings.allow_paid_models,
        "collectors": collectors.catalogue(),
        "lanes": list(LANES),
    }


@app.put("/api/workers")
def put_workers(body: WorkerSettingsPatch) -> dict[str, Any]:
    from backend.workers.accounts import ACCOUNTS, load_workers, save_workers

    patch: dict[str, Any] = {}
    for name in ACCOUNTS:
        section = getattr(body, name, None)
        if section is None:
            continue
        fields = {k: v for k, v in section.model_dump().items() if v is not None}
        if fields:
            patch[name] = fields
    if body.relay_url is not None:
        patch["relay_url"] = body.relay_url.strip()
    if body.allow_paid_models is not None:
        patch["allow_paid_models"] = body.allow_paid_models
    if not patch:
        return get_workers()
    try:
        save_workers(patch)
    except ValueError as exc:
        # A token in the payload. Refused with the sentence saying where it goes.
        raise HTTPException(400, str(exc)) from exc
    load_workers()
    return get_workers()


@app.post("/api/workers/{account}/check")
async def check_worker(account: str) -> dict[str, Any]:
    """Can this account actually be dispatched to? A read, so it costs nothing."""
    from backend.workers.accounts import ACCOUNTS
    from backend.workers.github import check

    if account not in ACCOUNTS:
        raise HTTPException(404, f"no such worker account '{account}'")
    return await check(account)


@app.get("/api/workers/route")
def explain_route(
    task: str = "",
    interactive: bool = True,
    scheduled: bool = False,
    fanout: int = 1,
    offline_ok: bool = False,
) -> dict[str, Any]:
    """What the execution router would decide, and why.

    Here because "it ran locally again" is only debuggable if the machine will
    say what it wanted and what stopped it.
    """
    from backend.workers import collectors
    from backend.workers.router import ExecutionRequest, choose

    collector = collectors.get(task) if task else None
    decision = choose(
        ExecutionRequest(
            task=task,
            interactive=interactive,
            scheduled=scheduled,
            fanout=max(1, fanout),
            offline_ok=offline_ok,
            needs_local_data=bool(collector and collector.local_only),
        )
    )
    return {**decision.as_json(), "explain": decision.explain()}


@app.get("/api/logs")
def logs(limit: int = 50) -> list[dict[str, Any]]:
    return [dict(r) for r in ExecutionLogRepository().recent(limit)]


# ----------------------------------------------------------------------- MCP
#
# One-click connect for a UI: GET /api/mcp/catalogue to render the tiles, POST
# /api/mcp/servers to add one, then POST /api/mcp/servers/{name}/login and poll
# GET /api/mcp/authorizations for the provider URL to send the user to.


@app.get("/api/mcp/catalogue")
def mcp_catalogue() -> list[dict[str, Any]]:
    from backend.mcp import commands as mcp

    return mcp.list_catalogue()


@app.get("/api/mcp/servers")
def mcp_servers(accounts: bool = False) -> list[dict[str, Any]]:
    """Configured connectors. `accounts=true` also asks each who it is signed in as,
    which can mean a network round trip, so the polling list does not ask for it.

    Each row carries a derived `state` -- see `backend/mcp/lifecycle.py`. It is
    computed here rather than in the interface so that the screen, the CLI and
    anything else asking cannot reach different conclusions from the same five
    fields, which is what they were doing.
    """
    from backend.capabilities import CapabilityService, Kind
    from backend.mcp import commands as mcp
    from backend.mcp.lifecycle import state_of
    from backend.mcp.oauth import PENDING

    rows = mcp.status(with_accounts=accounts)
    manager = _mcp["manager"]
    live = manager.state() if manager is not None else {}
    reconciled = manager is not None and manager.reconciled_once
    synced = _synced_sources()
    capabilities = CapabilityService()

    for row in rows:
        name = row["name"]
        # `enabled` from the same source `reconcile` obeys, not from mcp.yaml.
        # The two disagreed: a connector enabled in YAML with no capability
        # row (connectors default to off there) passed the `off` check, had no
        # error and no live tools -- and because a manager object existed,
        # `reconciled` was true, so every fresh server read "failed to start"
        # until someone pressed Connect. The capability row is the truth; a
        # connector that is on in YAML but off in `capability_state` now
        # renders as `off` with a Connect action, which is what it is.
        row["enabled"] = capabilities.is_enabled(Kind.CONNECTOR, name)
        p = PENDING.get(name)
        row["lifecycle"] = state_of(
            row,
            pending={"status": p.status, "message": p.message} if p else None,
            live=live.get(name),
            synced=name in synced,
            reconciled=reconciled,
        ).as_dict()
    return rows


def _synced_sources() -> set[str]:
    """Connectors whose first pull has actually happened.

    Asked of the mirrored rows rather than remembered in a flag: a flag would
    survive the tasks being cleared, and then claim a sync that no longer shows
    anywhere. Failing closed here only costs a "not synced yet" label.
    """
    try:
        from backend.db.connection import get_connection

        rows = get_connection().execute(
            "SELECT DISTINCT external_source FROM tasks WHERE external_source IS NOT NULL"
        )
        return {r[0] for r in rows if r[0]}
    except Exception:
        return set()


class AddServer(BaseModel):
    catalogue_id: str | None = None
    name: str | None = None
    # custom server fields
    transport: str | None = None
    command: str | None = None
    args: list[str] = []
    url: str | None = None
    oauth: bool = False
    allow_local: bool = False


@app.post("/api/mcp/servers")
async def mcp_add_server(body: AddServer) -> dict[str, Any]:
    from backend.mcp import commands as mcp

    try:
        if body.catalogue_id:
            config = mcp.add_from_catalogue(body.catalogue_id, body.name)
        else:
            if not body.name:
                raise HTTPException(400, "a custom server needs a name")
            config = mcp.add_custom(
                body.name,
                body.transport or ("streamable-http" if body.url else "stdio"),
                command=body.command,
                args=body.args,
                url=body.url,
                oauth=body.oauth,
                allow_local=body.allow_local,
            )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    # Adding used to end here, leaving a row in mcp.yaml and nothing running --
    # so "add" meant "add, then go and find the switch, then go and find
    # Connect". It now carries its own setup as far as it can go without the
    # user: switched on, started, and asked what it still needs.
    #
    # Non-interactive on purpose. A browser opening behind someone who pressed
    # Add is the same mistake as the serial sign-in that cost an automation its
    # whole budget: a sign-in is a step the user takes, deliberately, when they
    # are ready for it.
    lifecycle = await _start_after_add(config.name)

    return {
        "name": config.name,
        "oauth": config.oauth,
        "needs_login": config.oauth,
        "registration_help": mcp.registration_help(config.name, config.catalogue_id) or None,
        # What is still missing, in the same vocabulary the Connectors list uses,
        # so the card that opens after Add reads the same as the row behind it.
        "lifecycle": lifecycle,
    }


async def _first_sync(name: str) -> None:
    """Run a connector's initial pull, if it has one to run."""
    from backend.mcp.lifecycle import FIRST_SYNC

    if name not in FIRST_SYNC:
        return
    try:
        from backend.sync.microsoft_todo import SERVER
        from backend.sync.microsoft_todo import sync as sync_microsoft_todo

        report = await sync_microsoft_todo(await _manager_with(SERVER))
        log.info("first sync for '%s': %s", name, report.summary())
    except Exception as exc:
        # Nearly always "not signed in yet", which is the expected state right
        # after adding it. The lifecycle reports `sign_in`, then `syncing`, and
        # the row offers Sync now.
        log.info("'%s' has nothing to sync yet: %s", name, exc)


async def _start_after_add(name: str) -> dict[str, Any]:
    """Switch a newly added connector on, start it, and report where it got to."""
    from backend.capabilities import CapabilityService, Kind
    from backend.mcp import commands as mcp
    from backend.mcp import guidance
    from backend.mcp.config import load_servers
    from backend.mcp.lifecycle import state_of

    try:
        CapabilityService().set_enabled(Kind.CONNECTOR, name, True)
    except Exception as exc:  # a connector that will not switch on is still added
        log.warning("could not switch on '%s' after adding it: %s", name, exc)

    manager = None
    try:
        manager = await _manager_with(name)
    except Exception as exc:
        log.info("'%s' did not start on being added: %s", name, exc)

    guidance.forget()

    # The last step of setting a connector up, where it has one. Microsoft To Do
    # mirrors into the local tasks table, and until the first pull has run the
    # Tasks page is empty while the connector reports itself ready -- which reads
    # as the sync being broken rather than as never having been asked to run.
    # Best-effort: a sync that cannot run yet (no account) is the normal state
    # on the way through, not a failure to add the connector.
    await _first_sync(name)

    config = load_servers().get(name)
    if config is None:
        return {}
    row = next((r for r in mcp.status() if r["name"] == name), None)
    if row is None:
        return {}
    return state_of(
        row,
        live=(manager.state() if manager is not None else {}).get(name),
        synced=name in _synced_sources(),
        reconciled=manager is not None,
    ).as_dict()


@app.delete("/api/mcp/servers/{name}")
def mcp_remove_server(name: str) -> dict[str, str]:
    from backend.mcp import commands as mcp

    if not mcp.remove(name):
        raise HTTPException(404, f"no server named '{name}'")
    return {"status": "removed"}


class OAuthClient(BaseModel):
    client_id: str
    client_secret: str | None = None


@app.post("/api/mcp/servers/{name}/oauth-client")
def mcp_set_oauth_client(name: str, body: OAuthClient) -> dict[str, str]:
    """Attach a hand-registered OAuth app, for providers without dynamic registration."""
    from backend.mcp import commands as mcp

    try:
        mcp.set_oauth_client(name, body.client_id, body.client_secret)
    except mcp.CredentialLocked as exc:
        # Already working, and shared. Replacing it is a CLI decision.
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        # A rejected client id is the caller's mistake, not a missing route. A
        # 404 here sent "that is not a client id" back as "no such server".
        status_code = 404 if "no server named" in str(exc) else 400
        raise HTTPException(status_code, str(exc)) from exc
    return {"status": "stored"}


class ServerEnv(BaseModel):
    key: str
    value: str
    secret: bool = True


# A stdio server that takes its credentials through the environment -- Google
# Workspace is the catalogue's example -- could otherwise only be configured
# from the CLI, which makes "set it up in the browser" false for exactly the
# connectors that need setting up.
_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@app.post("/api/mcp/servers/{name}/env")
def mcp_set_env(name: str, body: ServerEnv) -> dict[str, Any]:
    """Set one environment variable for a stdio server."""
    from backend.mcp import commands as mcp
    from backend.mcp.config import load_servers

    if not _ENV_KEY.match(body.key):
        raise HTTPException(400, f"'{body.key}' is not a valid environment variable name")
    if load_servers().get(name) is None:
        raise HTTPException(404, f"no server named '{name}' in mcp.yaml")
    try:
        # No `force` here, and deliberately no way to pass one: a stored secret
        # is replaced from the CLI, which is a decision someone had to go and
        # make rather than a field they were already looking at.
        config = mcp.set_env(name, body.key, body.value, secret=body.secret)
    except mcp.CredentialLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        # A credential AMETHYST can already tell is wrong is a bad request, not a
        # missing server -- and the message says what to do about it, which is
        # the whole point of checking before the provider does.
        raise HTTPException(400, str(exc)) from exc
    return {
        "status": "set",
        "name": name,
        "key": body.key,
        "stored": "keychain" if body.secret else "mcp.yaml",
        "env": sorted(config.env),
    }


@app.delete("/api/mcp/servers/{name}/env/{key}")
def mcp_unset_env(name: str, key: str) -> dict[str, Any]:
    from backend.mcp import commands as mcp

    try:
        removed = mcp.unset_env(name, key)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not removed:
        raise HTTPException(404, f"'{name}' has no environment variable '{key}'")
    return {"status": "unset", "name": name, "key": key}


class LoginRequest(BaseModel):
    # Sign out first, so the provider shows its account chooser instead of
    # handing back whichever account it still has a session for.
    force: bool = False
    # Some servers cannot start their own flow without being told which account
    # to start it for. Google Workspace is one.
    account_hint: str | None = None


@app.post("/api/mcp/servers/{name}/login", status_code=202)
async def mcp_login(name: str, body: LoginRequest | None = None) -> dict[str, Any]:
    """Start the sign-in flow, and answer without waiting for it to finish.

    Signing in takes as long as a person takes. Holding the request open for it
    meant a five-minute HTTP call that the browser, or any proxy in front of it,
    gave up on long before the user did -- which surfaced as an unexplained
    network error over a sign-in that was going fine. The flow now runs as a
    task and reports through `GET /api/mcp/authorizations`, which is where the
    login URL already lived and which interfaces already poll.
    """
    from backend.capabilities import CapabilityService, Kind
    from backend.mcp import commands as mcp
    from backend.mcp.config import load_servers
    from backend.mcp.oauth import PENDING, PendingAuthorization

    request = body or LoginRequest()
    config = load_servers().get(name)
    if config is None:
        raise HTTPException(404, f"no server named '{name}' in mcp.yaml")

    # A sign-in already running is a reason to refuse a second one -- two flows
    # race for one callback port, and the loser's state is never accepted. But
    # only while it is genuinely live: an abandoned attempt used to block every
    # retry until its own deadline passed, which left the user with a dead link
    # and no way to ask for a new one.
    existing = _login_tasks.get(name)
    if existing is not None and not existing.done():
        pending = PENDING.get(name)
        if pending is not None and not pending.live:
            existing.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await existing
            _login_tasks.pop(name, None)
            await mcp.end_auth_session(name)
        else:
            raise HTTPException(409, f"a sign-in to '{name}' is already in progress")

    # Replace whatever an earlier attempt left behind, and say straight away
    # that this one is running. Without an entry here the interface has nothing
    # to show between "accepted" and the outcome -- and a sign-in that needs no
    # browser (a token already stored, being reconnected) never publishes a URL
    # at all, so that gap was the whole flow. `redirect_handler` overwrites this
    # with the real link if the provider does need the user.
    PENDING[name] = PendingAuthorization(server_name=name, authorization_url="")

    # Signing in means "and now use it": without this the token is stored, the
    # connector stays switched off, and nothing ever starts it. Cheap, and it
    # must happen before the task so the answer already reflects it.
    CapabilityService().set_enabled(Kind.CONNECTOR, name, True)

    async def run() -> None:
        # Whatever a previous attempt recorded is about to be settled either
        # way. Cleared here rather than at the end, where it would also erase
        # what *this* attempt just found out.
        _mcp["errors"].pop(name, None)
        try:
            # The manager only if one is already running. Building it starts
            # every switched-on connector serially -- minutes on a machine with
            # a dozen -- and the user is waiting for a browser tab, not for
            # Chrome DevTools to boot. The sign-in has to begin now.
            started = await _started_manager()
            await mcp.login(
                name,
                force=request.force,
                account_hint=request.account_hint,
                manager=started,
            )
            # Only when the sign-in did not already run against the live
            # registry. When it did, the connector is in it -- connecting again
            # would tear down the session that had just been established and
            # pay for a second handshake, which took a sign-in from three
            # seconds to twenty-four.
            if started is None and mcp.is_signed_in(load_servers()[name]) is not False:
                await _connect_into_live_registry(name)
        except Exception as exc:  # a failed sign-in is a reported outcome, not a crash
            log.warning("sign-in to %s failed: %s", name, exc)
            mcp.report_login_failure(name, str(exc))
        finally:
            _login_tasks.pop(name, None)

    _login_tasks[name] = asyncio.create_task(run(), name=f"mcp-login:{name}")
    return {"status": "started", "server": name}


@app.delete("/api/mcp/servers/{name}/login")
async def mcp_cancel_login(name: str) -> dict[str, Any]:
    """Abandon a sign-in in progress.

    A sign-in holds real resources while it waits -- the fixed callback port for
    AMETHYST's own flow, and a whole subprocess for a server that runs its own --
    and a user who has closed the browser tab has no other way to say so. They
    expire on their own, but "wait five minutes" is not an answer to "I did not
    mean to start this".
    """
    from backend.mcp import commands as mcp
    from backend.mcp.oauth import PENDING

    task = _login_tasks.pop(name, None)
    if task is not None and not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
    await mcp.end_auth_session(name)
    existed = PENDING.pop(name, None) is not None
    return {"status": "cancelled" if existed or task else "nothing in progress", "server": name}


@app.post("/api/mcp/servers/{name}/logout")
async def mcp_logout(name: str) -> dict[str, Any]:
    """Forget the connected account so the next sign-in reaches the chooser.

    Switching a connector off stops its process and leaves its account in
    place; there was no way from here to change which account a connector uses.
    """
    from backend.mcp import commands as mcp

    task = _login_tasks.pop(name, None)
    if task is not None and not task.done():
        task.cancel()
    # A server held open only to receive a sign-in the user has just abandoned
    # would otherwise sit there until its own deadline.
    await mcp.end_auth_session(name)

    try:
        cleared = mcp.sign_out(name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"status": "signed out", "name": name, "cleared": cleared}


@app.get("/api/mcp/authorizations")
async def mcp_pending_authorizations() -> list[dict[str, Any]]:
    """Sign-ins this process started, in flight or recently finished.

    `status` is `waiting` while the user is with the provider, then `done` or
    `failed` with the reason. This is the only channel that outlives the request
    that started the flow, so it is how an interface learns a sign-in landed.

    Async on purpose: the body mutates `PENDING` (pruning, finishing, signing
    out) and a sync endpoint would do that from a threadpool thread while the
    login tasks on the loop write the same dict.
    """
    from backend.mcp import commands as mcp
    from backend.mcp.config import load_servers
    from backend.mcp.oauth import PENDING, prune_finished

    prune_finished()

    # A card saying "finish signing in" for a connector that is already signed
    # in is simply wrong, and the user cannot dismiss it. It happens whenever a
    # sign-in lands by a route the watcher did not see -- another window, a
    # server-side flow that completed after its deadline, a stale entry across a
    # reconnect. Cheap to check, and it makes the list self-correcting.
    #
    # Token presence alone is not "signed in", though: an expired, revoked or
    # half-written token passes `has_tokens`, and flipping the card to done on
    # that basis is what let GitHub read "connected" without anyone ever
    # authenticating. Where the connector publishes an identity endpoint, the
    # token has to work there too. A 401 drops the stale token so the next
    # render offers Sign in rather than a connection that dies on first use.
    servers = load_servers()
    for pending_name, pending in list(PENDING.items()):
        if pending.status != "waiting":
            continue
        config = servers.get(pending_name)
        if config is None or mcp.is_signed_in(config) is not True:
            continue
        valid = mcp.identity_valid(pending_name)
        if valid is False:
            mcp.sign_out(pending_name)
            pending.finish("failed", f"the sign-in to {pending_name} did not stick; try again")
            continue
        # Name the account when the provider says who it is. "Connected to
        # github" alone is what let an unauthenticated connector read as
        # signed-in -- the account is the fact the user actually wants.
        who = mcp.account(pending_name)
        pending.finish(
            "done",
            f"signed in to {pending_name} as {who}" if who else f"signed in to {pending_name}",
        )

    return [
        {
            "server": name,
            # Only offered while the link can still be used. A dead one is worse
            # than none: it fails at the provider with a message about a state
            # parameter, which reads as AMETHYST being broken.
            "authorization_url": p.authorization_url if p.live else None,
            "status": p.status,
            "message": p.message,
            "finished_at": p.finished_at,
            "expires_in": max(0, round(p.ttl_seconds - p.age())) if p.live else 0,
            # The short code a device-code flow expects to be typed at the
            # provider. Without it that sign-in cannot be completed: the page
            # asks for a code the user was never shown.
            "user_code": p.user_code,
            "instructions": p.instructions,
            "account": mcp.account(name) if p.status == "done" else None,
        }
        for name, p in PENDING.items()
    ]


@app.post("/api/mcp/servers/{name}/connect")
async def mcp_connect(name: str) -> dict[str, Any]:
    """Connect a server into the registry turns actually run against.

    This used to connect a throwaway manager and shut it down again, which
    reported a tool count for a connection nothing could use: the next turn ran
    against the live registry, which had never heard of the server.
    """
    from backend.capabilities import CapabilityService, Kind
    from backend.mcp.config import load_servers

    config = load_servers().get(name)
    if config is None:
        raise HTTPException(404, f"no server named '{name}' in mcp.yaml")
    if CapabilityService().switched_off(Kind.CONNECTOR, name):
        # Connecting anyway would last until the next turn reconciles it away,
        # which reads as a connection that silently drops itself.
        raise HTTPException(409, f"'{name}' is switched off; turn it on before connecting")

    if _mcp["manager"] is None:
        # Build it against the working directory only if no turn has built one:
        # rebuilding for a different workspace would tear down live connections.
        await _registry_for(None)
    manager = _mcp["manager"]
    async with _registry_lock:
        manager.errors.pop(name, None)  # an explicit request retries a failed server
        try:
            # Someone pressed the button. `force` because they are asking for a
            # fresh session, not for the tool count they can already see.
            count = await manager.connect_server(config, force=True)
        except Exception as exc:
            _mcp["errors"][name] = str(exc)
            return {"name": name, "tools": 0, "error": str(exc)}
        _mcp["errors"].pop(name, None)
    return {"name": name, "tools": count, "error": None}


# ---------------------------------------------------------- capabilities
#
# What the composer's "+" menu needs: list skills and connectors with their
# on/off state, toggle them globally or for one conversation, and enumerate
# skills for the "/" autocomplete.


def _capability_json(c) -> dict[str, Any]:
    return {
        "kind": str(c.kind),
        "name": c.name,
        "title": c.title,
        "description": c.description,
        "enabled": c.enabled,
        "source": c.source,
        "detail": c.detail,
    }


@app.post("/api/mcp/reconcile")
async def reconcile_connectors() -> dict[str, Any]:
    """Start every switched-on connector now, the way the first turn would.

    Connectors reconcile at the start of a turn, so on a freshly started server
    every one of them is truthfully "not running" until someone says something.
    That is correct and it is also unreadable: a page listing six connectors as
    not running, when the real answer is "nothing has asked them to yet", is the
    same wall of red either way. This is the one button that asks.
    """
    await _registry_for(None)
    live = _mcp["manager"].state() if _mcp["manager"] else {}
    return {
        "connected": sum(1 for v in live.values() if v.get("connected")),
        "tools": sum(v.get("tools", 0) for v in live.values()),
        "errors": dict(_mcp["errors"]),
    }


@app.get("/api/capabilities")
def list_capabilities(conversation_id: str | None = None) -> dict[str, list[dict[str, Any]]]:
    from backend.capabilities import CapabilityService, Kind

    overview = CapabilityService().overview(conversation_id)
    # Connector rows carry what is actually running, not just what is switched
    # on: those are different facts, and only one of them is the truth.
    live = _mcp["manager"].state() if _mcp["manager"] else {}
    out: dict[str, list[dict[str, Any]]] = {}
    for group, items in overview.items():
        rows = []
        for capability in items:
            row = _capability_json(capability)
            if capability.kind is Kind.CONNECTOR:
                row["live"] = live.get(
                    capability.name,
                    {"connected": False, "tools": 0, "error": None, "ready": False},
                )
            rows.append(row)
        out[group] = rows
    return out


# --------------------------------------------------------------- profiles
#
# A named, reusable set of connectors -- switching a conversation between
# "everything" and "just search" used to mean toggling each connector by
# hand, every time, which is a chore nobody repeats. See the schema comment
# on capability_profiles for why this exists.
#
# Registered before the generic `{kind}/{name}` routes below: both shapes are
# two path segments, and Starlette matches routes in registration order, not
# by which segment is a literal -- after `{kind}/{name}`, `.../profiles/x`
# was being parsed as kind="profiles", a 400 rather than the route below.


@app.get("/api/capabilities/profiles")
def list_capability_profiles() -> list[dict[str, Any]]:
    from backend.capabilities import CapabilityService

    return CapabilityService().profiles()


class SaveProfile(BaseModel):
    name: str
    conversation_id: str | None = None


@app.post("/api/capabilities/profiles")
def save_capability_profile(body: SaveProfile) -> dict[str, Any]:
    """Snapshot a conversation's current connector on/off state under a name."""
    from backend.capabilities import CapabilityService

    try:
        CapabilityService().save_profile(body.name, conversation_id=body.conversation_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "saved", "name": body.name}


class ApplyProfile(BaseModel):
    conversation_id: str


@app.post("/api/capabilities/profiles/{name}/apply")
async def apply_capability_profile(name: str, body: ApplyProfile) -> dict[str, Any]:
    """Make a conversation's connectors match a profile, live -- not just in the DB.

    Mirrors `toggle_capability`: a profile that says a connector is on means
    that connector is actually running when this returns, and one it leaves
    off is actually disconnected, not merely marked off for the next turn.
    """
    from backend.capabilities import CapabilityService, Kind

    service = CapabilityService()
    # Both sides of this diff read the raw capability-state toggle -- not
    # `Capability.enabled`, which is `config.enabled AND is_enabled(...)`.
    # Comparing an AND'd `before` against a raw `after` (the original shape
    # here) misclassified a connector as "changed" whenever its `mcp.yaml`
    # `enabled: false` disagreed with a stale capability-state row, and
    # `_apply_connector` below does not itself check `config.enabled` --
    # so applying a profile could reconnect a connector the user had
    # administratively switched off in mcp.yaml.
    before = {
        c.name: service.is_enabled(Kind.CONNECTOR, c.name, body.conversation_id)
        for c in service.connectors(body.conversation_id)
    }
    try:
        on = service.apply_profile(name, body.conversation_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    changed = [
        c.name
        for c in service.connectors(body.conversation_id)
        if before.get(c.name) != service.is_enabled(Kind.CONNECTOR, c.name, body.conversation_id)
    ]
    for connector_name in changed:
        await _apply_connector(
            connector_name,
            service.is_enabled(Kind.CONNECTOR, connector_name, body.conversation_id),
        )
    return {"status": "applied", "name": name, "on": on, "changed": changed}


@app.delete("/api/capabilities/profiles/{name}")
def delete_capability_profile(name: str) -> dict[str, Any]:
    from backend.capabilities import CapabilityService

    found = CapabilityService().delete_profile(name)
    if not found:
        raise HTTPException(404, f"no profile called '{name}'")
    return {"status": "deleted"}


class CapabilityToggle(BaseModel):
    enabled: bool
    conversation_id: str | None = None  # omit to change the global default


@app.post("/api/capabilities/{kind}/{name}")
async def toggle_capability(kind: str, name: str, body: CapabilityToggle) -> dict[str, Any]:
    """Switch a capability on or off -- and, for a connector, make it so now.

    Writing the row and deferring the connection to the next turn is what
    produced a switch that said "on" while no process was running. Connectors
    start and stop here, and the outcome comes back with the response, so the
    interface can report what actually happened rather than what was intended.
    """
    from backend.capabilities import CapabilityService, Kind

    try:
        parsed = Kind(kind)
    except ValueError as exc:
        raise HTTPException(400, f"unknown capability kind '{kind}'") from exc

    service = CapabilityService()
    service.set_enabled(parsed, name, body.enabled, conversation_id=body.conversation_id)
    enabled = service.is_enabled(parsed, name, body.conversation_id)

    result = {
        "kind": kind,
        "name": name,
        "enabled": enabled,
        "scope": body.conversation_id or "global",
    }
    if parsed is Kind.CONNECTOR:
        result["live"] = await _apply_connector(name, enabled)
    return result


async def _apply_connector(name: str, enabled: bool) -> dict[str, Any]:
    """Start or stop one connector immediately, reporting the real outcome."""
    from backend.mcp.config import load_servers

    config = load_servers().get(name)
    if config is None:
        return {"connected": False, "tools": 0, "error": f"'{name}' is not in mcp.yaml"}

    if _mcp["manager"] is None:
        # No turn has run yet, so there is nothing live to attach to. Build the
        # registry against the working directory; a later turn naming a
        # workspace rebuilds it and reconnects whatever is switched on.
        await _registry_for(None)
    manager = _mcp["manager"]

    async with _registry_lock:
        if not enabled:
            await manager.disconnect_server(name)
            _mcp["errors"].pop(name, None)
            return {"connected": False, "tools": 0, "error": None}

        manager.errors.pop(name, None)  # an explicit switch-on retries a failure
        try:
            # A switch the user just flipped means "start it now", so the
            # already-connected shortcut is not what they asked for.
            tools = await manager.connect_server(config, force=True)
        except Exception as exc:
            _mcp["errors"][name] = str(exc)
            return {"connected": False, "tools": 0, "error": str(exc)}
        _mcp["errors"].pop(name, None)
        return {"connected": True, "tools": tools, "error": None}


@app.delete("/api/capabilities/{kind}/{name}")
def reset_capability(kind: str, name: str, conversation_id: str | None = None) -> dict[str, str]:
    """Drop an explicit setting so the capability follows its default again."""
    from backend.capabilities import CapabilityService, Kind

    try:
        parsed = Kind(kind)
    except ValueError as exc:
        raise HTTPException(400, f"unknown capability kind '{kind}'") from exc

    CapabilityService().clear(parsed, name, conversation_id=conversation_id)
    return {"status": "reset"}


@app.get("/api/skills/search")
def skill_autocomplete(q: str = "", conversation_id: str | None = None) -> list[dict[str, Any]]:
    """Backs the "/" menu: enabled skills whose name or description matches."""
    from backend.capabilities import CapabilityService

    needle = q.strip().lower().lstrip("/")
    matches = [
        c
        for c in CapabilityService().skills(conversation_id)
        if c.enabled and (not needle or needle in c.name.lower() or needle in c.description.lower())
    ]
    matches.sort(key=lambda c: (not c.name.lower().startswith(needle), c.name))
    return [_capability_json(c) for c in matches]


@app.get("/api/skills")
def list_skills() -> dict[str, Any]:
    skills, errors = scan()
    return {
        "skills": [
            {
                "name": s.name,
                "description": s.description,
                "path": str(s.path),
                "version": s.version,
            }
            for s in skills
        ],
        "errors": [{"path": str(e.path), "error": e.error} for e in errors],
    }


@app.get("/api/skills/catalogue")
async def skills_catalogue(refresh: bool = False) -> dict[str, Any]:
    """Skills that can be installed, read from their source repositories.

    Cards need a real name and description, so this parses each SKILL.md's
    frontmatter rather than shipping a hand-written list that would drift the
    moment the source changed. `error` is populated when the fetch failed and
    the list is stale or empty -- never silently.
    """
    from backend.skills.catalogue import fetch

    catalogue = await fetch(force=refresh)
    installed = {skill.name for skill in scan()[0]}
    return {
        "error": catalogue.error,
        "skills": [
            {
                "id": entry.id,
                "name": entry.name,
                "description": entry.description,
                "publisher": entry.publisher,
                "source": entry.source,
                "url": entry.url,
                "homepage": entry.homepage,
                "installed": entry.name in installed,
            }
            for entry in catalogue.skills
        ],
    }


class InstallSkill(BaseModel):
    url: str
    overwrite: bool = False


@app.post("/api/skills/install")
async def install_skill(body: InstallSkill) -> dict[str, Any]:
    """Install a skill from a URL -- a GitHub page URL included.

    Skills are markdown, so "install" is a download and a validation. It is a
    first-class action because the alternative is asking the agent to write
    files into its own skills directory, which is a shell command the user has
    to approve and cannot easily check.
    """
    from backend.mcp.ssrf import UnsafeURL
    from backend.skills.install import SkillInstallError, install_from_url

    try:
        skill = await install_from_url(body.url, overwrite=body.overwrite)
    except (SkillInstallError, UnsafeURL) as exc:
        raise HTTPException(400, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"could not fetch {body.url}: {exc}") from exc
    return {
        "name": skill.name,
        "description": skill.description,
        "path": str(skill.path),
        "version": skill.version,
    }


class CreateSkill(BaseModel):
    name: str
    description: str
    instruction: str
    overwrite: bool = False


@app.post("/api/skills/create")
def create_skill(body: CreateSkill) -> dict[str, Any]:
    """Write a skill from the three things a skill actually is.

    A skill is a directory with a SKILL.md whose frontmatter carries a name and
    a description, and whose body is the instruction (ADR-0006). That is three
    fields, so this takes three fields and composes the file rather than asking
    someone to write YAML by hand -- and then puts it through exactly the same
    validation as one installed from a URL, so a skill authored here cannot be
    one the loader will only ever report as broken.
    """
    from backend.skills.install import SkillInstallError, install_text

    name = body.name.strip().lower().replace(" ", "-")
    description = " ".join(body.description.split())
    instruction = body.instruction.strip()
    if not instruction:
        raise HTTPException(400, "a skill with no instruction has nothing to offer")
    # Quoted and escaped: a description containing a colon is ordinary English
    # and must not become a second YAML key.
    quoted = description.replace("\\", "\\\\").replace('"', '\\"')
    text = f'---\nname: {name}\ndescription: "{quoted}"\n---\n\n{instruction}\n'
    try:
        skill = install_text(text, overwrite=body.overwrite)
    except SkillInstallError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "name": skill.name,
        "description": skill.description,
        "path": str(skill.path),
        "version": skill.version,
    }


@app.delete("/api/skills/{name}")
def remove_skill(name: str) -> dict[str, str]:
    from backend.skills.install import SkillInstallError, remove

    try:
        removed = remove(name)
    except SkillInstallError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not removed:
        raise HTTPException(404, f"no skill named '{name}'")
    return {"status": "removed", "name": name}


@app.get("/api/tools")
def list_tools() -> list[dict[str, Any]]:
    """Every tool the agent can currently reach, builtin and connected alike.

    The flat namespace is the point (ADR-0003) -- the model cannot tell a
    builtin from an MCP tool -- but a person deciding what to switch on can, so
    the source and server come back with each one.
    """
    # Deliberately not _registry_for: listing what exists must not start
    # connector processes as a side effect. Before the first turn this is the
    # builtin set, which is exactly what is true at that moment.
    registry = _listing_registry()
    rows = []
    for tool in registry.list():
        rows.append(
            {
                "name": tool.name,
                "description": tool.description,
                "source": tool.source.value,
                "server": tool.server_name,
                "risk": tool.risk.value,
            }
        )
    return sorted(rows, key=lambda r: (r["server"] or "", r["name"]))


# ------------------------------------------------------------- attachments
#
# A browser cannot hand the agent a file path -- it has no idea where the file
# is on disk, and AMETHYST's tools work on paths. So a file dropped into the
# composer is written into the AMETHYST home first, and the message carries the
# path it landed at, which the ordinary file tools then read.


@app.post("/api/attachments")
async def upload_attachment(file: UploadFile) -> dict[str, Any]:
    from uuid import uuid4

    name = Path(file.filename or "attachment").name
    if not name or name in {".", ".."}:
        raise HTTPException(400, "the upload has no usable filename")

    folder = paths().home / "attachments" / uuid4().hex[:12]
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name

    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_ATTACHMENT_BYTES:
                out.close()
                shutil.rmtree(folder, ignore_errors=True)
                raise HTTPException(413, "attachments are limited to 32MB")
            out.write(chunk)

    await _index_attachment(target, name)
    return {
        "name": name,
        "path": str(target),
        "bytes": size,
        "content_type": file.content_type,
    }


async def _index_attachment(target: Path, name: str) -> None:
    """Make an uploaded file findable, not just readable.

    The composer already tells the agent to read the file it just carried in, so
    this is not about the current turn. It is about the next week: a contract
    dropped into a conversation on Monday is invisible to `search_documents` on
    Friday unless something indexes it. `library/service.py` does the same thing
    for captured pages, with the same `require_embeddings=False` -- an
    unreachable embedder should leave the file findable by keyword rather than
    fail an upload the user watched succeed.
    """
    from backend.retrieval.indexer import DOCUMENT_EXTENSIONS, TEXT_EXTENSIONS, Indexer

    if target.suffix.lower() not in TEXT_EXTENSIONS | DOCUMENT_EXTENSIONS:
        return
    try:
        await Indexer().index_file(
            target, source="attachment", title=name, require_embeddings=False
        )
    except Exception as exc:  # indexing is best-effort; the upload already worked
        log.info("could not index attachment %s: %s", name, exc)


# ------------------------------------------------------------------ tasks
#
# Every write goes through `backend.tasks.service`, which the agent's tools and the
# To Do sync also use. Three copies of "resolve the hints, pick a list, write the
# row, mirror it upstream" is how this interface ended up able to express less
# than the API it was calling.


class CreateTask(BaseModel):
    title: str
    notes: str | None = None
    # Natural language, resolved by the scheduling engine against the real
    # clock -- the same path the agent's tools take, so a task typed by hand and
    # one created in a turn cannot disagree about what "tomorrow" means.
    due_date_hint: str | None = None
    scheduled_hint: str | None = None
    reminder_hint: str | None = None
    priority: str | None = None
    important: bool = False
    add_to_my_day: bool = False
    list: str | None = None
    duration_estimate_minutes: int | None = None


class UpdateTask(BaseModel):
    title: str | None = None
    notes: str | None = None
    status: str | None = None
    priority: str | None = None
    important: bool | None = None
    add_to_my_day: bool | None = None
    list: str | None = None
    due_date_hint: str | None = None
    scheduled_hint: str | None = None
    reminder_hint: str | None = None
    duration_estimate_minutes: int | None = None


class CreateList(BaseModel):
    name: str


class RenameList(BaseModel):
    name: str


TASK_BUCKETS = ("my_day", "missed", "important", "general", "completed", "all")


def _task_row(row: Any) -> dict[str, Any]:
    return dict(row)


@app.get("/api/tasks")
def list_tasks(
    bucket: str = "all",
    list_id: int | None = None,
    limit: int = 200,
    include_done: bool = False,
) -> list[dict[str, Any]]:
    """One bucket, or one list.

    `include_done` is kept for callers that predate the buckets; it maps onto
    the `all`/`completed` split rather than the old behaviour, which also
    returned cancelled rows and so made "showing done" quietly mean "showing
    everything including what you gave up on".
    """
    from backend.db.repositories import TaskRepository

    repo = TaskRepository()
    if list_id is not None:
        return [_task_row(r) for r in repo.bucket("list", list_id=list_id, limit=limit)]
    if include_done and bucket == "all":
        bucket = "completed"
    if bucket not in TASK_BUCKETS:
        raise HTTPException(400, f"bucket must be one of {', '.join(TASK_BUCKETS)}")
    return [_task_row(r) for r in repo.bucket(bucket, limit=limit)]


@app.get("/api/tasks/buckets")
def task_counts() -> dict[str, Any]:
    """Every count the rail needs, in one call rather than six."""
    from backend.db.repositories import TaskListRepository, TaskRepository

    counts = TaskRepository().counts()
    lists = [
        {
            "id": row["id"],
            "name": row["name"],
            "is_default": bool(row["is_default"]),
            "external_id": row["external_id"],
            "open": counts.get(f"list:{row['id']}", 0),
        }
        for row in TaskListRepository().all()
    ]
    return {
        "buckets": {name: counts.get(name, 0) for name in TASK_BUCKETS},
        "lists": lists,
        # Which of those lists is My Day. The interface needs it to stop showing
        # the list twice -- once as the bucket at the top of the rail and again
        # among the lists below it -- and the answer is the server's to give:
        # the rule for which name counts lives in one place and is not restated
        # in JavaScript.
        "my_day_list_id": TaskRepository().my_day_list_id(),
        # So the interface can say "local only" honestly rather than implying a
        # list the user made here is on their phone.
        "connected": any(row["external_id"] for row in lists) if lists else False,
    }


@app.get("/api/task-lists")
def get_task_lists() -> list[dict[str, Any]]:
    from backend.db.repositories import TaskListRepository

    return [dict(row) for row in TaskListRepository().all()]


@app.post("/api/task-lists", status_code=201)
async def create_task_list(body: CreateList) -> dict[str, Any]:
    from backend.db.repositories import TaskListRepository
    from backend.tasks.service import TaskError, TaskService

    try:
        ref = await TaskService().create_list(body.name)
    except TaskError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = TaskListRepository().get(ref.id)
    return {**dict(row), "note": ref.note}


@app.patch("/api/task-lists/{list_id}")
async def rename_task_list(list_id: int, body: RenameList) -> dict[str, Any]:
    from backend.db.repositories import TaskListRepository
    from backend.sync.microsoft_todo import rename_remote_list

    repo = TaskListRepository()
    row = repo.get(list_id)
    if row is None:
        raise HTTPException(404, f"no list with id {list_id}")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "a list needs a name")

    if row["external_id"]:
        try:
            await rename_remote_list(str(row["external_id"]), name)
        except Exception as exc:
            # The rename is not lost -- it is applied locally and the next sync
            # would otherwise overwrite it, so refusing here is the honest
            # answer rather than showing a name that will silently revert.
            raise HTTPException(502, f"Microsoft To Do refused the rename: {exc}") from exc
    repo.update(list_id, name=name)
    return dict(repo.get(list_id))


@app.post("/api/tasks", status_code=201)
async def create_task(body: CreateTask) -> dict[str, Any]:
    """Add a task by hand.

    Goes to the connected task service where there is one, for the same reason
    the agent's `create_task` does: a local row beside a signed-in To Do account
    is a second list nobody asked for.
    """
    from backend.db.repositories import TaskRepository
    from backend.tasks.service import TaskError, TaskService

    try:
        written = await TaskService().create(
            body.title,
            notes=(body.notes or None),
            due_hint=body.due_date_hint,
            scheduled_hint=body.scheduled_hint,
            reminder_hint=body.reminder_hint,
            duration_estimate_minutes=body.duration_estimate_minutes,
            priority=body.priority,
            important=body.important,
            add_to_my_day=body.add_to_my_day,
            list_name=body.list,
        )
    except TaskError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Unlike before, the caller is told when the upstream write did not happen
    # rather than getting a 201 with a silently null external_source.
    return {**dict(TaskRepository().get(written.task_id)), "routed_to": written.routed_to}


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: int, body: UpdateTask) -> dict[str, Any]:
    """Change a task: mark it done, retime it, file it, or edit what it says."""
    from backend.db.repositories import TaskRepository
    from backend.tasks.service import TaskError, TaskService

    try:
        await TaskService().update(
            task_id,
            title=body.title,
            notes=body.notes,
            status=body.status,
            priority=body.priority,
            important=body.important,
            add_to_my_day=body.add_to_my_day,
            list_name=body.list,
            due_hint=body.due_date_hint,
            scheduled_hint=body.scheduled_hint,
            reminder_hint=body.reminder_hint,
            duration_estimate_minutes=body.duration_estimate_minutes,
        )
    except TaskError as exc:
        # "no task with id N" is a 404; everything else the caller can fix.
        status = 404 if str(exc).startswith("no task with id") else 400
        raise HTTPException(status, str(exc)) from exc
    return dict(TaskRepository().get(task_id))


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int) -> dict[str, str]:
    from backend.tasks.service import TaskError, TaskService

    # Cancelled, not deleted: a task mirrored from To Do would come straight
    # back on the next sync, and a row that reappears is worse than one that
    # stays and says it was dropped.
    try:
        await TaskService().cancel(task_id)
    except TaskError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"status": "cancelled", "id": str(task_id)}


@app.post("/api/tasks/sync")
async def sync_tasks() -> dict[str, Any]:
    """Push local changes to Microsoft To Do and pull it back, now.

    The same sync the background loop runs every fifteen minutes, exposed so a
    user who has just signed in does not have to wait for the next one.
    """
    from backend.sync.microsoft_todo import SERVER, SyncUnavailable
    from backend.sync.microsoft_todo import sync as sync_microsoft_todo

    try:
        report = await sync_microsoft_todo(await _manager_with(SERVER))
    except SyncUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "ok", "summary": report.summary(), **report.as_dict()}


# ---------------------------------------------------------------------------
# mail
#
# Read straight from Gmail rather than through the `google-gmail` connector, and
# the reason is in `backend/mail/gmail.py`: the connector answers in prose written
# for a model to read, and a view built on that is a regular expression over
# somebody else's help text. The agent still uses the connector; the screen uses
# the API. Both sign in as the same account, because the credentials are the
# ones the connector stored.
# ---------------------------------------------------------------------------


class MailReply(BaseModel):
    body: str


class MailLabels(BaseModel):
    add: list[str] = []
    remove: list[str] = []


@app.get("/api/mail/account")
async def mail_account() -> dict[str, Any]:
    """Who mail is read as, and what that sign-in is allowed to do.

    Answers rather than raising when nobody is signed in: this is the call the
    screen makes first, and an empty inbox with a sentence beats an error.
    """
    from backend.mail import accounts

    found = accounts()
    if not found:
        return {"address": None, "detail": "No Google account is signed in."}
    account = found[0]
    return {
        "address": account.address,
        "can_send": account.can_send,
        "can_modify": account.can_modify,
        # Every account the connector holds. More than one means it picks in
        # single-user mode and AMETHYST cannot say which -- worth showing.
        "others": [a.address for a in found[1:]],
    }


@app.get("/api/mail/threads")
async def mail_threads(q: str = "in:inbox", limit: int = 25) -> list[dict[str, Any]]:
    from backend.mail import MailUnavailable, threads

    try:
        return await threads(q, limit=limit)
    except MailUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/mail/threads/{thread_id}")
async def mail_thread(thread_id: str) -> dict[str, Any]:
    from backend.mail import MailUnavailable, thread

    try:
        return await thread(thread_id)
    except MailUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/mail/threads/{thread_id}/reply")
async def mail_reply(thread_id: str, body: MailReply) -> dict[str, Any]:
    from backend.mail import MailUnavailable, reply

    if not body.body.strip():
        raise HTTPException(400, "a reply needs something in it")
    try:
        return await reply(thread_id, body.body)
    except MailUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/mail/messages/{message_id}/labels")
async def mail_labels_modify(message_id: str, body: MailLabels) -> dict[str, Any]:
    """Add and remove labels. Archiving is removing `INBOX`; there is no separate
    archive call in Gmail's API and inventing one here would hide that."""
    from backend.mail import MailUnavailable, modify_labels

    try:
        return await modify_labels(message_id, add=body.add, remove=body.remove)
    except MailUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/mail/labels")
async def mail_labels() -> list[dict[str, Any]]:
    from backend.mail import MailUnavailable, labels

    try:
        return await labels()
    except MailUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/calendar")
def list_calendar(days: int = 14) -> list[dict[str, Any]]:
    from datetime import datetime, timedelta

    from backend.db.repositories import CalendarRepository

    now = datetime.now()
    rows = CalendarRepository().in_window(
        now.isoformat(timespec="seconds"),
        (now + timedelta(days=days)).isoformat(timespec="seconds"),
    )
    return [dict(row) for row in rows]


# ---------------------------------------------------------------- memory
#
# The standing facts AMETHYST holds about the user, and the switch that governs
# them. Memory has its own table rather than a capability_state row (the CHECK
# constraint there predates it), so it needs its own routes rather than riding
# /api/capabilities.


class MemoryToggle(BaseModel):
    enabled: bool
    conversation_id: str | None = None  # omit to change the global default


@app.get("/api/memory")
def list_memories(conversation_id: str | None = None, limit: int = 200) -> dict[str, Any]:
    from backend.memory import MemoryStore

    store = MemoryStore()
    return {
        "enabled": store.is_enabled(conversation_id),
        "scope": conversation_id or "global",
        "facts": [
            {
                "id": m.id,
                "fact": m.fact,
                "conversation_id": m.conversation_id,
                "created_at": m.created_at,
            }
            for m in store.live(limit)
        ],
    }


class JournalSchedulePatch(BaseModel):
    """When the briefing and the reviews are filed. Every field optional."""

    briefing_enabled: bool | None = None
    briefing_hour: int | None = None
    review_enabled: bool | None = None
    review_hour: int | None = None
    weekly_enabled: bool | None = None
    weekly_weekday: int | None = None


class Settings(BaseModel):
    #: The agent loop's iteration ceiling. Optional so a PATCH can carry only
    #: the fields it changes.
    max_iterations: int | None = None
    #: Nested rather than six flat keys: these are read together, saved
    #: together, and shown as one block, so they are one setting.
    journal: JournalSchedulePatch | None = None


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    """User-adjustable knobs that are not per-provider or per-conversation."""
    from backend.config import (
        DEFAULT_MAX_ITERATIONS,
        MAX_MAX_ITERATIONS,
        MIN_MAX_ITERATIONS,
        load_journal_schedule,
        load_max_iterations,
    )

    return {
        "max_iterations": load_max_iterations(),
        # The bounds the interface should offer, so it does not have to hardcode
        # numbers that could drift from the ones the server clamps to.
        "max_iterations_default": DEFAULT_MAX_ITERATIONS,
        "max_iterations_min": MIN_MAX_ITERATIONS,
        "max_iterations_max": MAX_MAX_ITERATIONS,
        "journal": load_journal_schedule().as_dict(),
    }


@app.patch("/api/settings")
def update_settings(body: Settings) -> dict[str, Any]:
    """Change a knob. Only the fields present are touched; the value is clamped."""
    from backend.config import save_journal_schedule, save_max_iterations

    if body.max_iterations is not None:
        save_max_iterations(body.max_iterations)
    if body.journal is not None:
        save_journal_schedule(body.journal.model_dump(exclude_none=True))
    return get_settings()


@app.post("/api/memory/toggle")
def toggle_memory(body: MemoryToggle) -> dict[str, Any]:
    from backend.memory import MemoryStore

    store = MemoryStore()
    store.set_enabled(body.enabled, conversation_id=body.conversation_id)
    return {
        "enabled": store.is_enabled(body.conversation_id),
        "scope": body.conversation_id or "global",
    }


@app.delete("/api/memory")
def forget_all_memories() -> dict[str, Any]:
    """Retire every remembered fact at once.

    Superseded rather than deleted, like the single-fact path: the row stays so
    that what AMETHYST believed, and when it stopped, remains answerable. Nothing
    recalls a superseded fact, so from the model's side this is forgetting.
    """
    from backend.memory import MemoryStore

    return {"status": "superseded", "superseded": MemoryStore().supersede_all()}


@app.delete("/api/memory/{memory_id}")
def forget_memory(memory_id: int) -> dict[str, Any]:
    """Retire a fact. It stops being recalled but the row survives, so what AMETHYST
    believed and when it stopped believing it stays answerable."""
    from backend.memory import MemoryStore

    if not MemoryStore().supersede([memory_id]):
        raise HTTPException(404, f"no live memory with id {memory_id}")
    return {"status": "superseded", "id": memory_id}


# ----------------------------------------------------------------- brand
#
# Voice, values, palette, fonts. The point of storing them is that they change
# what the model writes, so the response carries `prompt_block` -- the literal
# text the system prompt will be handed -- rather than leaving the interface to
# guess at the effect from the fields.


class BrandBody(BaseModel):
    enabled: bool = True
    name: str | None = None
    mission: str | None = None
    audience: str | None = None
    voice: str | None = None
    values: list[str] | str | None = None
    do: list[str] | str | None = None
    dont: list[str] | str | None = None
    palette: list[dict[str, str]] | None = None
    fonts: list[dict[str, str]] | None = None


def _brand_payload(brand) -> dict[str, Any]:
    from backend.brand import prompt_block

    return {**brand.as_dict(), "prompt_block": prompt_block(brand)}


@app.get("/api/brand")
def get_brand() -> dict[str, Any]:
    from backend.brand import load

    return _brand_payload(load())


@app.put("/api/brand")
def put_brand(body: BrandBody) -> dict[str, Any]:
    from backend.brand import from_payload, save

    return _brand_payload(save(from_payload(body.model_dump())))


# --------------------------------------------------------------- library
#
# What the user has read, watched and listened to. The text of a captured page
# is a real file under ~/.amethyst/library indexed by the ordinary document
# indexer, so `search_documents` finds it too -- these routes are the record
# and the capture path, not a second search stack.


class LibraryBody(BaseModel):
    url: str | None = None
    title: str | None = None
    kind: str | None = None
    category: str | None = None
    author: str | None = None
    notes: str | None = None
    text: str | None = None
    consumed_on: str | None = None
    rating: int | None = None


class LibraryPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    category: str | None = None
    author: str | None = None
    notes: str | None = None
    consumed_on: str | None = None
    rating: int | None = None
    # Correctable: what a model wrote about your own library is yours to fix.
    summary: str | None = None
    tags: list[str] | None = None
    resources: list[dict] | None = None


@app.get("/api/library")
async def list_library(
    q: str | None = None,
    kind: str | None = None,
    category: str | None = None,
    tag: str | None = None,
    order: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    from backend.library.service import LibraryService

    service = LibraryService()
    limit = max(1, min(limit, 200))
    if q and q.strip():
        items = await service.search(q, limit=limit)
        if kind:
            items = [it for it in items if it.get("kind") == kind]
        if category:
            items = [it for it in items if it.get("category") == category]
        if tag:
            items = [it for it in items if tag in (it.get("tags") or [])]
        if str(order).lower() == "asc":
            items.reverse()
    else:
        items = service.recent(
            kind=kind, category=category, tag=tag, order=order, limit=limit, offset=offset
        )
    return {
        "items": items,
        "counts": service.counts(),
        "category_counts": service.category_counts(),
        "tag_counts": service.tag_counts(),
        "query": q or "",
    }


@app.post("/api/library", status_code=201)
async def add_library_item(body: LibraryBody) -> dict[str, Any]:
    from backend.library.service import LibraryError, LibraryService

    service = LibraryService()
    try:
        if body.url and body.url.strip():
            captured = await service.capture_url(
                body.url,
                kind=body.kind,
                category=body.category,
                consumed_on=body.consumed_on,
                notes=body.notes,
                title=body.title,
            )
        else:
            captured = await service.log_manual(
                title=body.title or "",
                kind=body.kind or "note",
                category=body.category,
                text=body.text,
                author=body.author,
                notes=body.notes,
                consumed_on=body.consumed_on,
                rating=body.rating,
            )
    except LibraryError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**captured.item, "already_logged": captured.already_logged}


@app.get("/api/library/{item_id}")
def get_library_item(item_id: int) -> dict[str, Any]:
    from backend.library.service import as_dict
    from backend.library.store import LibraryStore

    row = LibraryStore().get(item_id)
    if row is None:
        raise HTTPException(404, f"no library item {item_id}")
    return as_dict(row)


@app.patch("/api/library/{item_id}")
def update_library_item(item_id: int, body: LibraryPatch) -> dict[str, Any]:
    from backend.library.service import as_dict
    from backend.library.store import KINDS, LibraryStore

    store = LibraryStore()
    if store.get(item_id) is None:
        raise HTTPException(404, f"no library item {item_id}")
    fields = body.model_dump(exclude_none=True)
    if "kind" in fields and fields["kind"] not in KINDS:
        raise HTTPException(400, f"unknown kind. One of: {', '.join(KINDS)}")
    for column in ("tags", "resources"):
        if column in fields:
            fields[column] = json.dumps(fields[column])
    store.update(item_id, **fields)
    return as_dict(store.get(item_id))


@app.delete("/api/library/{item_id}")
def delete_library_item(item_id: int) -> dict[str, Any]:
    from backend.library.service import LibraryService

    if not LibraryService().remove(item_id):
        raise HTTPException(404, f"no library item {item_id}")
    return {"status": "deleted", "id": item_id}


@app.post("/api/library/{item_id}/enrich")
async def enrich_library_item(item_id: int) -> dict[str, Any]:
    """Say what this item is about, from the text it has. The mirror of reindex."""
    from backend.library.service import LibraryError, LibraryService

    try:
        return await LibraryService().enrich(item_id)
    except LibraryError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/library/{item_id}/thumbnail")
async def library_thumbnail(item_id: int) -> FileResponse:
    """The still, by id. The browser is never handed a filesystem path."""
    from backend.library.service import LibraryService
    from backend.library.store import LibraryStore

    store = LibraryStore()
    row = store.get(item_id)
    if row is None:
        raise HTTPException(404, f"no library item {item_id}")

    if row["thumbnail_path"]:
        path = Path(row["thumbnail_path"])
        if path.is_file():
            return FileResponse(path, media_type="image/jpeg")

    # If missing or not yet downloaded, try on-demand fetch once
    if row["url"]:
        service = LibraryService(store)
        fetched = await service.fetch_thumbnail_for_item(item_id)
        if fetched:
            row = store.get(item_id)
            if row and row["thumbnail_path"]:
                path = Path(row["thumbnail_path"])
                if path.is_file():
                    return FileResponse(path, media_type="image/jpeg")

    raise HTTPException(404, "there is no thumbnail for that item")

@app.get("/api/library/{item_id}/media")
def library_media(item_id: int) -> FileResponse:
    """Stream raw media content."""
    import mimetypes

    from backend.library.store import LibraryStore

    with get_connection() as conn:
        row = LibraryStore(conn).get(item_id)
    
    if row is None or not row["media_path"]:
        raise HTTPException(404, "there is no media for that item")
        
    path = Path(row["media_path"])
    if not path.is_file():
        raise HTTPException(404, "the media is missing from disk")
        
    mime_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path, media_type=mime_type or "application/octet-stream")


@app.post("/api/library/{item_id}/reindex")
async def reindex_library_item(item_id: int) -> dict[str, Any]:
    """Index an item's text again, first forgetting a refused embedder.

    This is how someone who started Ollama after AMETHYST gets semantic search
    without restarting: the unreachable-endpoint cache is per process, and this
    is the one thing that clears it.
    """
    from backend.library.service import LibraryError, LibraryService

    try:
        return await LibraryService().reindex(item_id)
    except LibraryError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"the text could not be indexed: {exc}") from exc


@app.post("/api/library/consolidate-tags")
async def consolidate_library_tags() -> dict[str, Any]:
    from backend.library.service import LibraryService

    return LibraryService().consolidate_tags()


# ----------------------------------------------------------------- search
#
# External search endpoints for the Damon spotlight palette.
# No external API keys needed: DuckDuckGo HTML, YouTube scraping, Openverse CC,
# GitHub public API, and Wikipedia REST API.


@app.get("/api/search/web")
async def search_web_endpoint(q: str, limit: int = 8, offset: int = 0) -> dict[str, Any]:
    """One page of web results, and an honest word about where they came from.

    `offset` pages through a ranked pool built once per query, so scrolling
    appends more results without a fresh search. `has_more` tells the client
    whether another page exists, which is what stops infinite scroll from
    hammering an exhausted pool.

    `source` is here because falling back to Wikipedia silently is the worst of
    the available behaviours: the results look reasonable, so a person concludes
    the search is simply bad when it is usually the network. Saying so costs one
    field.
    """
    from backend.web.search_service import configured_search_api, search_web

    results = await search_web(q, limit=limit, offset=offset)
    # One more than this page tells us whether to offer another, without a count.
    has_more = len(await search_web(q, limit=1, offset=offset + limit)) > 0
    sources = {r.get("source") for r in results if r.get("source")}
    source = sources.pop() if len(sources) == 1 else "mixed"
    return {
        "query": q,
        "results": results,
        "offset": offset,
        "next_offset": offset + len(results),
        "has_more": has_more,
        "source": source,
        # Only asked when it matters. A search that worked needs no diagnosis.
        "search_api": configured_search_api() if source == "wikipedia" else None,
    }


@app.get("/api/search/youtube")
async def search_youtube_endpoint(q: str, limit: int = 8, offset: int = 0) -> dict[str, Any]:
    from backend.web.search_service import search_youtube
    results = await search_youtube(q, limit=limit, offset=offset)
    has_more = len(await search_youtube(q, limit=1, offset=offset + limit)) > 0
    return {
        "query": q,
        "results": results,
        "offset": offset,
        "next_offset": offset + len(results),
        "has_more": has_more,
    }


@app.get("/api/search/images")
async def search_images_endpoint(q: str, limit: int = 12) -> dict[str, Any]:
    from backend.web.search_service import search_images
    results = await search_images(q, limit=limit)
    return {"query": q, "results": results}


@app.get("/api/search/github")
async def search_github_endpoint(q: str, limit: int = 6) -> dict[str, Any]:
    from backend.web.search_service import search_github
    results = await search_github(q, limit=limit)
    return {"query": q, "results": results}


@app.get("/api/search/wiki")
async def search_wiki_endpoint(q: str) -> dict[str, Any]:
    from backend.web.search_service import search_wikipedia
    result = await search_wikipedia(q)
    return {"query": q, "result": result}


# An answer card for a question typed into the palette. The articles below it
# are the evidence; this is the sentence that answers, so the page reads
# answer-first instead of making every query a link dump.
#
# Two sources feed one model call: the web results the articles list is
# already built from, and the Wikipedia summary the universal mode already
# asks for. Nothing new is fetched, no tool loop runs, and with no model
# configured the endpoint says so and the palette shows only the articles --
# the question is not made to wait on an answer that cannot be written.
ANSWER_TIMEOUT = 20.0
ANSWER_MAX_TOKENS = 400

#: The model call is the one metered step on this path, so it is the one worth
#: answering from memory: the same question asked twice in twelve hours gets
#: the same card, and a free-tier key spends its tokens on questions the
#: palette has not already paid for. Sources are cached along with the text
#: because the article cache hands out the same list anyway.
ANSWER_TTL = 12 * 3600.0
ANSWER_CACHE_MAX = 200
_answer_cache: dict[str, tuple[float, dict[str, Any]]] = {}

_UNSET = object()

_ANSWER_PROMPT = (
    "You are answering one question from a few short web snippets. Answer in "
    "2-4 sentences, plainly, in the user's language. If the snippets disagree "
    "or do not contain the answer, say so in one sentence rather than guessing. "
    "Do not mention the snippets, do not cite, do not editorialise."
)


@app.get("/api/search/answer")
@app.post("/api/search/answer")
# `Request`, not an optional one: FastAPI injects this parameter itself and
# refuses to build a field for an optional form of it, taking the whole app down
# at import. Never optional in practice either -- the body check below is what
# distinguishes the GET from the POST, not the presence of the request.
async def search_answer_endpoint(q: str, request: Request) -> dict[str, Any]:
    import asyncio

    from backend.runtime.registry import default_chain, resolve
    from backend.runtime.types import ModelParameters
    from backend.web.search_service import search_web, search_wikipedia

    key = q.strip().lower()
    hit = _answer_cache.get(key)
    if hit and time.monotonic() - hit[0] < ANSWER_TTL:
        return hit[1]

    # The web mode already fetched the article list for the same query; the
    # answer is written from the same evidence, so it is POSTed here rather
    # than fetched a second time. One search for both, on the path where the
    # user is looking at both. A wiki the caller hands over is the same
    # deal -- and an explicit null means the caller decided there is no wiki
    # for this query, so nothing is asked of Wikipedia either.
    prefetched: list[dict] | None = None
    wiki_prefetched: Any = _UNSET
    if request.headers.get("content-type", "").startswith("application/json"):
        with contextlib.suppress(Exception):
            body = await request.json()
            if isinstance(body, dict) and isinstance(body.get("results"), list):
                prefetched = body["results"]
                if "wiki" in body:
                    wiki_prefetched = body["wiki"]

    async def _gather() -> tuple[list[dict], dict | None]:
        async def _web() -> list[dict]:
            return prefetched if prefetched else await search_web(q, limit=5)

        if wiki_prefetched is not _UNSET:
            return await _web(), wiki_prefetched or None

        web, wiki = await asyncio.gather(
            _web(), search_wikipedia(q), return_exceptions=True
        )
        if isinstance(web, BaseException):
            web = []
        if isinstance(wiki, BaseException):
            wiki = None
        return web, wiki

    results, wiki = await _gather()
    snippets = "\n\n".join(
        f"[{i + 1}] {r.get('title', '')} ({r.get('domain', '')}): {r.get('snippet', '')}"
        for i, r in enumerate(results[:5])
        if r.get("snippet") or r.get("title")
    )
    if wiki and (wiki.get("extract") or wiki.get("summary")):
        snippets += f"\n\n[6] Wikipedia: {wiki.get('extract') or wiki.get('summary')}"

    if not snippets.strip():
        return {"query": q, "answer": None, "sources": [], "error": None}

    context = f"Question: {q}\n\nSnippets:\n{snippets}"
    links = default_chain(limit=2)
    if not links:
        return {
            "query": q,
            "answer": None,
            "sources": results[:5],
            "error": "no model is configured, so there is no answer card -- the results below are the evidence.",
        }

    last_error: str | None = None
    for link in links:
        try:
            model = resolve(link.provider, link.model)
            response = await asyncio.wait_for(
                model.client.complete(
                    [
                        {"role": "system", "content": _ANSWER_PROMPT},
                        {"role": "user", "content": context},
                    ],
                    tools=None,
                    params=ModelParameters(max_tokens=ANSWER_MAX_TOKENS),
                ),
                timeout=ANSWER_TIMEOUT,
            )
            answer = (response.text or "").strip()
            if answer:
                payload = {
                    "query": q,
                    "answer": answer,
                    "sources": results[:5],
                    "provider": link.provider,
                    "model": link.model,
                    "error": None,
                }
                _answer_cache[key] = (time.monotonic(), payload)
                if len(_answer_cache) > ANSWER_CACHE_MAX:
                    oldest = min(_answer_cache.items(), key=lambda item: item[1][0])[0]
                    _answer_cache.pop(oldest, None)
                return payload
        except Exception as exc:
            last_error = str(exc)
            continue
    return {"query": q, "answer": None, "sources": results[:5], "error": last_error}



# ----------------------------------------------------------------- share
#
# One capture-only endpoint so a phone can send AMETHYST a link. See backend/share.py
# for why it is shaped the way it is, and docs/deployment.md for what has to be
# true before this is reachable from anywhere but this machine.


class ShareBody(BaseModel):
    url: str | None = None
    text: str | None = None
    kind: str | None = None
    note: str | None = None


@app.get("/api/share")
def share_status() -> dict[str, Any]:
    """Whether sharing is switched on. Never returns the token itself."""
    from backend import share

    return {"enabled": share.enabled()}


@app.post("/api/share/token")
def rotate_share_token() -> dict[str, Any]:
    """Generate a token, replacing any existing one.

    Returned once, here, and never again: after this it lives in the keychain
    and nothing reads it back out to a browser.
    """
    from backend import share

    try:
        return {"token": share.rotate(), "enabled": True}
    except Exception as exc:
        raise HTTPException(503, f"the token could not be stored: {exc}") from exc


@app.delete("/api/share/token")
def revoke_share_token() -> dict[str, Any]:
    from backend import share

    share.revoke()
    return {"enabled": False}


@app.post("/api/share/capture", status_code=201)
async def share_capture(body: ShareBody, request: Request) -> dict[str, Any]:
    """Log a URL. The only thing a share token can do."""
    from backend import share
    from backend.library.service import LibraryError, LibraryService

    if not share.enabled():
        # Not a 401: an endpoint that answers differently when it is switched
        # off is an endpoint worth probing for.
        raise HTTPException(404, "no such endpoint: /api/share/capture")
    if not share.check(share.bearer(request.headers.get("authorization"))):
        raise HTTPException(401, "that token is not the one this instance holds")

    target = (body.url or body.text or "").strip()
    if not target:
        raise HTTPException(400, "a url is required")

    try:
        captured = await LibraryService().capture_url(
            target, kind=body.kind, notes=body.note
        )
    except LibraryError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "id": captured.item["id"],
        "title": captured.item["title"],
        "already_logged": captured.already_logged,
    }


# ------------------------------------------------------------- instagram
#
# The second of exactly two paths here meant to be reachable from the internet,
# and the only one that cannot carry a bearer token -- Meta will not send one.
# Its authentication IS the HMAC signature on every delivery. See
# backend/instagram/signature.py, and docs/deployment.md for the one proxy rule
# that may ever publish it.


class InstagramCredentials(BaseModel):
    app_secret: str | None = None
    verify_token: str | None = None
    access_token: str | None = None
    #: Days until the pasted token lapses. Meta's long-lived tokens last 60.
    expires_in_days: int | None = None


class InstagramRelay(BaseModel):
    """Where the always-on receiver is, and what this machine presents to it."""

    url: str | None = None
    token: str | None = None
    enabled: bool | None = None


class InstagramPatch(BaseModel):
    enabled: bool | None = None
    cookies_from_browser: str | None = None
    owner_ig_id: str | None = None
    mentions_from: str | None = None
    keep_video: bool | None = None
    max_video_mb: int | None = None
    max_duration_seconds: int | None = None
    enrich: bool | None = None
    reply_on_save: bool | None = None


@app.get("/api/instagram/webhook", response_class=PlainTextResponse)
def instagram_handshake(request: Request) -> str:
    """Meta's one-time verification.

    The challenge is echoed as bare text. Returning it as JSON -- `"12345"`, with
    quotes -- is the single most common reason this step fails, and it fails
    with a message that does not say so.
    """
    from backend.instagram import signature

    params = request.query_params
    challenge = signature.verify_challenge(
        params.get("hub.mode"), params.get("hub.verify_token"), params.get("hub.challenge")
    )
    if challenge is None:
        raise HTTPException(403, "that verify token is not the one this instance holds")
    return challenge


@app.post("/api/instagram/webhook")
async def instagram_webhook(request: Request) -> dict[str, Any]:
    """Write the delivery down, and answer. Nothing slow happens on this path.

    Meta wants a 200 within seconds and retries anything else for hours, so the
    work -- a Graph call, a download, ffmpeg, a transcription -- belongs to the
    runner. The acknowledgement here means "written down", not "done".
    """
    from backend.config import load_instagram
    from backend.instagram import signature
    from backend.instagram.store import MAX_QUEUED, InstagramEventStore
    from backend.instagram.webhook import WebhookBody, parse

    if not signature.configured() or not load_instagram().enabled:
        raise HTTPException(404, "no such endpoint: /api/instagram/webhook")

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > signature.MAX_BODY_BYTES:
        raise HTTPException(413, "that body is larger than this endpoint accepts")

    raw = await request.body()
    if len(raw) > signature.MAX_BODY_BYTES:
        raise HTTPException(413, "that body is larger than this endpoint accepts")
    # Over the bytes that arrived, never over a re-serialised model: key order,
    # unicode escaping and float formatting all differ, so a signature computed
    # over anything else is a check that passes when it should fail.
    if not signature.verify_signature(request.headers.get("x-hub-signature-256"), raw):
        raise HTTPException(403, "that signature is not one this instance accepts")

    try:
        body = WebhookBody.model_validate_json(raw)
    except ValidationError:
        # 200 on purpose. A body Meta signed and AMETHYST cannot read is not
        # something retrying fixes, and a 4xx makes Meta retry it for hours.
        log.warning("instagram webhook: a signed body did not parse")
        return {"status": "unreadable"}

    store = InstagramEventStore()
    if store.queued_count() >= MAX_QUEUED:
        log.warning("instagram queue is full at %d; dropping a delivery", MAX_QUEUED)
        return {"status": "backlogged", "events": 0}

    queued = 0
    for inbound in parse(body):
        if signature.is_stale(inbound.received_at):
            log.warning("instagram webhook: ignoring a delivery older than the skew window")
            continue
        if store.enqueue(inbound) is not None:
            queued += 1
    if queued:
        _instagram.nudge()
    return {"status": "queued", "events": queued}


@app.get("/api/instagram")
def instagram_status() -> dict[str, Any]:
    """What is set up, what is not, and what is waiting. Never a credential."""
    from backend.config import load_instagram
    from backend.instagram import signature
    from backend.instagram.store import InstagramEventStore
    from backend.media.audio import ffmpeg_missing
    from backend.runtime.transcribe import resolve_transcriber

    settings = load_instagram()
    store = InstagramEventStore()
    transcriber = resolve_transcriber()
    expires_in = None
    if settings.token_expires_on:
        from datetime import date as _date

        try:
            expires_in = (_date.fromisoformat(settings.token_expires_on) - _date.today()).days
        except ValueError:
            expires_in = None

    return {
        "settings": settings.as_dict(),
        "credentials": signature.present(),
        "configured": signature.configured(),
        "webhook_path": "/api/instagram/webhook",
        "token_expires_in_days": expires_in,
        "counts": store.counts(),
        "unknown_senders": [dict(row) for row in store.unknown_senders()],
        "transcription": (
            {"provider": transcriber[0].name, "model": transcriber[1]} if transcriber else None
        ),
        "ffmpeg": ffmpeg_missing() is None,
        "relay": _relay_status(),
        "reels": _reel_status(),
    }


def _reel_status() -> dict[str, Any]:
    """Whether a pasted Instagram link can be opened, and what it needs.

    Separate from the API route on purpose: they answer different questions and
    can each be working while the other is not.
    """
    from backend.config import load_instagram
    from backend.media.reel import BROWSERS, yt_dlp_missing

    missing = yt_dlp_missing()
    browser = load_instagram().cookies_from_browser
    return {
        "available": missing is None,
        "reason": missing,
        "cookies_from_browser": browser,
        "browsers": list(BROWSERS),
        # Instagram serves a login wall to anonymous requests, so without a
        # browser session this route mostly returns a note instead of a reel.
        "ready": missing is None and bool(browser),
    }


def _relay_status() -> dict[str, Any]:
    """Whether capture survives this machine being off, and nothing secret."""
    from backend.config import load_instagram
    from backend.instagram import relay

    settings = load_instagram()
    return {
        "url": settings.relay_url,
        "enabled": settings.relay_enabled,
        "token": bool(relay.token()),
        "ready": settings.relay_enabled and relay.configured(),
    }


@app.put("/api/instagram/credentials")
def put_instagram_credentials(body: InstagramCredentials) -> dict[str, Any]:
    """Store the three secrets. Write-only: nothing reads them back out."""
    from datetime import date as _date
    from datetime import timedelta as _timedelta

    from backend.config import save_instagram
    from backend.instagram import signature
    from backend.secrets import CredentialError

    try:
        signature.set_credentials(
            app_secret=body.app_secret,
            verify_token=body.verify_token,
            access_token=body.access_token,
        )
    except CredentialError as exc:
        raise HTTPException(503, str(exc)) from exc

    if body.access_token and body.expires_in_days:
        save_instagram(
            {
                "token_expires_on": (
                    _date.today() + _timedelta(days=int(body.expires_in_days))
                ).isoformat()
            }
        )
    return instagram_status()


@app.delete("/api/instagram/credentials")
def delete_instagram_credentials() -> dict[str, Any]:
    from backend.config import save_instagram
    from backend.instagram import signature

    signature.revoke()
    save_instagram({"enabled": False, "token_expires_on": ""})
    return instagram_status()


@app.patch("/api/instagram/settings")
def patch_instagram_settings(body: InstagramPatch) -> dict[str, Any]:
    from backend.config import MENTION_SOURCES, save_instagram
    from backend.instagram import signature

    patch = body.model_dump(exclude_none=True)
    if "cookies_from_browser" in patch:
        from backend.media.reel import BROWSERS

        value = (patch["cookies_from_browser"] or "").strip().lower()
        if value and value not in BROWSERS:
            raise HTTPException(400, f"browser must be one of: {', '.join(BROWSERS)}")
        patch["cookies_from_browser"] = value
    if "mentions_from" in patch and patch["mentions_from"] not in MENTION_SOURCES:
        raise HTTPException(400, f"mentions_from must be one of: {', '.join(MENTION_SOURCES)}")
    if patch.get("enabled") and not signature.configured():
        raise HTTPException(
            400, "the app secret, verify token and access token all have to be set first"
        )
    save_instagram(patch)
    return instagram_status()


@app.put("/api/instagram/relay")
def put_instagram_relay(body: InstagramRelay) -> dict[str, Any]:
    """Point this machine at its relay. The token goes to the keychain, not here.

    Switching the relay on does not change what the local webhook accepts. Both
    paths reach the same queue and dedupe against the same UNIQUE key, so running
    both during a changeover saves nothing twice.
    """
    from backend.config import load_instagram, save_instagram
    from backend.instagram import relay
    from backend.secrets import CredentialError

    patch: dict[str, Any] = {}
    if body.url is not None:
        url = body.url.strip().rstrip("/")
        if url and not url.startswith("https://"):
            # It carries the access token in both directions. Plain HTTP is not a
            # setting to be talked out of.
            raise HTTPException(400, "the relay URL has to be https")
        patch["relay_url"] = url
    if body.token:
        try:
            relay.set_token(body.token)
        except CredentialError as exc:
            raise HTTPException(503, str(exc)) from exc
    if body.enabled is not None:
        patch["relay_enabled"] = body.enabled
    if patch.get("relay_enabled") and not (
        patch.get("relay_url", load_instagram().relay_url) and relay.token()
    ):
        raise HTTPException(400, "the relay needs both a URL and a token before it can be used")
    if patch:
        save_instagram(patch)
    return instagram_status()


@app.delete("/api/instagram/relay")
def delete_instagram_relay() -> dict[str, Any]:
    from backend.config import save_instagram
    from backend.instagram import relay

    relay.clear_token()
    save_instagram({"relay_url": "", "relay_enabled": False})
    return instagram_status()


@app.post("/api/instagram/relay/sync")
async def sync_instagram_relay() -> dict[str, Any]:
    """Go and look now, rather than at the next fifteen-second poll."""
    result = await _instagram.sync_relay()
    _instagram.nudge()
    return result


@app.post("/api/instagram/senders/{igsid}")
def allow_instagram_sender(igsid: str) -> dict[str, Any]:
    from backend.config import allow_sender

    allow_sender(igsid, allowed=True)
    return instagram_status()


@app.delete("/api/instagram/senders/{igsid}")
def disallow_instagram_sender(igsid: str) -> dict[str, Any]:
    from backend.config import allow_sender

    allow_sender(igsid, allowed=False)
    return instagram_status()


@app.get("/api/instagram/events")
def list_instagram_events(limit: int = 50) -> list[dict[str, Any]]:
    from backend.instagram.store import InstagramEventStore

    rows = InstagramEventStore().recent(limit=max(1, min(limit, 200)))
    # The payload is kept for reprocessing and is not something to hand a
    # browser: it carries whatever Instagram sent, verbatim.
    return [{k: v for k, v in dict(row).items() if k != "payload"} for row in rows]


@app.post("/api/instagram/events/{event_id}/retry")
def retry_instagram_event(event_id: int) -> dict[str, Any]:
    from backend.instagram.store import InstagramEventStore

    if not InstagramEventStore().requeue(event_id):
        raise HTTPException(404, f"no instagram event {event_id}")
    _instagram.nudge()
    return {"status": "queued", "id": event_id}


# --------------------------------------------------------------- browser
#
# Reading the browser's own bookmarks and history, off until switched on. See
# backend/browser/places.py for why the database is copied before it is read.


@app.get("/api/browser")
def browser_status() -> dict[str, Any]:
    """Settings, plus what is actually in the profile -- measured, not claimed."""
    from backend.browser.places import PlacesError, counts, find_profile
    from backend.config import load_browser

    settings = load_browser()
    payload: dict[str, Any] = {
        "settings": settings.as_dict(),
        "profile": None,
        "counts": None,
        "problem": None,
        "last_sync": None,
    }
    try:
        profile = find_profile(settings.profile_dir or None)
        payload["profile"] = str(profile)
        payload["counts"] = counts(profile)
    except PlacesError as exc:
        # A machine with no Firefox-family browser is an ordinary state, not a
        # failure: the page should say so rather than show an error banner.
        payload["problem"] = str(exc)

    if _browser.last is not None:
        payload["last_sync"] = {
            "summary": _browser.last.summary(),
            "captured": _browser.last.captured,
            "failed": _browser.last.failed,
        }
    return payload


@app.patch("/api/browser")
def update_browser(patch: dict[str, Any]) -> dict[str, Any]:
    from backend.config import save_browser

    saved = save_browser(patch)
    if saved.enabled:
        # Switching it on should do something visible now, not in five minutes.
        _browser.nudge()
    return saved.as_dict()


@app.post("/api/browser/sync")
async def sync_bookmarks() -> dict[str, Any]:
    """Capture new bookmarks now. The button behind "I just bookmarked that"."""
    from backend.browser.service import BookmarkIngest
    from backend.config import load_browser

    if not load_browser().enabled:
        raise HTTPException(400, "browser capture is switched off")

    report = await BookmarkIngest().sync()
    _browser.last = report
    return {
        "summary": report.summary(),
        "seen": report.seen,
        "captured": report.captured,
        "already": report.already,
        "enriched": report.enriched,
        "failed": report.failed,
        "unavailable": report.unavailable,
    }


# --------------------------------------------------------------- journal
#
# The morning briefing and the daily and weekly reviews. Signals are gathered in
# Python and the model only writes prose over them (backend/journal/service.py),
# so an entry always exists with real figures even when nothing can write it up.


class JournalAnswer(BaseModel):
    user_notes: str


@app.get("/api/journal")
def list_journal(kind: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
    from backend.journal.service import JournalError, JournalService

    try:
        return JournalService().recent(kind=kind, limit=max(1, min(limit, 200)))
    except JournalError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/journal/{entry_id}")
def get_journal_entry(entry_id: int) -> dict[str, Any]:
    from backend.journal.service import entry_as_dict
    from backend.journal.store import JournalStore

    row = JournalStore().get(entry_id)
    if row is None:
        raise HTTPException(404, f"no journal entry {entry_id}")
    return entry_as_dict(row)


@app.post("/api/journal/{kind}/generate")
async def generate_journal_entry(
    kind: str, entry_date: str | None = None, force: bool = False
) -> dict[str, Any]:
    from datetime import date as _date

    from backend.journal.service import JournalError, JournalService

    try:
        day = _date.fromisoformat(entry_date) if entry_date else _date.today()
    except ValueError as exc:
        raise HTTPException(400, "entry_date must be YYYY-MM-DD") from exc
    try:
        return await JournalService().generate(kind, day, force=force)
    except JournalError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/journal/{entry_id}")
async def answer_journal_entry(entry_id: int, body: JournalAnswer) -> dict[str, Any]:
    """Store the check-in answers, then write the review from them."""
    from backend.journal.service import JournalError, JournalService

    try:
        return await JournalService().answer(entry_id, body.user_notes)
    except JournalError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: int) -> dict[str, Any]:
    from backend.journal.store import JournalStore

    if not JournalStore().delete(entry_id):
        raise HTTPException(404, f"no journal entry {entry_id}")
    return {"status": "deleted", "id": entry_id}


# ------------------------------------------------------------------ today
#
# One read for the whole page: the day's events, what is owed, what is unread,
# what has been logged, and this morning's briefing.
#
# Deliberately does not touch /api/health or availability.survey(): the store
# already polls health every eight seconds and every view has it, and probing
# every provider over the network is not what opening a dashboard should cost.


@app.get("/api/today")
async def today() -> dict[str, Any]:
    from datetime import date as _date

    from backend.journal.service import JournalService
    from backend.journal.signals import gather

    signals = await gather(_date.today())
    journal = JournalService().today()
    return {
        "date": signals.entry_date,
        "signals": signals.to_json(),
        "briefing": journal["briefing"],
        "review": journal["review"],
        "weekly": journal["weekly"],
        "questions": journal["questions"],
        # Which sections could not be read, and why. The interface says so
        # rather than showing a zero it did not measure.
        "degraded": signals.degraded,
    }


# ------------------------------------------------------------------- the app

# In development the interface is served by Vite on another port and reaches
# this API across origins. A built bundle is different: `npm run build` writes
# frontend/dist, and if that exists it is served from here, so one `uvicorn`
# process is the whole product and there is no second server to run, no second
# port to remember, and no cross-origin request to configure.
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _mount_frontend() -> None:
    if not (_DIST / "index.html").is_file():
        return

    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    # Hashed filenames, so the bundle can be cached hard; index.html must not be
    # or a deploy would keep serving the previous build's script tags.
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        """Every non-API path is the single page.

        Registered last, so it cannot shadow a real endpoint: FastAPI matches in
        declaration order and every `/api/...` route is already above it. An
        unknown `/api/...` path still has to 404 rather than quietly returning
        HTML, or a typo in a fetch would look like a parse error instead.
        """
        if path.startswith("api/"):
            raise HTTPException(404, f"no such endpoint: /{path}")
        candidate = (_DIST / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(_DIST):
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html", headers={"Cache-Control": "no-store"})


_mount_frontend()
