# Amethyst Home Dashboard: Spec

Status: draft v1 · Last updated: 2026-10-24
Scope: the main "Home" screen of Amethyst, built as a widget system.
Place this file at `docs/dashboard-spec.md` in the repo.

---

## 0. Instructions for whoever implements this (human or model)

1. Read this whole file before writing code. Then read the existing backend (`backend/`) and frontend, and follow their conventions. Where this spec proposes an API or table that conflicts with existing code, the existing code wins; note the deviation in `docs/dashboard-changelog.md`.
2. Build in tier order: MVP, then v2, then Later (section 6). Do not start a later tier until the earlier one meets its Definition of Done (section 12).
3. One widget per task. Each task ends with: the widget working, its tests passing, and its `Done` box ticked in section 6. Do not take screenshots; the owner reviews the UI by hand.
4. Do not invent features, data, claims, or integrations that are not in this file. If something is ambiguous, write the question under section 13 and pick the simplest option that can be reversed.
5. Never use fake data in shipped widgets. Sample data is allowed only in tests and design mockups, and must be labelled.
6. Commit small and often. Update `docs/dashboard-changelog.md` at the end of every session so the work can be continued by someone else.
7. Output rules (tokens are limited): edit files in place and never reprint files or diffs in replies; no plans, summaries, or explanations of code; read only the files and spec sections the task needs; run only the tests for what you touched. The final reply is at most 5 lines: widget ids done, test result, blockers.

---

## 1. Goal

Home is the first screen of Amethyst: one ranked place that shows what needs the user now, what the agent is doing, and what is coming up, built from the user's mail, calendar, code, notes, tasks, and the agent's own activity.

It must feel like a calm, premium desktop app (Linear and Raycast are the references), not a wall of tiles.

### Non-goals (v1)

- No hosted service, no accounts, no multi-user mode. Amethyst stays local-first and single-user.
- No auto-sending of messages or mail. The agent drafts; the user approves.
- No native mobile app. A phone companion view uses the existing phone-sharing feature.
- No features that need an API that does not exist. Anything blocked is listed under Later with the reason.

---

## 2. Hard rules

These apply to every widget.

1. **Drafts only.** The agent never sends, deletes, or posts on its own. Every write action goes through the Director's permission gate and is recorded in the turn trace.
2. **Honest states.** Every widget implements: loading, empty, not-connected, error, and stale. Never show placeholder data to look full.
3. **Freshness is visible.** Every widget shows "last synced" and has a manual refresh.
4. **Independent failure.** One widget failing or being slow must not block, delay, or break any other widget (per-widget error boundary, per-widget fetch).
5. **Cache first.** Home renders from the SQLite cache immediately and refreshes in the background (stale-while-revalidate). Home must be usable with no network.
6. **Local-first, stated precisely.** Data from connectors passes through Composio. UI copy and docs must not claim that nothing leaves the machine while connectors are on.
7. **Minimal data.** Cache only the fields a widget needs. Provide "disconnect and delete this connector's data".
8. **LLM-powered widgets are optional and async.** Summaries, briefs, suggestions, and tone drafts must work with a local Ollama model, never block rendering, and show a "generating" state. The dashboard is fully usable with every LLM widget off.
9. **Repo-accurate copy.** UI text states only what the product does today. Concrete nouns, no hype words.

---

## 3. Architecture

### 3.1 Stack (existing)

FastAPI backend, React 19 frontend, SQLite. The Director provides the agent loop, turn traces, and the permission gate. The Library provides the markdown vault, semantic and keyword search, and dedup. Models: Ollama locally or the cloud presets. Skills: `SKILL.md`. Generative UI: CopilotKit (`generate_sandboxed_ui`). Connectors: Composio.

### 3.2 Widget model

A widget is a manifest plus a data provider (backend) plus a component (frontend).

