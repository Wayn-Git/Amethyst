# UI revamp checklist

## Session 1 foundation

- [x] Paper-first tokens; all nine modes with light/dark/accent tones.
- [x] Spacing, typography, radii, shadows, motion and reduced motion.
- [x] Bento grid S/M/L/wide/tall; responsive spans and container queries.
- [x] Manifest/Position size vocabulary; existing sizes preserved.
- [x] Tile, TileHeader, Stat, Ring, Gauge, Sparkline, SegmentedBar, Chip, Row.
- [x] IconBadge, Initials, SplitTile, Skeleton, EmptyState, ConnectTile, ErrorState, Toast.
- [x] Button, IconButton, Input, Select, Checkbox, Switch, Segmented, Menu, Tooltip, Kbd.
- [x] Dev-only /dev/ui with labelled samples, tones/sizes, interactive and disabled/loading states.
- [x] Raw native-control lint warnings.
- [x] Text design-system specification.

## Session 2 Home structure

- [x] Shared BentoGrid/Tile surfaces; four compact glance tiles then M/L mixes in the Morning default.
- [x] 24 px radii, 16 px gutters, bounded ultrawide canvas, 360–2560 px without page overflow.
- [x] Drag placeholder/live reflow, transform movement, snap sizes, arrow keys, mobile move buttons, undo.
- [x] Reordering preserves both peer slot and widget-content render counts.
- [x] Compact Connect tiles, hover/focus chrome, mono freshness and subtle stale dot/label.
- [x] Settings drawer owns refresh, quiet hours, shortcuts and gallery; native modal focus/Escape retained.
- [x] No tile scrolling; hover lift, press response and reduced motion.
- [x] Existing app navigation, permissions, APIs and manifest sizes preserved.

## Session 3 Add widget

- [x] Right drawer on desktop; bottom sheet at 390 px.
- [x] Search, category counts, empty search and responsive card grid.
- [x] Layout silhouettes in tile tones; distinct manifest icons and capability descriptions for all 80 widgets.
- [x] Manifest-supported size picker; connector chips and Connect links.
- [x] Add, On Home and Remove; settings-only utilities retain Open.
- [x] Tile entrance/highlight, modal-accessible undo toast and reduced motion.
- [x] Focused manifest and browser regression checks; changelog and commit.

## Later sessions — existing implementations require target review

- [x] Home header/date/greeting/capture; existing navigation integration.
- [ ] Glance strip; Needs you; Agent activity; Today; Dev; Library; Feed sections.
- [x] Home grid adoption, edit/drag/resize/collapse, persistence/undo.
- [x] Add widget drawer: distinct icons, descriptions, categories, search, Add/Added.
- [x] Home settings drawer: Refresh status, Quiet hours, Keyboard shortcuts, Widget gallery.
- [ ] Show all/detail drawer; widget settings; source connection panels.
- [ ] Command palette; confirmation dialogs; menus; tooltips; global toast host.
- [ ] All forms/buttons adopt foundation controls; verify keyboard and loading states.
- [x] Air quality structured display; sunrise/sunset honest numbers; travel form.
- [ ] Stale chips; source note once; lighter widget chrome; violet primary buttons.
- [ ] Real-number-only data visuals; no decorative/fake charts.
- [ ] Mobile reading order, no nested scrolling, bounded previews, refresh stability.
- [ ] Hardware frame-time profiling.

## Widget ownership

Pilot widget visuals are checked below; remaining IDs still await adoption of `docs/ui-widget-patterns.md`.

