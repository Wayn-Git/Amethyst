# Agent System

The Director is the single owner of the reason → act → observe cycle
(ADR-0016). It lives in `backend/agent/director.py`. Nothing else decides what
the loop does next.

**Verified 2026-11-04 · commit `f52a7d1` · dirty working tree.**

## Main modules

| File | Responsibility |
|---|---|
| `backend/agent/director.py` | Loop, streaming events, tool batching, guards, fallback, persistence |
| `backend/agent/state.py` | Canonical turn phases, legal transitions, serialized state |
| `backend/agent/prompt.py` | System prompt, token budgeting, history shaping, tool-schema fitting |
| `backend/agent/planning.py` | Plan and step tools |
| `backend/agent/intent_router.py` | Fast intent route and lane selection |
| `backend/agent/tool_selector.py` | Tool filtering before exposure |
| `backend/agent/tool_search.py` | Search/describe/call bridge for large catalogues |
| `backend/agent/tool_repair.py` | Repair malformed tool calls |
| `backend/agent/context_compressor.py` | Conversation and tool-result compression |
| `backend/agent/agents.py` | Built-in primary and subagent definitions |
| `backend/agent/types.py` | Agent type definitions |
| `backend/agent/questions.py` | Clarifying-question lifecycle |
| `backend/agent/trace.py` | Turn traces and timing |
| `backend/agent/projection.py` | Field projection for tool results |
| `backend/agent/read_cache.py` | In-turn read deduplication |
| `backend/agent/scratch_store.py` | Offloaded large payload handles |

## Turn lifecycle

`POST /api/conversations/{conversation_id}/turn` in `backend/api/main.py`
streams SSE. One turn per conversation is active at a time; a disconnect
cancels the turn.

Durable phases are defined in `backend/agent/state.py`:

`preparing`, `reasoning`, `acting`, `awaiting_approval`, `awaiting_input`,
`awaiting_connection`, `completed`, `stopped`, `cancelled`, `failed`,
`interrupted`.

`interrupted` is written by the boot sweep when the process died mid-turn.
Terminal phases are `completed`, `stopped`, `cancelled`, `failed`,
`interrupted`. Transitions are an explicit table; an illegal transition raises
`IllegalTransition`.

Display statuses are a separate vocabulary in `director.py`: `starting`,
`retrieving`, `recalling`, `thinking`, `planning`, `generating`, `tool`,
`connector`, `retrying`, `resuming`, `switching`, `completed`, `cancelled`,
`failed`. Do not store a display status where a phase belongs.

## Event stream

`Event` types emitted by the Director:

`assistant_delta`, `assistant_text`, `reasoning_delta`, `tool_call`,
`tool_result`, `confirmation_required`, `status`, `plan`, `step_started`,
`step_done`, `warning`, `guard`, `error`, `done`, `memory`, `artifact_open`,
`artifact_delta`, `artifact_done`, `question_required`, `question_settled`,
`widget`, `connector_failed`.

The answer arrives once: as `assistant_delta` chunks when the provider streams,
or as one `assistant_text` when it does not. The loop never emits both for the
same response.

The API adds keepalive `ping` frames and guarantees a terminal frame:
`done`, `error`, or `guard`. A turn that ends without one is a bug in the
transport, not a valid quiet ending.

## Prompt assembly

`build_system_prompt()` combines the base prompt with environment facts, the
enabled skill catalogue, MCP guidance, memory, retrieved context and mode
instructions. History is budgeted against the selected model's context window,
not a fixed message count. Tool schemas are fitted to the remaining budget;
oversized catalogues fall back to tool search.

`BASE_PROMPT` requires the model to take the cheapest correct path, batch
independent tool calls, stop when answered, avoid repeated failing calls, and
respect remaining-step warnings.

## Tool execution inside the loop

- Read-only tools can run in parallel; writers and interactive tools run
  sequentially.
- Every call goes through `backend/tools/registry.py`.
- The registry applies the permission gate, timeout, result normalization,
  truncation and audit logging.
- A failed tool returns an error string the model can read; it does not end the
  turn.
