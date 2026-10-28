# Today size and motion design

The supplied iOS references govern rounded instrument faces, editorial type, pill controls and compact information hierarchy. Existing theme colors, fonts, real provider payloads and approval gates remain authoritative. No screenshots. No `.agents/DESIGN.md` is present; `docs/today-ui-design.md` records the existing direction.

[design-pipeline]
0. laws-of-ux → Fitts: 44×44px controls with 8px gaps; Hick: at most five visible card actions; Proximity: 8px within related controls, 24px between groups; Doherty: press feedback within 150ms; Working Memory: retain drafts across resize/detail transitions; Von Restorff: one primary emphasis per card.
1. Art direction → use existing white, charcoal, lavender, violet, calendar-red and weather-blue tokens. Existing display/body fonts stay. Clock, calendar, player, correspondence, editorial, timeline, metrics, board and control surfaces each have a content-specific composition.
2. Size hierarchy → Small: one recognizable reading and a detail entry point. Medium: the reading with relevant context and the next action. Large: a working surface with existing controls, richer lists and a detail entry point. Unsupported sizes are not added to manifests. Width changes adapt the chosen composition rather than silently changing the saved size.
3. Motion → 120–150ms press/hover, 200ms menu/disclosure, 240ms drawer entry, 160ms drawer exit; animate transform/opacity. Feedback follows user input. Never replay number entrances on polling or move card bounds during a refresh. Reduced motion disables nonessential movement, including press and layout animation.
4. Verification → inspect DOM hierarchy and geometry for every widget/manifest size, long/empty/error states, nine themes, keyboard/touch controls and reduced motion. Profile representative interactions using browser frame and rendering events without screenshots. Record measured limits rather than promising hardware-independent frame rates.

## Law audit

Implementation evidence and the size coverage table are recorded after verification. Laws apply to their relevant surfaces; a law that needs user research is not represented as empirically proven by automated tests.

The audit covers Today cards, their size controls, detail sheets and existing review flows. These are design constraints and implementation checks, not a claim that psychology or usability has been empirically proved.

| Principle | Constraint and evidence / limit |
|---|---|
| Aesthetic–Usability Effect | Shared theme colors, type, 24px card corners and content-specific faces. Aesthetic preference needs owner review. |
| Doherty Threshold | Immediate pressed state; 180ms resize feedback, 240ms sheet entry and 160ms exit. Browser timing is measured separately below. |
| Fitts’s Law | Card entry/menu targets at least 44×44px; header action gaps use the 8px token. Composition tests check target bounds. |
| Goal–Gradient Effect | Task completion rings and habit counts use actual provider totals. No invented progress or completion bonuses. |
| Hick’s Law | One compact detail action; settings and less frequent actions stay in the menu/sheet. Player transport retains three familiar buttons. |
| Jakob’s Law | Native dialogs, Escape, Tab/Shift+Tab, standard forms and a conventional media transport. Drawer and recovery tests exercise them. |
| Law of Prägnanz | Clock dial, calendar date, timer ring and ordinary icons identify instrument types. No decorative charts imply nonexistent measurements. |
| Occam’s Razor | Removed two buttons opening the same detail view; reused the existing editor and permission flow. No new dependency or integration. |
| Pareto Principle | Compact cards prioritize one reading/current item. Actual usage distribution has not been measured; hierarchy remains a hypothesis. |
| Parkinson’s Law | Existing saved timezone/location/working-hour defaults remain available; controls avoid requiring re-entry after resizing. |
| Peak–End Rule | Existing failed-review retry and permission-denial messages remain visible; close returns focus. Emotional response needs user research. |
| Postel’s Law | Existing timezone alias/whitespace handling and coordinate validation retained; clock and served-desktop tests verify rejection and retry. |
| Selective Attention | One prominent reading/headline per compact face; data refresh does not replay a number entrance. Current errors/staleness remain labelled. |
| Serial Position Effect | Heading/source remain first; the detail action remains at the bottom. No speculative ranking of the owner’s data. |
| Tesler’s Law | Same mounted editor moves between inline and modal presentation. Provider parsing, permissions and persistence remain in their established layers. |
| Von Restorff Effect | Primary emphasis belongs to the main action or instrument reading; player/timer detail controls use a quieter variant. Focus has a visible outline. |
| Zeigarnik Effect | Real pending counts and saved drafts remain available across size/detail changes. No manufactured unfinished-work badge. |
| Law of Common Region | Card bounds, list separators and existing review regions group related information. Sheets contain one widget’s complete working surface. |
| Law of Proximity | Existing spacing tokens separate groups; related controls use 8px gaps. Label/input grouping is retained in native editors. |
| Law of Similarity | Same button, source-link underline, caption and status treatments across all families; noninteractive readings use plain typography. |
| Law of Uniform Connectedness | Existing working timelines, board columns, task rings and explicit form labels preserve relationships; no invented relationships in previews. |
| Choice Overload | Compact faces offer a single detail entry; catalog search/categories and existing settings tabs remain available. No feature inventory added to a card. |
| Chunking | Explicit composition families group correspondence, people, editorial, tasks, schedules, metrics, boards and instruments. Size changes alter actual structure. |
| Cognitive Bias | Fixtures are labelled and unshipped; counts name their scope (“shown”). Preference and task-success claims require independent user testing. |
| Cognitive Load | Compact faces clamp secondary text and lead to complete content. Stress tests use eight rows and long source strings; no hidden compact editor controls enter the tab order. |
| Flow | In-place large working surfaces retain drafts; routine polling does not move card bounds. Explicit detail opening is the interruption boundary. |
| Mental Model | Clock/world clocks, mail drafts, task lists, Library sources and player controls keep their existing names and behavior. User mental-model validation remains outstanding. |
| Miller’s Law | Related information stays visible in chunks; no arbitrary seven-item limit is imposed on full lists. Compact previews disclose their full item count. |
| Paradox of the Active User | Visible menu/detail labels, source/freshness and honest empty states provide entry points without a tutorial. Learnability needs observation. |
| Working Memory | The same editor stays mounted across L→M→detail→L; typed note/review and city-search input retention are covered by composition tests. |

