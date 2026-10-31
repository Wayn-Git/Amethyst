# Wiring: `task.deadlines`

## Fields

| Template data | Live source | Fallback |
|---|---|---|
| `tasks[]` | `backend/dashboard/items.py:provide("task.deadlines")`, SQLite `deadlines` table | Empty array |
| `title`, `id`, `due_at` | Deadline row | Missing title is unavailable; due time is required by the API |
| Countdown and date labels | Derived from `due_at` and the browser clock | “Not available” for an invalid timestamp |
| Importance / project | Not stored for deadline rows | No importance marker; project displays “Not available” |
| Layout, labels, palette | Static `design.json`, with theme-aware tokens | Fixed layout defaults |

## Actions

| Action | Backend handler | Gate | Result |
|---|---|---|---|
| Complete deadline | `POST /api/widgets/task.deadlines/actions/complete` | Yes, through `LocalReview` and the dashboard confirmation gate | Refreshes from the deadlines table after approval |

## Statuses

Loading, empty, ready, and error follow the dashboard cache and provider response. No offline signal exists for this local provider.
