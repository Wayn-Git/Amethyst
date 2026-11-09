# Wiring: `task.conflicts`

Fields come from the cache-first `/api/widgets/task.conflicts/data` payload in `backend/dashboard/planning.py::provide`. Events come from the connected calendar through `backend/dashboard/agenda.py::provide`; conflict rows are calculated from those events. The frontend adapter groups rows by local date and formats times with the provider timezone.

| Template data | Live source | Missing value |
|---|---|---|
| `days[].dateLabel` | Provider event date and timezone | `Not available` |
| `days[].events[]` | Provider `events` (`id`, `title`, `start`, `end`) | Empty list |
| `days[].conflicts[]` | Provider `items` (`id`, `title`, `detail`, `start`, `end`) | Empty list |
| Conflict duration and times | Derived from provider interval boundaries | Omit invalid intervals |

| Action | Handler | Gate / result |
|---|---|---|
| Day and view selection | Renderer local view state | No backend write |

| Status | Condition |
|---|---|
| `loading` | No provider payload yet |
| `ready` / empty conflicts | Provider returns events without overlapping intervals |
| `error` | Provider failure or incomplete calendar |
| `not-connected` | Calendar access is unavailable |
