# Wiring: `glance.weather`

The generated navy-split template consumes one `weather` object and adapts by
`layout` (`small`, `medium`, `large`). `WeatherGlance.jsx` maps the cached live
payload from `backend/dashboard/weather.py`; the fixture is not imported at
runtime.

| Template field | Live source | Missing value |
|---|---|---|
| `weather.location` | `location_name` | “No location” label |
| `weather.current.temperatureLabel` | `temperature` | em dash |
| `weather.current.condition` | `weather_code` mapped to WMO text | “Unavailable” |
| `weather.current.humidityLabel` | `humidity` | em dash |
| `weather.current.icon` | `weather_code`, `is_day` | question icon |
| `weather.hourly[]` | First five `hours[]` entries | forecast unavailable |
| `weather.daily[]` | First five `daily[]` entries | forecast unavailable |

The template’s design-only layout, palette, labels and icon allowlist live in
`design.json`. Location settings remain in the widget’s settings drawer. No
forecast values, locations, or weather artwork are synthesized.
