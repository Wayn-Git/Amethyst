# Widget design standard

This applies to **every widget on the Home dashboard** (`glance.*`, `task.*`, `need.*`, `comm.*`, `dev.*`, `lib.*`, `agent.*`, `feed.*`, `sys.*`, and the card-style `dash.*` ones). There are about 80 of them and they're being redone one at a time, so the whole point of this file is consistency: widget #60 has to look like it came from the same hand as widget #1.

Read this fully before touching any widget. When this file and your instincts disagree, this file wins. When it doesn't cover something, make the smallest reasonable call, say so in your summary, and keep going. Don't invent a new pattern silently.

**Scope.** This is a UI standard only. Don't change backend behavior, API shapes, data models, or tests while doing a widget redesign. If `docs/widget-howto.md` exists, it covers wiring data and backend; this file covers how a widget looks and behaves. Don't duplicate one in the other.

Visual baseline: the Clock widget (`glance.clock`), sketch at https://claude.ai/artifact/Sg5Amn188mGtpqpbikXH7s. Clock is the *look*, not the *template*. Most widgets aren't clocks, so use the archetypes below for layout.

## The three rules

1. **Each size is its own layout, not a scaled copy.** Bigger sizes show more *content*, never the same content with more empty space.
2. **Chrome is hidden until needed.** No titles, badges, chips, timestamps, or footer links sitting on the card.
3. **Everything comes from shared primitives and tokens.** No one-off colors, sizes, radii, or hand-rolled cards.

## Build primitives once, then compose

Before redoing any widget, make sure these exist as shared components (check the codebase first; refactor existing ones instead of duplicating them). Widgets are composed from them and never write their own card styles.

- `WidgetCard`: the surface, border, radius, padding per size, whole-card link/button, hover and focus styles.
- `WidgetLabel`, `HeroValue` (with suffix and a text variant), `SecondaryLine`
- `Row` (variants below), `Hairline`
- `WidgetVisual`: a fixed-size slot for a face, ring, chart, or artwork
- `WidgetChrome`: the hover/focus-only overflow menu and refresh buttons
- `WidgetState`: loading, empty, error, not connected, unavailable
- A size hook/prop so a widget renders a different layout per size, not a CSS-scaled one

If a widget needs something the primitives can't do, extend the primitive (and note it), don't fork it.

## Tokens

Colors are **semantic tokens**, never raw hex in a widget. The app has multiple themes (System, Graphite, Ink, Nocturne, NVIDIA, Paper, Sand, Claude, Cursor, some of them light), so every theme must define every token below. The values here are the reference dark values from the approved design; map them to the closest existing dark theme and derive the others, keeping contrast rules.

```css
:root {
  /* layout */
  --w-unit: 170px;  --w-gap: 16px;  --w-radius: 24px;
  --w-pad: 16px;    --w-pad-lg: 18px;  --w-radius-inner: 8px;

  /* surfaces */
  --w-stage: #0b0b0d;               /* canvas behind widgets */
  --w-card: #1c1c1e;                /* card */
  --w-card-hover: #202022;
  --w-inset: #111113;               /* recessed surface inside a card */
  --w-skeleton: rgba(255,255,255,.06);
  --w-border: rgba(255,255,255,.07);
  --w-hairline: rgba(255,255,255,.08);

  /* text */
  --w-text: #ffffff;
  --w-text-2: #8e8e93;              /* labels, units, secondary. Must be >= 4.5:1 on --w-card in every theme */
  --w-focus: rgba(255,255,255,.6);

  /* color with meaning */
  --w-accent: #ff9f0a;              /* the one live/moving element */
  --w-positive: #30d158;
  --w-negative: #ff453a;
}
```

Card surfaces are neutral, never tinted warm or cool. Standard cards avoid unmotivated gradients, glow blobs, or decorative drop shadows.

**Surface & Border Exceptions:**
- **Borderless / Floating Elements**: When a widget design defines its own floating geometry (e.g. Dynamic Island capsule) or is full-bleed (e.g. album artwork), the outer card border and background are omitted (`border: 0; background: transparent;`) so the floating shape sits directly on the canvas without redundant double borders.
- **Full-Bleed Media Scrims**: For rich visual media widgets (e.g. Immersive Cover), the artwork fills the 24px rounded card edge-to-edge. A frosted glass scrim (`backdrop-filter: blur(...)` and smooth dark gradient overlay) across the lower section guarantees WCAG 4.5:1 text contrast and control legibility over arbitrary background images.

