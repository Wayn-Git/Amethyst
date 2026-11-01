# Wiring: `glance.next-event`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from response presence / calendar connector status / event presence | string | `"loading"` |
| `message` | Backend `data.message` or empty string | string | `""` |
| `lastUpdated` | Formatted sync timestamp | string | `"Not available"` |
| `countdown` | Calculated relative minutes from now to event start (`"in Xm"`, `"Now"`, `"All day"`) | string | `"Not available"` |
| `eventTitle` | `data.items[0].title` (`backend/dashboard/agenda.py:63`) | string | `"Not available"` |
| `eventTime` | Start and end formatted time (`"15:00 - 16:00"` or `"All day"`) | string | `"Not available"` |
| `location` | `data.items[0].location` (`backend/dashboard/agenda.py:67`) | string | `"No location"` |
| `date` | Event date label (`"Today"`, `"Tomorrow"`, or `"Mon, Nov 2"`) | string | `"Today"` |
| `labels.*` | UI string dictionary | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| *(none)* | Display only widget | No | N/A |

## 3. Status Mapping

| Real condition | `data.status` |
|---|---|
| Initial load before data arrives | `loading` |
| Upcoming event present in `data.items[0]` | `ready` |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` |
| No upcoming events in calendar (`data.items.length === 0`) | `empty` |
| Calendar connector not linked (`SourceUnavailable`) | `not_connected` |
| Request failed or service unreachable | `error` |
| Client offline with cached data | `offline` |
| Payload age > refresh interval (300s) | `stale` |
