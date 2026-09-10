# Dashboard changelog

## 2026-10-25 — Today Bento Dashboard Redesign & Crash Fixes

- Redesigned Home view into Apple-inspired 12-column Bento Grid with live preview Gallery studio (S/M/L variants), fixed SimpleNamespace risk access in items.py, guarded conversations and layout queries against unhandled undefined filters, added menu icon in Icon.jsx.
- Polished Today dashboard and Add Widgets studio: Spotlight search bar with clear action, capsule category pills with count badges, radial stage background, ambient bento card gradients, and fluid micro-animations (soundwaves, cascade entrances, hover lifts).

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

2026-10-24 — need.drafts: local SQLite drafts, full review/edit, single-use gate requests and changed-row checks; sending disabled (Gmail read-only). Local source replaces proposed Gmail drafts. Backend and browser checks pass.

2026-10-24 — need.waiting: latest sent/reply thread comparison, 3-day configurable delay, gated manual items and local nudge drafts; bounded to 100 sent/received messages over 90 days, stated in UI. Backend and browser checks pass.

2026-10-24 — comm.unread: unread Gmail grouped by normalized sender, recent snippets and explicit 100-message limit; shared read-only cache, mocked backend and browser checks pass.

2026-10-24 — comm.tone: asynchronous short/formal/friendly rewrites via optional free models (including Ollama), reviewed local saves with revision checks; model failure preserves original. Backend and browser checks pass.

2026-10-25 — comm.templates: local template CRUD and reviewed creation of unsent local drafts; revision checks protect edits/deletes. Final proof: 80 targeted backend tests, all six mocked browser flows and targeted lint pass; live accounts/models not exercised.

- 2026-10-25: glance.next-event — read-only countdown reuses the agenda projection and calendar access switch; targeted provider/shell and component checks passed.
- 2026-10-25: need.mentions — independently connected Slack/GitHub mentions, reply-since filtering (including paginated threads and PR discussions), minimal shared Composio read cache and verified reader risk metadata; mocked backend/component and browser shell checks passed. Polling replaces push; bounded search results are labelled.
- 2026-10-25: dev.prs — read-only review-requested and authored open PR queries, deduplicated role labels, minimal shared-cache fields and visible result limits; 18 targeted backend checks and component checks passed.
- 2026-10-25: dev.issues — open issues assigned to the connected GitHub user, shared read-only search/cache and persisted minimal display fields; 20 targeted backend checks and component checks passed.
- 2026-10-25: dev.ci — latest GitHub Actions run status per repository (up to 50 recently pushed repos, limits labelled), explicit empty histories and minimal shared-cache fields; calendar reads also coalesce across agenda/next-event and retain only projected fields. All five requested widgets: 126 mocked backend tests, component checks, browser shell and changed-line lint passed; live accounts untested.

- 2026-10-25 glance.weather: explicit location settings, 12-hour forecast/rain notice, audited minimal cache; mocked backend/UI tests pass. Open-Meteo terms checked: https://open-meteo.com/en/terms free API non-commercial only, <10,000/day, 5,000/hour, 600/minute; CC BY 4.0 attribution shown. Commercial use needs a paid service.
- 2026-10-25 glance.sun: shared explicit location, daily sunrise/sunset with polar unavailable state, audited Open-Meteo reads; mocked provider/UI checks pass.
- 2026-10-25 glance.air: explicit shared location, European AQI/PM2.5/PM10 minimal projection, audited requests; CAMS ENSEMBLE and Open-Meteo attribution per https://open-meteo.com/en/docs/air-quality-api; mocked backend/UI tests pass.
- 2026-10-25 glance.music: read-only Spotify currently/recently played via audited Composio reader, minimal projection and read-only scopes; slugs verified at https://docs.composio.dev/toolkits/spotify; mocked provider/UI and connector checks pass.
- 2026-10-25 feed.rss: no default feeds; persistent reviewed add/edit tags/remove through existing gate, SSRF checks per redirect, bounded RSS/Atom reads and per-request audit; only titles/links/tags/dates cached, saved items labelled stale on failure; mocked backend/UI checks pass. Limit: 20 feeds, 20 items/feed, 1 MB/feed.
- 2026-10-25 feed.news: groups only user feeds by assigned tags (untagged items labelled), reuses projected RSS cache and manual source refresh; source manifest is RSS because no separate news API is used. All six rows: 69 targeted backend tests, mocked widget UI, Ruff/Oxlint pass; existing shell UI passed on retry after one reload timeout. No live account/API tests.

