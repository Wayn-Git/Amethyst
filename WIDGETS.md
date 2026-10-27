# Amethyst — Complete Widgets Inventory

This document is the authoritative directory of **all widgets present across the Amethyst project**.

## Executive Summary

| Category | Count | Code Locations | Purpose |
|---|---|---|---|
| **1. Core Dashboard Widgets** | **80** | `backend/dashboard/registry.py`<br>`frontend/src/dashboard/widgets/` | Persisted Home Bento dashboard widgets with backend providers, SQLite cache, and quiet hours. |
| **2. Chat / Turn Interactive Widgets** | **11** | `backend/agent/widgets.py`<br>`frontend/src/components/widgets/` | Interactive structured UI rendered in agent conversation turns via `amethyst:widget` fences. |
| **3. Glance Playground Widgets** | **5** | `widgets/glance.*/`<br>`frontend/src/dashboard/widgets/*Glance.jsx` | Gan.dev template packages rendered with `@tugan/widgets` `WidgetRenderer`. |
| **4. Wigggle UI Vendor Designs** | **92** | `frontend/src/components/wigggle/` | Upstream design widget catalog variants across 8 categories adaptable to live dashboard widgets. |
| **TOTAL** | **188** | Entire Repository | All widget implementations, models, templates, and designs. |

---
## 1. Core Dashboard Widgets (80 Widgets)

Defined as validated manifests in `backend/dashboard/registry.py` and rendered by `frontend/src/dashboard/Home.jsx` via lazy components in `frontend/src/dashboard/registry.js`.