```json
{
  "id": "need.drafts",
  "title": "Mail drafts",
  "group": "needs-you",
  "tier": "mvp",
  "sizes": ["m", "l"],
  "source": { "type": "composio", "toolkit": "gmail" },
  "refresh": { "mode": "poll", "interval_s": 900 },
  "requires": ["connector:gmail"],
  "actions": [{ "id": "send", "label": "Send", "gate": true }],
  "empty": "No drafts waiting."
}
```

Fields:

| Field | Meaning |
|---|---|
| `id` | Stable id from section 6, `group.name` |
| `group` | One of: dashboard, glance, needs-you, communication, agent, library, tasks, developer, student, feed, life, system, proactive |
| `tier` | `mvp`, `v2`, or `later` |
| `sizes` | Allowed sizes: `s`, `m`, `l` |
| `source.type` | `local`, `library`, `director`, `git`, `api`, `rss`, `composio`, `llm` (a widget may list several) |
| `refresh` | `poll` with `interval_s`, `push`, or `manual` |
| `requires` | Connectors or settings that must be on, otherwise the widget shows "not connected" |
| `actions` | User actions; `gate: true` means the action must pass the permission gate |

Manifests are validated against a JSON schema at startup. An invalid manifest disables that widget and reports it in `sys.logs`, it never crashes the app.

### 3.3 Backend (proposed endpoints)

| Endpoint | Purpose |
|---|---|
| `GET /api/widgets` | All manifests plus enabled state |
| `GET /api/widgets/{id}/data` | Cached payload plus `{state, synced_at, stale, error}` |
| `POST /api/widgets/{id}/refresh` | Force a refresh now (calls the source directly) |
| `POST /api/widgets/{id}/actions/{action}` | Run an action; routed through the Director; `gate: true` actions wait for approval |
| `GET/PUT /api/layout?mode=` | Layout per mode |
| `GET /api/connectors/health` | Connection status per connector |

### 3.4 SQLite (proposed tables)

`widget_cache(widget_id, payload_json, state, error, synced_at)`
`layouts(mode, layout_json, updated_at)`
`widget_settings(widget_id, settings_json)`
`snoozes(item_id, widget_id, until)`
`tasks`, `deadlines`, `reminders`, `habits`, `goals`, `support_cases` (only the ones the shipped widgets need)

### 3.5 Frontend

- A registry maps widget id to a React component. Layout is a grid with drag and resize, saved per mode in SQLite.
- Each widget is lazy-loaded and wrapped in an error boundary.
- Widgets read from a shared data hook that handles state, freshness, refresh, and polling.
- All colors, spacing, radii, and type come from theme tokens. No hard-coded hex values in widget code.

### 3.6 Generative widgets

The agent can pin any chat answer to Home as a widget through `generate_sandboxed_ui`. Requirements: sandboxed with no network access and no access to the parent app's DOM or storage; data only through declared tool calls; labelled as "pinned from chat"; removable; stored in SQLite so it survives restarts.

### 3.7 Skill-shipped widgets (Later)

A `SKILL.md` may ship a widget manifest and component. Requires a review and permission step before a skill widget can load. Not in MVP.

---

## 4. Composio integration

1. **Auth:** use managed auth with a Connect Link: the user opens a link and authenticates. This maps to the "Connected apps" step in first-run setup and to `sys.connectors`.
2. **Freshness:** Gmail and Google Calendar are polled by Composio (up to about 15 minutes of delay on managed auth). Slack and GitHub can push in real time through webhook triggers; verify per trigger type. Widgets must show "last synced" and manual refresh must call the tool directly instead of waiting for a trigger.
3. **Local app and triggers:** webhook triggers need an address Composio can reach, and `127.0.0.1` is not one. First test SDK subscriptions for receiving trigger events locally. If that does not work, poll. Do not require users to set up a tunnel.
4. **Scopes:** request read-only scopes by default. Request send/write scopes only when the user turns on a feature that needs them.
5. **Gate:** no Composio write tool may be called outside the permission gate. Add a test that fails if a write tool is reachable without approval.
6. **Logging:** every connector call is written to the tool-call audit log (`agent.audit`) and appears in the privacy log (`sys.privacy`).
7. **Resilience:** backoff on rate limits, per-connector circuit breaker, and a clear "reconnect" state when auth expires.
8. **Verify before building:** check that the toolkit exists in the Composio catalogue for each of: GitLab, Discord, WhatsApp, YouTube, Google Maps, Google Classroom. Record the result under section 13 and mark dependent widgets accordingly.
9. **Due diligence:** read Composio's published incident reports before routing mail through it, and describe the data path in the docs.

