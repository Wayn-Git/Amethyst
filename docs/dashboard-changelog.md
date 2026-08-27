# Dashboard changelog

- 2026-10-30 · `settings.general`: revamped General section with 7 squircle cards (workspace, editor destination, lifecycle & sleep prevention, chat archive & compaction, speed tiers, composer steer/queue, confetti) and 3-group sidebar with live search; backend endpoints and pytest tests pass.
- 2026-10-29 · `dash.palette`: Raycast & Wox v2 redesign with docked action footer, search header, Ask AI pill, kind badges, and full-width layout; spotlight, splitpane, actionpanel, and dashboard-palette tests pass.
- 2026-10-28 · `glance.clock`: rounded square reference dial, independent live clock, world times/dates on Today, immediate saved settings propagation, safe timezone validation and save retries; 19 backend tests, clock/Glance browser checks (nine themes, three sizes/widths), focused lint and build pass. No screenshots; exact visual fidelity and other widgets remain unreviewed this session.

## 2026-10-25 — Today Bento Dashboard Redesign & Crash Fixes

- Redesigned Home view into Apple-inspired 12-column Bento Grid with live preview Gallery studio (S/M/L variants), fixed SimpleNamespace risk access in items.py, guarded conversations and layout queries against unhandled undefined filters, added menu icon in Icon.jsx.
- Polished Today dashboard and Add Widgets studio: Spotlight search bar with clear action, capsule category pills with count badges, radial stage background, ambient bento card gradients, and fluid micro-animations (soundwaves, cascade entrances, hover lifts).
- Fixed 1-column collapse bug for M widgets, replaced 44px box styles with modern pill/squircle touch targets, and streamlined Add Widget drawer into 1-click catalog cards with inline size selectors.
- Scaled down Today dashboard sizing across headings (24px), glance tiles (110px), buttons (32px), cards, and drawer (500px) to match standard desktop density in Tasks and Library.
- Matched Image 4 exact Bento Grid: clean light neutral canvas, pure white cards, circular pastel icon badges, integrated task command pill, collapsible template composer, and streamlined Add Widget catalog rows.

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
- 2026-10-25: agent.rules — audited reviewed per-tool rules in existing gate, write always-allow rejected, scheduled writes require fresh approval; permission/backend/UI tests passed.
- 2026-10-25: agent.usage — Director token/latency totals over the recent session, exact cached cloud rate estimates only, honest unavailable values; 97 focused backend tests and six widget UI checks passed.
- 2026-10-25: agent.research — trace the reviewed Library save separately and link results through the supported Library title filter; eight focused backend tests and all six UI checks passed.

- 2026-10-25 task.plan: deterministic, estimate-based proposals in user-set working hours; read-only Composio calendar/shared cache, fixed-clock and functional UI tests. No model needed.
- 2026-10-25 task.free: saved working days/hours/timezone, merged busy intervals and all-day blocking, transparent-event exclusion, shared calendar cache and dependent-data deletion; fixed-clock tests pass.
- 2026-10-25 task.conflicts: overlapping busy events and deadline days without free slots, user timezone and deadline-horizon calendar reads; fixed-clock mocked Composio tests pass.
- 2026-10-25 task.risk: deterministic cumulative task estimates versus free minutes before each deadline, overdue/high/unknown/fits outcomes; missing estimates never imply safety, no model calls; fixed-clock tests pass.
- 2026-10-25 glance.travel: home-location settings, next located event, audited read-only Maps duration with shared minimal cache and honest setup/unavailable states; catalogue verified at https://docs.composio.dev/toolkits/google_maps (actual slug google_maps, GOOGLE_MAPS_GET_ROUTE); mocked fixed-clock and functional UI tests pass. Calendar stop prevents in-flight data restoration. Live accounts not tested; existing unrelated lint findings excluded.

