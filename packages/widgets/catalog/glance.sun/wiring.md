# Wiring: `glance.sun`

`Sun.jsx` maps live solar times from `backend/dashboard/weather.py` into the
generated horizon composition. The provider requests two days so the Small
widget can show tomorrow's sunrise after today's sunset. The template computes
daylight length only from same-day sunrise/sunset values.

| Template field | Live source | Missing value |
|---|---|---|
| `sunrise` | Today's sunrise in the provider timezone | unavailable |
| `sunset` | Today's sunset in the provider timezone | unavailable |
| `next_sunrise` | Following day's sunrise | unavailable |
| `timezone` | Open-Meteo timezone | empty; event times stay unavailable |

Local wall times are converted to timestamps using the supplied IANA timezone.
No sunrise, sunset, UV, or daylight values are fabricated. Location setup is
provided by the shared settings drawer.
