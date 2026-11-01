# Wiring: `need.snoozed`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `sizeChoice` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `layoutChoice` | Active composition layout (`minimal`, `timeline`, `grouped`, `agenda`, `compact`) | string | `"minimal"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `items` | Computed from `items` array returned by `backend/dashboard/items.py` | array | `[]` |
| `items[].id` | Item ID from SQLite snoozes table | string/number | `""` |
| `items[].title` | Item title joined from tasks/deadlines/reminders | string | `"Untitled item"` |
| `items[].time` | Local return time (e.g. `"09:30"`) formatted from `until` | string | `""` |
| `items[].context` | Return status context (e.g. `"Ready to resume"`, `"Returning at 09:30"`) | string | `""` |
| `items[].kind` | Category key (`"task"`, `"reminder"`, `"followup"`) | string | `"task"` |
| `items[].type` | Display type label (`"Task"`, `"Reminder"`, `"Follow-up"`) | string | `"Task"` |
| `items[].source` | Source table label (`"Projects"`, `"Deadlines"`, `"Reminders"`, `"Mail"`) | string | `"Projects"` |
| `items[].priority` | Priority level (`"High"`, `"Normal"`, `"Low"`) | string | `"Normal"` |
| `items[].period` | Day period (`"morning"`, `"afternoon"`) based on return hour | string | `"morning"` |
| `groups` | Source categories for grouped layout | array | Default 3 groups |
| `periods` | Time ranges for agenda layout | array | Morning / Afternoon |
| `ui.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Resume/complete | `POST /api/widgets/<source>/actions/complete` | Yes | Marks item completed |
| Layout switcher | Local state / `localStorage` | No | Switches active composition layout |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero snoozed items returning today | `empty` | "Nothing returning today" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Returning items present | `ready` | Active layout (Minimal, Timeline, Grouped, Agenda, Compact) |
