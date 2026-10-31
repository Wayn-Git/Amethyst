# Background Jobs and Schedules

What runs without a request: the lifespan runners, durable jobs, lanes, leases,
retries, crash recovery and the replay guard.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [sections/automations.md](../sections/automations.md),
[DATABASE.md](../DATABASE.md), [AGENT-SYSTEM.md](../AGENT-SYSTEM.md),
[sections/status.md](../sections/status.md).

## Two layers

AMETHYST has two kinds of background work, and they are not the same mechanism.

| Layer | Lives in | Use |
|---|---|---|
| **Runners** | `backend/api/main.py` lifespan | Long-lived loops with their own cadence |
| **Durable jobs** | `backend/jobs/` | Work that must survive a crash and must not repeat a tool call |

A runner can enqueue a job. A job never owns a runner. The split exists because
an automation turn takes minutes, while a reminder scan is one indexed read.
Putting both on one loop makes the reminder arrive whenever the turn finishes.

## Lifespan runners

Started in `backend/api/main.py` after migrations and crash recovery:

| Runner | Module | Cadence / role |
|---|---|---|
| Automations | `backend/automation.py` | Decides what is due; enqueues `automation` jobs |
| Reminders | `backend/reminders.py` | `TICK_SECONDS = 10`; fires due reminders, connector task sync, audit pruning |
| Journal | `backend/journal/runner.py` | Morning briefing and evening review |
| Instagram | `backend/instagram/runner.py` | Drain queue, relay poll, token refresh, pruning |
| Browser | `backend/browser/runner.py` | No-op until the browser capability is enabled |
| Library | `backend/library/runner.py` | `SWEEP_INTERVAL_SECONDS = 30`; enriches and synthesizes items |
| Connector boot | inline `_start_connectors` | Builds the MCP manager and starts enabled connectors off the request path |
| Stale subagent cleanup | inline `_stale_subagent_cleanup_loop` | Every 60s; fails subagents idle over 1200s |

The root `README.md` still says five runners. The code starts the eight above.
Trust the code.

Order matters:

- Automations start before their lane, so a tick always has somewhere to put a
  job.
- Lanes start before the runners that feed them.
- Shutdown reverses it: library, browser, Instagram, journal, reminders,
  automation scheduler, then the three job lanes.
- A job in flight on shutdown is cancelled and returned to the board with its
  step ledger intact.

## Durable job model

`backend/jobs/state.py` defines the contract.

States:

```text
queued -> running -> completed
                  -> waiting -> queued | running | paused | cancelled | failed
                  -> paused  -> queued | waiting | cancelled
completed / failed / cancelled  (terminal; failed and cancelled may be requeued by a person)
```

- `TERMINAL = {completed, failed, cancelled}`.
- `RUNNABLE = {queued}`. A `waiting` job is promoted to `queued` when its
  deadline passes.
- `waiting` with no deadline means blocked on a person; nothing promotes it.
- `paused` is a person's stop, not a failure.

Backoff:

- `BACKOFF_BASE_SECONDS = 15`.
- `BACKOFF_CAP_SECONDS = 3600`.
- `BACKOFF_JITTER = 0.25` (up to +25%).
- `LEASE_SECONDS = 120` by default; long-running handlers override it.

The lease is a claim with a heartbeat. A process that dies stops renewing, and
the job is reclaimed after the lease lapses rather than at the next restart.

## Job kinds

Registered in code:

| Kind | Registered in | Attempts | Crash replay |
|---|---|---|---|
| `automation` | `backend/api/main.py` | 2 | Guarded; model chooses tools |
| `remote_turn` | `backend/api/main.py` | 2 | Guarded; model chooses tools |
| `worker_batch` | `backend/api/main.py` | 1 | Safe; every dispatch is a recorded step |
| `mobile_capture` | `backend/remote/captures.py` | 3 | Safe; library capture is replayable |
| `instagram_ingest` | `backend/instagram/runner.py` | handler default | Uses `begin`, not a lane claim |

`instagram_ingest` is the exception: the Instagram runner already claims
deliveries from `instagram_events`, so it uses `JobStore.begin()` for the step
ledger rather than competing for a lane claim.

## Lanes

`backend/jobs/runner.py` defines `JobRunner`: one loop, one job at a time,
claiming only its registered kinds.

| Lane | Kinds | Why separate |
|---|---|---|
| `automations` | `automation`, `remote_turn` | Both run a turn and take minutes |
| `mobile-captures` | `mobile_capture` | Phone captures should not wait behind a model turn |
| `workers` | `worker_batch` | A batch is often enqueued *by* an automation; one lane would deadlock |

`TICK_SECONDS = 2.0`. `nudge()` wakes a lane immediately after an enqueue, so
the tick is a floor for work that arrives without a nudge, not the latency of a
button.

Within a lane, work is serial. That is deliberate: one person does not benefit
from three unattended turns competing for the same machine.

