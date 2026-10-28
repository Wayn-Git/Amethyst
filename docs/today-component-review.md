# Today component review · 2026-10-28

Scope: all 80 registered/shipped dashboard widgets on `/today`, plus Home, WidgetFrame/WidgetSlot, Drawer, HomeSettings, AddWidget, SourceItem, PinToHome, useWidget, useConnections and dashboard request handling. Unshipped catalogue entries and unused legacy FocusTimer/ProgressGauge/NeedsYou are outside this runtime scope.

- 239 dashboard backend tests pass, including permission gates, projected connector data, persistence and shared planning settings. Fixtures now provide realistic connected-account ids; production authentication checks remain enforced. Slack channel listing has an explicit reviewed read-only annotation.
- All 80 registered components match labelled fixtures. Every manifest size and six states pass at desktop/mobile widths. Nine-theme sweeps cover 360–2560px; visible fixture text meets AA contrast. The 144 overdue-badge contrast failures were corrected with existing tone tokens.
- The real Today composition passes with 76 cards and four settings components across nine themes and five widths. Responsive container names are preserved, sources remain visible, Library entries open, saved working hours load, and disabling calendar access clears dependent cards immediately.
- 27 write flows exercise proposals, failed-approval retry, rejected-input retention and denial. Additional checks cover nested-dialog focus/return, inert previews, Glance-boundary recovery, readable validation errors, OAuth spoof rejection/expiry/poll cleanup, completed deadlines and malformed legacy dates.
- Production build and served-desktop interaction checks pass. Existing bundle-size/static-import warnings remain. No screenshots were taken. Exact screenshot fidelity and live OAuth/Composio/MPRIS behavior require owner review with real accounts/devices; automated checks use fixtures.

These checkboxes record review coverage of shipped components, not completion of unshipped features. Every row received shared state/size/theme/contrast checks.

