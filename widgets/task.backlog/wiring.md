# Wiring: `task.backlog`

## Fields

| Template data | Live source | Fallback |
|---|---|---|
| `tasks[]` | `backend/dashboard/items.py:provide("task.backlog")`, local `tasks` rows | Empty array |
| `tasks[].title`, `id`, `updated_at`, `important`, `editable` | SQLite task row; importance comes from the existing `tasks.important` flag | Title is source-owned; unavailable update time says “Not available” |
| Layout groups, labels, and motion preference | Static design configuration in `design.json`; no user/sample records | Fixed widget copy and layout defaults |
| `status` | Dashboard cache state and whether live tasks exist | Loading until first response |

## Actions

| Action | Backend handler | Gate | Result |
|---|---|---|---|
| Capture | `POST /api/widgets/task.backlog/actions/add` | Yes, through `LocalReview` and the dashboard confirmation gate | Creates a local task without a due date |
| Complete / remove | `complete` / `delete` actions in `backend/dashboard/items.py` | Yes | Refreshes from the task table after approval |
| Prioritise | `edit` with `important` in `backend/dashboard/items.py` | Yes | Updates the task's existing importance flag |

## Statuses

The widget uses loading before the first cache response, empty when the provider returns no open backlog tasks, and ready for live rows. Errors and connector setup states are shown by the dashboard frame. The task provider has no offline signal.