## Presentation behavior

S selects one reading or subject; M adds domain context; L exposes the existing working controls. Only manifest-supported sizes are available. Large Gallery retains its existing compact search/add controls and opens the complete browser in details. Clock, weather, calendar, air, sun, player and focus timer retain instrument controls instead of adopting a generic list. Small weather shows one hourly observation, M up to six, L/details up to twelve. Clock S shows the local face plus world-clock count, M up to two worlds, and L/details the editable saved list.

Compact non-instrument cards show a content-specific preview and one labelled detail action. Detail controls share the mounted editor with large cards, retaining unsaved values and pending reviews. Gallery thumbnails remain inert and do not mount hidden editors. Location editors retain text when hidden but invalidate pending device/city lookups, including after a quick reopen. Writes still use the existing permission gates.

## Verification limits

No screenshots or reference-image pixel diffs were taken, per repository instructions. DOM geometry and contrast checks cannot establish a 100% visual match to the supplied images. Browser profiling measures a local headless Chromium session, not target-device compositor performance. Real accounts, hardware media controls, assistive technology and independent usability research require owner/device testing. Existing production bundle-size and static/dynamic import warnings remain.

## Checked widget compositions · 2026-10-29

All 80 registered IDs have an explicit presentation. The 169 manifest-supported size variants use the original providers and action handlers. Checkboxes refer to composition coverage, not completion of unshipped spec rows.

