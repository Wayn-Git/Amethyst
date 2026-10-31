# Tasks

The task board at `/tasks`: buckets, lists, calendar scheduling, conflict
detection, and optional Microsoft To Do mirroring.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Tasks.jsx`, `frontend/src/views/tasks.css` |
| Client | `frontend/src/api.js` → `api.tasks`, `api.taskBuckets`, `api.createTask`, `api.updateTask`, `api.deleteTask`, `api.syncTasks` |
| Routes | `backend/api/main.py` `/api/tasks*`, `/api/task-lists*` |
| Service | `backend/tasks/service.py` |
| Scheduling | `backend/scheduling/engine.py` |
| Remote mirror | `backend/sync/microsoft_todo.py` |
| Tables | `tasks`, `task_lists` in `backend/db/schema.sql` |

## UI structure

Buckets in the rail:

```text
my_day  important  missed  all  completed
```

Plus user lists, which are separate from buckets. `GET /api/tasks/buckets`
returns every count the rail needs in one call, the My Day list id, and whether
any list is connected to a remote service.

Views:

- Board/card layout per bucket or list.
- Search and filters.
- Task detail popup with notes, priority, due date, scheduled time, duration,
  list and status.
- Calendar/agenda surfaces driven by the scheduling engine.
- Empty states per bucket.
- Sync control for Microsoft To Do.

## Data flow

```mermaid
flowchart LR
  UI[Tasks.jsx] --> API[/api/tasks]
  API --> SVC[TaskService]
  SVC --> REPO[TaskRepository]
  REPO --> DB[(tasks, task_lists)]
  SVC --> TODO[Microsoft To Do]
  TODO --> REPO
```

- Reads go through `TaskRepository`, not SQL in the view.
- Writes go through `TaskService`, which decides whether to write locally,
  upstream, or both.
- When a task service is connected, creating a task goes upstream. A local row
  beside a signed-in To Do account would be a second list nobody asked for.
- `POST /api/tasks/sync` runs the same pull/push the background loop runs every
  fifteen minutes.
- `TaskService` refuses a scheduled task that conflicts with an existing one
  (`_refuse_on_conflict`), unless the caller overrides.
- Deleting a list deletes or reassigns its tasks according to the service.

## Buckets and status

`TASK_BUCKETS` in `backend/api/main.py` is authoritative. Bucket semantics:

- `my_day` — tasks explicitly added to today.
- `important` — high priority.
- `missed` — past due and not completed.
- `all` — open tasks.
- `completed` — done or cancelled, presented separately.

`include_done` is a legacy parameter. It maps onto the `all`/`completed` split;
it does not return cancelled rows.

## Scheduling

`backend/scheduling/engine.py`:

- `resolve_date_hint` parses natural-language dates. Ambiguous input raises
  `AmbiguousDate` rather than guessing.
- `find_conflicts` returns overlapping scheduled tasks.
- `find_free_slot` proposes a slot given duration and constraints.

The calendar widgets and the task detail form use these functions. Do not
duplicate date parsing in the frontend.

## Microsoft To Do

`backend/sync/microsoft_todo.py` maps remote lists and tasks to local rows.

- `SERVER` names the MCP server used for the mirror.
- Lists carry `external_id`; local-only lists have none.
- A rename or delete on a connected list is applied upstream first. If the
  remote refuses, the API returns 502 instead of showing a name that will
  silently revert on the next sync.
- `SyncUnavailable` means the connector is not usable; the UI should offer to
  connect rather than retry forever.
- `TruncatedListing` means the remote returned more than the client will page;
  the sync reports it instead of silently dropping items.

The mirror is optional. Local tasks work without it.

## Modification guide

| Change | Touch |
|---|---|
| Add a bucket | `TASK_BUCKETS`, `TaskRepository.counts`, `Tasks.jsx` rail |
| Change a task field | schema, `TaskRepository`, `TaskService`, `CreateTask`/`UpdateTask`, `Tasks.jsx` |
| Change conflict rules | `backend/scheduling/engine.py`, `TaskService._refuse_on_conflict` |
| Change To Do mapping | `backend/sync/microsoft_todo.py` |
| Change the board layout | `Tasks.jsx`, `tasks.css` |
| Change sync cadence | the background task runner in `backend/api/main.py` |

Rules:

- Never write `tasks` directly from a route.
- Keep list identity stable. `external_id` is the remote key; local ids are
  integers.
- A remote failure must be visible, not swallowed. Silent divergence is worse
  than an error.
- Do not add a second source of “today” semantics. My Day is a bucket, not a
  separate table.

## Known issues

- Tasks are local-first but the mirror is one-way authoritative for connected
  lists. Concurrent edits on both sides resolve on the next sync; there is no
  field-level merge for task rows.
- The `include_done` parameter is kept for old callers and behaves differently
  from its name suggests.
- The board has many view states in one component. Extract before adding a new
  mode.
- Date parsing accepts a bounded set of hints. Unsupported phrasing raises
  rather than falling back to “today”.

## Related

- [DATABASE.md](../DATABASE.md)
- [DATA-FLOW.md](../DATA-FLOW.md)
- [sections/today.md](today.md)
- [systems/sync.md](../systems/sync.md)
- [sections/mail.md](mail.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
