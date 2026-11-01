# Wiring: `need.overdue`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `scale` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `timeline`, `priority`, `grouped`, `editorial`) | string | `"minimal"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `tasks` | Computed from `items` array returned by `backend/dashboard/items.py` | array | `[]` |
| `tasks[].id` | Real item ID from SQLite (`tasks`, `deadlines`, `reminders`) | string/number | `""` |
| `tasks[].title` | Item title from DB | string | `"Untitled task"` |
| `tasks[].days` | Days overdue computed from `seconds_until_due` or `due_at` vs `now` | number | `1` |
| `tasks[].due` | Formatted due date string (e.g. `"May 8"`) | string | `""` |
| `tasks[].priority` | Inferred priority level (`"Critical"`, `"High"`, `"Standard"`) | string | `"Standard"` |
| `tasks[].rank` | Numeric rank (1: Critical for >=7d, 2: High for 3-6d, 3: Standard for 1-2d) | number | `3` |
| `tasks[].color` | Semantic status color token (`"danger"`, `"warning"`, `"secondary"`) | string | `"secondary"` |
| `tasks[].project` | Source table label (e.g. `"Tasks"`, `"Deadlines"`, `"Reminders"`) | string | `"Tasks"` |
| `tasks[].medium` | Prominent flag for medium card display | boolean | `true` |
| `tasks[].done` | Completion state | boolean | `false` |
| `priorityGroups` | Priority categorization scale (Critical, High, Standard) | array | Default 3 groups |
| `durationGroups` | Duration buckets (7+ days, 3–6 days, 1–2 days) | array | Default 3 groups |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Complete task | `POST /api/widgets/<task.source>/actions/complete` with `{"id": id}` | Yes | Marks task done in database, invalidates cache |
| Direction switcher | `PUT /widgets/need.overdue/settings` / local state | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero overdue items in DB or all completed | `empty` | "Nothing overdue" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Overdue items present | `ready` | Active direction layout (Minimal, Timeline, Priority, Grouped, Editorial) |