- 2026-10-25 lib.ask: cached async Library retrieval; local/free model selects validated verbatim note passages, with source links and an offline extractive fallback; focused backend/UI checks passed.
- 2026-10-25 lib.readlater: Library URL queue, gated saves, async local/free summaries in the widget cache, and audited page fetches including redirects; backend/UI checks passed. Existing reader lint findings remain outside these edits.
- 2026-10-25 lib.highlights: pasted highlights saved as gated Library notes with durable article references; source-change checks and backend/UI tests passed.
- 2026-10-25 lib.daily: deterministic prompts, gated per-day Library note creation with concurrent reuse and a model-free scaffold, and source-note opening; backend/UI checks passed.
- 2026-10-25 lib.collections: gated named tag collections, note tagging through LibraryStore and filtering through LibraryService; 47 focused backend tests, all five widget UI flows and shared-primitives checks passed. Live models/pages were mocked; existing reader lint findings remain.

- 2026-10-25 task.focus: gated settings/start/stop, persistent session log, restart-safe sys.notify completion; focused backend and functional UI tests pass.

- 2026-10-25 task.habits: gated local creation/check-ins, daily or Monday-based weekly targets, date-derived streaks; fixed-clock backend and functional UI checks pass.

- 2026-10-25 task.goals: gated local goals with target dates, manual percentages or live existing-task progress; fixed-clock backend and functional UI checks pass.

- 2026-10-25 task.focus: completion reuses the shared notification dispatcher, including quiet hours and desktop delivery; worker retries tick failures.

- 2026-10-25 task.kanban: projects reuse existing local task lists; editable columns store placement only, gated moves update canonical task status and dependent caches. All four widgets: 32 focused backend tests, fixed-clock Asia/Kolkata UI checks and targeted lint pass.

- 2026-10-25 agent.knows: existing memory facts, gated edits and real deletes, audit entries, shared-primitives UI; targeted backend and browser checks passed.

- 2026-10-25 — UI shell on ui-redesign: theme-aware controls, responsive slots, accessible edit/undo, grouped Add widget drawer, design-system/ownership docs and raw-control warnings; no widget or backend changes.

- 2026-10-25 — `glance.clock`: UI-only instrument tile pilot on `ui-redesign`; shared theme primitives, responsive states and pattern guide; existing contracts and permission flow retained.
- 2026-10-25 — `need.inbox`: UI-only read-only list pilot on `ui-redesign`; shared theme primitives, responsive states and pattern guide; existing contracts and permission flow retained.
- 2026-10-25 — `task.today`: UI-only editable list pilot on `ui-redesign`; shared theme primitives, responsive states and pattern guide; existing contracts and permission flow retained.
- 2026-10-25 — `agent.feed`: UI-only timeline pilot on `ui-redesign`; shared theme primitives, responsive states and pattern guide; existing contracts and permission flow retained.

- 2026-10-25 — `glance.clock`, `need.inbox`, `task.today`, `agent.feed`: revise pilot hierarchy after visual feedback; contrasting theme-based clock, smaller metadata, denser borderless lists, reduced preview bounds; full Home and narrow-slot fixture checks pass.

- 2026-10-26 — `glance.music`: replace Spotify connector reads with shared local Linux MPRIS status and player-targeted previous/play/pause/next drafts through the permission gate; reuse one component in tile/drawer, honor capabilities and reject changed sessions; focused backend/browser checks pass.

- 2026-10-26 — Today reference revamp: isolated compact frame, 7/5 main/side packing, integrated edit controls, category catalog and tabbed Home settings; focused browser checks cover addition, settings navigation, mobile controls, themes and reduced motion.

- 2026-10-26 — UI session 1 foundation: Paper-first three-tone tokens for nine modes, isolated bento grid/primitives and controls, dev-only /dev/ui, text design system/checklist; extended Manifest.sizes and Position.size with wide/tall (no registered widget or Home content changes); reused raw-control lint warning.

- 2026-10-26 · UI session 2: Home bento structure, compact connections, quiet chrome, isolated reorder renders, snap resize/undo and settings/catalog drawers; frontend-only, existing navigation and contracts retained.

- 2026-10-26 · UI session 3 `dash.gallery`: responsive Add widget cards with tone silhouettes, 80 distinct manifest icons/descriptions, sizes, connector links, On Home/Remove, entrance/highlight and modal-accessible undo; additive manifest metadata only, source and permission contracts retained.