- A model's self-reported risk can escalate a tool's static floor, never lower
  it.

See [systems/tool-execution.md](systems/tool-execution.md).

## Guards

`Guards` defaults in `director.py`:

- `max_iterations = 40`
- `max_tool_calls = 120`
- `max_seconds = 0.0` (uncapped)
- `max_repeated_calls = 4`
- restart allowance for empty or cut-off answers

Agent types can set lower limits. A guard ends the turn with `guard`, not
`error`.

## Providers and fallback

The loop resolves a provider through `backend/runtime/registry.py`, optionally
routes through `backend/runtime/router.py` when the conversation provider is
`auto`, and builds a fallback chain with `backend/runtime/chain.py`. Provider
differences stay in adapters. See
[systems/model-providers.md](systems/model-providers.md).

## Subagents

The `task` tool in `backend/tools/builtin/task.py` spawns a subagent session.
Built-in types are defined in `backend/agent/agents.py`: `build`, `plan`,
`general`, `explore`, and `scout`. Subagents have their own iteration, tool-call
and time limits, a depth limit, heartbeat tracking, and stale-session cleanup.
Subagent events are exposed through `GET /api/subagents/{session_id}/events`.

## Artifacts and widgets

The loop can stream file artifacts (`artifact_open`, `artifact_delta`,
`artifact_done`) and generative-UI widgets (`widget`). Artifact identity is
derived from conversation and path; versions are stored in `artifact_versions`.
See [components/shared.md](components/shared.md).

## Persistence

Messages are normalized rows in `messages`. `agent_runs` stores one row per
turn with the serialized `AgentState` payload. `execution_logs` stores each tool
dispatch and the permission decision. `conversation_summaries` supports
compaction.

`agent_runs` also carries the turn's measured usage: `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `tool_call_count`
and `duration_ms`. The counts come from `ModelResponse`; nothing is estimated
from characters. `link` is `provider/model`, which is what analytics groups by.

## After the turn

A turn that reaches `done` runs three post-turn steps, in this order, none of
which can fail the turn:

1. `_remember` — memory extraction, a second model call.
2. `_enqueue_learning_review` — a `learning_review` job, only when the review is
   enabled. The job payload carries a bounded copy of the exchange, the tool
   names used, and the answering provider/model.
3. `_refresh_summary` — deterministic SQLite summary refresh, no model.

The learning job stores proposals in `learning_proposals`; it never applies
them. Approval happens through `/api/learning/proposals/{id}/approve` and calls
`backend/learning/service.py`. See
[sections/memory.md](sections/memory.md#learning-proposals) and
[sections/capabilities.md](sections/capabilities.md#learning-proposals).

## Change guidance

- Change the loop only in `director.py`; keep phase changes explicit in
  `state.py`.
- Add a new event type only when the interface must render it mid-turn.
- Add a new guard as a field on `Guards` and enforce it between iterations.
- Keep provider-specific behavior out of the loop.
- Add a regression test for every terminal path: answer, guard, error, cancel,
  disconnect and restart recovery.

## Known issues

- `director.py` is large and carries many concerns: routing, retries,
  compression, artifacts, widgets and persistence. Prefer extraction over adding
  another branch.
- `frontend/src/views/Chat.jsx` is correspondingly large and must stay mounted
  during a turn.
- The distinction between durable phase and display status is easy to blur; keep
  them separate.

## Related

- [DATA-FLOW.md](DATA-FLOW.md#1-chat-turn)
- [systems/tool-execution.md](systems/tool-execution.md)
- [systems/model-providers.md](systems/model-providers.md)
- [sections/chat.md](sections/chat.md)
- [../architecture/turns.md](../architecture/turns.md)
- [../architecture/decisions/0016-agent-loop-ownership-and-concurrency.md](../architecture/decisions/0016-agent-loop-ownership-and-concurrency.md)
- [../architecture/decisions/0021-agent-run-state.md](../architecture/decisions/0021-agent-run-state.md)

_Last verified: 2026-11-04 · commit `f52a7d1` · dirty working tree._
