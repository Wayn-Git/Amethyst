# Wiring: `glance.sun`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from response presence / error / stale | string | `"loading"` |
| `message` | Backend `data.message` or empty string | string | `""` |
| `lastUpdated` | Formatted from current sync time or sunrise date | string | `"Not available"` |
| `sunrise` | `data.sunrise` (`backend/dashboard/weather.py:59`) formatted as `HH:MM AM/PM` | string | `"Not available"` |
| `sunset` | `data.sunset` (`backend/dashboard/weather.py:60`) formatted as `HH:MM AM/PM` | string | `"Not available"` |
| `dayLength` | Difference between `sunset` and `sunrise` wall times | string | `"Not available"` |
| `timezone` | `data.timezone` (`backend/dashboard/weather.py:62`) | string | `"Not available"` |
| `labels.*` | UI string dictionary (labels, loading, prefixes) | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| *(none)* | Display only widget | No | N/A |

## 3. Status Mapping

| Real condition | `data.status` |
|---|---|
| Initial load before data arrives | `loading` |
| `data.sunrise` and `data.sunset` present | `ready` |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` |
| `data.set_location === true` (no saved location in settings) | `empty` |
| Request failed or service unreachable | `error` |
| Client offline with cached data | `offline` |
| Payload age > refresh interval (900s) | `stale` |
