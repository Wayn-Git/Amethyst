# Wiring: `need.drafts`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `footprint` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `composition` | Active composition direction (`minimal`, `inbox`, `editorial`, `review`) | string | `"minimal"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `drafts` | Computed from `items` array returned by `backend/dashboard/mail.py` | array | `[]` |
| `drafts[].id` | Integer ID from `dashboard_mail_drafts` table | number | `0` |
| `drafts[].recipient.name` | Clean contact name parsed from recipient field | string | `"Recipient"` |
| `drafts[].recipient.email` | Contact email parsed from recipient field | string | `""` |
| `drafts[].subject` | Draft subject line | string | `"No subject"` |
| `drafts[].body` | Full draft body text or snippet | string | `""` |
| `drafts[].preview` | Cleaned 1-2 sentence preview text | string | `""` |
| `drafts[].status` | `"awaiting"` (if "draft") or `"approved"` | string | `"awaiting"` |
| `drafts[].edited` | Humanized relative edit time (e.g. `"Edited 8 min ago"`) | string | `""` |
| `drafts[].editedAt` | Milliseconds timestamp of `updated_at` | number | `0` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Approve draft | `POST /widgets/need.drafts/actions/approve` | Yes | Marks draft approved |
| Edit draft | `POST /widgets/need.drafts/actions/edit` | Yes | Updates draft subject/text |
| Layout switcher | Local state / `localStorage` | No | Switches active composition layout |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero drafts in `dashboard_mail_drafts` | `empty` | "No drafts in this preview" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Drafts present | `ready` | Active direction (Minimal, Inbox, Editorial, Review) |