- 2026-10-25 agent.brief: optional async model selection from cached widget items, source links, persisted cache; scheduled at 08:00/18:00 local time while running (next startup catches up), manual refresh supported; model output selects source indices only.
- 2026-10-25 agent.next: optional async selection of exactly one existing approval, decision, overdue item, draft or Today task; source-derived reason and item link; no generated tasks.
- 2026-10-25 dash.palette: existing global ⌘K/Ctrl+K palette searches Library, cached widget items, widget manifests/actions and persisted tasks; quick capture reuses lib.capture review/permission gate; action results open their widget, and ⌘K now opens the palette even inside capture.
- 2026-10-25 dash.pin: saved chat answers pin/remove through the existing reviewed permission gate; SQLite stores redacted generate_sandboxed_ui declarations only, replayed as labelled offline snapshots. Pins disable scripts/live data because CSP cannot block script-driven frame navigation; inert HTML allowlist, opaque sandbox and CSP block network/parent DOM/storage. 26 focused backend tests, 31 renderer checks, browser chat/pin/removal/security checks and targeted lint pass (two existing ResponseArtifactBox escape warnings).
- 2026-10-25 Home presentation: shared card headers/freshness/source chips, skeletons and five-row drawer previews; greeting/capture header, four glance tiles, merged ranked Needs you, Morning defaults persisted without replacing saved layouts, searchable category gallery and Home settings reachable through ⌘K; no new widget IDs or provider changes. Preserved item forms across empty/populated refreshes and existing approval gates. Validation: 23 targeted backend tests; Home shell (all themes, 1440/390px, focus, keyboard, drag/resize, persistence, offline and no nested card scrolling), six item widgets, six mail widgets, connected/public/Director checks, production build and targeted Ruff/Oxlint passed. Existing agent.feed payload omits per-turn timestamps/status, so its timeline retains source titles/details; live connectors untested.
- 2026-10-25 shared widget primitives: extracted card, header, row, chip, skeleton and state views; all existing widget presentation and merged Needs you reuse them without CSS or rendered markup changes. Updated widget how-to and added focused primitive/state/draft-preservation proof. Validation: 57 before/after widget DOM comparisons, primitive checks, five CRUD widgets, six mail widgets, both insights, connected/Director/public checks and targeted lint passed (four existing warnings). Home shell passed with a temporary 60s timeout after baseline 15s navigation timeouts; the combined 16-widget item run completed its assertions but hit a route teardown race, while the focused five-widget rerun exited cleanly. No new widget IDs or Done-box changes; no screenshots or live services.

- need.lor-slack: Read-only Composio DM candidates checked against latest conversation search; bounded discovery is disclosed; no read-receipt claims. Provider and minimal UI tests pass.

- comm.thread-summary: Optional async local/free-model summaries of partial Gmail/Slack thread snippets, source links and shared caches; provider and UI tests pass.

- comm.newsletters: List-header detection, subject digest, optional local/free-model summaries and manual unsubscribe suggestions only; no send/unsubscribe tools or actions. Mocked connector and UI tests pass.

- comm.contacts: Local cached cards merge Gmail/Slack identities, last-contact dates and shared thread links; no message bodies or snippets in cards. Mocked persistence/privacy and UI tests pass.

- comm.reachout: Manual birthdays today and configurable inactivity reminders (30 days by default); local changes use existing draft/approval gate. Shared DM reads enumerate verified im conversations; metadata history is bounded. Focused mocked backend, gate/privacy and isolated-browser checks pass; live accounts/models were not exercised.

- 2026-10-25: agent.jobs — durable capped Director jobs, missed-run audit, explicit write approvals, shared-primitives UI; focused backend/UI tests passed.
- 2026-10-25: agent.delegated — durable queued/running/approval/done/failed board sharing the job lane, persisted trace viewer; focused backend/UI tests passed.
- 2026-10-25: agent.research — serial Director web-only research, sourced Library note saved after gate approval, unavailable state; focused backend/UI tests passed.
- 2026-10-25: agent.watchers — persisted serial page/mailbox polling (15-minute floor), reused appeal inbox reader, audited fetches, sys.notify alerts; focused backend/UI tests passed.
