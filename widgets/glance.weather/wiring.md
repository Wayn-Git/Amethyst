# Wiring: `glance.weather`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from response presence / error / stale | string | `"loading"` |
| `message` | Backend `data.message` or empty string | string | `""` |
| `lastUpdated` | Formatted current/forecast time | string | `"Not available"` |
| `temperature` | `data.temperature` (`backend/dashboard/weather.py:95`) formatted with `°` | string | `"Not available"` |
| `condition` | Derived from `data.weather_code` (WMO code translation) | string | `"Not available"` |
| `location` | `data.timezone` formatted city name | string | `"Not available"` |
| `feelsLike` | `data.feels_like` formatted with `°` | string | `"Not available"` |
| `wind` | `data.wind_speed` formatted with ` km/h` | string | `"Not available"` |
| `rainAlert` | `"Rain likely"` if `data.rain_alert` is true | string | `""` |
| `hours` | First 4 entries of `data.hours` (`time`, `temp`, `rain`) | array | `[]` |
| `labels.*` | UI string dictionary (labels, loading, prefixes) | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| *(none)* | Display only widget | No | N/A |

## 3. Status Mapping

| Real condition | `data.status` |
|---|---|
| Initial load before data arrives | `loading` |
| `data.temperature` present and valid | `ready` |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` |
| `data.set_location === true` (no saved location in settings) | `empty` |
| Request failed or service unreachable | `error` |
| Client offline with cached data | `offline` |
| Payload age > refresh interval (900s) | `stale` |