### 1.1 Glance (Quick Sensory & Status) (7 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `glance.air` | **Air quality** | Air quality readings for your saved location. | `s, m, l` | `poll (1h)` | `api` | `-` | `-` | `frontend/src/dashboard/widgets/AirQuality.jsx` | `backend/dashboard/weather.py:provide` |
| `glance.clock` | **Clock** | Local time and your saved time zones. | `s, m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Clock.jsx` | `backend/dashboard/service.py` |
| `glance.music` | **Desktop music** | See and control your desktop music player. | `s, m, l` | `poll (10s)` | `local` | `-` | `play, pause, previous, next (gated)` | `frontend/src/dashboard/widgets/Music.jsx` | `backend/dashboard/music.py:provide` |
| `glance.next-event` | **Next event** | See the next event on your calendar. | `s, m, l` | `poll (15m)` | `composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/NextEventGlance.jsx` | `backend/dashboard/agenda.py:next_event` |
| `glance.sun` | **Sunrise and sunset** | Sunrise and sunset times for your location. | `s, m, l` | `poll (1h)` | `api` | `-` | `-` | `frontend/src/dashboard/widgets/Sun.jsx` | `backend/dashboard/weather.py:provide` |
| `glance.travel` | **Travel time to next event** | Estimate travel time to your next calendar event. | `m, l` | `poll (15m)` | `composio:googlecalendar, composio:google_maps` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/TravelGlance.jsx` | `backend/dashboard/travel.py:provide` |
| `glance.weather` | **Weather** | Current weather and forecast for your location. | `m, l` | `poll (30m)` | `api` | `-` | `-` | `frontend/src/dashboard/widgets/WeatherGlance.jsx` | `backend/dashboard/weather.py:provide` |

### 1.2 Needs-You (Urgent, Approvals & Review) (9 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `need.approvals` | **Permission approvals** | Approve or deny pending agent tool requests. | `m, l` | `poll (10s)` | `director` | `-` | `approve, deny (gated)` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `need.decisions` | **Decisions waiting** | Review decisions waiting for your input. | `m, l` | `poll (10s)` | `director` | `-` | `answer, dismiss (gated)` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `need.drafts` | **Mail drafts to approve** | Review and approve your saved mail drafts. | `m, l` | `poll (15m)` | `local` | `-` | `add, edit, approve (gated)` | `frontend/src/dashboard/widgets/MailDrafts.jsx` | `backend/dashboard/mail.py:provide` |
| `need.inbox` | **Priority inbox** | Mail that may need your attention or a reply. | `m, l` | `poll (15m)` | `composio:gmail, llm` | `connector:gmail` | `-` | `frontend/src/dashboard/widgets/Mail.jsx` | `backend/dashboard/mail.py:provide` |
| `need.lor-slack` | **Unreplied Slack DMs** | Slack direct messages still awaiting your reply. | `m, l` | `poll (15m)` | `composio:slack` | `-` | `-` | `frontend/src/dashboard/widgets/Communication.jsx` | `backend/dashboard/communication.py:provide` |
| `need.mentions` | **Unanswered mentions** | Unanswered mentions from Slack and GitHub. | `m, l` | `poll (15m)` | `composio:slack, composio:github` | `-` | `-` | `frontend/src/dashboard/widgets/ConnectedItems.jsx` | `backend/dashboard/mentions.py:provide` |
| `need.overdue` | **Overdue items** | Review tasks and deadlines past their due date. | `m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/NeedsItems.jsx` | `backend/dashboard/items.py:provide` |
| `need.snoozed` | **Snoozed items returning today** | See snoozed items returning today. | `m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/NeedsItems.jsx` | `backend/dashboard/items.py:provide` |
| `need.waiting` | **Waiting on replies** | Track messages and items awaiting a reply. | `m, l` | `poll (15m)` | `composio:gmail, llm` | `connector:gmail` | `add, complete, nudge (gated)` | `frontend/src/dashboard/widgets/Waiting.jsx` | `backend/dashboard/mail.py:provide` |

### 1.3 Tasks, Calendar & Planning (13 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `task.agenda` | **Agenda and week view** | Browse your calendar agenda and week. | `m, l` | `poll (15m)` | `composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/Agenda.jsx` | `backend/dashboard/agenda.py:provide` |
| `task.backlog` | **Backlog** | Collect tasks to work on later. | `m, l` | `poll (1m)` | `local` | `-` | `add, edit, complete, delete (gated)` | `frontend/src/dashboard/widgets/Items.jsx` | `backend/dashboard/items.py:provide` |
| `task.conflicts` | **Calendar conflicts** | Identify overlapping calendar events. | `m, l` | `poll (15m)` | `local, composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/Planning.jsx` | `backend/dashboard/planning.py:provide` |
| `task.deadlines` | **Deadline countdowns** | See countdowns to your saved deadlines. | `m, l` | `poll (1m)` | `local` | `-` | `add, edit, complete, delete (gated)` | `frontend/src/dashboard/widgets/Items.jsx` | `backend/dashboard/items.py:provide` |
| `task.focus` | **Focus timer** | Run a focus timer for your current task. | `m, l` | `poll (1m)` | `local` | `-` | `configure, start, stop (gated)` | `frontend/src/dashboard/widgets/Focus.jsx` | `backend/dashboard/focus.py:provide` |
| `task.free` | **Free-slot finder** | Find open slots in your calendar. | `m, l` | `poll (15m)` | `local, composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/Planning.jsx` | `backend/dashboard/planning.py:provide` |
| `task.goals` | **Goals** | Track progress toward your saved goals. | `m, l` | `poll (1m)` | `local` | `-` | `add, progress (gated)` | `frontend/src/dashboard/widgets/Goals.jsx` | `backend/dashboard/goals.py:provide` |
| `task.habits` | **Habit streaks** | Record habit check-ins and review streaks. | `m, l` | `poll (1m)` | `local` | `-` | `add, checkin (gated)` | `frontend/src/dashboard/widgets/Habits.jsx` | `backend/dashboard/habits.py:provide` |
| `task.kanban` | **Mini kanban per project** | Move project tasks between kanban columns. | `m, l` | `poll (1m)` | `local` | `-` | `project, configure, move (gated)` | `frontend/src/dashboard/widgets/Kanban.jsx` | `backend/dashboard/kanban.py:provide` |
| `task.plan` | **Proposed day plan** | Review a proposed plan for your day. | `m, l` | `poll (15m)` | `local, composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/Planning.jsx` | `backend/dashboard/planning.py:provide` |
| `task.reminders` | **Reminders** | Manage reminders and their due times. | `m, l` | `poll (1m)` | `local` | `-` | `add, edit, complete, delete (gated)` | `frontend/src/dashboard/widgets/Items.jsx` | `backend/dashboard/items.py:provide` |
| `task.risk` | **Deadline risk** | Review deadlines that may be at risk. | `m, l` | `poll (15m)` | `local, composio:googlecalendar` | `connector:googlecalendar` | `-` | `frontend/src/dashboard/widgets/Planning.jsx` | `backend/dashboard/planning.py:provide` |
| `task.today` | **Today list** | Manage the tasks on your Today list. | `m, l` | `poll (1m)` | `local` | `-` | `add, edit, complete, delete (gated)` | `frontend/src/dashboard/widgets/Items.jsx` | `backend/dashboard/items.py:provide` |

### 1.4 Library & Knowledge Base (11 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `lib.ask` | **Ask your library** | Ask questions using your saved library material. | `m, l` | `poll (1m)` | `library, llm` | `-` | `-` | `frontend/src/dashboard/widgets/LibraryAsk.jsx` | `backend/dashboard/library.py:provide` |
| `lib.capture` | **Quick capture** | Save a quick note to your library. | `m, l` | `poll (1m)` | `library` | `-` | `add (gated)` | `frontend/src/dashboard/widgets/Capture.jsx` | `backend/dashboard/library.py:provide` |
| `lib.collections` | **Collections and tags** | Browse library collections and tags. | `m, l` | `poll (1m)` | `library` | `-` | `add, tag (gated)` | `frontend/src/dashboard/widgets/Collections.jsx` | `backend/dashboard/library.py:provide` |
| `lib.daily` | **Daily note** | Open or create your daily library note. | `m, l` | `poll (1m)` | `library` | `-` | `create (gated)` | `frontend/src/dashboard/widgets/DailyNote.jsx` | `backend/dashboard/library.py:provide` |
| `lib.dupes` | **Duplicates found** | Review potential duplicate library items. | `m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/Library.jsx` | `backend/dashboard/library.py:provide` |
| `lib.highlights` | **Article highlights** | Revisit highlights from saved articles. | `m, l` | `poll (1m)` | `library` | `-` | `add (gated)` | `frontend/src/dashboard/widgets/Highlights.jsx` | `backend/dashboard/library.py:provide` |
| `lib.inbox` | **Saved items inbox** | Review items saved to your library inbox. | `m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/Library.jsx` | `backend/dashboard/library.py:provide` |
| `lib.readlater` | **Read later** | Browse articles you saved to read later. | `m, l` | `poll (1m)` | `library, llm` | `-` | `add (gated)` | `frontend/src/dashboard/widgets/ReadLater.jsx` | `backend/dashboard/library.py:provide` |
| `lib.recent` | **Recently edited notes** | Find recently edited library notes. | `m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/Library.jsx` | `backend/dashboard/library.py:provide` |
| `lib.resurface` | **Resurfaced old notes** | Revisit older notes from your library. | `m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/Library.jsx` | `backend/dashboard/library.py:provide` |
| `lib.search` | **Library search** | Search saved notes and library items. | `m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/LibrarySearch.jsx` | `backend/dashboard/library.py:provide` |

### 1.5 Communication & Messaging (7 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `comm.contacts` | **Contact cards** | Browse contacts from mail, Slack and local notes. | `m, l` | `poll (15m)` | `local, composio:gmail, composio:slack` | `-` | `-` | `frontend/src/dashboard/widgets/Communication.jsx` | `backend/dashboard/communication.py:provide` |
| `comm.newsletters` | **Newsletter digest** | Summarize newsletters from your mailbox. | `m, l` | `poll (15m)` | `composio:gmail, llm` | `-` | `-` | `frontend/src/dashboard/widgets/Communication.jsx` | `backend/dashboard/communication.py:provide` |
| `comm.reachout` | **Birthdays and reach-out nudges** | Track birthdays and reminders to reach out. | `m, l` | `poll (15m)` | `local, composio:gmail, composio:slack` | `-` | `configure (gated)` | `frontend/src/dashboard/widgets/Reachout.jsx` | `backend/dashboard/reachout.py:provide` |
| `comm.templates` | **Draft templates** | Create and reuse local mail draft templates. | `m, l` | `poll (15m)` | `local` | `-` | `add, edit, delete, use (gated)` | `frontend/src/dashboard/widgets/Templates.jsx` | `backend/dashboard/mail.py:provide` |
| `comm.thread-summary` | **Long-thread summaries** | Generate summaries of long mail and Slack threads. | `m, l` | `poll (15m)` | `composio:gmail, composio:slack, llm` | `-` | `-` | `frontend/src/dashboard/widgets/Communication.jsx` | `backend/dashboard/communication.py:provide` |
| `comm.tone` | **Reply tone picker** | Rewrite a saved draft in a chosen tone. | `m, l` | `poll (15m)` | `local, llm` | `-` | `rewrite (gated)` | `frontend/src/dashboard/widgets/Tone.jsx` | `backend/dashboard/mail.py:provide` |
| `comm.unread` | **Unread by person** | See unread mail grouped by person. | `m, l` | `poll (15m)` | `composio:gmail` | `connector:gmail` | `-` | `frontend/src/dashboard/widgets/Mail.jsx` | `backend/dashboard/mail.py:provide` |

### 1.6 Developer & Git Repositories (7 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `dev.appeal` | **Support cases** | Track support cases and prepare follow-ups. | `m, l` | `poll (15m)` | `local, composio:gmail, llm` | `-` | `add, reply, follow-up, unwatch (gated)` | `frontend/src/dashboard/widgets/SupportCases.jsx` | `backend/dashboard/developer.py:provide` |
| `dev.backup` | **Backup status** | Check recorded backup status. | `m, l` | `poll (1m)` | `git` | `-` | `-` | `frontend/src/dashboard/widgets/GitRepos.jsx` | `backend/dashboard/git.py:provide` |
| `dev.ci` | **CI status** | Check CI runs for your connected repositories. | `m, l` | `poll (15m)` | `composio:github` | `connector:github` | `-` | `frontend/src/dashboard/widgets/ConnectedItems.jsx` | `backend/dashboard/github.py:provide` |
| `dev.issues` | **Assigned issues** | See GitHub issues assigned to you. | `m, l` | `poll (15m)` | `composio:github` | `connector:github` | `-` | `frontend/src/dashboard/widgets/ConnectedItems.jsx` | `backend/dashboard/github.py:provide` |
| `dev.prs` | **Pull requests** | Review pull requests from GitHub. | `m, l` | `poll (15m)` | `composio:github` | `connector:github` | `-` | `frontend/src/dashboard/widgets/ConnectedItems.jsx` | `backend/dashboard/github.py:provide` |
| `dev.recovery` | **Recovery checklist** | Manage a local account recovery checklist. | `m, l` | `poll (1m)` | `local` | `-` | `add, edit, complete, delete (gated)` | `frontend/src/dashboard/widgets/Items.jsx` | `backend/dashboard/developer.py:provide` |
| `dev.unpushed` | **Unpushed commits and dirty branches** | Find unpushed commits and working-tree changes. | `m, l` | `poll (1m)` | `git` | `-` | `-` | `frontend/src/dashboard/widgets/GitRepos.jsx` | `backend/dashboard/git.py:provide` |

### 1.7 Agent Operations, Jobs & Audits (14 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `agent.audit` | **Tool-call audit log** | Inspect the agent’s recorded tool calls. | `m, l` | `poll (10s)` | `director` | `-` | `-` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `agent.brief` | **Daily brief and evening wrap-up** | Generate a daily brief or evening wrap-up. | `m, l` | `poll (1m)` | `llm` | `-` | `-` | `frontend/src/dashboard/widgets/Insights.jsx` | `backend/dashboard/insights.py:provide` |
| `agent.delegated` | **Delegated tasks board** | Review tasks delegated to other agents. | `m, l` | `poll (10s)` | `director` | `-` | `add (gated)` | `frontend/src/dashboard/widgets/Jobs.jsx` | `backend/dashboard/director.py:provide` |
| `agent.errors` | **Errors and retries** | Inspect failed agent actions and retry them. | `m, l` | `poll (10s)` | `director` | `-` | `-` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `agent.feed` | **Activity feed** | Review the agent’s recent activity. | `m, l` | `poll (10s)` | `director` | `-` | `-` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `agent.jobs` | **Scheduled and recurring agent jobs** | Manage scheduled and recurring agent jobs. | `m, l` | `poll (10s)` | `director` | `-` | `add, delete (gated)` | `frontend/src/dashboard/widgets/Jobs.jsx` | `backend/dashboard/director.py:provide` |
| `agent.knows` | **What Amethyst knows about me** | Review the memory Amethyst keeps about you. | `m, l` | `poll (10s)` | `library` | `-` | `edit, delete (gated)` | `frontend/src/dashboard/widgets/Knows.jsx` | `backend/dashboard/director.py:provide` |
| `agent.next` | **One suggested next action** | Review one suggested next action. | `m, l` | `poll (15m)` | `llm` | `-` | `-` | `frontend/src/dashboard/widgets/Insights.jsx` | `backend/dashboard/insights.py:provide` |
| `agent.research` | **Background research jobs with results** | Track background research and open its results. | `m, l` | `poll (10s)` | `director` | `-` | `add (gated)` | `frontend/src/dashboard/widgets/Jobs.jsx` | `backend/dashboard/director.py:provide` |
| `agent.rules` | **Permission rules manager** | Review and manage tool permission rules. | `m, l` | `poll (10s)` | `director` | `-` | `set (gated)` | `frontend/src/dashboard/widgets/Rules.jsx` | `backend/dashboard/director.py:provide` |
| `agent.running` | **Running tasks** | Follow agent tasks currently in progress. | `m, l` | `poll (10s)` | `director` | `-` | `stop (gated)` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/director.py:provide` |
| `agent.skills` | **Skills** | Browse installed agent skills. | `m, l` | `poll (10s)` | `local` | `-` | `toggle (gated)` | `frontend/src/dashboard/widgets/Skills.jsx` | `backend/dashboard/director.py:provide` |
| `agent.usage` | **Model usage meter** | Review recorded model usage. | `m, l` | `poll (10s)` | `director` | `-` | `-` | `frontend/src/dashboard/widgets/Usage.jsx` | `backend/dashboard/director.py:provide` |
| `agent.watchers` | **Page and mailbox watchers** | Manage page and mailbox watchers. | `m, l` | `poll (15m)` | `director` | `-` | `add, delete (gated)` | `frontend/src/dashboard/widgets/Watchers.jsx` | `backend/dashboard/director.py:provide` |

