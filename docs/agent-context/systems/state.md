# State

Where state lives and which copy is authoritative: React context, the URL,
localStorage, SQLite, and the per-turn state machine.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Layers

| Layer | Owner | Lifetime |
|---|---|---|
| URL path | React Router | Per navigation; source of truth for the current view |
| React context | `frontend/src/store.jsx` | Per page load |
| localStorage | `frontend/src/lib/storage.js` (`safeStorage`) | Per browser/device |
| SQLite | `backend/db/` | Durable |
| Turn state | `backend/agent/state.py` | One turn, checkpointed |
| Sync outbox | `backend/sync/` | Until acknowledged |

## Frontend store

`AppProvider` in `frontend/src/store.jsx` is one large context. It owns:

- `view` — derived from `location.pathname` every render, not stored.
- `server` — whether the backend answers at all.
- `health` — what a reachable backend says about itself.
- `conversations`, `activeId`.
- `workspace`, `panel`, `sidebar`, `drawer`.
- Appearance: theme, accent, text size, fonts, contrast, motion.
- Composer and safety preferences: guard, effort, confirmations.
- Capabilities, jobs, toasts, overlays.
- Pairing state and pending approvals.

`view` is deliberately derived. A browser back/forward or a typed address must
never disagree with the rendered page.

`server` and `health` are distinct. “Still booting” and “up but degraded” need
different frames; conflating them showed a page of failed-to-load errors during
an ordinary cold start.

## Preferences

- `loadPrefs()` reads localStorage.
- Setters write localStorage immediately.
- A small allowlisted subset is also sent to `PATCH /api/preferences` and
  synced to other devices.
- Server values are stored as text; the client restores the shape.

Synced names are in `SYNCED_PREFERENCES` (`backend/sync/registry.py`). Per-device
values (`panelWidth`, `sidebar`, `textSize`, `activeId`, `workspace`) are
excluded on purpose.

The server refuses unknown names with 400 and lists the allowed set. That is the
contract; do not silently ignore an unknown preference.

## Turn state

`backend/agent/state.py` is the canonical state of one turn.

Phases:

```text
preparing  reasoning  acting  awaiting_approval  awaiting_input
awaiting_connection  completed  stopped  cancelled  failed  interrupted
```

`TRANSITIONS` is a written-out table of legal moves. `enter(phase)` is the only
way to change phase and raises `IllegalTransition` for a move not in the table.
Self-transitions are legal where they happen (`reasoning -> reasoning` on a
resume, `acting -> acting` for the next call in a batch).

`TERMINAL` phases: `completed`, `stopped`, `cancelled`, `failed`, `interrupted`.

`STATE_VERSION` is bumped when the serialized shape changes. A payload written
by an older version goes through `_UPGRADES`, a data migration, not an
`ALTER TABLE`.

The state object holds message ids, not message bodies. Retrieved context is
referenced by row id. The resolved model and wire history are rebuilt, because a
second stored copy would go stale.

## Checkpointing and recovery

- The turn state is checkpointed so a process death does not lose the phase.
- On boot, a sweep marks turns left mid-flight as `interrupted`.
- `close_open_tool_calls` repairs a conversation whose last tool call never
  completed. Without it, every later provider call sees a dangling tool call.
- A resumed turn re-enters `reasoning` or `acting` according to what it was
  doing.

Do not add a phase for a fact already stored as a number (`switching`,
`retrying`, `resuming`). That duplicates the fact and the copies diverge.

## Durable application state

- Conversations and messages: `conversations`, `messages`.
- Runs: `conversation_runs`.
- Tool audit: `execution_logs`.
- Preferences: `app_settings` (`ui.*` keys).
- Devices: `devices`.
- Jobs: the job ledger tables under `backend/jobs/`.

Repositories own SQL. Routes and services do not.

## Modification guide

| Change | Touch |
|---|---|
| Add a preference | `store.jsx`, `SYNCED_PREFERENCES` if it should travel |
| Add a view state | derive from the URL where possible; otherwise store with a clear owner |
| Add a turn phase | `PHASES`, `TRANSITIONS`, the Director, the UI status map |
| Change checkpoint shape | `STATE_VERSION`, `_UPGRADES` |
| Change server state polling | `store.jsx`, `api.health`, `api.ping` |

Rules:

- The URL is the source of truth for the current view.
- Do not keep two copies of a derived value.
- A preference that follows devices must be allowlisted server-side.
- An illegal phase transition is a bug, not something to catch and ignore.
- A terminal phase is final.

## Known issues

- `store.jsx` is very large and holds unrelated concerns. Extract a provider
  rather than adding another `useState` block.
- localStorage is per-device; server preferences are the only cross-device
  copy, and only for allowlisted names.
- `health` polling can be slower than `ping`. Do not use health as a liveness
  check.
- The UI status vocabulary is not the same as the turn phase vocabulary. See
  the comment at the top of `state.py`.

## Related

- [FRONTEND.md](../FRONTEND.md)
- [AGENT-SYSTEM.md](../AGENT-SYSTEM.md)
- [systems/sync.md](sync.md)
- [sections/settings.md](../sections/settings.md)
- [DATABASE.md](../DATABASE.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