| Done | ID | Composition | Supported sizes |
|---|---|---|---|
| [x] | `glance.clock` | clock | S / M / L |
| [x] | `feed.news` | feed | M / L |
| [x] | `feed.rss` | feed | M / L |
| [x] | `glance.music` | player | M / L |
| [x] | `glance.air` | air | S / M / L |
| [x] | `glance.sun` | sun | S / M / L |
| [x] | `glance.weather` | weather | M / L |
| [x] | `need.mentions` | people | M / L |
| [x] | `need.inbox` | correspondence | M / L |
| [x] | `need.drafts` | correspondence | M / L |
| [x] | `need.waiting` | correspondence | M / L |
| [x] | `need.lor-slack` | people | M / L |
| [x] | `comm.thread-summary` | correspondence | M / L |
| [x] | `comm.newsletters` | correspondence | M / L |
| [x] | `comm.contacts` | people | M / L |
| [x] | `comm.reachout` | people | M / L |
| [x] | `comm.unread` | correspondence | M / L |
| [x] | `comm.tone` | correspondence | M / L |
| [x] | `comm.templates` | correspondence | M / L |
| [x] | `sys.connectors` | controls | S / M / L |
| [x] | `sys.model` | controls | S / M / L |
| [x] | `sys.notify` | timeline | S / M / L |
| [x] | `sys.vault` | metrics | S / M / L |
| [x] | `agent.brief` | editorial | M / L |
| [x] | `agent.next` | editorial | M / L |
| [x] | `agent.running` | timeline | M / L |
| [x] | `agent.feed` | timeline | M / L |
| [x] | `need.decisions` | review | M / L |
| [x] | `need.approvals` | review | M / L |
| [x] | `agent.errors` | timeline | M / L |
| [x] | `agent.audit` | timeline | M / L |
| [x] | `agent.usage` | metrics | M / L |
| [x] | `agent.knows` | controls | M / L |
| [x] | `agent.skills` | controls | M / L |
| [x] | `agent.rules` | controls | M / L |
| [x] | `agent.watchers` | timeline | M / L |
| [x] | `agent.research` | timeline | M / L |
| [x] | `agent.delegated` | timeline | M / L |
| [x] | `agent.jobs` | timeline | M / L |
| [x] | `dev.ci` | timeline | M / L |
| [x] | `dev.issues` | timeline | M / L |
| [x] | `dev.prs` | timeline | M / L |
| [x] | `dev.appeal` | timeline | M / L |
| [x] | `dev.recovery` | tasks | M / L |
| [x] | `dev.unpushed` | timeline | M / L |
| [x] | `dev.backup` | timeline | M / L |
| [x] | `lib.inbox` | editorial | M / L |
| [x] | `lib.resurface` | editorial | M / L |
| [x] | `lib.capture` | capture | M / L |
| [x] | `lib.search` | capture | M / L |
| [x] | `lib.recent` | editorial | M / L |
| [x] | `lib.dupes` | editorial | M / L |
| [x] | `lib.ask` | capture | M / L |
| [x] | `lib.readlater` | editorial | M / L |
| [x] | `lib.highlights` | editorial | M / L |
| [x] | `lib.daily` | editorial | M / L |
| [x] | `lib.collections` | editorial | M / L |
| [x] | `need.overdue` | tasks | M / L |
| [x] | `need.snoozed` | tasks | M / L |
| [x] | `glance.travel` | route | M / L |
| [x] | `task.agenda` | calendar | M / L |
| [x] | `task.plan` | schedule | M / L |
| [x] | `task.free` | schedule | M / L |
| [x] | `task.conflicts` | schedule | M / L |
| [x] | `task.risk` | schedule | M / L |
| [x] | `glance.next-event` | calendar | S / M / L |
| [x] | `task.focus` | timer | M / L |
| [x] | `task.habits` | metrics | M / L |
| [x] | `task.goals` | metrics | M / L |
| [x] | `task.kanban` | board | M / L |
| [x] | `task.today` | tasks | M / L |
| [x] | `task.backlog` | tasks | M / L |
| [x] | `task.deadlines` | tasks | M / L |
| [x] | `task.reminders` | tasks | M / L |
| [x] | `dash.palette` | controls | M / L |
| [x] | `dash.pin` | controls | M / L |
| [x] | `dash.gallery` | controls | M / L |
| [x] | `dash.sync` | controls | S / M / L |
| [x] | `dash.quiet` | controls | M / L |
| [x] | `dash.shortcuts` | controls | M / L |

## Verification receipt · 2026-10-29

- `dashboard-reference.mjs`: all 80 widgets, 169 sizes, six states, two widths and Paper/Graphite. Each group has an isolated browser page; long shared-page gallery runs previously stalled during navigation to System, while isolated group runs passed. Assertions still cover every size/state/theme/width combination.
- `dashboard-compositions.mjs`: real tile geometry at 1440/390px, all native card button targets, all compact-to-detail paths, long text/eight-row lists, retained note/review/city input, native sheet focus and compositor-only entry/resize properties. Latest local sample: sheet response 34ms; 89 RAF intervals, median 16.7ms, p95 16.8ms; cumulative layout 6ms and style recalculation 37ms during sheet entry/close, resize and press. This is a sampled headless-browser measurement.
- `dashboard-reference-sweep.mjs` and `dashboard-contrast.mjs`: nine themes, 360–2560px, reduced motion and visible fixture text AA checks.
- `dashboard-all-components.mjs`: 76 actual Home cards plus four settings sections, nine themes/five widths, Library links, working-hour defaults and calendar-cache deletion propagation.
- `dashboard-recovery.mjs`: 27 proposal/failure/rejection/denial flows plus nested focus, inert preview, validation, render-boundary and OAuth recovery checks.
- Native clock, Glance/Needs/Communication adoption, public-widget and desktop-music tests pass. Focused lint and production build pass. `dashboard-desktop.mjs` verifies the served production application with fixture routes, including pending device-location cancellation, location persistence, fit/undo and drag/drop.
- No backend code changed or backend tests repeated. The older isolated-backend `dashboard-shell.mjs` harness was not run; its detail-action locator was aligned with the consolidated footer. Actual Home behavior is exercised by the all-component and served-desktop harnesses above.
