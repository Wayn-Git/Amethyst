# Wiring: `task.focus`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / active | string | `"ready"` |
| `widgetSize` | Slot size (`"small"`, `"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `circular`, `digital`, `sessions`, `editorial`) | string | `"minimal"` |
| `darkAppearance` | Host theme mode (`true` if dark, `false` if light) | boolean | `false` |
| `running` | Whether an active session is currently counting down | boolean | `false` |
| `deadline` | Timestamp (ms) when current session ends | number | `0` |
| `seconds` | Seconds remaining in current session | number | `1500` |
| `focusSeconds` | Configured duration for focus in seconds | number | `1500` (25m) |
| `breakSeconds` | Configured duration for break in seconds | number | `300` (5m) |
| `longBreakSeconds` | Duration for long break in seconds | number | `900` (15m) |
| `phase` | Active mode (`"focus"`, `"break"`) | string | `"focus"` |
| `sessionNumber` | Current cycle session index (1 to 4) | number | `1` |
| `completed` | Completed focus sessions today | number | `0` |
| `dailyFocusBefore` | Total completed focus seconds today | number | `0` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Start timer | `POST /api/widgets/task.focus/actions/start` (`mode: "focus" | "break"`) | Yes | Starts new timer in SQLite `dashboard_focus` |
| Stop timer | `POST /api/widgets/task.focus/actions/stop` | Yes | Marks active session ended |
| Configure timer | `POST /api/widgets/task.focus/actions/configure` (`focus_minutes`, `break_minutes`) | Yes | Updates settings in `widget_settings` |
| Layout switcher | Local state / `localStorage` | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Ready | `ready` | Active focus direction (Minimal, Circular, Digital, Sessions, Editorial) |
