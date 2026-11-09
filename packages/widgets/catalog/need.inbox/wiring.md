# Wiring: `need.inbox`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `density` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `mediumStyle` | Active medium composition (`minimal`, `inbox`, `mediumEditorial`) | string | `"minimal"` |
| `largeStyle` | Active large composition (`grouped`, `priority`, `largeEditorial`) | string | `"grouped"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `messages` | Computed from `items` array returned by `backend/dashboard/mail.py` | array | `[]` |
| `messages[].id` | Message ID from Gmail API | string | `""` |
| `messages[].sender` | Sender display name | string | `"Unknown sender"` |
| `messages[].initials` | 2-character initials of sender | string | `""` |
| `messages[].email` | Sender email address | string | `""` |
| `messages[].subject` | Message subject line | string | `"No subject"` |
| `messages[].preview` | Snippet / preview of message body | string | `""` |
| `messages[].time` | Local formatted time or date | string | `""` |
| `messages[].unread` | Boolean unread status | boolean | `false` |
| `messages[].needsReply` | True if model or thread detects reply needed | boolean | `false` |
| `messages[].priority` | Priority tier (`"urgent"`, `"important"`, `"other"`) | string | `"important"` |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| Toggle model ranking | `PUT /widgets/need.inbox/settings` | No | Enables/disables LLM priority ranking |
| Layout switcher | Local state / `localStorage` | No | Switches active composition layout |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero messages in inbox | `empty` | "Inbox zero" checkmark card |
| Backend query failure or error state | `error` | Unavailable alert card with message |
| Messages present | `ready` | Active composition style (Minimal, Inbox, Editorial, Grouped) |