### 1.8 News & Feeds (2 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `feed.news` | **News by topic** | Headlines from your feeds, grouped by topic. | `m, l` | `poll (30m)` | `rss` | `-` | `-` | `frontend/src/dashboard/widgets/News.jsx` | `backend/dashboard/news.py:provide` |
| `feed.rss` | **RSS reader** | Read and manage your RSS subscriptions. | `m, l` | `poll (30m)` | `rss` | `-` | `add, edit, delete (gated)` | `frontend/src/dashboard/widgets/Feeds.jsx` | `backend/dashboard/feeds.py:provide` |

### 1.9 System & Infrastructure (4 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `sys.connectors` | **Connector health and reconnect** | Check connected sources and reconnect them. | `s, m, l` | `poll (10s)` | `composio` | `-` | `-` | `frontend/src/dashboard/widgets/Connectors.jsx` | `backend/dashboard/system.py:provide` |
| `sys.model` | **Active model** | View and switch the active language model. | `s, m, l` | `poll (1m)` | `director` | `-` | `switch (gated)` | `frontend/src/dashboard/widgets/Model.jsx` | `backend/dashboard/system.py:provide` |
| `sys.notify` | **Notification center** | Review dashboard notifications. | `s, m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/system.py:provide` |
| `sys.vault` | **Vault size and storage** | Check library storage and vault size. | `s, m, l` | `poll (1m)` | `library` | `-` | `-` | `frontend/src/dashboard/widgets/Director.jsx` | `backend/dashboard/system.py:provide` |