---

## 5. Design requirements

- **Identity:** lavender, violet, and night-blue with white and near-black. Fonts: Space Grotesk (headings), Inter (body), JetBrains Mono (timestamps, counts, ids).
- **Look:** premium macOS-style. References: Linear, Raycast. Quiet surfaces, thin borders, tight but readable density.
- **Do not use:** glassmorphism, glow, gradient washes, decorative rings or lines around the logo, star or night-sky backgrounds, emoji as icons, or anything that reads as vibe-coded.
- **Layout:** one ranked "Needs you" column first, then glanceable cards, then browse-later cards. Not equal tiles.
- **Cards:** each card shows its source, how fresh it is, and one primary action.
- **Themes:** all in-app themes must work: System, Graphite, Ink, Nocturne, NVIDIA, Paper, Sand, Claude, Cursor. Layout modes (v2) may set a default theme.
- **Motion:** restrained and purposeful. 150 to 250 ms for state changes. No animation on data refresh that moves layout. Respect `prefers-reduced-motion`.
- **Accessibility:** WCAG AA contrast (4.5:1 for text, including small grey labels), keyboard reachable everything, real `button`, `a`, `input`, and `label` elements, visible focus, `aria-label` on icon-only buttons, status never conveyed by color alone, touch targets at least 44 px.
- **Responsive:** works at phone width (the grid collapses to one column; the sidebar becomes a top bar).
- **Icons:** one stroke icon set. No emoji.

---

## 6. Widget catalogue

Source legend: `local` = SQLite only · `lib` = Library · `dir` = Director · `git` = local git · `api` = free public API · `rss` = RSS · `cmp:<toolkit>` = via Composio · `llm` = needs a model call.

`Done` is for the implementer to tick.

### 6.1 Dashboard

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| dash.gallery | Widget gallery with drag and resize | local | MVP | [x] |
| dash.palette | ⌘K palette and global search | local, lib | MVP | [ ] |
| dash.pin | Pin a chat answer as a widget | dir, llm | MVP | [ ] |
| dash.sync | Per-widget refresh and "last synced" | local | MVP | [x] |
| dash.quiet | Quiet hours and snooze | local | MVP | [x] |
| dash.shortcuts | Keyboard shortcuts | local | MVP | [x] |
| dash.modes | Layout modes: Morning, Work, Study, Evening, Focus | local | v2 | [ ] |
| dash.theme-mode | Theme per mode | local | v2 | [ ] |
| dash.phone | Phone companion view | local | v2 | [ ] |
| dash.skill-widgets | Skill-shipped widgets | SKILL.md | Later | [ ] |

### 6.2 Glance

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| glance.clock | Clock and world clocks | local | MVP | [x] |
| glance.weather | Weather with hourly forecast and rain alerts | api | MVP | [ ] |
| glance.sun | Sunrise and sunset | api | MVP | [ ] |
| glance.air | Air quality | api | MVP | [ ] |
| glance.next-event | Next event with countdown | cmp:googlecalendar | MVP | [ ] |
| glance.music | Now playing and last played | cmp:spotify | MVP | [ ] |
| glance.travel | Travel time to next event | cmp:googlemaps | v2 | [ ] |
| glance.listen-stats | Listening stats | cmp:spotify | v2 | [ ] |

