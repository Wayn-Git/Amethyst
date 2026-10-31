# Database

SQLite is the only relational store. It runs in WAL mode with foreign keys on,
a 5-second busy timeout, and `synchronous=NORMAL`. There is no ORM and no
database server.

Canonical schema: `backend/db/schema.sql`. Connection and migrations:
`backend/db/connection.py`. Repositories: `backend/db/repositories.py`.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Connection behavior

`backend/db/connection.py`:

- resolves the database through `backend/config.py` (`~/.amethyst/amethyst.db`);
- sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`,
  `synchronous=NORMAL`;
- applies the schema idempotently and runs additive migrations;
- exposes `get_connection()` and `transaction()`.

WAL lets readers continue while a background writer commits. The busy timeout
covers two writers meeting. Keep transactions short; do not hold one across a
model call or a network request.

## Tables

`backend/db/schema.sql` creates 43 tables.

| Group | Tables |
|---|---|
| Settings and policy | `app_settings`, `confirmation_preferences`, `capability_state`, `capability_profiles`, `capability_profile_items`, `mcp_trusted_servers` |
| Conversations | `conversations`, `messages`, `conversation_summaries` |
| Documents and retrieval metadata | `documents`, `document_chunks` |
| Tasks and calendar | `task_lists`, `tasks`, `calendar_events` |
| Audit and runs | `execution_logs`, `agent_runs`, `subagent_sessions` |
| Automations and jobs | `automations`, `automation_runs`, `jobs`, `job_steps`, `worker_reports` |
| Memory and journal | `memories`, `memory_state`, `journal_entries` |
| Library and media | `library_items`, `instagram_events`, `brand_profile` |
| Artifacts | `artifacts`, `response_artifacts`, `artifact_versions` |
| Sync and devices | `devices`, `sync_ops`, `sync_seen`, `sync_intents` |
| Integrations | `composio_state`, `provider_fallbacks` |
| Dashboard | `today_items`, `today_snapshots`, `widget_cache`, `layouts`, `widget_settings` |
| Remote | `remote_action_drafts` |

Virtual tables are created by `backend/retrieval/store.py`, not by
`schema.sql`:

- `chunks_fts` — FTS5 index over `document_chunks.content`.
- `chunk_vectors` — `sqlite-vec` `vec0` table for embeddings. Dimensions are
  fixed at creation time.

`sqlite-vec` is optional at import time. When unavailable, semantic search is
disabled and search degrades to keywords; callers can observe the degradation.

## Relationships that matter

- `messages.conversation_id` → `conversations.id`. Messages are normalized rows,
  not one transcript blob. Tool calls and results stay in JSON columns attached
  to real rows.
- `document_chunks.document_id` → `documents.id`. Chunk hashes enable incremental
  re-indexing.
- `agent_runs.conversation_id` → `conversations.id`. One row per turn, with a
  serialized `AgentState` payload and a phase.
- `jobs` and `job_steps` form the durable work ledger. A step row records an
  outward effect so a retry does not repeat it.
- `devices` holds paired control devices and permission grants. `sync_ops` is the
  ordered op log; `sync_seen` deduplicates; `sync_intents` holds control-device
  intents for the host.
- `memories` supersedes rather than deletes. `superseded_at` marks retirement.
- `library_items` indexes captured material; the text itself lives under
  `~/.amethyst/library/`.
- `widget_cache` stores per-widget payloads and state; `layouts` stores per-mode
  widget order and sizes; `widget_settings` stores per-widget settings.

## Repository layer

Nothing above `backend/db/repositories.py` issues SQL. Repositories include:

`ConversationRepository`, `MessageRepository`, `ArtifactRepository`,
`ResponseArtifactRepository`, `ConfirmationPreferenceRepository`,
`ExecutionLogRepository`, `McpTrustRepository`, `AgentRunRepository`,
`TaskRepository`, `TaskListRepository`, `CalendarRepository`,
`SubagentSessionRepository`, `ConversationSummaryRepository`.

Some domain modules have their own stores for subsystem-local tables:
`backend/jobs/store.py`, `backend/library/store.py`,
`backend/dashboard/store.py`, `backend/sync/ops.py`,
`backend/retrieval/store.py`. Follow the existing split; do not add a new SQL
path to a route.

## Time and identity conventions

- Timestamps are local naive ISO strings, compared as strings by SQLite. This is
  deliberate: UTC values compared against local values silently shift by the
  machine offset. See `_now()` and `_today()` in `repositories.py`.
- Integer primary keys are minted by the host. Under the host/control sync model,
  a control device sends intents rather than minting rows.
- `tasks` and `memories` carry nullable UUIDs for cross-device identity.
- Sync uses per-field last-write-wins with a hybrid logical clock
  `(wall_ms, counter, device_id)`.

## Migrations

`backend/db/connection.py` applies `schema.sql`, then reconciles columns and
runs additive migrations. There is no external migration framework. When adding
a column:

1. Add it to `schema.sql` with a safe default.
2. Add the reconciliation/migration step if existing rows need a value.
3. Update the repository and its dataclass.
4. Add a regression test that opens an older-shaped database.

Do not rewrite or reorder existing migrations. Do not drop a column in place;
SQLite requires a table rebuild, and existing user data must survive.

## Change guidance

- A new table needs a repository, a schema entry, and a test.
- A new indexed field needs a query plan check if it is on a hot path.
- A new syncable field must be added to the allowlist in
  `backend/sync/registry.py`; the sync layer never uses `SELECT *`.
- Never store a secret. Store a keychain reference.
- Keep captured text and binary media out of the database file.

## Related

- [systems/storage.md](systems/storage.md)
- [systems/sync.md](systems/sync.md)
- [../architecture/data-model.md](../architecture/data-model.md)
- [../architecture/decisions/0002-primary-database-engine.md](../architecture/decisions/0002-primary-database-engine.md)
- [../architecture/decisions/0004-storage-architecture-multi-store-split.md](../architecture/decisions/0004-storage-architecture-multi-store-split.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
