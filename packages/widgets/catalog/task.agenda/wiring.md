# Wiring: `task.agenda`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from data presence / state / empty | string | `"loading"` |
| `sizeChoice` | Slot size (`"medium"`, `"large"`) | string | `"medium"` |
| `mediumLayout` | Medium layout direction (`"agenda"`, `"strip"`, `"minimal"`) | string | `"agenda"` |
| `largeLayout` | Large layout direction (`"split"`, `"timeline"`, `"grid"`) | string | `"split"` |
| `appearance` | Host theme mode (`"light"`, `"dark"`) | string | `"light"` |
| `week` | 7-day schedule array from `backend/dashboard/agenda.py` | array | `[]` |
| `week[].events` | Timed events for each day | array | `[]` |
| `week[].allDay` | All-day events for each day | array | `[]` |
| `calendarRed` | Theme colors for current day indicator | object | Standard palette |
| `categoryColors` | Theme colors for categories (work, personal, focus) | object | Standard palette |
| `labels.*` | Localized UI strings | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| View calendar | `task.agenda` settings drawer | No | Opens settings drawer with full week list |
| Toggle calendar access | `PUT /widgets/task.agenda/settings` | No | Enables or stops Google Calendar access |

## 3. Status Mapping

| Real condition | `status` | Rendered View |
|---|---|---|
| Initial load before data arrives | `loading` | Loading skeleton matching slot dimensions |
| Zero events in the week | `empty` | "No upcoming events this week" |
| Google Calendar not connected | `not_connected` | Connect Google Calendar card |
| Backend query failure | `error` | Calendar unavailable alert card |
| Calendar events present | `ready` | Active layout (Agenda, Strip, Minimal, Split, Timeline, Grid) |
