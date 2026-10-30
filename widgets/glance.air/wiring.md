# Wiring: `glance.air`

`AirQuality.jsx` maps live current readings from `backend/dashboard/weather.py`
to the generated segmented-spectrum template. The design fixture is not loaded
as runtime data.

| Template field | Live source | Missing value |
|---|---|---|
| `current.location` | `location_name` | “Location unavailable” |
| `current.usAqi` | `us_aqi` | em dash and “Unavailable” category |
| `current.euAqi` | `european_aqi` | `null` |
| `current.pm25` | `pm2_5` | unavailable value, no unit |
| `pollutants[]` | `pm10`, `carbon_monoxide`, `nitrogen_dioxide`, `ozone` | unavailable value, no unit |

Open-Meteo supplies these pollutant measurements in μg/m³. The template does
not synthesize trends, health advice, or location names. Location setup remains
in the existing settings drawer.
