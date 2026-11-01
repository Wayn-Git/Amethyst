# Wiring: `need.decisions`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `sizeMode` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `inbox`, `comparison`, `priority`, `editorial`) | string | `"minimal"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `decisions` | Real questions from `backend/dashboard/director.py` (`backend/agent/questions.py`) | array | `[]` |
| `decisions[].id` | Question item ID | string | `""` |
| `decisions[].question` | Question title / prompt string | string | `"Decision required"` |
| `decisions[].context` | Additional question context / explanation | string | `""` |
| `decisions[].category` | Inferred category (e.g. `"Release timing"`, `"Configuration"`) | string | `"General"` |
| `decisions[].agent` | Agent / tool origin name | string | `"Agent"` |
| `decisions[].agentIcon` | Agent icon slug (`"cube"`, `"brain"`, `"sparkles"`) | string | `"brain"` |
| `decisions[].wait` | Time spent waiting | string | `"5 min"` |
| `decisions[].priority` | Urgency rating (`"Time-sensitive"`, `"Standard"`) | string | `"Standard"` |
| `decisions[].urgent` | Boolean urgency flag | boolean | `false` |
| `decisions[].options` | Array of options `[{ value, label, impact, description }]` | array | `[]` |
| `outcomes` | Map of `decision.id -> "waiting" \| "answered" \| "dismissed"` | object | `{}` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Answer decision | `POST /api/widgets/need.decisions/actions/answer` with `{"id": id, "answer": value}` | Yes | Submits answer to Director, removes item from queue |
| Dismiss decision | `POST /api/widgets/need.decisions/actions/dismiss` with `{"id": id}` | Yes | Dismisses question, removes item from queue |
| Direction switcher | Local preference | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero questions waiting in Director | `empty` | "No decisions waiting" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Questions waiting for user decision | `ready` | Active direction layout (Minimal, Inbox, Comparison, Priority, Editorial) |