### 6.3 Needs you

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| need.inbox | Priority inbox (mails that need a reply) | cmp:gmail, llm | MVP | [ ] |
| need.drafts | Mail drafts to approve | cmp:gmail, llm, gate | MVP | [ ] |
| need.waiting | Waiting on (sent, no answer) with nudge drafts | cmp:gmail, local, llm | MVP | [ ] |
| need.overdue | Overdue items | local | MVP | [ ] |
| need.mentions | Unanswered mentions | cmp:slack, cmp:github | MVP | [ ] |
| need.decisions | Decisions the agent is waiting on | dir | MVP | [ ] |
| need.snoozed | Snoozed items returning today | local | MVP | [ ] |
| need.approvals | Permission-gate approval queue | dir | MVP | [ ] |
| need.lor-slack | Left on read: unreplied Slack DMs | cmp:slack | v2 | [ ] |
| need.lor-social | Left on read: WhatsApp and Instagram | blocked: no official personal-account API | Later | [ ] |

### 6.4 Communication

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| comm.tone | Reply tone picker (short, formal, friendly) | llm | MVP | [ ] |
| comm.templates | Draft templates | local | MVP | [ ] |
| comm.unread | Unread digest by person | cmp:gmail | MVP | [ ] |
| comm.thread-summary | Long-thread summaries | cmp:gmail, cmp:slack, llm | v2 | [ ] |
| comm.schedule-send | Scheduled send queue | cmp:gmail, gate | v2 | [ ] |
| comm.newsletters | Newsletter digest and unsubscribe suggestions | cmp:gmail, llm | v2 | [ ] |
| comm.meeting | Meeting request handler (proposes times) | cmp:gmail, cmp:googlecalendar, llm | v2 | [ ] |
| comm.contacts | Contact cards (last contact, shared context) | local, cmp:gmail | v2 | [ ] |
| comm.reachout | Birthdays and reach-out nudges | local, cmp:gmail | v2 | [ ] |

### 6.5 Agent (Director)

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| agent.feed | Live activity feed (turn traces) | dir | MVP | [ ] |
| agent.running | Running tasks with progress and a stop button | dir | MVP | [ ] |
| agent.audit | Tool-call audit log | dir | MVP | [ ] |
| agent.errors | Errors and retries | dir | MVP | [ ] |
| agent.brief | Daily brief and evening wrap-up | llm, all widget data | MVP | [ ] |
| agent.next | One suggested next action | llm | MVP | [ ] |
| agent.jobs | Scheduled and recurring agent jobs | dir | v2 | [ ] |
| agent.delegated | Delegated tasks board | dir | v2 | [ ] |
| agent.research | Background research jobs with results | dir, llm | v2 | [ ] |
| agent.watchers | Watchers ("tell me when X changes") | dir, cmp triggers, api | v2 | [ ] |
| agent.rules | Permission rules manager (always allow, ask, deny) | dir | v2 | [ ] |
| agent.usage | Model usage meter (tokens, latency, cost) | dir | v2 | [ ] |
| agent.knows | "What Amethyst knows about me" viewer and editor | lib | v2 | [ ] |
| agent.skills | Skills list with toggles | SKILL.md | v2 | [ ] |
| agent.suggest | Automation suggestions | llm, dir | v2 | [ ] |
| agent.prompts | Saved prompt shortcuts | local | v2 | [ ] |
| agent.weekly | Weekly review | llm | v2 | [ ] |

### 6.6 Library

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| lib.inbox | Saved items inbox | lib | MVP | [ ] |
| lib.resurface | Resurfaced old notes | lib (semantic search) | MVP | [ ] |
| lib.capture | ⌘K quick capture | lib | MVP | [ ] |
| lib.search | Semantic and keyword search | lib | MVP | [ ] |
| lib.recent | Recently edited notes | lib | MVP | [ ] |
| lib.dupes | Duplicates found | lib (dedup) | MVP | [ ] |
| lib.ask | Ask-your-library Q&A | lib, llm | v2 | [ ] |
| lib.readlater | Read-later queue with summaries | lib, llm | v2 | [ ] |
| lib.highlights | Highlights from articles | lib | v2 | [ ] |
| lib.daily | Daily note or journal prompt | lib | v2 | [ ] |
| lib.collections | Collections and tags | lib | v2 | [ ] |
| lib.flashcards | Flashcards due (spaced repetition) | lib, llm | Later | [ ] |
| lib.graph | Linked-notes graph | lib | Later | [ ] |

