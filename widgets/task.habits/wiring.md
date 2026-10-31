# Wiring: `task.habits`

The payload comes from `backend/dashboard/habits.py::provide`. Medium renders a compact daily summary and one check-in action; Large renders a seven-day history for up to five habits in provider order. The adapter derives the longest completed daily or weekly streak from the full persisted `history_days`, using the provider's local `today`. Missing check-ins are treated as open; the backend does not record missed or paused states.

| Template data | Live source | Missing value |
|---|---|---|
| Habit id/title/period/target | `dashboard_habits` via `provide()` | Omit incomplete row |
| Current count and streak | Backend `progress()` over persisted check-ins | Backend value; displayed in days for daily habits and weeks for weekly habits |
| Best streak | Derived from all persisted `history_days` periods meeting the habit target | `0` if there are no check-ins; same unit as the habit period |
| Seven-day history | `dashboard_habit_checkins.day` via `history()` | Open day; no missed state is inferred |

| Action | Handler | Gate / result |
|---|---|---|
| Check in today | `backend/dashboard/habits.py::draft('checkin')` | Review draft; applies after approval, then provider refreshes |
| Select view/week | Renderer local state | No backend write |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Provider returns habits |
| `empty` | No saved habits |
| `error` | Provider or draft request fails |
