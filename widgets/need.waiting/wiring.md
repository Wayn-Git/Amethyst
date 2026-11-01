# Wiring: `need.waiting`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `scale` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `layout` | Active composition layout (`minimal`, `inbox`, `timeline`, `followup`, `grouped`) | string | `"minimal"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `messages` | Computed from `items` array returned by `backend/dashboard/mail.py` | array | `[]` |
| `messages[].id` | Item ID from mail or manual table (`"mail:..."` or `"manual:..."`) | string | `""` |
| `messages[].name` | Sender/recipient name parsed from `recipient` or `from` | string | `"Unknown"` |
| `messages[].firstName` | Extracted first name for friendly follow-up greetings | string | `""` |
| `messages[].initials` | 2-character initials computed from name | string | `""` |
| `messages[].subject` | Subject line from mail or manual title | string | `"No subject"` |
| `messages[].preview` | Snippet / preview of message body | string | `""` |
| `messages[].source` | Source provider label (`"Email"`, `"Slack"`, `"Messages"`, `"Manual"`) | string | `"Email"` |
| `messages[].sourceId` | Source category ID (`"email"`, `"slack"`, `"messages"`) | string | `"email"` |
| `messages[].sentDay` | Formatted day string (e.g. `"Nov 12"`) | string | `""` |
| `messages[].sentDate` | Formatted date string (e.g. `"Nov 12, 2026"`) | string | `""` |
| `messages[].sentTime` | Formatted time string (e.g. `"2:40 PM"`) | string | `""` |
| `messages[].sentAt` | Formatted combined string (e.g. `"Nov 12 · 2:40 PM"`) | string | `""` |
| `messages[].wait` | Humanized elapsed wait string (e.g. `"7d"`, `"4d 19h"`, `"25m"`) | string | `""` |
| `messages[].due` | Boolean flag indicating wait time exceeds configured threshold | boolean | `false` |
| `messages[].recent` | Boolean flag indicating sent within past 24 hours | boolean | `false` |
| `messages[].status` | Status badge (`"Overdue"`, `"Waiting"`, `"Recent"`) | string | `"Waiting"` |
| `groups` | Source categories for grouped layout | array | Default 3 groups |
| `labels.*` | Localized UI strings | object | Standard labels |
| `draftParts` | Templates for inline follow-up message drafting | object | Standard parts |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Nudge follow-up | `POST /widgets/need.waiting/actions/nudge` | Yes | Prepares local draft in `dashboard_mail_drafts` |
| Mark replied | `POST /widgets/need.waiting/actions/complete` | Yes | Marks manual item completed |
| Add manual item | `POST /widgets/need.waiting/actions/add` | Yes | Adds manual item to tracking |
| Direction switcher | Local state / `localStorage` | No | Switches active composition layout |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero waiting messages in DB / Gmail | `empty` | "All caught up" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Awaiting messages present | `ready` | Active layout (Minimal, Inbox, Timeline, Follow-up, Grouped) |
