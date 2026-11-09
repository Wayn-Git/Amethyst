# Wiring: `agent.brief`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / disabled | string | `"ready"` |
| `widgetSize` | Slot size (`"small"`, `"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `split`, `timeline`, `editorial`, `dashboard`) | string | `"editorial"` |
| `darkPreview` | Host theme mode (`true` if dark, `false` if light) | boolean | `false` |
| `greeting` | Time-of-day greeting | string | `"Good morning"` |
| `dayNote` | Daily brief summary sentence | string | `""` |
| `date.*` | Real date components (`day`, `weekday`, `month`, `year`, `short`, `full`) | object | Current date |
| `tasks` | Daily tasks from grounded brief items | array | `[]` |
| `events` | Calendar events from grounded brief items | array | `[]` |
| `topTask` | Top priority task ID | string | `""` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Enable model selection | `PUT /api/widgets/agent.brief/settings` (`model_enabled: true`) | No | Enables grounded model brief generation |
| Layout switcher | Local state / `localStorage` | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Ready | `ready` | Active direction (Minimal, Split, Timeline, Editorial, Dashboard) |