### 6.7 Tasks and planning

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| task.today | Today list | local | MVP | [x] |
| task.backlog | Backlog sorted by idle time | local | MVP | [x] |
| task.deadlines | Deadline countdowns | local | MVP | [x] |
| task.agenda | Agenda and week view | cmp:googlecalendar | MVP | [ ] |
| task.reminders | Reminders and alarms | local | MVP | [ ] |
| task.plan | Auto-planned day with time blocks | llm, cmp:googlecalendar | v2 | [ ] |
| task.focus | Focus timer | local | v2 | [ ] |
| task.habits | Habit streaks | local | v2 | [ ] |
| task.goals | Goals | local | v2 | [ ] |
| task.free | Free-slot finder | cmp:googlecalendar | v2 | [ ] |
| task.kanban | Mini kanban per project | local | v2 | [ ] |
| task.conflicts | Calendar conflict detector | cmp:googlecalendar | v2 | [ ] |
| task.risk | Deadline risk warning | local, llm | v2 | [ ] |

### 6.8 Developer

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| dev.appeal | Support case tracker (for example an account appeal): timeline of Sent, Waiting (day N), Reply; watches the linked inbox for replies; manual "mark reply received"; "draft follow-up" | local, cmp:gmail, llm | MVP | [ ] |
| dev.recovery | Recovery checklist (mirror, local clone, exports) | local | MVP | [ ] |
| dev.backup | Backup status across hosts and local clones (remotes, last push, reachable or not) | git | MVP | [ ] |
| dev.unpushed | Unpushed commits and dirty branches | git | MVP | [ ] |
| dev.prs | PRs awaiting review and my open PRs | cmp:github | MVP | [ ] |
| dev.issues | Assigned issues | cmp:github | MVP | [ ] |
| dev.ci | CI status | cmp:github | MVP | [ ] |
| dev.security | Security and dependency alerts | cmp:github | v2 | [ ] |
| dev.streak | Contribution streak | cmp:github | v2 | [ ] |
| dev.release | Release checklist | local | v2 | [ ] |
| dev.services | Local dev services status | local | v2 | [ ] |
| dev.team | Team pulse (who did what this week) | cmp:github | v2 | [ ] |

### 6.9 Student

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| stu.exams | Exam countdowns | local | v2 | [ ] |
| stu.syllabus | Syllabus progress | local | v2 | [ ] |
| stu.assignments | Assignments due | local, cmp:googleclassroom (if available) | v2 | [ ] |
| stu.timetable | Class timetable | local | v2 | [ ] |
| stu.papers | Past-paper practice tracker | local | v2 | [ ] |
| stu.planner | Study planner | local, llm | v2 | [ ] |

### 6.10 Feed

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| feed.news | News by topic | api, rss | MVP | [ ] |
| feed.rss | RSS reader | rss | MVP | [ ] |
| feed.social | Hacker News and Reddit trending | api | v2 | [ ] |
| feed.arxiv | arXiv paper alerts | api | v2 | [ ] |
| feed.releases | New model and library releases | rss, api | v2 | [ ] |
| feed.podcasts | Podcasts queue | local, rss | v2 | [ ] |
| feed.watchlater | Watch-later list | local, cmp:youtube (if available) | v2 | [ ] |
| feed.sports | Sports scores | api | Later | [ ] |
| feed.markets | Price and stock watchlist | api | Later | [ ] |
| feed.events | Events near you | api | Later | [ ] |

### 6.11 Life (all Later)

Personal data in this group is stored locally only and is off until the user turns the widget on.

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| life.bills | Bills and subscriptions | cmp:gmail, local | Later | [ ] |
| life.expenses | Expense tracker and budget | local, cmp:splitwise (optional) | Later | [ ] |
| life.health | Sleep, steps, water, workout | local (manual or connector) | Later | [ ] |
| life.meals | Meal plan | local | Later | [ ] |
| life.trips | Trips and tickets | cmp:gmail, local | Later | [ ] |
| life.packages | Package tracking | cmp:gmail | Later | [ ] |
| life.shopping | Shopping list | local | Later | [ ] |
| life.mood | Mood and energy check-in | local | Later | [ ] |
| life.screen | Screen time | local | Later | [ ] |

