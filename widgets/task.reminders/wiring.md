# Wiring: `task.reminders`

## Fields

| Template data | Live source | Fallback |
|---|---|---|
| `reminders[]` | `backend/dashboard/items.py:provide("task.reminders")`, SQLite `reminders` table | Empty array |
| `title`, `id`, `due_at` | Reminder row | Due time is required by the API |
| `repeat`, `note` | Not stored by the current reminder schema | Empty / none; editing controls for these fields are removed |
| Date/time labels | Derived from `due_at` in the browser's local timezone | “Not available” for invalid timestamps |
| Layout and labels | Static `design.json`; no fixture records are imported at runtime | Fixed layout defaults |

## Actions

| Action | Backend handler | Gate | Result |
|---|---|---|---|
| Add / edit / complete | Matching item actions in `backend/dashboard/items.py` | Yes, through `LocalReview` and the dashboard confirmation gate | Refreshes from the reminders table after approval |

## Statuses

Loading, empty, ready, and error follow the dashboard cache and provider response. The provider does not schedule notifications and has no offline signal.
