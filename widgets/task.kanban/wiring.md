# Wiring: `task.kanban`

The payload comes from `backend/dashboard/kanban.py::provide`, combining local task lists, configured columns, and their tasks. Connected tasks are excluded by the provider. The adapter uses the persisted column assignment and shows unavailable where the task backend has no priority, due-date, checklist, or owner field in this payload.

| Template data | Live source | Missing value |
|---|---|---|
| Project and columns | Local `task_lists` and `dashboard_kanban_boards` via `provide()` | Empty list |
| Cards and current column | `tasks` plus `dashboard_kanban_cards` | Omit cancelled tasks |
| Priority, due date, checklist, owner | Not provided by this endpoint | `Not available` |

| Action | Handler | Gate / result |
|---|---|---|
| Move selected task | `backend/dashboard/kanban.py::draft('move')` | Review draft; applies after approval |
| Select project, card, or layout | Renderer local state | No backend write |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Provider returns local boards |
| `empty` | No local project boards |
| `error` | Provider or draft request fails |
