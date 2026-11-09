# Wiring: `glance.next-event`

`NextEventGlance.jsx` maps the live cached calendar projection from
`backend/dashboard/agenda.py` to the generated split agenda template. The
template changes only its layout (`small`, `medium`, `large`) and palette mode;
fixture data is not imported at runtime.

| Template field | Live source | Missing value |
|---|---|---|
| `calendar.liveEvent` | First `items[]` event with a start time | Empty title/start; template shows its empty state |
| `calendar.liveEvent.title/start/end/location` | The selected calendar event | Empty string |
| `calendar.liveEvent.timeZone` | Provider `timezone` | Empty string; ISO offset remains usable |
| `calendar.liveEvent.meetingUrl` | No meeting URL is exposed by this provider | Empty string; no join link |
| `calendar.upcomingEvents[]` | `events[]`, excluding the live event | Empty list |

The widget has no design selector and no fabricated calendar values. Calendar
connection and error states remain owned by `WidgetFrame` and the provider.
