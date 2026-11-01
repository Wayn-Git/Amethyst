# Wiring: `glance.travel`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from response presence / connector status / error | string | `"loading"` |
| `message` | Backend `data.message` or empty string | string | `""` |
| `lastUpdated` | Formatted current time | string | `"Not available"` |
| `duration` | Extracted from `item.detail` or Google Maps duration | string | `"Not available"` |
| `eventTitle` | `data.items[0].title` (`backend/dashboard/travel.py:48`) | string | `"Not available"` |
| `eventTime` | Relative time to event start (`in X min`) | string | `"Not available"` |
| `route` | `data.items[0].detail` route info | string | `"Not available"` |
| `origin` | Saved home origin address from `settings_read("glance.travel")` | string | `"Home"` |
| `labels.*` | UI string dictionary | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| *(none)* | Display only widget (Origin configuration managed in drawer) | No | N/A |

## 3. Status Mapping

| Real condition | `data.status` |
|---|---|
| Initial load before data arrives | `loading` |
| `data.items[0].detail` present and valid | `ready` |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` |
| `data.set_location === true` (no origin saved) | `empty` |
| No upcoming events with a location | `empty` |
| Calendar/Maps connector not linked (`SourceUnavailable`) | `not_connected` |
| Request failed or service unreachable | `error` |
| Client offline with cached data | `offline` |
| Payload age > refresh interval (900s) | `stale` |
