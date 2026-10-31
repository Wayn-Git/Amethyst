# Wiring: `task.plan`

The payload comes from `backend/dashboard/planning.py::provide`, using live calendar events, saved task due dates and estimates, and configured working hours. Suggestions are computed locally by the provider and remain proposals; the calendar is read-only.

| Template data | Live source | Missing value |
|---|---|---|
| Fixed blocks | Provider `events` | Empty list |
| Suggested blocks | Provider `items` with start/end | Unscheduled tasks are not shown as blocks |
| Date, timezone, capacity | Provider `today`, `timezone`, and capacity fields | `Not available` |

| Action | Handler | Gate / result |
|---|---|---|
| Select layout/scenario/block | Renderer local state | No calendar write |
| Accept/move/dismiss suggestion | Not supported by the calendar provider | Removed from the template |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Calendar and planning settings are available |
| `empty` | No proposed tasks or calendar blocks |
| `error` | Provider failure or incomplete calendar |
| `not-connected` | Calendar access is unavailable |
