# Today Bento Dashboard Redesign Specification

**Status**: Approved design · **Date**: 2026-10-25  
**Scope**: Frontend Home Dashboard (`frontend/src/dashboard/`)  
**Design Reference**: Bento Grid Modular Architecture (Digesto, Nothing OS, Rodiyah, Tactile Neumorphism)  

---

## 1. Goal & Principles

Transform the Amethyst Home view into an award-winning, highly structured, 10/10 usability desktop instrument panel that organizes the user's day into four distinct, cohesive Bento sections.

### UX Principles & Applied Laws of UX (Selection of 30 Laws)
1. **Hick's Law**: Minimize decision time by grouping 30+ disparate widgets into 4 high-level thematic zones.
2. **Miller's Law**: Chunk data into digestible groups of 3–5 items per card, with expand drawers for long lists.
3. **Fitts's Law**: Primary interaction targets (play/pause timer, complete task, capture search, triage actions) have a minimum hit area of 44–48px with generous padding.
4. **Law of Proximity**: Group time-sensitive and execution elements (Tasks, Agenda, Timer, Progress) together in the central "Today's Focus Hub".
5. **Law of Common Region**: Clear squircle card boundaries with subtle 1px border lines and soft backdrop cards.
6. **Von Restorff Effect**: The high-priority Focus Timer and urgent triage items feature bold, distinctive accent contrast so they naturally draw the eye.
7. **Goal-Gradient & Zeigarnik Effects**: A prominent radial completion gauge celebrates finished tasks and visualizes momentum towards clearing the day's backlog.
8. **Doherty Threshold**: Immediate visual feedback (<150ms) for task completions, timer toggles, and layout changes.
9. **Aesthetic-Usability Effect**: High craftsmanship, curated typography, domain-tailored SVG textures, and harmonious theme-token colors create a calm, delightful, premium experience.

---

## 2. Structural Architecture: The 4 Bento Sections

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER                                                                                  │
│ Eyebrow: "TODAY" · Date: Day, Month Date · Greeting: "Good morning / afternoon"       │
│ ⌘K Quick-Capture Search Bar · Action Buttons: [Edit Layout] [Add Widget] [Settings]     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ SECTION 1: AT A GLANCE (4-Tile Squircle Vitals Row)                                     │
│ ┌──────────────────┬──────────────────┬──────────────────────┬────────────────────────┐ │
│ │ glance.clock     │ glance.weather   │ glance.next-event    │ glance.music           │ │
│ │ Dot-matrix mesh  │ Sky gradient     │ Date block (Mon 24)  │ Rotating vinyl record  │ │
│ │ Tabular time     │ Temp + condition │ Title + "in 35m"     │ Track + Soundwave SVG  │ │
│ └──────────────────┴──────────────────┴──────────────────────┴────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ SECTION 2: TODAY'S FOCUS HUB (Central 12-Column Bento Grid)                             │
│ ┌─────────────────────────────┬─────────────────────────────┬─────────────────────────┐ │
│ │ Daily Progress Gauge (4 col)│ Focus Timer Card (4 col)    │ Today's Agenda (4 col)  │ │
│ │ • Semicircular SVG arc (%)  │ • Bold digital time (25:00) │ • Calendar timeline     │ │
│ │ • "X of Y done" subtext     │ • Play/Pause pill button    │ • Time markers & tags   │ │
│ │ • Streak / status badge     │ • +5m & Reset controls      │ • "Join / Open" link    │ │
│ ├─────────────────────────────┴─────────────────────────────┤                         │ │
│ │ Today's Tasks: task.today (8 col)                         │                         │ │
│ │ • Custom squircle checkboxes with instant strike-through  │                         │ │
│ │ • Due time chips ("12:00 PM", "Overdue" in amber/coral)   │                         │ │
│ │ • Seamless inline-add input at top                        │                         │ │
│ └───────────────────────────────────────────────────────────┴─────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ SECTION 3: NEEDS ATTENTION (Priority Triage Bento)                                      │
│ ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Cross-source triage list (Mail, Drafts, Waiting, Mentions, Overdue)                 │ │
│ │ • Category badge chips: MAIL (indigo), DRAFT, WAITING (amber), OVERDUE (coral)      │ │
│ │ • Two-line clarity: Headline + "Why it needs you" explanation                       │ │
│ │ • Trailing quick-action button (Read, Review, Approve, Reply)                       │ │
│ │ • Inline connection prompts for disconnected sources                                │ │
│ └─────────────────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ SECTION 4: INTELLIGENCE & STREAMS (3-Column Context Grid)                               │
│ ┌───────────────────────────┬───────────────────────────┬─────────────────────────────┐ │
│ │ Agent Activity            │ Developer Workstream      │ Library Resurface           │ │
│ │ • agent.brief             │ • dev.prs                 │ • lib.resurface             │ │
│ │ • agent.feed timeline     │ • CI pass/fail status     │ • Note cover aspect cards   │ │
│ │ • Approval action pills   │ • Branch & repo chips     │ • Key tags & reading time   │ │
│ └───────────────────────────┴───────────────────────────┴─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component & Widget Design Specifications

