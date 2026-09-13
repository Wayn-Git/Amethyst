# Durable jobs

## The question this document answers

Some work has nobody watching it. An automation runs for minutes against a
provider that may be having a bad minute; an Instagram reel arrives while the
laptop is shut. Both used to be a Python coroutine and nothing else, so a crash
took the work with no record that it had started — and the retry repeated every
outward call the first attempt had already made.

This is the layer that fixes that, and the list of what is deliberately not on
it.

## What is a job, and what is not

**An interactive conversation turn is not a job.** It is fast, a person is
watching it arrive, and [`agent_runs`](data-model.md) already records what it
did. Putting it on a queue would cost a round trip through SQLite for something
nobody would see the benefit of, and would move the answer further from the
person waiting for it. `AgentState` stays authoritative for interactive work.

What is on it, and why:

| Workload | Durable? | Why |
|---|---|---|
| Conversation turn | no | interactive; `agent_runs` records it; must stay fast |
| Automation run | **yes** | minutes long, unattended; a crash re-ran every tool call the first attempt had made |
| Instagram ingest | **yes** | minutes of download, ffmpeg and transcription; a crash re-sent the confirmation and skipped the transcript |
| Microsoft To Do sync | no | already idempotent on `(source, external_id)` plus an etag — a re-run converges, so a job buys nothing |
| Journal, reminders, bookmark watcher | no | seconds, idempotent per day or per row, no outward writes worth a ledger |
| The Instagram ack while the laptop is away | **yes, remotely** | a 24-hour deadline a closed laptop cannot meet — see [instagram.md](instagram.md) and `relay/src/jobs/` |

The rule behind the table: a job is worth its cost when the work is long enough
to be interrupted **and** has an effect that repeating would be wrong.

## States

`queued · running · waiting · paused · completed · failed · cancelled`

Every legal move is written out in `TRANSITIONS` (`backend/jobs/state.py`);
`Job.enter` refuses anything else.

- **`waiting`** is two things that look the same and are not. A job backing off
  after a transient failure has a `next_attempt_at`, and the lane promotes it
  when that passes. A job blocked on a person — a permission it was never
  granted, a crash whose repeat might change something — has no deadline, and
  nothing promotes it. `blocked_on` says which, in a sentence.
- **`failed`** is terminal. A job that has spent its attempts needs a decision,
  not another automatic try. The one move out of a terminal state is a person
  asking for another attempt, and a *completed* job has no move out at all:
  asking again for work that is done is a question, not an instruction.

## The step ledger

The whole of the idempotency guarantee, and deliberately the same mechanism
Cloudflare Workflows uses, so the local and remote halves of durable execution
are one idea in two places rather than two ideas.

```python
await store.step(job, "reply:saved", lambda: self._maybe_reply(sender, title))
```

On the first attempt the call runs and its answer is written to `job_steps`. On
every later attempt the written answer is returned and the call does not run.
Retrying therefore re-enters the handler from the top and *replays* the parts
that already happened rather than repeating them.

**The row is written after the call returns.** A crash in the middle leaves no
row and the step runs again: at-least-once for the step in flight, exactly-once
for every step before it. Writing first would turn a crash into work that is
silently never done, and a reply that was never attempted is harder to notice
than one sent twice.

**Not everything belongs in a step.** `_resolve` in the Instagram pipeline is a
read, and Instagram's asset URLs expire in about a week — a recorded one would
be handed to a download now guaranteed to fail, which is the opposite of what
replaying is for. The rule is: wrap what is expensive or externally visible,
not what is cheap and safe to repeat.

## Never repeating a tool call that was not safe

A handler that wraps every outward call in a step can promise a replay is a
no-op and says so with `auto_retry_after_crash=True`. **A handler that runs an
agent turn cannot**: the model chooses the tool calls, so what a dead attempt
did is not knowable in advance.

`backend.jobs.replayable_after_crash` answers it after the fact instead, and
asks the audit table rather than the model:

1. The kind says it is safe → safe.
2. Nothing has happened yet (no conversation was even opened) → safe.
3. Otherwise read `execution_logs` for that conversation. Every call the
   permission gate let through is there with the risk level it *resolved* to.
   All read-only → safe to repeat. Anything above `low` → the job waits for a
   person, naming the tools, because repeating a write, a send or a shell
   command is not a decision a boot sequence gets to make.

This is also why `retry` keeps the step ledger by default. Only a person can
tell a message that should be re-sent from one that must not, so only a person
clears it (`reset_steps`).

## Lanes

