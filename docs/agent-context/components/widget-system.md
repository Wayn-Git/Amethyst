# Widget System

The Home dashboard contract: 80 validated widget manifests, a lazy frontend
renderer registry, a SQLite cache, per-widget refresh, and a persisted 12-column
bento layout.

**Verified 2026-11-02 · commit `ba6b9f3` · dirty working tree.**

Related: [sections/today.md](../sections/today.md), [FRONTEND.md](../FRONTEND.md),
[BACKEND.md](../BACKEND.md), [DATABASE.md](../DATABASE.md),
[components/design-system.md](design-system.md), [DATA-FLOW.md](../DATA-FLOW.md).

## Source map

```text
backend/dashboard/registry.py       MANIFESTS, CATALOG, JSON Schema, REGISTRY
backend/dashboard/models.py         Manifest, Position, Layout, settings models
backend/dashboard/router.py         /api/widgets, /api/layout, settings, actions
backend/dashboard/service.py        scheduling, cache reads, refresh, quiet hours
backend/dashboard/store.py          widget_cache, widget_settings, layouts
backend/dashboard/<domain>.py       one provider per widget family
backend/dashboard/connectors.py     connector access, backoff, READ_TOOLS
frontend/src/dashboard/Home.jsx     grid, edit mode, drawers, drag/resize
frontend/src/dashboard/registry.js  widget id -> lazy React component
frontend/src/dashboard/useWidget.js cache-first fetch, polling, invalidation
frontend/src/dashboard/WidgetFrame.jsx  frame, states, actions, boundary
frontend/src/dashboard/WidgetSlot.jsx   grid slot, collapse, edit controls
frontend/src/dashboard/primitives.jsx   WidgetCard, WidgetHeader, WidgetState
frontend/src/dashboard/presentation.js  content patterns and labels
frontend/src/dashboard/widgets/         widget renderers
frontend/src/dashboard/layout.js        groups, defaults, sizing, quiet hours
scripts/check-widget-map.py             backend/frontend/docs parity check
docs/ui-widget-map.md                   generated widget inventory
frontend/src/dev/widgets/manifests.json dev manifest snapshot
```

## Manifest contract

Every widget is a validated manifest in `backend/dashboard/registry.py`. Invalid
entries are disabled with an error, not allowed to crash startup.

| Field | Rule |
|---|---|
| `id` | `group.name`, lowercase, stable; layouts and cache key on it |
| `title` | 1–100 characters |
| `description` | Catalog copy, independent of runtime empty state |
| `icon` | Named house icon |
| `group` | `dashboard`, `glance`, `needs-you`, `communication`, `agent`, `library`, `tasks`, `developer`, `student`, `feed`, `life`, `system`, `proactive` |
| `tier` | `mvp`, `v2`, `later` |
| `sizes` | 1–5 of `s`, `m`, `l`, `wide`, `tall` |
| `source` | One source object or a list: `local`, `library`, `composio`, `api`, `rss`, `director`, `llm`, `git` |
| `refresh` | `poll` requires `interval_s`; schema and model both enforce it |
| `requires` | Optional `connector:<toolkit>` gates |
| `actions` | Declared actions; `gate: true` means confirmation |
| `empty` | Useful empty-state copy |

The shipped registry contains **80 widgets**. The count is verified by
`len(MANIFESTS)` and by the parity script. `wide` and `tall` are accepted by the
model and the bento CSS, but no shipped manifest currently advertises them.
`Position.height` is 2–8; `Layout.widgets` is capped at 50 and ids must be
unique.

`CATALOG` supplies `description` and `icon` for every shipped id. A legacy custom
manifest without those fields remains valid because the model supplies defaults.

## Backend API

