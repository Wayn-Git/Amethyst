# Add one Home widget

1. Read `AGENTS.md`, section 0 of `docs/dashboard-spec.md`, then only the target widget row; follow tier order.
2. Add its entry to `MANIFESTS` in `backend/dashboard/registry.py`; use `manifest`, `task_manifest`, or `need_manifest` as appropriate.
   Match `Manifest` in `backend/dashboard/models.py`: exact spec ID, group, tier, sizes, source, refresh, requires, actions and empty text.
   Helpers default to local MVP polling; set other fields explicitly. Invalid manifests are disabled by `validate_registry`.
3. Add the provider branch in `backend/dashboard/service.py::local_provider`; `task.*` and `need.*` dispatch to `backend/dashboard/items.py::provide`.
   `PROVIDERS` already maps registered IDs to `local_provider`; override that ID there only when a separate async provider is needed.
   Return the payload, not the cache envelope; lists use `{"items": [...]}` and empty lists use `{"items": []}`.
   `service.py` owns cache-first refresh, timeout, stale/error handling and freshness; `backend/dashboard/store.py` owns cache persistence.
   Nonempty `requires` currently produces `not-connected`; connector execution is not implemented by registering a manifest.
4. Reuse existing tables in `backend/db/schema.sql` (including `tasks`); add only needed dashboard tables to `backend/dashboard/schema.sql`.
   `backend/db/connection.py::migrate` executes both schemas. Supply an explicit safe migration for changes to existing dashboard tables.
5. For local item writes, extend the allowlisted `TABLES`, validation and apply logic in `backend/dashboard/items.py`.
   `backend/dashboard/router.py` exposes `POST /api/widgets/{id}/actions/{action}` to create a draft without changing source rows.
   `POST /api/widgets/{id}/drafts/{draft_id}` with `{"approved": true}` reviews that saved draft through `ConfirmationService`.
   Keep expiry, single-use claims, changed-row checks, turn tracing and dependent-cache invalidation; never bypass the gate.
6. Add `frontend/src/dashboard/widgets/YourWidget.jsx`, default-exporting a component accepting `{ data, refresh, widgetId }` as needed.
   Reuse `Items.jsx` for local CRUD or `NeedsItems.jsx` for the existing read-only item shapes; theme tokens only.
   `frontend/src/dashboard/WidgetFrame.jsx` and `useWidget.js` supply loading, empty, not-connected, error, stale, refresh and last-synced UI.
   Empty task widgets retain their add form; preserve an equivalent empty-state action if adding another editable widget group.
7. Add the exact ID to `WIDGETS` in `frontend/src/dashboard/registry.js`:
   `'group.name': lazy(() => import('./widgets/YourWidget.jsx')),`
   `widgets/Gallery.jsx` discovers backend manifests automatically. Enable the widget there; saved layouts need no forced change.
8. Add provider/action tests in `tests/test_dashboard_items.py` for item widgets, or a focused new test file for another provider.
   Update the exact shipped-ID assertion in `tests/test_dashboard_shell.py`; test empty data, real selection rules, persistence and rejected writes.
   Extend `frontend/tests/dashboard-items.mjs` for item behavior or `frontend/tests/dashboard-shell.mjs` for shell behavior; no screenshots.
   Run `.venv/bin/pytest tests/test_dashboard_items.py tests/test_dashboard_shell.py -q` when those paths are touched; otherwise select relevant tests.
   Browser tests require Vite and an isolated FastAPI app mounting `backend.dashboard.router.router` with a disposable `AMETHYST_HOME`.
   Run `BASE=http://127.0.0.1:5177 WIDGET_BACKEND=http://127.0.0.1:8017 TEST_WIDGETS=group.name node frontend/tests/dashboard-items.mjs` after extending its assertions.
   Run targeted Ruff/Oxlint on changed Python/JS files. Test fixtures must never use the user's database or connected accounts.
9. Once verified, tick the widget's Done box in `docs/dashboard-spec.md`, add one line to `docs/dashboard-changelog.md`, and commit that widget.

## Source-managed items

Tasks with a truthy `external_source` are source-managed: `items.py::display` returns `editable: false`.
`widgets/Items.jsx` shows “Edit in connected source.” instead of edit/complete/delete controls; adding a local item remains available.
`items.py::draft` also rejects writes to those task rows with HTTP 409, so calling the API cannot bypass the UI restriction.
Edit them in the connected source and let its existing sync update the local task cache; these widgets never write to that source.
Reminders use their own table; the reminder runner fires due rows through the persistent `sys.notify` notification center.