## Idempotency

Every job has an `idempotency_key` chosen from the fact it is about, never at
random.

Examples:

- Automation: `automation:<id>:<scheduled slot>`.
- Manual automation run: `automation:<id>:manual:<timestamp>`.
- Remote turn: `remote_turn:<intent id>`.
- Mobile capture: `mobile:<device>:<capture uuid>`.

`jobs.idempotency_key` is UNIQUE. Pressing Run twice, a re-delivered webhook or
a page reload all return the existing job. A finished job is not reopened.

Inside a job, `JobStore.step(job, key, ...)` records each externally visible
operation and returns the recorded answer on replay. The row is written after
the operation returns, so a crash mid-step leaves no row and that step runs
again. This is at-least-once for the step and exactly-once for everything after
it.

## Crash recovery

On boot, before any runner starts:

1. `AgentRunRepository().interrupt_live()` closes turns a dead process left in a
   live phase.
2. Open tool calls for those conversations are closed.
3. `JobStore.recover_orphans()` returns leased jobs to the board.
4. For each recovered job, `replayable_after_crash(job, store)` decides whether
   it may run automatically.
5. `JobStore.prune()` keeps the newest `KEEP = 1000` terminal rows.

`replayable_after_crash` says yes when:

- the handler declares `auto_retry_after_crash=True`, or
- the job never started / made no tool calls, or
- every audited tool call for its conversation has `risk_level = low`.

It says no when the dead attempt ran a write, send, delete or shell command. The
job is blocked with a readable reason and waits for a person. An unreadable
audit table is treated as "no".

The check reads `execution_logs`, not the model's account of itself.

## Runner responsibilities

### Automations

`AutomationRunner` (`backend/automation.py`) owns the schedule. It computes
`next_run_at`, enqueues one job per due slot, and does not run turns itself.
`run_once` is shared by the scheduler and "Run now", so both paths behave the
same.

An unattended turn uses `UnattendedGate`: it refuses an interactive confirmation
rather than waiting for a person who is not there.

### Reminders

`ReminderRunner` wakes every 10 seconds and calls `fire_due()`. It also owns
connector task sync and periodic audit-log pruning, but runs the sync as a
tracked background task so a slow Graph call cannot delay reminder delivery.

### Journal

`JournalRunner` files the morning briefing and evening review at the configured
hours. It sleeps before its first check, so starting the process does not
immediately file an entry.

### Instagram

`InstagramRunner` waits on an event with a timeout rather than a fixed sleep.
The nudge is what acknowledges and drains a delivery before Meta's asset URLs
expire. The timeout is what makes a queue left by a crash recoverable.

### Library

`LibraryRunner` sweeps unsummarized items, enriches them and nudges the UI. It
starts after a two-second boot delay and can be woken by `nudge()`.

### Browser

`BrowserRunner` is a no-op until the browser capability is switched on. It
exists so enabling the capability does not require a restart.

### Connectors

The boot task imports the MCP manager in a thread, then reconciles enabled
connectors with a deadline. It is not awaited, so `/api/ping` answers while
stdio servers start. Until it finishes, connectors read `starting`.

## API surface

`backend/api/main.py` exposes job inspection and control under `/api/jobs`:

- list and filter jobs,
- pause, resume, cancel, retry,
- inspect steps and result,
- registered kinds and lane names.

The exact routes are in the file; they are thin wrappers over `JobStore`.

## Modification guide

| Change | Touch |
|---|---|
| Add a durable job kind | `jobs.register(Handler(...))`, a lane, an idempotency key, a handler |
| Add a runner | lifespan start/stop, its own module, status surface |
| Change retry policy | `Handler.backoff_base/cap/max_attempts`, `jobs/state.py` |
| Change crash policy | `auto_retry_after_crash`, `replayable_after_crash` |
| Change lane assignment | `JobRunner([...])` in `backend/api/main.py` |
| Change job retention | `KEEP` in `backend/jobs/store.py` |
| Change scheduling | `backend/automation.py`, `backend/journal/runner.py` |

Rules:

- Choose the idempotency key from the fact, not a random value.
- Wrap every outward write in `JobStore.step`.
- Do not set `auto_retry_after_crash=True` for a handler that lets a model choose
  tool calls.
- Give a long handler a lease longer than its worst case.
- Never run two lanes that can wait on each other.
- Keep one uvicorn worker. Leases assume one process, and the API already
  requires it.

## Known issues

- Background work runs only while the API process is up. That is a stated
  product rule, not a bug.
- A job blocked on a person stays `waiting` forever until resumed or cancelled.
- `jobs` rows are pruned by count, not age; a burst of terminal jobs can remove
  older history.
- The automation scheduler and the reminder runner both touch Microsoft To Do
  sync; the split is intentional but easy to misread.
- The relay has its own durable job layer (`relay/src/jobs/`) for work a closed
  laptop cannot do. It is a separate implementation with the same vocabulary.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
