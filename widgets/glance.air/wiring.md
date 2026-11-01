# Wiring: `glance.air`

## 1. Fields

| Field | Backend source | Type | Fallback if missing/null |
|---|---|---|---|
| `status` | Computed from response presence / error / stale | string | `"loading"` |
| `message` | Backend `data.message` or empty string | string | `""` |
| `lastUpdated` | Formatted from `data.time` (`backend/dashboard/weather.py`) | string | `"Not available"` |
| `aqi` | `data.european_aqi` (`backend/dashboard/weather.py:52`) | string | `"Not available"` |
| `category` | Derived from `european_aqi` (0-20: Good, 20-40: Fair, 40-60: Moderate, 60-80: Poor, 80+: Very Poor) | string | `"Not available"` |
| `pm2_5` | `data.pm2_5` (`backend/dashboard/weather.py:52`) with unit `µg/m³` | string | `"Not available"` |
| `pm10` | `data.pm10` (`backend/dashboard/weather.py:52`) with unit `µg/m³` | string | `"Not available"` |
| `labels.*` | UI string dictionary (labels, loading, prefixes) | object | Standard labels |

## 2. Actions

| Action Type | Backend Handler | Gate Required | Result / Next State |
|---|---|---|---|
| *(none)* | Display only widget | No | N/A |

## 3. Status Mapping

| Real condition | `data.status` |
|---|---|
| Initial load before data arrives | `loading` |
| `data.european_aqi` present and valid | `ready` |
| Background re-fetch in progress (`data.refreshing === true`) | `refreshing` |
| `data.set_location === true` (no saved location in settings) | `empty` |
| Request failed or service unreachable | `error` |
| Client offline with cached data | `offline` |
| Payload age > refresh interval (900s) | `stale` |
