# ADR-0021: Agent run state — one row per turn, and it holds references

## Status

Proposed

## Context

A turn's execution state did not exist anywhere durable. It lived as local
variables on the stack of `Director._run`: `carried`, `resumes`,
`continuations`, `active`, `budget`, `iteration`, `tool_calls_made`,
`call_fingerprints`, `step_open`, `seen_message_id`, `nudge`, and four warning
latches. Around it, three process-memory dicts held the rest — `_active_turns`
(conversation id to a cancel event), `_pending` (approval id to a future), and
`questions._waiting` (ask id to a future).

The process was therefore the state, with four consequences that were all live:

- **A kill took everything.** And because a kill skips the `finally` in
  `Director.run`, it also skipped `close_open_tool_calls` — the repair recorded
  in that function's docstring, where one unanswered tool call from a 2026-09-09
  turn left the conversation drawing `400`s from groq and cloudflare and an empty
  answer from nvidia, forever.
- **The interface was the source of truth for resumability.** `resumable`
  arrived on the terminal `error` frame and lived in `Chat.jsx` component state.
  A reload cleared it, and nothing on disk said a turn had been interrupted
  rather than answered.
- **Transitions were implicit.** `STATUSES` is a display vocabulary the loop
  streams and never reads back. Nothing said a finished turn could not start
  running again; nothing could have caught it if one did.
- **A suspended turn was invisible.** A turn waiting on the permission gate is a
  future held by a suspended dispatch task. Restart, and there was no way to tell
  it from a turn that had been waiting on a model.

## Decision

One `agent_runs` row per turn, written through `AgentState`
(`backend/agent/state.py`), which is the single owner of what a turn knows.

**The loop keeps its shape.** `AgentState` is a refactor of the locals that were
already there, not a second architecture: `_run` reads and writes `state.resumes`,
`state.active`, `state.carried` where it used to read and write bare names.
Everything derivable stays a local — the wire history, the resolved model, the
attempt budget, the per-attempt `streamed_text`, `time.monotonic()`.

**Phases are explicit and closed.** Ten of them, with every legal move written
out in `TRANSITIONS`; `AgentState.enter` refuses anything else. They are a
different vocabulary from `STATUSES`, because three `STATUSES` names describe
something that is already a counter on the state — a phase for each would be one
fact stored twice.

**The row holds references.** The request, the plan, the tool calls and their
results are row ids in `messages`; retrieved context is a `memories.id` or a
`document_chunks.id` with its label. The only content stored outright is the
half-written answer, which has no other durable home until the turn gives up.
The repeated-call guard keys on a digest of a call's arguments rather than the
arguments, because the audit path redacts before writing and nothing redacts
this row.

**Checkpointing cannot cost a turn.** `Director._checkpoint` is shaped like
`_persist`: a locked database or a disk that filled is a log line, not a failed
turn. An illegal transition is logged loudly and swallowed for the same reason —
the tests assert the refusal against `AgentState` directly, where it is visible.

**Suspension is observed, not re-plumbed.** The permission gate and the question
service already announce before they block. The loop reads the phase off those
frames as they pass through `_drain`. Neither service is touched, so the static
risk floor, the self-report escalation, the sensitive-path override, standing
preferences, MCP first-use trust, the unattended gate and the sandbox are all
exactly as they were.

**The payload is versioned separately from the schema.** The column never
changes shape, so an older payload is a data migration (`_UPGRADES`) rather than
an `ALTER TABLE`. A newer payload is refused rather than read with this
version's field names.

**Nothing resumes itself.** At startup the sweep retires every run left in a
live phase — with one uvicorn worker, those can only be turns whose process
died — and closes the tool calls they left unanswered. It does not re-enter the
loop. Picking a turn back up stays the user's existing gesture, read from
`GET /api/conversations/{id}/run` rather than from what the browser remembers.

## Consequences

A turn survives a restart as a readable record: what it was doing, what it was
waiting on, which provider answered, how far it got, and whether there is half
an answer worth finishing. A killed process no longer leaves a conversation
broken on every provider. The interface asks the server what happened instead of
remembering.

The cost is a small write on every phase change and every tool result — one
`UPDATE` of a bounded row, in WAL, on a database that already takes a row per
message and a row per tool call. `AgentRunRepository.KEEP` prunes to the newest
500 runs when a turn reaches a terminal phase.

The state is *not* a checkpoint the loop can be restarted from. It records what
happened; re-entering a turn from the middle would re-run approved tool calls
against the real machine, and that is a decision for a person, not for a boot
sequence.

## Alternatives considered

**A column per field.** Rejected: a run state is read whole or not at all, and
fifteen nullable columns is a schema change for every counter added.

**Reusing `STATUSES` as the phase vocabulary.** Rejected: it would store
`switching`, `retrying` and `resuming` as phases when each is already a number
on the same row.

**Auto-resuming interrupted runs at boot.** Rejected: it fires model calls with
no reader attached and re-runs tool calls the user approved once, and
[automation.md](../automation.md) already holds the line that a run that failed
does not retry within itself.

**Leaving the locals in place and mirroring them onto a state object.**
Rejected: two copies of every counter, and the drift between them is the class
of defect this ADR exists to remove.
