# Wiring: `task.today`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state (`data.state`) | string | `"loading"` |
| `direction` | Configured composition style (`"minimal"`, `"list"`, `"timeline"`, `"progress"`, `"editorial"`) | string | `"minimal"` |
| `widgetSize` | Slot size mapped (`"small"`, `"medium"`, `"large"`) | string | `"medium"` |
| `appearance` | App theme (`"light"` / `"dark"`) | string | `"light"` |
| `tasks` | Array of tasks mapped from SQLite `tasks` table (`id`, `slot`, `title`, `group`, `day`, `due`, `shortDue`, `time`, `meridiem`, `priority`, `tone`, `done`) | array | `[]` |
| `groups` | 3 groups (`overdue`, `today`, `upcoming`) with localized labels and tones | array | Standard groups |
| `labels.*` | Localized UI labels and headers | object | Standard labels dictionary |
| `directions` | Array of selectable direction options | array | 5 directions |
| `sizes` | Array of selectable size options | array | 3 sizes |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| `task.complete` | `POST /api/widgets/task.today/actions/complete` with `{ id }` | Yes (confirmation draft) | Task marked done |
| `task.add` | `POST /api/widgets/task.today/actions/add` with `{ title }` | Yes (confirmation draft) | Task created |
| *(card click)* | Triggers detail drawer with full task workbench | No | Opens drawer |

## 3. Status Mapping

| Real condition | `data.status` | Template Output |
|---|---|---|
| Initial load before data arrives | `loading` | Skeleton shaped like target layout size |
| Tasks loaded from SQLite | `ready` | Full composition for active direction and size |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` | Displays live widget seamlessly |
| No open tasks remaining today | `empty` | Clean all-done state ("A clear list. Every task is checked.") |
| Task fetch failed (`data.state === 'error'`) | `error` | Error message and retry status |
| Client offline with cached tasks | `offline` | Cached task list rendered |
| Payload age > refresh interval | `stale` | Task list rendered with sync status |
