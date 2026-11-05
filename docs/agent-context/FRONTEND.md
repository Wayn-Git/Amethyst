# Frontend

React 19 single-page application built by Vite. Entry point is
`frontend/src/main.jsx`; the shell is `frontend/src/App.jsx`. There is no
frontend router configuration file: `frontend/src/nav.js` is the single page
registry and `App.jsx` turns it into routes.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry and shell

| File | Role |
|---|---|
| `frontend/src/main.jsx` | Mounts React, imports global styles |
| `frontend/src/bootstrap.js` | Startup/bootstrap helpers |
| `frontend/src/App.jsx` | Workbench shell, global keys, route generation, overlays |
| `frontend/src/nav.js` | Pages, paths, labels, rail/settings/palette visibility, digits |
| `frontend/src/views/registry.js` | Page id → component; lazy loading with chunk retry |
| `frontend/src/store.jsx` | Shared application state and preferences |
| `frontend/src/api.js` | HTTP client, SSE turn reader, endpoint wrappers |

`Chat` is imported eagerly and stays mounted outside `<Routes>` so a running
turn is not unmounted by navigation. Every other view is lazy-loaded. A failed
chunk load triggers one session-scoped reload before surfacing the error.

The reload defers while a turn owns the page: unloading kills the turn's SSE
fetch and the control stream together, which the backend then logs as a client
disconnect and the transcript blames on "the model stream". `Chat.openTurn`
sets `window.__AMETHYST_TURN_ACTIVE` for the turn and dispatches
`amethyst:turn-settled` when it ends; `views/registry.js` parks its reload on
that signal (ceiling 120s) instead of killing a streaming turn.

## Pages

`nav.js` defines these routes:

| Path | Component | Notes |
|---|---|---|
| `/chat` | `views/Chat.jsx` | Default workbench, always mounted |
| `/today` | `dashboard/Home.jsx` | Widget dashboard; `/` redirects here |
| `/tasks` | `views/Tasks.jsx` | |
| `/mail` | `views/Mail.jsx` | Beta; hidden unless beta pages enabled |
| `/converter` | `views/Converter.jsx` | |
| `/capabilities` | `views/Capabilities.jsx` | Skills and connectors |
| `/automations` | `views/Automations.jsx` | Beta; hidden unless beta pages enabled |
| `/memory` | `views/Memory.jsx` | |
| `/library` | `views/Library.jsx` | |
| `/code` | `views/Code.jsx` | Placeholder |
| `/logs` | `views/Logs.jsx` | Settings entry, not in rail |
| `/dash` | `views/Dashboard.jsx` | Status; palette/banner only |
| `/remote` | `views/Remote.jsx` | Companion page |
| `/install` | `views/Install.jsx` | |
| `/settings` | `views/Settings.jsx` | |
| `*` | redirect | Sends unknown paths to `/today` |

`/pair` is not a route. `Pair` is rendered by `App.jsx` when the backend is
unreachable and the device is not paired. `RemoteOnly` is rendered when a paired
device cannot reach the host.

Beta gating is real: `forRoutes`, `forRail`, `forSettings` and `forPalette` all
filter beta pages when the preference is off. A disabled beta page is not
routed.

## State

`store.jsx` holds only state shared across surfaces: current view, server health,
conversation list, active conversation, capabilities, overlays, rail/panel
layout, and preferences. The transcript and streaming turn state stay inside
`Chat` because they change on every token.

Preferences persist in `localStorage` under `amethyst.ui.v1`. An allowlisted
subset is also sent to the backend for cross-device sync. Per-device values such
as panel width, text size, active conversation and workspace are deliberately
excluded. See [systems/state.md](systems/state.md).

## API client

`api.js` centralizes:

- base-origin resolution and backend wake-up;
- JSON request helpers and error normalization;
- the SSE reader for `POST /api/conversations/{id}/turn`;
- endpoint wrappers for conversations, providers, connectors, MCP, tasks, mail,
  library, memory, automations, widgets, sync, remote control and settings.

Do not call `fetch` directly from a view when a wrapper exists. Add the wrapper
next to its domain group so the API surface stays discoverable.

## Styling and motion

Global tokens are in `frontend/src/index.css` and `frontend/src/globals.css`.
Tailwind 4 is present, but most application styling is semantic CSS variables
plus per-view CSS files. Shared bento primitives live in
`frontend/src/components/ui/bento/`. Motion tokens and reduced-motion handling
live in `frontend/src/motion.js`.

Rules that the code follows:

- Animate transform and opacity, not layout properties.
- Respect `prefers-reduced-motion`.
- Use semantic tokens (`--canvas`, `--surface`, `--text`, `--accent`,
  `--border`) rather than hard-coded palette values.
- Reuse `AppButton`, `NativeSelect`, inputs, switches and bento primitives
  instead of raw controls.

See [components/design-system.md](components/design-system.md).

## Directory map

| Path | Contents |
|---|---|
| `frontend/src/views/` | Route-level pages |
| `frontend/src/dashboard/` | Today dashboard shell, widgets, layout, API |
| `frontend/src/components/` | Shared and feature components |
| `frontend/src/components/ui/` | Primitives, including bento |
| `frontend/src/components/agents/` | Message, streaming, approval, code-block components |
| `frontend/src/components/widgets/` | Generative-UI renderers used inside chat |
| `frontend/src/lib/sync/` | Sync client, crypto, HLC, replica, pairing |
| `frontend/src/mobile/` | Capacitor companion startup, captures, storage, updates |
| `frontend/src/hooks/` | Media-query and shared hooks |
| `frontend/src/styles/` | Cross-view CSS |
| `frontend/tests/` | Node-based frontend verification scripts |

## Mobile

The same Vite bundle is synced into Capacitor under `frontend/android` and
`frontend/ios`. `frontend/src/mobile/startup.js` and `native.js` handle native
startup; `lib/sync/` handles pairing and replication. See
[sections/remote-mobile.md](sections/remote-mobile.md).

## Change guidance

**Add a page.** Add an entry to `nav.js`, a loader to `views/registry.js`, and
the view file. If it is beta, set `beta: true`; do not add a separate gate.

**Add a keyboard action.** Add it to the one global listener in `App.jsx`.
Component-local handlers are fine only for fields and open menus, and should
stop propagation when they act.

**Add an API call.** Add a wrapper in `api.js`, then use it from the view. Keep
streaming endpoints on the existing SSE reader.

**Add shared state.** Put it in `store.jsx` only if more than one surface must
agree. Otherwise keep it local.

## Known issues

- `views/Today.jsx` and `views/today/` are unreferenced legacy code. Do not
  assume they render `/today`.
- `views/Code.jsx` is a static “In Development” page.
- `views/Memory.jsx` falls back to sample facts on empty or failed loads; this
  is demo content, not data.
- `Chat.jsx` is very large. Prefer extracting a component over adding another
  branch to it.

## Related

- [components/shared.md](components/shared.md)
- [components/design-system.md](components/design-system.md)
- [sections/chat.md](sections/chat.md)
- [sections/today.md](sections/today.md)
- [systems/state.md](systems/state.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