Router prefix is `/api`; every path below is absolute.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/widgets` | `{ widgets: [{ manifest, enabled, error }], schema }` |
| `GET` | `/api/widgets/{id}/data` | Cached payload; schedules a refresh when stale |
| `POST` | `/api/widgets/{id}/refresh` | Forces a refresh, returns current cache |
| `GET` | `/api/layout?mode=default` | Saved layout or generated default |
| `PUT` | `/api/layout?mode=default` | Validates ids, sizes and uniqueness; persists |
| `GET` | `/api/widgets/{id}/settings` | Per-widget settings; planning widgets share `task.free` |
| `PUT` | `/api/widgets/{id}/settings` | Validates the widget-specific settings model |
| `POST` | `/api/widgets/{id}/actions/{action}` | Declared action; permission gate where required |
| `GET` | `/api/connectors/health` | Connector status used by setup states |
| `POST` | `/api/connectors/{toolkit}/connect` | Starts a Composio connect flow |

Unknown ids return 404. A disabled manifest returns 409. A size the manifest does
not advertise returns 422.

## Refresh and cache model

`backend/dashboard/store.py` owns three tables:

- `widget_cache` — `widget_id`, `payload_json`, `state`, `error`, `synced_at`;
- `widget_settings` — per-widget JSON settings;
- `layouts` — one JSON layout per mode.

Allowed cache states are `loading`, `ok`, `empty`, `not-connected`, `error` and
`stale`. `read_data()` marks a payload stale when its refresh interval has
expired, and reports `refreshing` when a refresh is in flight.

`service.schedule()`:

- skips a widget already in flight;
- honours per-widget retry backoff;
- pauses scheduled refresh during quiet hours, while still allowing initial
  local data;
- forces refresh when the caller asks;
- runs providers under a semaphore of four;
- keeps the last good payload on failure and writes an error state;
- writes `not-connected` when a required connector is unavailable;
- invalidates relevant read caches for connector-backed widgets.

Providers are ordinary async functions under `backend/dashboard/` and are wired
in `service.local_provider()`. They must return JSON-serializable payloads.
Widget-specific generation work (briefs, summaries, Library answers) has a
60-second timeout; other providers get 10 seconds.

Quiet hours come from `dash.quiet` settings: `enabled`, `start`, `end`,
`timezone`, `snoozed_until`. `quiet_active()` uses the configured zone, not the
browser clock. `Alt+Q` snoozes refresh for one hour.

## Frontend render pipeline

1. `Home.jsx` fetches `/widgets`, `/layout?mode=...` and `dash.quiet` settings.
   Manifests and layouts are cached in device-scoped localStorage.
2. It filters to enabled manifests, resolves positions and renders one
   `WidgetSlot` per position.
3. `WidgetFrame` calls `useWidget(manifest, quiet, refreshVersion, onData)`.
4. `useWidget` seeds from the localStorage cache, requests
   `/widgets/{id}/data`, and remembers the result. A cached payload displays as
   `stale` until fresh data arrives.
5. `WidgetPresentation` resolves the renderer from `WIDGETS[id]`, picks a
   content pattern from `presentation.js`, and wraps the body in
   `WidgetBoundary`, `WidgetState` and `Suspense`.
6. `WidgetSlot` owns the grid cell, collapse state, drag handles and edit-mode
   size controls.

`WidgetFrame` also handles:

- header title, count, source and freshness;
- refresh, menu, setup and remove actions;
- `not-connected` and `error` setup panels with a connect/reconnect path;
- the preview body versus the expanded workbench drawer;
- size-change and add animations, skipped under reduced motion;
- an error boundary that retries when the payload changes.

Glance widgets (`glance.air`, `glance.music`, `glance.next-event`, `glance.sun`, `glance.travel`, `glance.weather`) and task widgets (`task.backlog`, `task.conflicts`, `task.deadlines`, `task.free`, `task.goals`, `task.habits`, `task.kanban`, `task.plan`, `task.reminders`, `task.risk`) render via `@tugan/widgets` `WidgetRenderer` using exact templates generated from `widgets.gan.dev/playground` per `docs/widget-playground/WIDGET_LOOP.md`. Artifacts reside in `widgets/<widget-id>/` (`template.txt`, `data.fixture.json`, `meta.json`, `wiring.md`), with adapters in `frontend/src/dashboard/widgets/` mapping live providers to template contracts; fixture data is not loaded at runtime. `glance.clock` uses its existing native `ClockFace` variants because its persisted design setting selects among nine live-time faces; it reads only saved world zones.


`useWidget` invalidates on window events:

| Event | Refreshes |
|---|---|
| `dashboard-items-changed` | `task.*`, `need.*`, `lib.*`, `dev.*`, `feed.*` |
| `dashboard-settings-changed` | Widgets listed in `event.detail` |
| `dashboard-clock-changed` | `glance.clock` |
| `dashboard-location-changed` | `glance.weather`, `glance.air`, `glance.sun` |
| `dashboard-connectors-changed` | Widgets whose source toolkit changed |

Polling runs only when the manifest mode is `poll`, the page is visible and
quiet hours are off. A payload with `refreshing: true` triggers one follow-up
read after 500ms.

## Layout and editing

`layout.js` defines the 12-column spans: `s = 3`, `m = 6`, `l = 12`. The bento
CSS narrows those spans at container breakpoints. `Home.jsx` also supports
`wide` and `tall` display sizes when a manifest advertises them.

Editing supports:

- pointer drag to reorder, with an undo toast;
- pointer drag or size fields to resize;
- keyboard move with arrow keys;
- collapse per slot;
- add from the catalog drawer;
- remove from the widget menu;
- “Fit widgets” to preferred manifest sizes.

Glance widget settings and the add catalog show live previews for each design at
Small, Medium and Large. Adding a preview stores both its selected size and
design id; applying a design to an existing widget preserves its slot size.
Widget renderers receive the active variation and continue to use live provider
data. The size tabs control preview size only until an Add action is chosen.

Saves are serialized through a promise queue so an earlier slow request cannot
overwrite the latest layout. The client writes optimistically, caches locally
and reports a save failure without discarding the local layout. `Escape` cancels
an in-progress drag or resize.

Default layouts are generated by `store.layout_read()` when a mode has no saved
row. `morningLayout()` upgrades only the untouched legacy default; custom
layouts keep their order and sizes.

## Adding or changing a widget

1. Add the manifest in `backend/dashboard/registry.py`, using a helper or a full
   dict. Add catalog copy to `CATALOG`.
2. Add a provider under `backend/dashboard/` and wire it into
   `service.local_provider()`.
3. Add settings/action models and handlers in `backend/dashboard/router.py` if
   the widget needs them.
4. Add the renderer under `frontend/src/dashboard/widgets/` and register the id
   in `frontend/src/dashboard/registry.js`.
5. Add the id to the appropriate group/default in
   `frontend/src/dashboard/layout.js` if it belongs on Home by default.
6. Update `docs/ui-widget-map.md` and regenerate
   `frontend/src/dev/widgets/manifests.json`.
7. Run `python scripts/check-widget-map.py` and the dashboard tests.

Do not fetch connector data in the browser. The backend owns auth, caching,
source access and failure handling. A renderer should consume the payload and
call declared actions; it should not invent a second data path.

## Known issues

- The backend has 80 manifests; the frontend registry must match exactly. A
  missing renderer produces “Widget component unavailable”, not a build error.
- `frontend/src/views/Today.jsx` and `frontend/src/views/today/` are legacy and
  call `/api/today/*`, a separate tracked-items API. Do not edit them for a
  `/api/widgets/*` change.
- `docs/ui-widget-map.md` and the dev manifest snapshot are generated
  inventories. They go stale when the registry changes; the parity script is
  the check.
- Refresh is best-effort. A failed source keeps the last payload and shows
  stale/error rather than throwing.
- Quiet hours suppress scheduled refresh but not an explicit user refresh.
- `WidgetFrame` renders `wide` and `tall` display sizes, but no shipped manifest
  currently advertises them; adding one requires a manifest change, not only a
  CSS change.

## Related

- [sections/today.md](../sections/today.md) — Home route and layout
- [components/design-system.md](design-system.md) — bento tokens and motion
- [DATA-FLOW.md](../DATA-FLOW.md) — widget request and refresh flow
- [DATABASE.md](../DATABASE.md) — dashboard tables
- [BACKEND.md](../BACKEND.md) — router and service conventions
- [DEVELOPMENT-GUIDE.md](../DEVELOPMENT-GUIDE.md) — verification commands

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