- 2026-10-26 · UI session 4 · glance.clock: dark hero time, stable tabular digits and reduced-motion-aware value entrance.
- 2026-10-26 · UI session 4 · glance.weather: accent hero, rain chip, shared full-view stat and real hourly sparkline.
- 2026-10-26 · UI session 4 · need.inbox: sender initials, kind chips and server-backed ranking switch.
- 2026-10-26 · UI session 4 · task.today: inline draft add, gated checkbox and explicitly labelled current-list ring; completed-history data unavailable.
- 2026-10-26 · UI session 4 · task.focus: saved-session ring and gated start/stop; pause/resume blocked by unchanged API.
- 2026-10-26 · UI session 4 · agent.feed: dark timeline rail, nodes and mono source details.
- 2026-10-26 · UI session 4 · task.deadlines: full-payload overdue/upcoming-today split counts with existing list actions.
- 2026-10-26 · UI session 4 · dev.prs: compact GitHub Connect tile using existing connection panel.
- 2026-10-26 · UI Glance group · glance.clock: retained dark hero and world-clock settings; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.weather: retained accent hero; forecast/settings/attribution disclosures; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.air: real AQI hero and split particulate readings; missing values explicit; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.sun: accent sunrise/sunset split with honest local wall times; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.next-event: shared compact/full real-minute countdown; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.music: dark transport tile; existing approval controls preserved; focused theme/state/control checks passed.
- 2026-10-26 · UI Glance group · glance.travel: route summary and house location controls; no numeric inference; focused theme/state/control checks passed.
- 2026-10-26 · UI Needs you group · need.inbox: retained ranked inbox pilot; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.drafts: recipient list, composer disclosure and gated local review; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.waiting: correspondence list, nudge review and settings disclosure; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.mentions: source-initial badges and existing source links; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.overdue: dated warning list with source and status; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.decisions: house answer controls with ordered question payloads; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.snoozed: dated return-state list with clock badges; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.approvals: accent review tile and house permission controls; focused theme/state/gate checks passed.
- 2026-10-26 · UI Needs you group · need.lor-slack: dark correspondence list with source/person initials; focused theme/state/gate checks passed.
- 2026-10-26 · Verification limit: dashboard-pilots.mjs stops at the task.today add-item approval step (outside these groups); focused Glance/Needs you checks and dashboard-director.mjs pass.
- 2026-10-26 · UI Communication group · comm.unread: grouped sender initials and honest preview-count chips; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.thread-summary: digest list and house optional-model control; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.newsletters: accent digest and text-only source suggestions; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.contacts: dark contact list and shared-thread disclosure; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.reachout: contact list, birthday/settings disclosure and gated review; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.templates: template list, house composer and preserved local gate; focused theme/state/action checks passed.
- 2026-10-26 · UI Communication group · comm.tone: accent rewrite composer, house selects and gated review; focused theme/state/action checks passed.
- 2026-10-26 · UI group verification: all 23 shipped Glance/Needs you/Communication IDs adopted, group checklist updated; four unimplemented IDs remain pending. Integrated Home and mocked mail regressions pass; expanded lists inherit group presentation. No backend/contracts/screenshots changed.
- 2026-10-26 · glance.weather: direct location action, real hourly sparkline and shared city/device/manual picker; existing settings contract preserved.
- 2026-10-26 · glance.air: shared location picker and refresh after environmental coordinates change; validated zero/bounds, denial, retry and cancellation with fixtures.
- 2026-10-26 · glance.sun: shared location picker/refresh and wide paired-time presentation; stored size vocabulary unchanged.
- 2026-10-26 · glance.travel: saved-origin prefill and device-location fill with explicit Save; existing address/coordinate settings and connector behavior preserved.
- 2026-10-26 · Home sizing: compact catalog defaults and optional Fit widgets with serialized persistence/Undo; custom order and membership preserved.
- 2026-10-26 · Desktop delivery: user was seeing stale frontend/dist, not the committed bento source. Rebuilt production assets and verified the running backend's /today entry matches; served-app location/layout/theme proof, Glance adoption and integrated Home checks pass. Lint has existing WidgetFrame raw-control warnings; build has chunk/import warnings. No screenshots, backend edits or live OS/connector checks.
- 2026-10-26 · dash.gallery design: quiet neutral canvas, compact shared headers, stable hover depth and 44px controls; desktop fixture passes nine themes at 1440/1024/768/390px with fit/undo and location flows.
- 2026-10-26 · glance.weather design: token-based blue surface, six-hour temperature/rain strip and timezone label; glance fixture passes real values, all source states, review controls, nine themes and reduced motion.
- 2026-10-26 · glance.clock design: accurate hour/minute analog dial with date inset, digital time and timezone; focused glance tests cover hand angles, accessible timestamp, nine themes, responsive states and reduced motion.
- 2026-10-26 · glance.next-event design: calendar date, event rail, location and compact countdown; glance fixture passes timezone boundary, all-day and missing-start cases, zero/missing weather values, theme/state checks and reviewed playback.
- 2026-10-26 · glance.music design: real album metadata, symbolic artwork fallback and familiar 44px transport controls; playback approval/rejection/error/idle tests and all 23 adopted widget theme/state fixtures pass.
- 2026-10-26 · Today design delivery: rebuilt frontend/dist; production desktop proof passes nine themes at 1440/1024/768/390px, 44px shell controls, location flows and layout undo. Focused JSX lint passes; existing bundle-size/dynamic-import warnings remain. No screenshots or live connector/OS checks.
- 2026-10-27 · glance.music usability: expose all desktop sessions, persist explicit player choice, show supplied artwork and protect selected-session approvals; 14 backend tests and playback browser checks pass, including missing players and narrow review.
- 2026-10-27 · sys.connectors / dash.sync: share Composio account state with Today, invalidate account projections and refresh on return; source setup and Home connection settings added. 35 focused backend tests and desktop connection lifecycle fixture pass. Live OAuth not checked.
- 2026-10-27 · need.drafts / need.waiting: move composers, approval reviews and waiting settings into existing modal sheets; retain unfinished fields on close and approval gates. Needs browser fixtures pass across source states, nine themes and narrow/wide layouts.
- 2026-10-27 · sys.connectors follow-up: register pinned dashboard read schemas before later account connections, prefer newest active account, and distinguish connected-but-unavailable sources. Eight fast-lane tests pass; runtime execution gates remain unchanged.
- 2026-10-27 · dash.gallery / glance.clock: bound shared grid tracks and scroll long previews, reserve card controls, size the clock dial, commit drag reorder on release and cancel old animations; gallery reveals one widget’s options at a time. Needs/Glance fixtures and production preview cover themes, widths, containment, gallery and drag/undo; typography deferred. Frontend rebuilt; desktop backend unavailable for live checks.

