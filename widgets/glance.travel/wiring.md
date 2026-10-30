# Wiring: `glance.travel`

`TravelGlance.jsx` maps the real read-only Google Maps driving estimate and the
next located calendar event from `backend/dashboard/travel.py` into the
generated travel-time composition. Fixture values are not loaded at runtime.

| Template field | Live source | Missing value |
|---|---|---|
| `durationMinutes` | `duration_seconds` rounded up to minutes | “—” |
| `eventName` | `event_title` | empty |
| `destination` | `destination` or event location | empty |
| `eventStartTime` | `start` formatted in `timezone` | empty |
| `homeOrigin` | configured `home` origin | empty |

The provider supplies driving only. The widget does not invent a map, route,
traffic, leave-by time, alternate mode, distance, or ETA. Origin editing and
device-location entry remain in the existing settings drawer.