**Accent:** only for the single live or moving element in a widget (the clock's second hand and center dot, a running timer). Never for labels, borders, icons, links, buttons, or backgrounds. No live element means no accent.

**Positive/negative:** only on value text or a small 8px status dot, and always paired with a word, sign, or arrow so meaning never depends on color alone. Never use these together with the accent in one widget.

## Sizes and grid

| Size | Grid | Dimensions | Padding |
|---|---|---|---|
| Small | 1x1 | 170 x 170 | 16 |
| Medium | 2x1 | 356 x 170 | 16 |
| Large | 2x2 | 356 x 356 | 18 |

- Radius 24 and a 1px `--w-border` at every size. Inner elements use `--w-radius-inner` (8).
- 4px rhythm inside cards. Gaps: 4, 6, 10, 12, 16, 20.
- **Don't assume every widget has all three sizes.** Each widget declares its supported sizes in the registry (below). Offer only those in the Add widget drawer. If a widget can't honestly fill Small (a kanban board, say), start at Medium. Don't pad a size to make it exist.
- Never scroll inside a card. If content doesn't fit, show fewer items and let the detail view hold the rest.

## Typography

One family: **Inter** (fallback `-apple-system, sans-serif`). No mono, no display face, no italics, no ALL CAPS micro-labels.

| Role | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Hero number | 54 small / 46 medium / 42 large | 600 | text | tracking -0.04em, line-height 1, tabular-nums |
| Hero text (when the hero is words, not a number) | 28 small / 26 medium / 26 large | 600 | text | tracking -0.02em, max 2 lines, then ellipsis |
| Hero suffix/unit | 15 small / 14 medium+large | 600 | text-2 | ~28% of the number, baseline-aligned, 3px gap |
| Card label | 13 | 600 | text-2 | one or two words, top-left |
| Secondary line | 13 | 400 | text-2 | 6px below the hero |
| Row title | 15 | 600 | text | one line, ellipsis |
| Row sub-label | 12 | 400 | text-2 | one line, ellipsis |
| Row value | 22 | 500 | text | tracking -0.02em, tabular-nums |
| Row value unit | 12 | 600 | text-2 | |
| Row action (text button) | 13 | 600 | text | min 32px tall hit area |

Number and text rules:
- All numbers tabular. No leading zeros ("3:05"). Large counts shorten ("1.2k").
- Row titles never wrap. Hero text wraps to 2 lines max.
- Sentence case. No trailing punctuation on labels.
- Times inside 24 hours are relative ("in 25 min", "2h ago"); farther out use "Sat 31 Oct". Respect user locale for 12h/24h, units, and date order.

## Archetypes

Pick the archetype first, then fill in the three sizes. Same archetype means same structure everywhere, which is what makes 80 widgets feel like one set. If something fits two, choose by what the user glances at first.

**Row variants** (used by every archetype):
- *Plain:* title + sub-label left, value (+unit) right.
- *Leading:* a 20-28px leading element (checkbox, status dot, 28px round avatar, small icon) + 12px gap + title/sub-label, optional trailing value or one text action. One action per row at most.

| Archetype | Typical fits (confirm in registry) | Small | Medium | Large |
|---|---|---|---|---|
| **Value** | glance.clock, weather, sun, air, travel, next-event, agent.next | Label + hero | Split: hero left, hairline, up to 3 plain rows right | Visual + hero beside it, hairline, up to 3 rows |
| **List** | task.today/backlog/deadlines/reminders/agenda/plan/conflicts/risk, need.overdue/snoozed/inbox/drafts/waiting/mentions, comm.unread/newsletters/contacts/reachout/templates/thread-summary, dev.prs/issues/unpushed, agent.feed/audit/jobs/delegated/research/watchers/rules, feed.news/rss, lib.readlater/highlights/collections | Label + hero count + the single top item as the secondary line | Stacked: label top-left and count top-right, then full-width leading rows (2 rows if they have sub-labels, 3 if title-only) | Label + hero count, hairline, up to 4 rows with sub-labels or 6 title-only, hairlines between |
| **Action list** | need.approvals, need.decisions | Label + count + "Review" as the whole card's action | Stacked, 2 rows, each with one text action | Up to 4 rows, one text action each |
| **Status** | dev.ci/backup/recovery/appeal, agent.running/errors, sys.vault/notify/model/connectors, comm.tone | Label + hero text (the status word) + 8px dot inline | Hero text left, hairline, up to 3 plain rows of detail right | Hero text on top, hairline, up to 4 detail rows |
| **Trend** | agent.usage | Hero number + a 28px-tall sparkline across the bottom | Hero left, chart right (about 170 x 100) | Chart on top (about 320 x 140), hairline, up to 3 rows |
| **Progress** | task.goals, task.habits, task.focus | Ring (6px stroke) with the hero inside it, label above | Ring left, up to 3 plain rows right | Ring + hero on top, hairline, up to 4 rows |
| **Media** | glance.music, lib.daily | 44px squircle art top-left, title + subtitle bottom-left (or compact floating pill / full-bleed cover) | Artwork square (138px) left, text right (or horizontal pill, spinning vinyl disc, Swiss editorial split, or frosted glass strip) | Full artwork on top, text below, then controls (or centered full-bleed showcase with 5 transport controls) |
| **Launcher** | lib.ask, dash.palette | Icon top-left, label + one short prompt line bottom-left | Same plus 2 recent items as plain rows | Same plus up to 4 recent items |
| **Board** | task.kanban (Medium and up) | Not offered | 3 columns as counts only, tap opens the board | Column headers plus up to 3 items per column |
| **Frame** | dash.pin | Pinned snapshot inside the standard card shell, no extra chrome | | |

Chart and visual rules: 1.5px strokes, no fills or gradients, no gridlines, no axis labels except min/max in 12px text-2. Rings have a `--w-hairline` track and a `--w-text` arc (accent only if it's a live timer). Media artwork must be real content; if there's none, show a flat `--w-inset` block with a stroke icon, never stock imagery.

### Media Archetype Variations (`glance.music`)

Media widgets can declare curated design variations to suit different playback contexts and visual preferences:
1. `media-*-01` (**Evermusic**): Native Apple Music style with squircle artwork, Heart favorite toggle, and adaptive 3-button (Small) or 5-button (Medium/Large) transport.
2. `media-*-02` (**Dynamic Island**): Floating dark capsule pill (`--w-inset`) with inverted circular play button, live progress scrubber bar, and a borderless outer container. In Small, it centers a sleek compact pill with zero overflow.
3. `media-*-03` (**Vinyl Groove**): Turntable disc with concentric groove rings, rotating center label with silver spindle dot, and `"33 ⅓ RPM"` chip (respects `prefers-reduced-motion`).
4. `media-*-04` (**Editorial**): Swiss typographic editorial layout, uppercase micro-label `"NOW PLAYING"`, bold display headline title, square artwork, hairline dividers, and structured metadata ledger.
5. `media-*-05` (**Immersive Cover**): Edge-to-edge full-bleed album artwork, frosted glass gradient overlay, bookmark and heart header buttons, centered bold typography with subtle text drop shadow, and floating transport controls.

**Widgets with no input fields in the card.** Mail, drafts, templates, and composer-like widgets show *rows*, never form fields. Anything that needs typing opens the detail view. A row may have one inline text action; side-effecting actions (approve, send, delete) go through the existing permission gate or the detail view, not a new confirmation UX. Sending stays disabled wherever the backend says it is.

## Chrome and controls

No always-visible "Widget name" title, live/now/local badge, timezone chip, last-updated stamp, or footer link.

- **The whole card is the target.** A real `<a>` (navigation) or `<button>` (action), never a div with `onClick`. It opens the widget's detail view.
- **Overflow menu and refresh** are icon buttons absolutely positioned top-right, outside layout flow. Hidden until the card is hovered or focus is inside it (opacity, 150ms ease). On touch / `hover: none` devices they aren't drawn; the same actions come from long-press or the context menu. Don't ship refresh on a widget with nothing to refresh.
- Icons: stroke style, 16px, 1.5px stroke, `currentColor` in `--w-text-2`, hit area at least 32 x 32, always with an `aria-label`.
- Card hover: background moves to `--w-card-hover`, 150ms. No scale, lift, shadow, or glow.
- Focus: `:focus-visible` shows a 2px `--w-focus` ring with 2px offset. Never remove an outline without replacing it.

## States (every widget, every supported size)

Same visual language everywhere. Keep the label in all of them.

- **Loading:** flat `--w-skeleton` blocks where the hero and rows go. No shimmer. A slow opacity pulse is fine (off under reduced motion).
- **Empty:** a quiet one-line message in the hero slot that says what to do ("Add a city", "Nothing due today"). Card still opens the detail view.
- **Error:** hero slot shows "—", secondary line says what happened in plain words, plus a "Retry" text action. No red, no warning icons, no stack traces. Models and live services do fail, so this state is not optional.
- **Not connected:** the connector this widget needs isn't linked. Hero slot shows a text action naming it ("Connect Gmail") that goes to the existing setup flow.
- **Unavailable:** the connector exists but isn't enabled yet. Plain "Not available yet", no action.
- **Stale:** don't print "updated 3m ago" on the card. If data is old enough to mislead, show the Error state.

## Data, copy, and behavior

- Use the widget's existing data hooks and API. Don't invent fields. Mock data is for previews and tests only and never ships.
- Everything displayed is computed from real data (timezones, locale, user settings). No hardcoded display strings in a finished widget.
- Live values tick on their natural boundary (clock digits on the minute, not an arbitrary interval). Clean up timers on unmount.
- **Copy:** repo-accurate and concrete. No invented claims, features, or numbers, and no buzzwords (no "ambient", "neural", "fabric", "supercharge", and the like). Plain nouns and verbs, sentence case.
- Transitions: 150ms ease, opacity or color only. No bounce or spring. Respect `prefers-reduced-motion` (no sweeping animation, step discrete changes).
- Pinned/sandboxed content (`dash.pin`) stays an offline snapshot: no scripts, no live data.

## Accessibility

- Card `aria-label` is a one-line summary that updates with the data ("Clock, Kolkata, 3:05 PM, world clocks").
- Decorative graphics are `aria-hidden="true"`; meaningful ones get `role="img"` with a current-state label.
- Text 4.5:1 minimum in every theme. Never rely on color alone.
- Fully usable by keyboard: Tab to the card, Enter to open, Tab to reach the hidden controls (they appear on focus).

## Don'ts

- No gradients, glow blobs, glassmorphism, shadows, decorative imagery, emoji.
- No warm- or cool-tinted card surfaces.
- No extra fonts, no mono, no ALL CAPS micro-labels.
- No pills, chips, or badges on the card face. No colored borders or colored row backgrounds.
- No form fields inside cards.
- No same layout stretched to a bigger size, no leftover empty halves.
- No new colors, sizes, or radii outside the tokens, and no per-widget card styles.
- Don't add features, widgets, or sizes that weren't asked for. Don't touch widgets outside your batch.

## How to work through the 80

**Registry.** Keep one table at `docs/widget-registry.md` (create it if missing) with a row per widget: `id | archetype | supported sizes | hero | status (todo / redone / needs-review) | notes and deviations`. The starter archetype map above is a guess; confirm or correct it per widget as you reach it, and record the change.

**Order.**
1. Shared primitives and tokens, plus themes defining every token.
2. Redo `glance.clock` on them. It must match the sketch.
3. One pilot widget per archetype. Bilal reviews these before the rest.
4. Roll out the remaining widgets in batches by namespace, one commit per widget.

**For each widget, before coding**, write this in your working notes or PR description:

```
id:
archetype:
hero (what's glanceable):
supported sizes:
small shows:
medium shows:
large shows:
data/connector it needs and the states that follow (loading, empty, error, not connected, unavailable):
inline action, if any:
detail view it opens:
```

**Definition of done** (all must be true before you mark it redone):
- [ ] Built only from the shared primitives and tokens; no hardcoded colors, sizes, or radii
- [ ] Supported sizes are exactly 170x170, 356x170, 356x356, each with its own layout from its archetype
- [ ] Small shows one thing; Medium and Large add real content, not padding
- [ ] No title, badge, chip, timestamp, or footer link on the card face
- [ ] Whole card is a real link/button with a visible focus ring; hover-only controls are hidden by default and absent on touch
- [ ] Loading, empty, error, and (where relevant) not-connected/unavailable states exist at every supported size
- [ ] Checked in at least one dark theme and one light theme (for example Graphite and Paper): contrast holds, nothing hardcoded leaks
- [ ] No input fields in the card; long text truncates; nothing scrolls inside it
- [ ] Accent used only on a live element, or not at all
- [ ] Side-by-side next to Clock and the pilot for its archetype, it reads as a sibling
- [ ] Reduced motion respected; `aria-label` present and current
- [ ] Lint, build, and the existing tests still pass; no backend changes
- [ ] Summary includes before/after screenshots of every supported size and the non-default states, plus any deviation from this file and why

**Deviations.** If a widget truly needs to break a rule, do it in the smallest way, log it in the registry notes, and call it out in your summary. If the same deviation comes up for three or more widgets, stop and propose an amendment to this file instead of repeating it. Only Bilal changes this file.

## Appendix: Clock, the visual baseline

Archetype: Value (the split-and-visual variant).

- **Small:** "Kolkata" label top-left. Time ("3:05") + PM bottom-left. Nothing else.
- **Medium:** Left: label, time + PM, date ("Sat 31 Oct"). Hairline. Right: London / New York / Tokyo as plain rows with "Today, -5:30" sub-labels and times.
- **Large:** Analog face (124px) beside label + time + date. Hairline, then the same three rows with hairlines between.
- Analog face: 100-unit viewBox, circle r=48 filled `--w-inset` with a 10% white stroke, 12 ticks in `--w-text-2` (major ticks at 12/3/6/9 thicker and longer), hour hand 3.4 wide / 24 long, minute hand 2.4 wide / 36 long, second hand 1 wide in `--w-accent` with a short tail and an accent center dot. No numerals.
- Cities come from the user's saved world clocks (default London, New York, Tokyo); times and "Today/Yesterday/Tomorrow, +/-H:MM" offsets are computed from IANA zones so DST is handled.