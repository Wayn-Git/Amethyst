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

- [ ] `agent.audit` — bento adoption pending.
- [ ] `agent.brief` — bento adoption pending.
- [ ] `agent.delegated` — bento adoption pending.
- [ ] `agent.errors` — bento adoption pending.
- [x] `agent.feed` — session 4 pilot; see ui-widget-patterns.md.
- [ ] `agent.jobs` — bento adoption pending.
- [ ] `agent.knows` — bento adoption pending.
- [ ] `agent.next` — bento adoption pending.
- [ ] `agent.prompts` — bento adoption pending.
- [ ] `agent.research` — bento adoption pending.
- [ ] `agent.rules` — bento adoption pending.
- [ ] `agent.running` — bento adoption pending.
- [ ] `agent.skills` — bento adoption pending.
- [ ] `agent.suggest` — bento adoption pending.
- [ ] `agent.usage` — bento adoption pending.
- [ ] `agent.watchers` — bento adoption pending.
- [ ] `agent.weekly` — bento adoption pending.
- [ ] `comm.contacts` — bento adoption pending.
- [ ] `comm.meeting` — bento adoption pending.
- [ ] `comm.newsletters` — bento adoption pending.
- [ ] `comm.reachout` — bento adoption pending.
- [ ] `comm.schedule-send` — bento adoption pending.
- [ ] `comm.templates` — bento adoption pending.
- [ ] `comm.thread-summary` — bento adoption pending.
- [ ] `comm.tone` — bento adoption pending.
- [ ] `comm.unread` — bento adoption pending.
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
- [x] `glance.air` — group adoption; see ui-widget-patterns.md.
- [x] `glance.clock` — session 4 pilot; see ui-widget-patterns.md.
- [ ] `glance.listen-stats` — bento adoption pending.
- [x] `glance.music` — group adoption; see ui-widget-patterns.md.
- [x] `glance.next-event` — group adoption; see ui-widget-patterns.md.
- [x] `glance.sun` — group adoption; see ui-widget-patterns.md.
- [x] `glance.travel` — group adoption; see ui-widget-patterns.md.
- [x] `glance.weather` — session 4 pilot; see ui-widget-patterns.md.
- [ ] `lib.ask` — bento adoption pending.
- [ ] `lib.capture` — bento adoption pending.
- [ ] `lib.collections` — bento adoption pending.
- [ ] `lib.daily` — bento adoption pending.
- [ ] `lib.dupes` — bento adoption pending.
- [ ] `lib.flashcards` — bento adoption pending.
- [ ] `lib.graph` — bento adoption pending.
- [ ] `lib.highlights` — bento adoption pending.
- [ ] `lib.inbox` — bento adoption pending.
- [ ] `lib.readlater` — bento adoption pending.
- [ ] `lib.recent` — bento adoption pending.
- [ ] `lib.resurface` — bento adoption pending.
- [ ] `lib.search` — bento adoption pending.
- [ ] `life.bills` — bento adoption pending.
- [ ] `life.expenses` — bento adoption pending.
- [ ] `life.health` — bento adoption pending.
- [ ] `life.meals` — bento adoption pending.
- [ ] `life.mood` — bento adoption pending.
- [ ] `life.packages` — bento adoption pending.
- [ ] `life.screen` — bento adoption pending.
- [ ] `life.shopping` — bento adoption pending.
- [ ] `life.trips` — bento adoption pending.
- [x] `need.approvals` — group adoption; see ui-widget-patterns.md.
- [x] `need.decisions` — group adoption; see ui-widget-patterns.md.
- [x] `need.drafts` — group adoption; see ui-widget-patterns.md.
- [x] `need.inbox` — session 4 pilot; see ui-widget-patterns.md.
- [x] `need.lor-slack` — group adoption; see ui-widget-patterns.md.
- [ ] `need.lor-social` — bento adoption pending.
- [x] `need.mentions` — group adoption; see ui-widget-patterns.md.
- [x] `need.overdue` — group adoption; see ui-widget-patterns.md.
- [x] `need.snoozed` — group adoption; see ui-widget-patterns.md.
- [x] `need.waiting` — group adoption; see ui-widget-patterns.md.
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
- [ ] `task.agenda` — bento adoption pending.
- [ ] `task.backlog` — bento adoption pending.
- [ ] `task.conflicts` — bento adoption pending.
- [x] `task.deadlines` — session 4 pilot; see ui-widget-patterns.md.
- [ ] `task.focus` — ring/start/stop pilot complete; pause/resume blocked by existing backend contract.
- [ ] `task.free` — bento adoption pending.
- [ ] `task.goals` — bento adoption pending.
- [ ] `task.habits` — bento adoption pending.
- [ ] `task.kanban` — bento adoption pending.
- [ ] `task.plan` — bento adoption pending.
- [ ] `task.reminders` — bento adoption pending.
- [ ] `task.risk` — bento adoption pending.
- [x] `task.today` — session 4 pilot; see ui-widget-patterns.md.

## Session 4 widget pilot

- [x] Hero stats, ranked inbox, checklist, timeline, split deadlines and compact GitHub Connect.
- [x] Focus ring, settings/history disclosures and gated start/stop.
- [ ] Focus pause/resume: no existing API/storage support; requires backend scope.
- [x] Token-based motion, reduced motion, bounded-preview loading reservation and text pattern guide.
- [ ] Daily completion history: current Today payload contains open tasks only; current-list ring is explicitly labelled.
