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
- `need.overdue`: reads open tasks, deadlines and reminders, compares absolute due times and orders oldest first; task changes invalidate its cache. Ten item tests, browser source rendering and targeted lint pass.
- `need.snoozed`: durable snoozes table, returns-today reader with ready/scheduled states and local-day boundaries; resolves task/deadline/reminder titles and excludes completed or deleted items. Global quiet-hours snooze stays separate. Verified existing naive task dates use host time, SQLite update dates use UTC. Final proof: 22 backend tests, all six browser widget checks and targeted Ruff/Oxlint pass; no screenshots or unrelated suite.

- lib.inbox: Library recent captures, minimal read-only payload and Home list; provider and shell tests pass.
- lib.resurface: reuse hybrid Library search for today tasks/recent captures, show context reason; old means at least seven days. Calendar context unavailable locally.
- lib.capture: reviewed single-use note drafts through ConfirmationService, markdown vault via LibraryService.log_manual; rejection, persistence, gate refusal and keyboard checks.
- lib.search: bounded query settings, existing Library hybrid search, matching excerpts and honest keyword fallback; provider, settings and browser checks pass.
- lib.recent: Library notes ordered by persisted edit time, capture invalidates Library widgets; selection and empty browser checks pass.
- lib.dupes: reuse LibraryStore.by_url/by_source_ref to show existing duplicate identities without writes; selection tests and browser checks pass. Library dedup supports identities, not fuzzy content.
- task.agenda: read-only primary-calendar agenda/week via the existing Composio handler and ConfirmationService; minimal cache, audited reads, offline stale data, retry backoff and stop/delete control. Machine reads bypass LLM projection/truncation while retaining the gate. Targeted backend/browser/lint checks pass; live accounts untested.
- dev.appeal: gated local support cases, Sent/Waiting/Reply evidence, optional exact-domain Gmail watch and stop/delete control; optional free-model unsent follow-ups. Shared audited connector reader extracted from agenda; targeted backend/browser/lint checks pass.
- dev.recovery: user-authored mirror/clone/export checklist reusing local item review, expiry, stale-row and single-use gates; focused CRUD/backend/browser/lint checks pass.
- dev.backup: explicit repository settings, local clone/remotes/reachability, credential-free cache and honest local push evidence; bounded read-only Git processes. Disposable Git/backend/browser/lint checks pass; cross-host push time remains unknown without evidence.

- 2026-10-24 agent.feed: Uses existing recent Director traces; bounded to 50; tracing history is process-local.

- 2026-10-24 agent.running: Uses durable Director run phases and tool-call progress; Stop calls the existing turn-stop endpoint.

- 2026-10-24 agent.audit: Displays the newest 50 persisted execution-log records including permission decisions; no new logging path.

- 2026-10-24 agent.errors: Reads recorded tool failures and Director trace errors; repeated attempts remain separate records; no automatic retry action.

- 2026-10-24 need.approvals: Uses existing live confirmation snapshot (including zombie filtering) and existing approve/deny endpoint; gate and audit remain Director-owned.

- 2026-10-24 need.decisions: Uses existing suspended question waiters and answer/dismiss endpoints; options shown with free-text answers. All six Director widgets verified with isolated fixtures.

- 2026-10-24: Reused SQLite execution_logs for audit; persisted dashboard gate outcomes and exposed read-only approval history across restarts.
- 2026-10-24: dev.unpushed reports dirty working trees and each branch ahead of local tracking refs; no upstream remains unknown, no fetch or push.
- 2026-10-24: sys.vault shows indexed vault file counts/bytes, Library item count, and available storage volume capacity; no filesystem crawl.
- 2026-10-24: sys.notify persists notifications before best-effort desktop delivery; task.reminders fire once through it, quiet hours retain center history. Targeted backend and browser checks pass.
- 2026-10-24: sys.model reads the existing default tier/router and switches local/cloud defaults through single-use gated drafts; stale settings reject approval. 77 targeted backend tests, Ruff/Oxlint, and dashboard system browser checks pass.

- 2026-10-24: sys.connectors adds health and scoped Connect Links atop the agenda/appeal reader, existing SWR cache and manifest polling; audited reads, auth expiry, connector backoff/circuits and write-gate regressions covered. 85 targeted backend tests, connector UI and changed-code lint pass; GitLab confirmed, live OAuth/local SDK delivery unverified.

2026-10-24 — need.inbox: read-only Gmail, shared projected cache, optional ranking with reasons and unread/recent fallback; mocked backend and browser checks pass.