### 1.10 Dashboard Controls & Shortcuts (6 widgets)

| ID | Title | Description | Sizes | Refresh | Source | Requires | Actions | Frontend Component | Backend Provider |
|---|---|---|---|---|---|---|---|---|---|
| `dash.gallery` | **Widget gallery** | Browse widgets and choose what appears on Home. | `m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Gallery.jsx` | `backend/dashboard/service.py:local_provider` |
| `dash.palette` | **Command palette and global search** | Search your workspace and capture new items. | `m, l` | `manual` | `local, library` | `-` | `-` | `frontend/src/dashboard/widgets/Palette.jsx` | `backend/dashboard/service.py:local_provider` |
| `dash.pin` | **Pinned answers** | Keep selected chat answers on Home. | `m, l` | `poll (1m)` | `director` | `-` | `add, delete (gated)` | `frontend/src/dashboard/widgets/Pins.jsx` | `backend/dashboard/pins.py:provide` |
| `dash.quiet` | **Quiet hours** | Set quiet hours and pause dashboard refreshes. | `m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Quiet.jsx` | `backend/dashboard/service.py:local_provider` |
| `dash.shortcuts` | **Keyboard shortcuts** | Look up Home keyboard shortcuts. | `m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Shortcuts.jsx` | `backend/dashboard/service.py:local_provider` |
| `dash.sync` | **Refresh status** | Check freshness and refresh dashboard sources. | `s, m, l` | `poll (1m)` | `local` | `-` | `-` | `frontend/src/dashboard/widgets/Sync.jsx` | `backend/dashboard/service.py:local_provider` |

