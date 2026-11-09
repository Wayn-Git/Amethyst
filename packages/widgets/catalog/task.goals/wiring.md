# Wiring: `task.goals`

The payload comes from `backend/dashboard/goals.py::provide`, backed by saved goal rows and current task status. The adapter displays the saved progress, target date, title, and mode. Milestones, next steps, and goal notes are not stored by the backend and are omitted or shown as unavailable; fixture values are not used.

| Template data | Live source | Missing value |
|---|---|---|
| Goal title, id, target date | `dashboard_goals` via `provide()` | Omit absent date as `Not available` |
| Progress and mode | `dashboard_goals.progress/mode`; task-linked progress is computed from current task states | Backend value |
| Milestones, plans and notes | No backend field | Empty list / `Not available` |

| Action | Handler | Gate / result |
|---|---|---|
| Increment manual progress | `backend/dashboard/goals.py::draft('progress')` | Review draft; applies only after approval |
| Expand/collapse and visual direction | Renderer local state | No backend write |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Provider returns goals |
| `empty` | No saved goals |
| `error` | Provider or draft request fails |
