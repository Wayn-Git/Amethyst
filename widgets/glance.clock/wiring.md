# Wiring: `glance.clock`

The renderer is `frontend/src/dashboard/widgets/Clock.jsx`; it uses the native
clock faces in `frontend/src/dashboard/widgets/clock/` so the saved face choice
can change the composition at runtime. Time and date come from the device clock
and timezone. World rows come only from the saved `zones` setting.

| Value | Source | Missing value |
|---|---|---|
| Local time and date | Device clock and local IANA timezone | No fabricated fallback time or zone |
| World clock rows | `GET /api/widgets/glance.clock/data` payload `zones[]` | No rows when none are saved |
| Selected face | Size-specific `clock-sm-*`, `clock-md-*`, or `clock-lg-*` id in `layout.widgets[].design`, saved through `PUT /api/layout?mode=...` | Face 01 for the current slot size |

World-clock add/remove writes use `PUT /api/widgets/glance.clock/settings` with
`{ zones: string[] }`. The UI validates IANA timezones, rejects duplicates,
limits the list to four, and displays returned saved settings. Face selection
preserves the current widget size. Fixture data is not imported by the runtime.