---
## 2. Chat / Turn Interactive Widgets (11 Widgets)

When an assistant response is better served by interactive UI instead of prose (e.g., recipes with serving scaling, step-by-step guides with timers, quizzes, or itineraries), `backend/agent/widgets.py` classifies the turn and emits a structured payload wrapped in `amethyst:widget` code fence.

Frontend dispatch: `frontend/src/components/widgets/WidgetRenderer.jsx`.

| Widget Type | Schema Model | Frontend Renderer | Media Support | Purpose & Interactive Features |
|---|---|---|---|---|
| `recipe` | `Recipe` | `frontend/src/components/widgets/Recipe.jsx` | Yes (video/image) | Interactive cooking recipes with dynamic servings scaling slider, ingredient checklists, and step timers. |
| `step_guide` | `StepGuide` | `frontend/src/components/widgets/StepGuide.jsx` | Yes (video/image) | Step-by-step instructional guides with progress tracking and step timers. |
| `quiz` | `Quiz` | `frontend/src/components/widgets/Quiz.jsx` | No | Interactive multi-question quiz with score tracking, option selection, and answer explanations. |
| `comparison` | `Comparison` | `frontend/src/components/widgets/Comparison.jsx` | No | Side-by-side comparative matrix table evaluating items across multiple attributes. |
| `itinerary` | `Itinerary` | `frontend/src/components/widgets/Itinerary.jsx` | Yes (hero & stops) | Multi-day travel itinerary with interactive stops, map coordinates, drive times, and scenic photos. |
| `translation` | `Translation` | `frontend/src/components/widgets/Translation.jsx` | No | Side-by-side source and translated text card with language badges and copy actions. |
| `chart` | `Chart` | `frontend/src/components/widgets/Chart.jsx` | No | Data visualizations rendering line, bar, or scatter charts with labeled series. |
| `options` | `Options` | `frontend/src/components/widgets/Options.jsx` | No | Selectable decision options supporting single or multi-select modes. |
| `image_gallery` | `ImageGallery` | `frontend/src/components/widgets/ImageGallery.jsx` | Yes | Rich visual gallery supporting grid and carousel layouts for media search results. |
| `data_table` | `DataTable` | `frontend/src/components/widgets/DataTable.jsx` | No | Structured data tables with sortable columns and structured rows. |
| `sandboxed_ui` | `SandboxedUi` | `frontend/src/components/widgets/SandboxedUi.jsx` | No | Sandboxed interactive HTML/CSS/JS components embedded directly in the conversation flow. |