## 2026-10-27 — glance reference verification

- `glance.clock`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.music`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.air`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.sun`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.weather`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.travel`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `glance.next-event`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — needs-you reference verification

- `need.mentions`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.inbox`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.drafts`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.waiting`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.lor-slack`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.decisions`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.approvals`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.overdue`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `need.snoozed`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — communication reference verification

- `comm.thread-summary`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.newsletters`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.contacts`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.reachout`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.unread`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.tone`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `comm.templates`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — agent reference verification

- `agent.brief`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.next`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.running`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.feed`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.errors`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.audit`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.usage`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.knows`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.skills`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.rules`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.watchers`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.research`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.delegated`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `agent.jobs`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — library reference verification

- `lib.inbox`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.resurface`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.capture`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.search`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.recent`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.dupes`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.ask`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.readlater`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.highlights`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.daily`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `lib.collections`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — tasks reference verification

- `task.agenda`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.plan`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.free`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.conflicts`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.risk`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.focus`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.habits`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.goals`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.kanban`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.today`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.backlog`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.deadlines`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `task.reminders`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — developer reference verification

- `dev.ci`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.issues`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.prs`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.appeal`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.recovery`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.unpushed`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dev.backup`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — feed reference verification

- `feed.news`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `feed.rss`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — system reference verification

- `sys.connectors`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `sys.model`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `sys.notify`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `sys.vault`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-27 — dashboard reference verification

- `dash.palette`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dash.pin`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dash.gallery`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dash.sync`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dash.quiet`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.
- `dash.shortcuts`: shared reference pattern, field controls and tone adoption verified for every manifest size and six states; Paper/Graphite at 1440/390; nine-theme contrast/responsive sweep.

## 2026-10-28 — Complete Today component review

- Shared Today shell: preserve both responsive container names, show sources, fix overdue contrast and narrow sun layout, isolate/recover Glance failures, use native nested-dialog focus, make previews inert, retain reviewed forms, and expose validation messages. Actual 80-component composition, nine-theme/size/state checks and 27 write flows pass.
- Connector verification: mark reviewed Slack channel listing read-only and supply realistic fixture account identities before seeding caches. Authentication, account isolation and write gates remain enforced; all 239 dashboard backend tests pass.
- `need.inbox`: Empty inbox no longer asks to reconnect; ranking and unread groups rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.drafts`: Rejected recipient/body edits persist; approval retry and denial feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.waiting`: Rejected manual/nudge edits persist; approval retry and denial feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.lor-slack`: Contact/summary metadata, safe links, source limits and model controls reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.thread-summary`: Contact/summary metadata, safe links, source limits and model controls reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.newsletters`: Contact/summary metadata, safe links, source limits and model controls reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.contacts`: Contact/summary metadata, safe links, source limits and model controls reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.reachout`: Rejected birthday input persists; denied configuration is reported. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.unread`: Empty inbox no longer asks to reconnect; ranking and unread groups rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.tone`: Rejected rewritten text persists; approval retry and denial feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `comm.templates`: Rejected template edits persist; approval retry and denial feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `sys.notify`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `sys.vault`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.brief`: Optional model control, cached evidence and existing-action links reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.next`: Optional model control, cached evidence and existing-action links reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.running`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.feed`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.decisions`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.approvals`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.errors`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.audit`: Logs plus stop/approval/question controls and rejected requests reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.usage`: Recorded token/cost/latency values and unavailable metrics reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.knows`: Approval retry and denied-memory-change feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.skills`: Approval retry and denied-toggle feedback corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.rules`: Approval retry/denial feedback corrected; write tools cannot be always allowed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.watchers`: Rejected watcher fields persist; failed approvals retry and denials are visible. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.research`: Rejected job fields persist; failed approvals retry and denials are visible. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.delegated`: Rejected job fields persist; failed approvals retry and denials are visible. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `agent.jobs`: Rejected job fields persist; failed approvals retry and denials are visible. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.inbox`: Saved items now open their source; source paragraphs retain formatting. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.resurface`: Saved items now open their source; source paragraphs retain formatting. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.capture`: Rejected note text retained; failed approvals retry; readable validation errors. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.search`: Search results inherit source navigation; query/degraded states reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.recent`: Saved items now open their source; source paragraphs retain formatting. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.dupes`: Saved items now open their source; source paragraphs retain formatting. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.ask`: Question, async answer, source citations and source navigation reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.readlater`: Denied article saves reported; rejected fields and failed approvals retained. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.highlights`: Denied highlight saves reported; source choice and rejected text retained. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.daily`: Denied creation reported; create/open-existing states rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `lib.collections`: Denied collection changes reported; rejected fields retained. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.recovery`: Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.agenda`: Access changes refresh dependent cards and remove disabled calendar data immediately. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.plan`: Saved shared hours/weekdays load correctly and changes propagate to dependents. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.free`: Saved shared hours/weekdays load correctly and changes propagate to dependents. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.conflicts`: Saved shared hours/weekdays load correctly and changes propagate to dependents. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.risk`: Saved shared hours/weekdays load correctly and changes propagate to dependents. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.focus`: Shared review retains rejected timer settings and resets applied changes only. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.habits`: Shared review retains rejected habit inputs and resets applied changes only. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.goals`: Shared review retains rejected goal inputs and resets applied changes only. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.kanban`: Shared review retains rejected project/column inputs and resets applied changes only. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.today`: Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.backlog`: Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.deadlines`: Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `task.reminders`: Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.mentions`: Safe source links, partial sources and PR/issue/CI labels reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.ci`: Safe source links, partial sources and PR/issue/CI labels reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.issues`: Safe source links, partial sources and PR/issue/CI labels reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.prs`: Safe source links, partial sources and PR/issue/CI labels reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.appeal`: Approval retry and denied-change feedback corrected; follow-ups remain drafts. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.unpushed`: Unique label ids for multiple instances; paths and read-only evidence reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dev.backup`: Unique label ids for multiple instances; paths and read-only evidence reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.clock`: Live clock, midnight rollover and persisted world zones rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.music`: Failed approvals remain retryable; explicit player selection and gated transport rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.air`: Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.sun`: Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.weather`: Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.travel`: Saved/device/manual origin, timezone display, source attribution and errors reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `glance.next-event`: Honest empty calendar and active/ended event states corrected. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `feed.news`: Topic groups, publisher links and partial-feed errors reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `feed.rss`: Failed approvals retry; rejected feed URL/tags retained; source errors reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `sys.connectors`: Connection/reconnect truth, failures and explicit sign-in links reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `sys.model`: Failed switch approvals retry and permission denials are reported. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.palette`: Palette entry point and existing search/capture scope reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.pin`: Failed removal approvals retry; snapshot sandbox and rejection rechecked. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.gallery`: Unique search ids; inert previews; selection/add/size controls reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.sync`: Per-widget freshness, source states and manual refresh reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.quiet`: Save/snooze/resume and settings keyboard navigation reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `dash.shortcuts`: Shortcut list and settings keyboard navigation reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.overdue`: Overdue/snoozed source labels and timestamps reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- `need.snoozed`: Overdue/snoozed source labels and timestamps reviewed. State/size/theme/contrast checks pass; see `today-component-review.md`.
- Final verification: 80 checked component entries, every registry/fixture/manifest id matched, 239 backend tests, 27 write flows plus shared recovery/OAuth/dialog checks, real 76-card/four-settings composition, nine themes, state/size/contrast sweeps and served production interactions pass. No screenshots; live accounts/devices and exact visual fidelity require manual review. Existing build warnings remain.

### 2026-10-29 · Today size compositions and motion

Shared card/detail composition keeps editors mounted across resizing, preserves gates and source links, consolidates duplicate detail actions, uses transform/opacity feedback and restores modal focus. Closed location editors invalidate pending lookups while retaining input. No dependencies or provider features added.
- `glance.clock`: clock composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `feed.news`: feed composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `feed.rss`: feed composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.music`: player composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.air`: air composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.sun`: sun composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.weather`: weather composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.mentions`: people composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.inbox`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.drafts`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.waiting`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.lor-slack`: people composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.thread-summary`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.newsletters`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.contacts`: people composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.reachout`: people composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.unread`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.tone`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `comm.templates`: correspondence composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `sys.connectors`: controls composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `sys.model`: controls composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `sys.notify`: timeline composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `sys.vault`: metrics composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.brief`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.next`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.running`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.feed`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.decisions`: review composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.approvals`: review composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.errors`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.audit`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.usage`: metrics composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.knows`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.skills`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.rules`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.watchers`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.research`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.delegated`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `agent.jobs`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.ci`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.issues`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.prs`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.appeal`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.recovery`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.unpushed`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dev.backup`: timeline composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.inbox`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.resurface`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.capture`: capture composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.search`: capture composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.recent`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.dupes`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.ask`: capture composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.readlater`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.highlights`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.daily`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `lib.collections`: editorial composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.overdue`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `need.snoozed`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.travel`: route composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.agenda`: calendar composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.plan`: schedule composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.free`: schedule composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.conflicts`: schedule composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.risk`: schedule composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `glance.next-event`: calendar composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.focus`: timer composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.habits`: metrics composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.goals`: metrics composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.kanban`: board composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.today`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.backlog`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.deadlines`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `task.reminders`: tasks composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.palette`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.pin`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.gallery`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.sync`: controls composition for S/M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.quiet`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- `dash.shortcuts`: controls composition for M/L; existing controls retained in the working/detail view; size and state coverage recorded in today-size-motion.md.
- Verification: 169 variants across six states; all 80 real card/detail compositions and long-list stress; nine-theme responsive/AA sweeps; 27 write recovery flows; clock/media/adoption/public checks; production build, served-desktop interactions and focused lint pass. Per-ID checklist and 30-law evidence/limits: `today-size-motion.md`. Backend tests were not repeated; live-device and pixel-reference review remain outstanding.

- 2026-10-29 — Astra mobile research: added `docs/plans/astra-mobile-research.md` with repository evidence, framework/reuse comparison, remote-control security gaps and phased acceptance gates; documentation only, no widget changes.
- 2026-10-29 — Damon launcher redesign (Milestone 1): single-instance socket lock, async streaming LauncherEngine (apps, library, commands), split-pane preview layout, and Cmd+K action panel with Esc hierarchy; 45 pytest tests and 3 frontend node tests pass.
- 2026-10-29 — Damon launcher native utilities (Milestone 2): system power/volume commands (`loginctl`, `systemctl`, `pactl`, `gio`), open window switcher via `wmctrl`, clipboard history SQLite store and copy actions, and fast local file search with preview reader; 55 pytest tests and 3 frontend node tests pass.
- 2026-10-29 — Astra companion foundation: separate mobile Home layout and device-scoped caches; native shell, encrypted capture queue and explicit remote permission gates. 155 targeted backend tests, 35 sync tests and 5 mobile tests pass; native device validation and broader mobile features remain open (docs/plans/astra-mobile-implementation.md).

- 2026-10-29 — Android companion APK built and copied to Downloads; camera permission added for QR pairing. 40 frontend tests, Android assemble/lint, APK signature and alignment checks pass; hardware validation remains open.

- 2026-10-30 — Companion 1.0.1: fixed Android secure-storage startup deadlock, bundled-font boot recovery, Amethyst Android artwork, and Settings updates from the paired desktop with APK verification. Android 15 launch and data-preserving upgrade verified; physical Vivo validation remains open.

- 2026-10-30 — `glance.clock`: reworked S/M/L dial and world-time layouts, live size previews in the gallery, seconds and UTC offsets; installed Kokonut bento grid with theme tokens/shared controls and no demo data, usage in `dashboard-bento-usage.md`; targeted clock/gallery/grid browser tests and focused lint pass; Done remains checked. Screenshot references were absent, so pixel matching is unverified.

- 2026-10-30 — `dash.gallery` / shared shell: replaced the abandoned Kokonut addition with all 92 MIT Wigggle source designs, labelled/inert samples and compatible real-source apply/add; optional validated design IDs persist in SQLite layouts; portalled menus, visible size radios and compact collapse replace the old controls. All 80 widget compositions and 92 previews pass; Done remains checked; unavailable sources remain samples (`dashboard-wigggle.md`).
- 2026-10-30 — `glance.clock`: replaced the prior clock styling with Wigggle digital, seconds, weekday, analog, Roman and world-time variants using live time/saved zones; nine-theme size/settings checks pass; Done remains checked.
- 2026-10-30 — `glance.weather`: bound the 11 Wigggle weather compositions to existing cached readings with explicit missing measurements and daily-forecast limitation; location/freshness/permission paths retained; live variant checks pass; Done remains checked.
- 2026-10-30 — `glance.next-event`: added Wigggle month compositions using actual cached calendar events and retained event countdown/details; variant/composition checks pass; Done remains checked.

- 2026-10-30 — `glance.weather`: replaced hard-coded missing readings with audited Open-Meteo humidity, apparent temperature, wind, precipitation, condition codes, 12 hourly readings and seven daily forecasts; enabled all 11 weather designs, preserved zero/null readings and fixed date-only weekday display. Eight provider tests plus setup/live-design checks pass; Done remains checked.
- 2026-10-30 — `dash.gallery` / shared widgets: added Setup & status screens to all 92 design previews and every live widget menu, with provider errors, sync time, live retry, real location setup, connector reconnect and model/local-media guidance; blocked designs name missing implementations without fake credential forms. Setup/recovery checks, 92 previews, 80 compositions, clock regression, focused lint and production build pass; Done remains checked.
