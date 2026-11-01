# Wiring: `agent.feed`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"ready"` |
| `sizeChoice` | Slot size (`"small"`, `"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `timeline`, `grouped`, `feed`, `editorial`) | string | `"minimal"` |
| `darkAppearance` | Host theme mode (`true` if dark, `false` if light) | boolean | `false` |
| `events` | Computed from `items` array returned by `backend/dashboard/director.py` | array | `[]` |
| `events[].id` | Unique turn / trace ID | string | `""` |
| `events[].kind` | Activity classification (`"approval"`, `"upload"`, `"comment"`, `"meeting"`, `"milestone"`, `"document"`, `"workspace"`) | string | `"milestone"` |
| `events[].title` | User message / prompt summary | string | `""` |
| `events[].description` | Detail string (model & tool call metrics) | string | `""` |
| `events[].actor` | Agent / Actor name | string | `"Agent"` |
| `events[].meta` | Subtitle / meta information | string | `""` |
| `events[].time` | Relative elapsed time | string | `"Just now"` |
| `events[].clock` | Time of day string | string | `""` |
| `events[].day` | Day grouping bucket (`"today"`, `"yesterday"`, `"earlier"`) | string | `"today"` |
| `events[].icon` | Event icon | string | `"check-circle"` |
| `events[].important` | Highlight flag | boolean | `false` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Layout switcher | Local state / `localStorage` | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero activity traces | `empty` | "No recent activity" quiet card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Activity present | `ready` | Active direction (Minimal, Timeline, Grouped, Feed, Editorial) |