---
## 3. Glance Playground Widgets (5 Widgets)

Specialized glance widgets designed via `widgets.gan.dev/playground` per `docs/widget-playground/WIDGET_LOOP.md` and rendered with `@tugan/widgets` `WidgetRenderer`.

| Widget ID | Artifact Directory | Fixture Data | Metadata & Spec | Template | Frontend Dashboard Adapter |
|---|---|---|---|---|---|
| `glance.air` | `widgets/glance.air/` | `widgets/glance.air/data.fixture.json` | `widgets/glance.air/meta.json, wiring.md` | `widgets/glance.air/template.txt` | `frontend/src/dashboard/widgets/AirQuality.jsx` |
| `glance.next-event` | `widgets/glance.next-event/` | `widgets/glance.next-event/data.fixture.json` | `widgets/glance.next-event/meta.json, wiring.md` | `widgets/glance.next-event/template.txt` | `frontend/src/dashboard/widgets/NextEventGlance.jsx` |
| `glance.sun` | `widgets/glance.sun/` | `widgets/glance.sun/data.fixture.json` | `widgets/glance.sun/meta.json, wiring.md` | `widgets/glance.sun/template.txt` | `frontend/src/dashboard/widgets/Sun.jsx` |
| `glance.travel` | `widgets/glance.travel/` | `widgets/glance.travel/data.fixture.json` | `widgets/glance.travel/meta.json, wiring.md` | `widgets/glance.travel/template.txt` | `frontend/src/dashboard/widgets/TravelGlance.jsx` |
| `glance.weather` | `widgets/glance.weather/` | `widgets/glance.weather/data.fixture.json` | `widgets/glance.weather/meta.json, wiring.md` | `widgets/glance.weather/template.txt` | `frontend/src/dashboard/widgets/WeatherGlance.jsx` |