### 6.12 System

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| sys.model | Active model with switch (local or cloud) | dir | MVP | [ ] |
| sys.connectors | Connector health and reconnect | cmp | MVP | [ ] |
| sys.vault | Vault size and storage | lib | MVP | [ ] |
| sys.notify | Notification center | local | MVP | [ ] |
| sys.sync | Cloud sync status | local | v2 | [ ] |
| sys.phones | Paired phones | local | v2 | [ ] |
| sys.resources | CPU, RAM, GPU, tokens per second | local | v2 | [ ] |
| sys.updates | Updates available | local | v2 | [ ] |
| sys.backups | Backups | local | v2 | [ ] |
| sys.privacy | Privacy log (what left this machine, including connector calls) | dir | v2 | [ ] |
| sys.logs | Logs and errors | local | v2 | [ ] |

### 6.13 Proactive

| ID | Widget | Source | Tier | Done |
|---|---|---|---|---|
| pro.away | "While you were away" summary | dir, llm | v2 | [ ] |
| pro.nudges | Proactive nudges | llm, local | v2 | [ ] |
| pro.anomaly | Anomaly alerts (unusual charge, CI broke, reply arrived) | cmp triggers, llm | Later | [ ] |
| pro.triage | Auto-triage rules | dir | Later | [ ] |
| pro.standing | Standing instructions | local, dir | Later | [ ] |
| pro.context | Context-aware modes | local, llm | Later | [ ] |

---

## 7. Behaviour notes for key MVP widgets

**need.drafts.** Shows drafts the agent prepared (recipient, subject, first lines). Actions: Review, Edit, Approve. Approve sends nothing by itself; it creates a gate request. Nothing sends until the gate approves.

**need.inbox.** Mails that likely need a reply, ranked. Each row shows why it was ranked. If the model is off, fall back to unread plus recent, without ranking text.

**need.waiting.** Items the user sent that have had no reply for N days (default 3, configurable). Manual items allowed. "Draft nudge" creates a draft, never a send.

**need.approvals.** Pending gate requests from the Director with what, where, and why. Approve and Deny. Each decision is written to the audit log.

**dev.appeal.** Generic support-case tracker. A case has: title, submitted date, status (Sent, Waiting, Reply), and an optional watch on the linked inbox for mail from a given sender domain. Shows "day N". Never claims a reply arrived unless a matching mail was found or the user marked it.

**dev.backup.** For each configured repo: remotes, last push time, whether each remote is reachable, and whether a local clone exists. Warns when a repo has only one remote or no local clone.

**agent.brief.** Built only from data already in widgets. Every line links to the source item. If there is nothing to say, it says so. Cached; regenerated at set times, not on every load.

**agent.next.** Exactly one action with a reason and a link. Never invents a task.

**lib.resurface.** Notes related to today's tasks, events, or recent captures, chosen by semantic search. Shows the match reason.

**dash.pin.** From any chat answer, "Pin to Home" creates a sandboxed widget (section 3.6). The pinned widget stores the tool calls it needs, not credentials.

**sys.connectors.** One row per connector: connected, needs reconnect, or not set up; last successful call; reconnect via Connect Link.

**glance.weather.** Needs a location the user sets in settings. If unset, shows "set location". No guessing.

---

## 8. Non-functional requirements