One loop per kind rather than one queue for everything, because the reasons the
existing runners are separate have not changed: `backend/instagram/runner.py`
says its work is minutes long and that queueing a reminder behind it would make
neither arrive when it should. A single job loop would put a reel ingest behind
a three-minute automation and undo that.

A lane runs one job at a time, which is the rule `AutomationRunner` already
stated: three unattended turns reaching for the same machine at once is not
something a single user gains from.

`AutomationRunner` is still the scheduler — deciding what is *due* is a schedule
question and takes milliseconds. It enqueues; the lane runs.

The Instagram drain is its own lane already and keeps its own claim:
`instagram_events` is where Meta's re-deliveries collide, and moving that claim
into `jobs` would leave two tables disagreeing about one reel. It uses
`JobStore.begin`, which is the same durable record for a caller that is its own
lane.

## Collecting what the relay finished

The relay runs the half whose deadline a closed laptop cannot meet, and its
result is not finished work until it is *here*. `RelayPoller._collect_jobs`
(`backend/instagram/relay.py`) is that last step, on the same fifteen-second
poll that collects deliveries:

- `/sync` answers with `jobs.ready` — every job the relay has completed or given
  up on — and `jobs.pending`, which is what is still in flight, so a machine that
  has been off for a day can tell a quiet relay from one halfway through five
  downloads.
- Each ready job goes to the library through `capture_url`, the same door every
  other capture uses. A `failed` job is logged and acknowledged rather than
  retried: the relay spent its attempts, and a fetch that failed there fails here
  for the same reason. `instagram_ack` has nothing to bring home — the receipt
  *was* the work.
- The id goes on `_pending_job_ack` and is confirmed on the **next** sync, which
  is what `ackJobs` treats as permission to delete the row and its staged bytes.
  The same discipline deliveries already followed, for the same reason: a job
  acknowledged before its result is applied is one a sync that died halfway
  would throw away. Acknowledging one twice is a no-op.
- A capture that raises something unexpected holds the job instead of
  acknowledging it, so the next poll is offered it again. A kind this machine
  does not know — a relay deployed ahead of it — is acknowledged, because a row
  nothing here can ever apply must not be re-offered forever.

What it deliberately does not do yet is collect **staged bytes**. R2 is
commented out in `relay/wrangler.jsonc` (it is the one Cloudflare product that
wants a card), so `document_fetch` and `media_fetch` report `staged: false` on
every deployment that has not turned it on, and the machine refetches the URL
with its own pipeline — which is what the relay's own comment says will happen.
`GET /jobs/{id}/artifact/{key}` is written and waiting on the relay side for
when that changes.

## Crashes

Two mechanisms, for two different deaths:

- **A lapsed lease** (`reclaim_expired`). A lane that stopped answering for
  longer than its lease is gone; the job goes back on the board, or to `failed`
  if its attempts are spent.
- **The boot sweep** (`recover_orphans`, from `_lifespan`). One uvicorn worker
  is a non-negotiable, so a job still holding a lease when the process starts
  cannot be one somebody else is driving. It does not wait for the lease, because
  the lease was granted by a process that no longer exists.

Both run the replay guard above before anything is repeated.

## Identity, and why the interface reconnects

`jobs.idempotency_key` is chosen from the fact the job is about — an automation
and the minute it came due, a delivery and its key — never randomly. Pressing
Run twice, a scheduler tick that overlapped a long run, a page reloaded mid-run
and a webhook Meta re-delivered all arrive with the same key, and all get the
job that already exists.

`POST /api/automations/{id}/run` answers with a job rather than a result. It
used to await the whole run — up to three minutes with the browser holding an
open request, which a proxy times out and a person reads as a failure while the
run carries on unseen.

`GET /api/automations/{id}/job` is what a page asks on open, so a reload
reconnects to a run rather than offering to start a second one.

## What this does not do

- **It does not resume a turn from the middle.** A turn is not resumable and the
  loop that owns it says so ([ai-runtime.md](ai-runtime.md)). What a job adds is
  that the attempt is recorded before it starts and that the decision to repeat
  it is made against evidence.
- **It does not run an agent in the cloud.** Processing stays on the machine:
  no free platform has a persistent disk, and ADR-0004 makes the filesystem the
  source of truth. Only deadline-bound outward sends move, and only to the relay
  that already existed.
- **It does not bypass the permission gate.** A job runs a turn through the same
  `ConfirmationService` with the same unattended gate; a refusal is still
  recorded as `blocked` and still names the operations to approve.