---
## 4. Wigggle UI Vendor Designs (92 Designs)

Catalog of 92 pre-built visual widget designs vendor-adapted under MIT license in `frontend/src/components/wigggle/vendor/registry/default/widgets/`.

### Summary by Category

- **Calendar** (21 designs)
- **Clock** (13 designs)
- **Dashboard** (10 designs)
- **Media** (13 designs)
- **Productivity** (11 designs)
- **Sports** (7 designs)
- **Stocks** (6 designs)
- **Weather** (11 designs)

| Design ID | Name | Category | Size | Module File |
|---|---|---|---|---|
| `calendar-lg-01` | **Calendar 01** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-01.tsx` |
| `calendar-lg-02` | **Calendar 02** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-02.tsx` |
| `calendar-lg-03` | **Calendar 03** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-03.tsx` |
| `calendar-lg-04` | **Calendar 04** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-04.tsx` |
| `calendar-lg-05` | **Calendar 05** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-05.tsx` |
| `calendar-lg-06` | **Calendar 06** | `calendar` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/lg/calendar-06.tsx` |
| `calendar-md-01` | **Calendar 01** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-01.tsx` |
| `calendar-md-02` | **Calendar 02** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-02.tsx` |
| `calendar-md-03` | **Calendar 03** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-03.tsx` |
| `calendar-md-04` | **Calendar 04** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-04.tsx` |
| `calendar-md-05` | **Calendar 05** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-05.tsx` |
| `calendar-md-06` | **Calendar 06** | `calendar` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/md/calendar-06.tsx` |
| `calendar-sm-01` | **Calendar 01** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-01.tsx` |
| `calendar-sm-02` | **Calendar 02** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-02.tsx` |
| `calendar-sm-03` | **Calendar 03** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-03.tsx` |
| `calendar-sm-04` | **Calendar 04** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-04.tsx` |
| `calendar-sm-05` | **Calendar 05** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-05.tsx` |
| `calendar-sm-06` | **Calendar 06** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-06.tsx` |
| `calendar-sm-07` | **Calendar 07** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-07.tsx` |
| `calendar-sm-08` | **Calendar 08** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-08.tsx` |
| `calendar-sm-09` | **Calendar 09** | `calendar` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/calendar/sm/calendar-09.tsx` |
| `clock-sm-01` | **Clock 01** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-01.tsx` |
| `clock-sm-02` | **Clock 02** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-02.tsx` |
| `clock-sm-03` | **Clock 03** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-03.tsx` |
| `clock-sm-04` | **Clock 04** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-04.tsx` |
| `clock-sm-05` | **Clock 05** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-05.tsx` |
| `clock-sm-06` | **Clock 06** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-06.tsx` |
| `clock-sm-07` | **Clock 07** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-07.tsx` |
| `clock-sm-08` | **Clock 08** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-08.tsx` |
| `clock-sm-09` | **Clock 09** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-09.tsx` |
| `clock-sm-10` | **Clock 10** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-10.tsx` |
| `clock-sm-11` | **Clock 11** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-11.tsx` |
| `clock-sm-12` | **Clock 12** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-12.tsx` |
| `clock-sm-13` | **Clock 13** | `clock` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/clock/sm/clock-13.tsx` |
| `dashboard-lg-01` | **Dashboard 01** | `dashboard` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/lg/dashboard-01.tsx` |
| `dashboard-lg-02` | **Dashboard 02** | `dashboard` | `l` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/lg/dashboard-02.tsx` |
| `dashboard-md-01` | **Dashboard 01** | `dashboard` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/md/dashboard-01.tsx` |
| `dashboard-md-02` | **Dashboard 02** | `dashboard` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/md/dashboard-02.tsx` |
| `dashboard-sm-01` | **Dashboard 01** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-01.tsx` |
| `dashboard-sm-02` | **Dashboard 02** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-02.tsx` |
| `dashboard-sm-03` | **Dashboard 03** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-03.tsx` |
| `dashboard-sm-04` | **Dashboard 04** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-04.tsx` |
| `dashboard-sm-05` | **Dashboard 05** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-05.tsx` |
| `dashboard-sm-06` | **Dashboard 06** | `dashboard` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/dashboard/sm/dashboard-06.tsx` |
| `media-md-01` | **Media 01** | `media` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/md/media-01.tsx` |
| `media-md-02` | **Media 02** | `media` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/md/media-02.tsx` |
| `media-md-03` | **Media 03** | `media` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/md/media-03.tsx` |
| `media-md-04` | **Media 04** | `media` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/md/media-04.tsx` |
| `media-md-05` | **Media 05** | `media` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/md/media-05.tsx` |
| `media-sm-01` | **Media 01** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-01.tsx` |
| `media-sm-02` | **Media 02** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-02.tsx` |
| `media-sm-03` | **Media 03** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-03.tsx` |
| `media-sm-04` | **Media 04** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-04.tsx` |
| `media-sm-05` | **Media 05** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-05.tsx` |
| `media-sm-06` | **Media 06** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-06.tsx` |
| `media-sm-07` | **Media 07** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-07.tsx` |
| `media-sm-08` | **Media 08** | `media` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/media/sm/media-08.tsx` |
| `productivity-md-01` | **Productivity 01** | `productivity` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/md/productivity-01.tsx` |
| `productivity-md-02` | **Productivity 02** | `productivity` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/md/productivity-02.tsx` |
| `productivity-md-03` | **Productivity 03** | `productivity` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/md/productivity-03.tsx` |
| `productivity-md-04` | **Productivity 04** | `productivity` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/md/productivity-04.tsx` |
| `productivity-sm-01` | **Productivity 01** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-01.tsx` |
| `productivity-sm-02` | **Productivity 02** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-02.tsx` |
| `productivity-sm-03` | **Productivity 03** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-03.tsx` |
| `productivity-sm-04` | **Productivity 04** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-04.tsx` |
| `productivity-sm-05` | **Productivity 05** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-05.tsx` |
| `productivity-sm-06` | **Productivity 06** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-06.tsx` |
| `productivity-sm-07` | **Productivity 07** | `productivity` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/productivity/sm/productivity-07.tsx` |
| `sports-sm-01` | **Sports 01** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-01.tsx` |
| `sports-sm-02` | **Sports 02** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-02.tsx` |
| `sports-sm-03` | **Sports 03** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-03.tsx` |
| `sports-sm-04` | **Sports 04** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-04.tsx` |
| `sports-sm-05` | **Sports 05** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-05.tsx` |
| `sports-sm-06` | **Sports 06** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-06.tsx` |
| `sports-sm-07` | **Sports 07** | `sports` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/sports/sm/sports-07.tsx` |
| `stocks-sm-01` | **Stocks 01** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-01.tsx` |
| `stocks-sm-02` | **Stocks 02** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-02.tsx` |
| `stocks-sm-03` | **Stocks 03** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-03.tsx` |
| `stocks-sm-04` | **Stocks 04** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-04.tsx` |
| `stocks-sm-05` | **Stocks 05** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-05.tsx` |
| `stocks-sm-06` | **Stocks 06** | `stocks` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/stocks/sm/stock-06.tsx` |
| `weather-md-01` | **Weather 01** | `weather` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/md/weather-01.tsx` |
| `weather-md-02` | **Weather 02** | `weather` | `m` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/md/weather-02.tsx` |
| `weather-sm-01` | **Weather 01** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-01.tsx` |
| `weather-sm-02` | **Weather 02** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-02.tsx` |
| `weather-sm-03` | **Weather 03** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-03.tsx` |
| `weather-sm-04` | **Weather 04** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-04.tsx` |
| `weather-sm-05` | **Weather 05** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-05.tsx` |
| `weather-sm-06` | **Weather 06** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-06.tsx` |
| `weather-sm-07` | **Weather 07** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-07.tsx` |
| `weather-sm-08` | **Weather 08** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-08.tsx` |
| `weather-sm-09` | **Weather 09** | `weather` | `s` | `frontend/src/components/wigggle/vendor/registry/default/widgets/weather/sm/weather-09.tsx` |