- [x] `agent.audit` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.brief` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.delegated` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.errors` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.feed` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.jobs` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.knows` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.next` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [ ] `agent.prompts` — bento adoption pending.
- [x] `agent.research` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.rules` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.running` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.skills` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [ ] `agent.suggest` — bento adoption pending.
- [x] `agent.usage` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [x] `agent.watchers` — reference adoption verified; ui-review/agent-contact-sheet.png.
- [ ] `agent.weekly` — bento adoption pending.
- [x] `comm.contacts` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [ ] `comm.meeting` — no shipped widget/provider; requires separate feature scope.
- [x] `comm.newsletters` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [x] `comm.reachout` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [ ] `comm.schedule-send` — no shipped widget/provider; requires backend and permission scope.
- [x] `comm.templates` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [x] `comm.thread-summary` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [x] `comm.tone` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [x] `comm.unread` — reference adoption verified; ui-review/communication-contact-sheet.png.
- [ ] `dash.gallery` — bento adoption pending.
- [ ] `dash.modes` — bento adoption pending.
- [ ] `dash.palette` — bento adoption pending.
- [ ] `dash.phone` — bento adoption pending.
- [ ] `dash.pin` — bento adoption pending.
- [ ] `dash.quiet` — bento adoption pending.
- [ ] `dash.shortcuts` — bento adoption pending.
- [ ] `dash.skill-widgets` — bento adoption pending.
- [ ] `dash.sync` — bento adoption pending.
- [ ] `dash.theme-mode` — bento adoption pending.
- [ ] `dev.appeal` — bento adoption pending.
- [ ] `dev.backup` — bento adoption pending.
- [ ] `dev.ci` — bento adoption pending.
- [ ] `dev.issues` — bento adoption pending.
- [x] `dev.prs` — session 4 pilot; see ui-widget-patterns.md.
- [ ] `dev.recovery` — bento adoption pending.
- [ ] `dev.release` — bento adoption pending.
- [ ] `dev.security` — bento adoption pending.
- [ ] `dev.services` — bento adoption pending.
- [ ] `dev.streak` — bento adoption pending.
- [ ] `dev.team` — bento adoption pending.
- [ ] `dev.unpushed` — bento adoption pending.
- [ ] `feed.arxiv` — bento adoption pending.
- [ ] `feed.events` — bento adoption pending.
- [ ] `feed.markets` — bento adoption pending.
- [ ] `feed.news` — bento adoption pending.
- [ ] `feed.podcasts` — bento adoption pending.
- [ ] `feed.releases` — bento adoption pending.
- [ ] `feed.rss` — bento adoption pending.
- [ ] `feed.social` — bento adoption pending.
- [ ] `feed.sports` — bento adoption pending.
- [ ] `feed.watchlater` — bento adoption pending.
- [x] `glance.air` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `glance.clock` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [ ] `glance.listen-stats` — no shipped widget/provider; requires separate feature scope.
- [x] `glance.music` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `glance.next-event` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `glance.sun` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `glance.travel` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `glance.weather` — reference adoption verified; ui-review/glance-contact-sheet.png.
- [x] `lib.ask` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.capture` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.collections` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.daily` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.dupes` — reference adoption verified; ui-review/library-contact-sheet.png.
- [ ] `lib.flashcards` — bento adoption pending.
- [ ] `lib.graph` — bento adoption pending.
- [x] `lib.highlights` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.inbox` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.readlater` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.recent` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.resurface` — reference adoption verified; ui-review/library-contact-sheet.png.
- [x] `lib.search` — reference adoption verified; ui-review/library-contact-sheet.png.
- [ ] `life.bills` — bento adoption pending.
- [ ] `life.expenses` — bento adoption pending.
- [ ] `life.health` — bento adoption pending.
- [ ] `life.meals` — bento adoption pending.
- [ ] `life.mood` — bento adoption pending.
- [ ] `life.packages` — bento adoption pending.
- [ ] `life.screen` — bento adoption pending.
- [ ] `life.shopping` — bento adoption pending.
- [ ] `life.trips` — bento adoption pending.
- [x] `need.approvals` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.decisions` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.drafts` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.inbox` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.lor-slack` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [ ] `need.lor-social` — blocked: no official personal-account API.
- [x] `need.mentions` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.overdue` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.snoozed` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [x] `need.waiting` — reference adoption verified; ui-review/needs-you-contact-sheet.png.
- [ ] `pro.anomaly` — bento adoption pending.
- [ ] `pro.away` — bento adoption pending.
- [ ] `pro.context` — bento adoption pending.
- [ ] `pro.nudges` — bento adoption pending.
- [ ] `pro.standing` — bento adoption pending.
- [ ] `pro.triage` — bento adoption pending.
- [ ] `stu.assignments` — bento adoption pending.
- [ ] `stu.exams` — bento adoption pending.
- [ ] `stu.papers` — bento adoption pending.
- [ ] `stu.planner` — bento adoption pending.
- [ ] `stu.syllabus` — bento adoption pending.
- [ ] `stu.timetable` — bento adoption pending.
- [ ] `sys.backups` — bento adoption pending.
- [ ] `sys.connectors` — bento adoption pending.
- [ ] `sys.logs` — bento adoption pending.
- [ ] `sys.model` — bento adoption pending.
- [ ] `sys.notify` — bento adoption pending.
- [ ] `sys.phones` — bento adoption pending.
- [ ] `sys.privacy` — bento adoption pending.
- [ ] `sys.resources` — bento adoption pending.
- [ ] `sys.sync` — bento adoption pending.
- [ ] `sys.updates` — bento adoption pending.
- [ ] `sys.vault` — bento adoption pending.
- [x] `task.agenda` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.backlog` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.conflicts` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.deadlines` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.focus` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.free` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.goals` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.habits` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.kanban` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.plan` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.reminders` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.risk` — reference adoption verified; ui-review/tasks-contact-sheet.png.
- [x] `task.today` — reference adoption verified; ui-review/tasks-contact-sheet.png.

## Session 4 widget pilot

- [x] Hero stats, ranked inbox, checklist, timeline, split deadlines and compact GitHub Connect.
- [x] Focus ring, settings/history disclosures and gated start/stop.
- [ ] Focus pause/resume: no existing API/storage support; requires backend scope.
- [x] Token-based motion, reduced motion, bounded-preview loading reservation and text pattern guide.
- [ ] Daily completion history: current Today payload contains open tasks only; current-list ring is explicitly labelled.

## Glance / Needs you / Communication group adoption

- [x] All 23 shipped IDs reviewed against the pattern guide; existing clock/weather/inbox pilots retained.
- [x] Real environmental readings and event countdown; textual route estimate without inferred chart values.
- [x] Correspondence, dated-list, decision-review, grouped-unread and draft-composer patterns.
- [x] Group-scoped light/dark/accent tones, house controls, disclosures and expanded-list presentation.
- [x] Focused synthetic state/action checks, nine themes at 1440/390, reduced motion and integrated Home proof.
- [ ] Four unimplemented IDs remain outside UI-only scope: glance.listen-stats, need.lor-social, comm.schedule-send, comm.meeting.
- [ ] Existing dashboard-pilots.mjs stops at task.today add-item approval; Tasks are outside these groups.

## Desktop delivery and location follow-up

- [x] Rebuilt the stale desktop bundle; verified live backend serves the new hashed entry and bento UI.
- [x] Shared environmental city/device/manual location controls, range validation, zero coordinates, denied access, failed-search retry and cancellation before save.
- [x] Saving shared coordinates refreshes weather, air quality and sunrise/sunset; compact forecast uses real numeric readings only.
- [x] Travel origin prefills saved settings; device lookup fills without saving until the explicit Save action.
- [x] Supported compact defaults, wide sunrise/sunset presentation, optional Fit widgets with preserved order and Undo.
- [x] Glance and integrated Home checks; served production browser proof across nine themes, mobile and reduced motion; no screenshots.
- [ ] Live OS geolocation and live connector requests were not exercised; tests use fixtures.