| Reviewed | ID | Component | Finding / verification |
|---|---|---|---|
| [x] | `glance.clock` | `Clock.jsx` | Live clock, midnight rollover and persisted world zones rechecked. |
| [x] | `feed.news` | `News.jsx` | Topic groups, publisher links and partial-feed errors reviewed. |
| [x] | `feed.rss` | `Feeds.jsx` | Failed approvals retry; rejected feed URL/tags retained; source errors reviewed. |
| [x] | `glance.music` | `Music.jsx` | Failed approvals remain retryable; explicit player selection and gated transport rechecked. |
| [x] | `glance.air` | `Weather.jsx` | Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. |
| [x] | `glance.sun` | `Weather.jsx` | Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. |
| [x] | `glance.weather` | `Weather.jsx` | Temperature/rain/AQI/unavailable states; narrow sunrise layout corrected. |
| [x] | `need.mentions` | `ConnectedItems.jsx` | Safe source links, partial sources and PR/issue/CI labels reviewed. |
| [x] | `need.inbox` | `Mail.jsx` | Empty inbox no longer asks to reconnect; ranking and unread groups rechecked. |
| [x] | `need.drafts` | `MailDrafts.jsx` | Rejected recipient/body edits persist; approval retry and denial feedback corrected. |
| [x] | `need.waiting` | `Waiting.jsx` | Rejected manual/nudge edits persist; approval retry and denial feedback corrected. |
| [x] | `need.lor-slack` | `Communication.jsx` | Contact/summary metadata, safe links, source limits and model controls reviewed. |
| [x] | `comm.thread-summary` | `Communication.jsx` | Contact/summary metadata, safe links, source limits and model controls reviewed. |
| [x] | `comm.newsletters` | `Communication.jsx` | Contact/summary metadata, safe links, source limits and model controls reviewed. |
| [x] | `comm.contacts` | `Communication.jsx` | Contact/summary metadata, safe links, source limits and model controls reviewed. |
| [x] | `comm.reachout` | `Reachout.jsx` | Rejected birthday input persists; denied configuration is reported. |
| [x] | `comm.unread` | `Mail.jsx` | Empty inbox no longer asks to reconnect; ranking and unread groups rechecked. |
| [x] | `comm.tone` | `Tone.jsx` | Rejected rewritten text persists; approval retry and denial feedback corrected. |
| [x] | `comm.templates` | `Templates.jsx` | Rejected template edits persist; approval retry and denial feedback corrected. |
| [x] | `sys.connectors` | `Connectors.jsx` | Connection/reconnect truth, failures and explicit sign-in links reviewed. |
| [x] | `sys.model` | `Model.jsx` | Failed switch approvals retry and permission denials are reported. |
| [x] | `sys.notify` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `sys.vault` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `agent.brief` | `Insights.jsx` | Optional model control, cached evidence and existing-action links reviewed. |
| [x] | `agent.next` | `Insights.jsx` | Optional model control, cached evidence and existing-action links reviewed. |
| [x] | `agent.running` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `agent.feed` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `need.decisions` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `need.approvals` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `agent.errors` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `agent.audit` | `Director.jsx` | Logs plus stop/approval/question controls and rejected requests reviewed. |
| [x] | `agent.usage` | `Usage.jsx` | Recorded token/cost/latency values and unavailable metrics reviewed. |
| [x] | `agent.knows` | `Knows.jsx` | Approval retry and denied-memory-change feedback corrected. |
| [x] | `agent.skills` | `Skills.jsx` | Approval retry and denied-toggle feedback corrected. |
| [x] | `agent.rules` | `Rules.jsx` | Approval retry/denial feedback corrected; write tools cannot be always allowed. |
| [x] | `agent.watchers` | `Watchers.jsx` | Rejected watcher fields persist; failed approvals retry and denials are visible. |
| [x] | `agent.research` | `Jobs.jsx` | Rejected job fields persist; failed approvals retry and denials are visible. |
| [x] | `agent.delegated` | `Jobs.jsx` | Rejected job fields persist; failed approvals retry and denials are visible. |
| [x] | `agent.jobs` | `Jobs.jsx` | Rejected job fields persist; failed approvals retry and denials are visible. |
| [x] | `dev.ci` | `ConnectedItems.jsx` | Safe source links, partial sources and PR/issue/CI labels reviewed. |
| [x] | `dev.issues` | `ConnectedItems.jsx` | Safe source links, partial sources and PR/issue/CI labels reviewed. |
| [x] | `dev.prs` | `ConnectedItems.jsx` | Safe source links, partial sources and PR/issue/CI labels reviewed. |
| [x] | `dev.appeal` | `SupportCases.jsx` | Approval retry and denied-change feedback corrected; follow-ups remain drafts. |
| [x] | `dev.recovery` | `Items.jsx` | Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. |
| [x] | `dev.unpushed` | `GitRepos.jsx` | Unique label ids for multiple instances; paths and read-only evidence reviewed. |
| [x] | `dev.backup` | `GitRepos.jsx` | Unique label ids for multiple instances; paths and read-only evidence reviewed. |
| [x] | `lib.inbox` | `Library.jsx` | Saved items now open their source; source paragraphs retain formatting. |
| [x] | `lib.resurface` | `Library.jsx` | Saved items now open their source; source paragraphs retain formatting. |
| [x] | `lib.capture` | `Capture.jsx` | Rejected note text retained; failed approvals retry; readable validation errors. |
| [x] | `lib.search` | `LibrarySearch.jsx` | Search results inherit source navigation; query/degraded states reviewed. |
| [x] | `lib.recent` | `Library.jsx` | Saved items now open their source; source paragraphs retain formatting. |
| [x] | `lib.dupes` | `Library.jsx` | Saved items now open their source; source paragraphs retain formatting. |
| [x] | `lib.ask` | `LibraryAsk.jsx` | Question, async answer, source citations and source navigation reviewed. |
| [x] | `lib.readlater` | `ReadLater.jsx` | Denied article saves reported; rejected fields and failed approvals retained. |
| [x] | `lib.highlights` | `Highlights.jsx` | Denied highlight saves reported; source choice and rejected text retained. |
| [x] | `lib.daily` | `DailyNote.jsx` | Denied creation reported; create/open-existing states rechecked. |
| [x] | `lib.collections` | `Collections.jsx` | Denied collection changes reported; rejected fields retained. |
| [x] | `need.overdue` | `NeedsItems.jsx` | Overdue/snoozed source labels and timestamps reviewed. |
| [x] | `need.snoozed` | `NeedsItems.jsx` | Overdue/snoozed source labels and timestamps reviewed. |
| [x] | `glance.travel` | `Travel.jsx` | Saved/device/manual origin, timezone display, source attribution and errors reviewed. |
| [x] | `task.agenda` | `Agenda.jsx` | Access changes refresh dependent cards and remove disabled calendar data immediately. |
| [x] | `task.plan` | `Planning.jsx` | Saved shared hours/weekdays load correctly and changes propagate to dependents. |
| [x] | `task.free` | `Planning.jsx` | Saved shared hours/weekdays load correctly and changes propagate to dependents. |
| [x] | `task.conflicts` | `Planning.jsx` | Saved shared hours/weekdays load correctly and changes propagate to dependents. |
| [x] | `task.risk` | `Planning.jsx` | Saved shared hours/weekdays load correctly and changes propagate to dependents. |
| [x] | `glance.next-event` | `NextEvent.jsx` | Honest empty calendar and active/ended event states corrected. |
| [x] | `task.focus` | `Focus.jsx` | Shared review retains rejected timer settings and resets applied changes only. |
| [x] | `task.habits` | `Habits.jsx` | Shared review retains rejected habit inputs and resets applied changes only. |
| [x] | `task.goals` | `Goals.jsx` | Shared review retains rejected goal inputs and resets applied changes only. |
| [x] | `task.kanban` | `Kanban.jsx` | Shared review retains rejected project/column inputs and resets applied changes only. |
| [x] | `task.today` | `Items.jsx` | Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. |
| [x] | `task.backlog` | `Items.jsx` | Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. |
| [x] | `task.deadlines` | `Items.jsx` | Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. |
| [x] | `task.reminders` | `Items.jsx` | Input survives rejection/failure; completed deadlines excluded; legacy dates remain editable; spoofed OAuth messages ignored and polling cleaned up. |
| [x] | `dash.palette` | `Palette.jsx` | Palette entry point and existing search/capture scope reviewed. |
| [x] | `dash.pin` | `Pins.jsx` | Failed removal approvals retry; snapshot sandbox and rejection rechecked. |
| [x] | `dash.gallery` | `Gallery.jsx` | Unique search ids; inert previews; selection/add/size controls reviewed. |
| [x] | `dash.sync` | `Sync.jsx` | Per-widget freshness, source states and manual refresh reviewed. |
| [x] | `dash.quiet` | `Quiet.jsx` | Save/snooze/resume and settings keyboard navigation reviewed. |
| [x] | `dash.shortcuts` | `Shortcuts.jsx` | Shortcut list and settings keyboard navigation reviewed. |
