# Wiring: `task.risk`

The payload comes from `backend/dashboard/planning.py::provide`, comparing saved task estimates and deadline due dates with open calendar capacity. The provider marks estimates as unknown when required inputs are missing; no project risk or next action is invented by the adapter.

| Template data | Live source | Missing value |
|---|---|---|
| Deadline title, due date and risk | Provider `items` (`title`, `due`, `risk`, `detail`) | `Not available` |
| Work estimate and capacity | Provider `known_minutes`, `capacity_minutes` | Provider's unknown risk state |
| Recommendations and dependencies | Not provided by this endpoint | `Not available` |

| Action | Handler | Gate / result |
|---|---|---|
| Choose register/timeline/workload view | Renderer local state | No backend write |
| Copy current assessment | Renderer client clipboard action | No backend write |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Deadline assessments are available |
| `empty` | No saved deadlines |
| `error` | Provider failure or incomplete calendar |
| `not-connected` | Calendar access is unavailable |