- **Performance:** first paint from cache in under 1 second on a normal laptop. Widgets fetch in parallel. A slow widget shows its own loading state.
- **Offline:** with no network, Home renders every cached widget as stale and disables only the actions that need the network.
- **Resource use:** background refresh jobs are capped (concurrency and frequency). Local-model widgets run one at a time.
- **Persistence:** layout, widget settings, snoozes, and local data survive restarts.
- **Privacy and security:** connector tokens are never stored in the repo or in the widget cache. Cached payloads are limited to needed fields. "Delete connector data" removes cache rows. Pinned generative widgets cannot reach the network or other widgets' data.
- **Observability:** each refresh and action produces a log line with widget id, duration, and result; errors appear in `sys.logs` and `agent.errors`.

---

## 9. Testing

- **Unit:** manifest validation, cache state machine (loading, ok, stale, error, not-connected), snooze and overdue logic, ranking.
- **Contract:** each Composio-backed provider tested against recorded and mocked responses, including auth-expired and rate-limited cases.
- **Gate test:** any widget action marked `gate: true` fails without an approval, and no write tool is reachable another way.
- **UI:** reviewed by the owner by hand in at least two themes (one dark, one light), at desktop and phone width. The implementer does not take screenshots.
- **Accessibility:** automated check plus keyboard walk-through of Home.
- **Offline:** load Home with the network disabled and confirm every widget renders from cache.

---

## 10. Milestones (7-day sprint)

| Day | Deliverable | Widgets |
|---|---|---|
| 0 | Local clone of the repo, this spec committed, test commands working | none |
| 1 | Shell: registry, manifest schema, grid, saved layout, states, "last synced" | dash.gallery, dash.sync, dash.quiet, dash.shortcuts |
| 2 | Local-only widgets | task.*, lib.*, agent.feed, agent.running, agent.audit, agent.errors, need.approvals, need.decisions, need.overdue, need.snoozed, dev.backup, dev.unpushed, dev.recovery, sys.* (MVP) |
| 3 | Composio layer and first connectors | sys.connectors, need.inbox, need.drafts, need.waiting, comm.unread, glance.next-event, task.agenda |
| 4 | More connectors and free APIs | need.mentions, dev.prs, dev.issues, dev.ci, dev.appeal, glance.music, glance.weather, glance.sun, glance.air, feed.news, feed.rss |
| 5 | Agent features | agent.brief, agent.next, comm.tone, comm.templates, dash.palette, lib.capture, dash.pin |
| 6 | Polish | themes, motion, phone width, accessibility, tests |
| 7 | Buffer | bug fixes, docs, push, start v2 |

---

## 11. Rollout order after MVP

1. **v2, local first:** modes, planning widgets, student widgets, remaining Library and Agent widgets.
2. **v2, connectors:** Slack left-on-read, Calendar planning, GitHub extras, feeds.
3. **v2, system and proactive:** privacy log, resources, away summary, nudges.
4. **Later:** Life group, anomaly alerts, auto-triage, standing instructions, context modes, skill-shipped widgets, flashcards, graph. `need.lor-social` stays blocked until an official API exists.

---

## 12. Definition of Done

**A widget is done when:** it implements all five states, shows freshness, has a manual refresh, passes its tests, meets the accessibility rules, uses only theme tokens, and its `Done` box is ticked.

**MVP is done when:** every MVP row in section 6 is ticked, Home loads from cache offline, the gate test passes, `sys.connectors` can connect and reconnect each MVP connector, and the changelog and this spec are up to date.

---

## 13. Open questions (fill in as they are answered)

- Do Composio SDK subscriptions work for a local-only app, or do we poll everything?
- Is there a Composio toolkit for GitLab? If not, does `dev.backup` cover GitLab through local git only?
- Which toolkits exist for Discord, WhatsApp, YouTube, Google Maps, and Google Classroom?
- Which weather and news sources do we use (free, no key if possible)?
- Where is the user's location stored for weather, and is it set in first-run setup or settings?
- How often should the daily brief regenerate by default?
- Default thresholds: days before a sent item counts as "waiting", idle days for backlog.

Day 1 decisions (2026-10-24): quiet hours pause Home polling only; equal start/end means all-day quiet. Keep existing theme fonts and `/today` route. Layouts persist discrete column sizes and row heights; phone layout stacks widgets. Source writes and connector support remain outside Day 1.
