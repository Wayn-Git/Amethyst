# Dashboard changelog

## 2026-10-24 — Day 1 shell

- `dash.gallery`: lazy widget registry, startup JSON Schema validation, disabled invalid manifests, drag/reorder and discrete resize, keyboard controls, SQLite layouts by mode.
- `dash.sync`: independent cache-first reads, bounded background refresh, visible freshness, per-widget and all-widget manual refresh.
- `dash.quiet`: persisted timezone-aware quiet hours and one-hour snooze; manual refresh remains available.
- `dash.shortcuts`: displays implemented refresh, snooze, edit, move and cancel shortcuts.
- `glance.clock`: live local clock and up to four persisted IANA world clocks; no external data source.
- Shared shell: loading, empty, not-connected, error and stale states; lazy components and independent error boundaries. Browser cache supports offline reload after first visit; SQLite remains authoritative.
- Existing conventions: Home uses `/today` and existing theme/font tokens. Existing phone remote-first routing remains; desktop mode provides the responsive grid. Previous Today implementation is retained but no longer loaded by this route.
- Scope: quiet settings affect Home polling only, not system notifications or agent jobs. Initial local reads can populate during quiet hours. Equal start/end means all-day quiet. Settings/layout writes are local preferences; no source-action endpoint or connector is implemented. Invalid manifests log server-side and appear disabled; `sys.logs` remains future work.
- Results: 9 backend tests passed; browser regression, targeted lint, and production build passed. Existing dependency deprecation and bundle-size warnings remain.
- Validation: `pytest tests/test_dashboard_shell.py -q`; Ruff for the dashboard package/tests; Oxlint for dashboard source/browser test; frontend production build; `node frontend/tests/dashboard-shell.mjs` against isolated FastAPI and Vite servers. No screenshots.

### Browser test setup

Start Vite on port 5177. Start an isolated FastAPI app with `backend.dashboard.router.router` mounted on port 8017 and a disposable `AMETHYST_HOME`; the test resets that database's layout and widget settings. Run `node frontend/tests/dashboard-shell.mjs`. Override `BASE`, `WIDGET_BACKEND`, or `CHROMIUM_PATH` if needed. Browser tests use labelled synthetic failure/state fixtures and never connect accounts.

- `task.today`: existing tasks table, Today by My Day/due/scheduled date, inline CRUD with durable single-use drafts, Director confirmation service and turn trace; connected-source rows remain source-managed. Added isolated browser CRUD coverage; 13 backend tests and targeted lint pass. `docs/widget-howto.md` is absent; existing shell conventions used. Dashboard table bootstrap lives beside dashboard providers to avoid unrelated schema edits.
- `task.backlog`: open tasks outside Today, oldest update first with idle days; shared inline gated CRUD. Six item tests, browser CRUD and targeted lint pass.
- `task.deadlines`: durable deadlines table, required offset-aware due dates, nearest-due sorting, live countdowns and inline gated CRUD; seven item tests, browser CRUD and targeted lint pass.
- `task.reminders`: separate reminders table and inline gated CRUD; stores and displays due state without entering the existing task notification scan. Notifications remain deferred to `sys.notify`. Nine item tests, browser CRUD and targeted lint pass.
