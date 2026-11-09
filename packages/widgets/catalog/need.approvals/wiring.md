# Wiring: `need.approvals`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `widgetSize` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `direction` | Active design direction (`minimal`, `review`, `inbox`, `security`, `editorial`) | string | `"minimal"` |
| `darkAppearance` | Host theme mode (`true` if dark, `false` if light) | boolean | `false` |
| `pendingCount` | Count of requests where `decision === "pending"` | number | `0` |
| `requests` | Computed from `items` array returned by `backend/dashboard/director.py` | array | `[]` |
| `requests[].id` | Unique confirmation ID | string | `""` |
| `requests[].agent` | Agent requesting execution | string | `"Agent"` |
| `requests[].initials` | Agent initials | string | `"AG"` |
| `requests[].icon` | Tool icon (`"square-code"`, `"mail"`, `"document"`, `"shield"`, etc.) | string | `"shield"` |
| `requests[].tool` | Tool name | string | `"Tool"` |
| `requests[].action` | Action description | string | `""` |
| `requests[].description` | Expanded argument / action details | string | `""` |
| `requests[].scope` | Scoped target (file path, repo, recipient) | string | `""` |
| `requests[].permission` | Permission classification (`"Read only"`, `"Send once"`, `"Create only"`) | string | `"Restricted"` |
| `requests[].riskLabel` | Risk level display (`"Low risk"`, `"Moderate risk"`, `"High risk"`) | string | `"Moderate risk"` |
| `requests[].riskTone` | Badge color (`"secondary"`, `"warning"`, `"danger"`) | string | `"warning"` |
| `requests[].riskTextTone` | Text color token | string | `"warning"` |
| `requests[].timestamp` | Humanized elapsed time | string | `"Just now"` |
| `requests[].urgent` | Boolean indicating high risk or time sensitivity | boolean | `false` |
| `requests[].decision` | Resolution state (`"pending"`, `"approve"`, `"deny"`) | string | `"pending"` |
| `copy.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Approve request | `POST /api/widgets/need.approvals/actions/approve` or `POST /api/confirmations/{id}` (`allow: true`) | Yes | Marks request approved, unblocks agent execution |
| Deny request | `POST /api/widgets/need.approvals/actions/deny` or `POST /api/confirmations/{id}` (`allow: false`) | Yes | Marks request denied, raises PermissionDenied to agent |
| Layout switcher | Local state / `localStorage` | No | Switches active design direction |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero pending tool confirmations | `empty` | "All clear" shield checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Confirmations present | `ready` | Active direction (Minimal, Review, Inbox, Security, Editorial) |
