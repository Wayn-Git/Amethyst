# ADR-0022: Durable jobs for unattended work, and not for turns

## Status

Proposed

## Context

Two workloads in AMETHYST run with nobody watching, and both were a Python
coroutine and nothing else.

**An automation run.** `run_once` marked the row `running`, opened a
conversation, and drove the agent loop for up to three minutes. A crash left
`last_status = 'running'` lying on the row and `next_run_at` unmoved, so the
scheduler ran the whole thing again on the next tick — repeating every tool call
the dead attempt had already made, with nothing anywhere recording that it had
made them. There was no bounded retry for a provider having a bad minute: a 503
pushed the next attempt out by a whole interval, which for a daily automation is
a day.

**An Instagram ingest.** `instagram_events` was already most of a durable queue —
explicit statuses, an attempts counter, a lease via `reclaim_stale`, and
`delivery_key` as an idempotency key against Meta's re-deliveries. What it did
not have was any notion of progress *inside* one delivery, and the pipeline is
minutes long: resolve, capture, thumbnail, download, ffmpeg, transcribe, enrich,
reply. Two defects followed directly:

- `_maybe_reply` ran before `store.finish`, so an event reclaimed after a crash
  in that gap sent "Saved: …" to the sender a second time.
- A crash during transcription left the library row already written, so the
  retry took the `already_logged` path, reported "already in the library", and
  never came back for the audio. Partial work was mistaken for complete work.

**And one deadline the machine cannot meet at all.** The relay's ack — "Got it,
I'll save this once your machine is running" — was `ctx.waitUntil(sendAck(...))`:
a single fetch inside the request handler, with a `catch` that logged and moved
on. A Graph 500 or a rate limit lost it silently, inside a 24-hour window that
cannot be reopened.

## Decision

A `jobs` table, a `job_steps` ledger, and one lane per kind
(`backend/jobs/`). Automation runs and Instagram ingests move onto it. The
relay's ack becomes a Cloudflare Workflow.

**An interactive turn is deliberately not a job.** It is fast, a person is
watching it arrive, and `agent_runs` (ADR-0021) already records what it did.
`AgentState` stays authoritative for interactive work; a queue between the
composer and the loop would cost a round trip for something nobody would see the
benefit of. The rule for what belongs here is that the work must be long enough
to be interrupted *and* have an effect that repeating would be wrong — which is
also why the Microsoft To Do sync stays where it is: it is already idempotent on
`(source, external_id)` plus an etag, so a re-run converges and a job buys
nothing.

**Seven states, with every legal move written out.** `queued · running ·
waiting · paused · completed · failed · cancelled`. `waiting` carries two cases
that must not be confused: backing off (has a deadline, the lane promotes it)
and blocked on a person (has none, nothing promotes it).

**The step ledger is the idempotency guarantee**, and is deliberately the same
mechanism Cloudflare Workflows uses, so the local and remote halves are one idea
in two places. A handler wraps each expensive or externally visible call in
`store.step(job, key, ...)`; a retry re-enters the handler from the top and
every finished step returns its recorded answer instead of calling out again.
The row is written *after* the call returns, so a crash mid-step leaves no row
and the step runs again: at-least-once for the step in flight, exactly-once for
every step before it. The other order would turn a crash into work silently
never done, and a reply that was never attempted is harder to notice than one
sent twice.

**A retry that might repeat a tool call is checked against the audit trail.** A
handler that wraps every outward call can promise a replay is a no-op and says
so. A handler that runs an agent turn cannot — the model chooses the calls — so
`replayable_after_crash` reads `execution_logs` for that conversation, where the
permission gate recorded the risk level it resolved to. All read-only: safe to
repeat. Anything above `low`: the job waits for a person, naming the tools.
For the same reason, `retry` keeps the step ledger unless a person explicitly
clears it.

**The interface reconnects rather than creates.** The idempotency key is chosen
from the fact the job is about, so a second press, an overlapping tick, a reload
and a re-delivery all get the job that exists. `POST
/api/automations/{id}/run` now answers with a job instead of awaiting the run.

**Only deadline-bound outward sends move to the cloud.** Processing stays on the
machine: no free platform has a persistent disk and ADR-0004 makes the
filesystem the source of truth for text. The relay's README already says
"capture moves here; processing does not", and that line is unchanged.

## Consequences

A run that is interrupted leaves a row saying so, keeps what it finished, and is
either picked up or held for a decision — rather than silently repeating itself.
A reel captured while the laptop was asleep gets exactly one confirmation. A
person can see, pause, cancel and retry background work that previously had no
representation at all.

The costs are real and bounded: one row per unit of background work (pruned to
the newest 1000 finished), a small write per step, and a second concept beside
`AgentState` that a reader has to hold. The second concept is the price of the
first sentence of this section.

Two things this explicitly does **not** buy:

- **A turn is still not resumable from the middle.** The loop that owns a turn
  says so, and nothing here changes it. What a job adds is that the attempt is
  recorded before it starts and that repeating it is a decision made against
  evidence.
- **Automations still do not run with AMETHYST closed.** The rule stays
  "automations run while AMETHYST is open", because the thing that settles it is
  unchanged: nothing can answer a permission prompt at 3am.

## Alternatives considered

**One queue for everything.** Rejected: it would put a reel ingest behind a
three-minute automation, undoing the reason `backend/instagram/runner.py` is a
separate runner in the first place. Lanes keep the existing separation and its
stated rationale.

**Moving `instagram_events` into `jobs`.** Rejected: that table is where Meta's
re-deliveries collide, and two tables claiming the same reel is worse than one
table with a ledger beside it. `JobStore.begin` exists for a caller that is
already its own lane.

**Running automations in Cloudflare Workflows.** Rejected: the agent loop needs
the local filesystem, the local database, the keychain and the permission gate.
Running it in the cloud would mean running a different agent, which is the thing
this codebase is organised around not doing.

**Replaying a crashed turn's tool calls from the transcript.** Rejected as
unsound: the transcript records what was *asked for*, not what completed, and a
write that half-happened is indistinguishable there from one that did not start.
The audit table plus a person is the honest answer.
