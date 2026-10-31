# Wiring: `task.free`

The `/api/widgets/task.free/data` payload is produced by `backend/dashboard/planning.py::provide`, using live calendar events, configured working hours and timezone, and free intervals computed as their complement. Settings are read and saved using the existing dashboard settings endpoint.

| Template data | Live source | Missing value |
|---|---|---|
| `days[].blocks[]` | Provider `items` free intervals and `events` calendar intervals | Empty state when no free intervals |
| Block labels and durations | Provider interval start/end | Invalid intervals omitted |
| `timezone` | Provider `timezone` | `Not available` |
| Settings | `GET/PUT /api/widgets/task.free/settings` | Existing error state |

| Action | Handler | Gate / result |
|---|---|---|
| Select a free window or filter | Renderer local view state | No calendar write |
| Ask the assistant about a selected window | Existing `amethyst-send-prompt` event | Draft prompt only; no calendar write |
| Save working hours | Existing settings endpoint | Persisted dashboard preference |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` | Provider returns free intervals |
| `empty` | No free intervals are available in configured hours |
| `error` | Provider or settings request fails |
| `not-connected` | Calendar source is unavailable |