### 3.1 At A Glance Strip
- **Container**: `home-glance` grid, 4 equal columns (wrapping gracefully to 2x2 on tablets and 1 column on mobile).
- **Cards**:
  - `glance.clock`: Monospace tabular numerals, live second indicator, subtle dot-matrix background SVG texture.
  - `glance.weather`: Dynamic atmospheric gradient matching sunrise/day/sunset, prominent temperature display, condition label, rain probability badge.
  - `glance.next-event`: Mini calendar date block with accent month header, event title, time range, and relative countdown.
  - `glance.music`: Vinyl record disc with circular groove lines, track and artist metadata, and an animated miniature audio waveform visualizer.

### 3.2 Today's Focus Hub
- **Daily Progress Gauge**:
  - Calculates real completion percentage: `completed / (completed + pending) * 100%`.
  - SVG semi-circular gauge with smooth stroke dasharray transition.
  - Central bold percentage with status label (e.g. "On track", "Almost done").
  - Soft pastel tinted card background (peach/periwinkle tint matching Digesto reference).
- **Focus Timer**:
  - Vibrant accent card (using theme primary accent / vibrant punch).
  - Prominent digital countdown (`25:00` default, 50-minute and 15-minute presets).
  - Pill action bar: Large white/contrast Play/Pause toggle (min 48px hit target), Reset, and +5m button.
  - Real browser timer backed by `localStorage` so navigation doesn't reset active focus sessions.
- **Task Checklist (`task.today`)**:
  - Elevated card with clean header and item counter.
  - Interactive squircle checkboxes with smooth checked state and strikethrough.
  - Due time badges with contextual urgency colors (green for later, amber for today, coral for overdue).
  - Inline add bar with autofocus and clean placeholder ("Add a task for today...").
- **Agenda Timeline (`task.agenda`)**:
  - Vertical timeline with hour markers.
  - Event cards with all-day pills or exact start/end times.
  - Connector state: when Google Calendar is disconnected, presents a clean "Connect Calendar" row rather than an empty broken box.

### 3.3 Needs Attention (Triage Section)
- Multi-source ranked list (`need.inbox`, `need.drafts`, `need.waiting`, `need.mentions`, `need.overdue`).
- Clear visual categorization with color-coded squircle chips.
- Direct action button per item that launches drawer or triggers review.
- Connected source status badge in header.

### 3.4 Intelligence & Streams
- 3-column modular stream:
  - **Agent Activity**: Recent turns, approvals, tool runs with relative timestamps and Approve/Deny buttons.
  - **Developer**: Pull requests awaiting review, CI statuses, and unpushed branch alerts.
  - **Library**: Resurfaced notes with note preview snippets and category tags.

---

## 4. Design System & Theme Token Rules

All styles strictly conform to Amethyst's existing design tokens (`index.css` / Kraken theme):
- Background: `--canvas` for cards, `--canvas-deep` for page body.
- Borders: `1px solid var(--hairline)` or `var(--hairline-strong)`.
- Accent: `var(--accent)` (Kraken Purple #7132f5 or current theme accent) and `var(--accent-wash)`.
- Semantic Status:
  - Waiting / Due Soon: `var(--warn)` (amber).
  - Success / Done: `var(--confirm)` (green).
  - Error / Overdue: `var(--stop)` (coral/red).
- Radii: `var(--radius-cards)` (12px–16px) for cards, pill radius for badges and toggles.
- Typography: Space Grotesk for headings/numbers, Inter for body/copy, JetBrains Mono for dates/chips/counters.
- Motion: 150–250ms transitions, disabled under `prefers-reduced-motion`.

---

## 5. File Modifications & New Modules

1. `frontend/src/dashboard/Home.jsx`:
   - Restructure layout into the 4 thematic Bento sections with semantic HTML (`<section aria-label="...">`).
   - Integrate Focus Timer and Progress Gauge calculation into the Focus Hub.
2. `frontend/src/dashboard/widgets/FocusTimer.jsx` (New):
   - Standalone Focus Timer component with presets, countdown, sound/visual alert, and local persistence.
3. `frontend/src/dashboard/widgets/ProgressGauge.jsx` (New):
   - SVG semicircular radial progress gauge reflecting live completed vs pending tasks.
4. `frontend/src/dashboard/home.css`:
   - Add Bento grid rules, squircle card styling, domain SVG textures, progress arc animations, and responsive breakpoints (desktop, tablet, mobile).
5. `frontend/src/dashboard/widgets/Items.jsx`:
   - Enhance squircle checkbox styling, due chips, and inline add input.
6. `frontend/src/dashboard/widgets/Agenda.jsx`:
   - Enhance timeline layout and event chips.
7. `frontend/src/dashboard/WidgetFrame.jsx`:
   - Refine Glance tiles with rich SVG textures (vinyl, waveform, atmospheric gradient, dot mesh).

---

## 6. Verification & Acceptance Criteria

1. **Visual Balance**: Verified at 1440px (wide desktop), 1024px (tablet), and 390px (mobile) with zero horizontal overflow or nested scrollbars.
2. **Functionality**:
   - Focus Timer starts, pauses, resets, and persists across widget interactions.
   - Tasks can be added, toggled complete, edited, and deleted.
   - Progress gauge dynamically updates when tasks are completed.
   - Glance tiles and Needs You continue to update via their existing API providers.
3. **Themes**: Tested in dark mode and light mode with full token adherence (no hard-coded unreadable colors).
4. **Automated Tests**: Existing tests in `tests/test_dashboard_*.py` and `frontend/tests/dashboard-*.mjs` stay green.
