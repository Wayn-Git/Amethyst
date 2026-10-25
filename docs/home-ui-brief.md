# Home UI Brief

Put this at `docs/home-ui-brief.md`. It is the visual spec for Home. `docs/dashboard-spec.md` stays the source of truth for features. Change shared components first so every widget inherits the result.

## 1. What is wrong with the current Home

1. The system widgets (Refresh status, Quiet hours, Keyboard shortcuts, Widget gallery) fill the main area. They are settings, not content.
2. Only Clock is on by default, so a fresh Home looks nearly empty.
3. Every card is the same size and weight. Nothing says what matters now.
4. Every card repeats a refresh button and a "local · Last synced" footer. It is noise.
5. Cards scroll inside themselves (Backlog, Shortcuts, Gallery).
6. "Add widgets" is a wall of about 45 buttons.
7. "Edit in connected source." repeats on every row.
8. Flat black surfaces and no accent color.

## 2. Layout

- Keep the existing app navigation. Do not add a second one.
- Home, top to bottom:
  1. **Header:** date in mono, greeting, a capture field (opens the ⌘K palette), and buttons: Edit layout, Add widget, Home settings.
  2. **Glance strip:** four compact tiles in a row: time, weather, next event, now playing. Tiles show a big value and a muted label. No inputs inside tiles.
  3. **Two columns:**
     - Main (about 60%): Needs you, Agent activity.
     - Side (about 40%): Today, Dev, Library, Feed.
- At 900 px wide or less: one column, tiles wrap two per row.
- **Home settings drawer** holds Refresh status, Quiet hours, Keyboard shortcuts, and the widget gallery. These are not on Home by default. They are also reachable from ⌘K.
- **Add widget** opens a drawer: search field, widgets grouped by category (Glance, Needs you, Communication, Agent, Library, Tasks, Developer, Feed, System), one row per widget with a one-line description and an Add button. Widgets already on Home show "Added".
- **Edit layout:** drag handles and resize controls appear only in this mode.

## 3. Default layout (ship this, not an empty Home)

Morning layout, on by default:
- Glance strip: glance.clock, glance.weather, glance.next-event, glance.music
- Main: Needs you (need.inbox, need.drafts, need.waiting, need.mentions, need.overdue merged into one ranked list), agent.brief, agent.feed
- Side: task.today, dev.prs, lib.resurface, feed.news

A widget whose connector is not connected shows one compact row ("Connect Gmail") inside its slot, not a large empty card. The user can dismiss it.

## 4. Card anatomy

- **Header:** title in Space Grotesk 14 px / 600; optional count chip in mono; on the right a "..." menu (Refresh, Size, Settings, Remove). The refresh control shows on hover and keyboard focus only.
- **Freshness:** small mono text in the header ("2m"). Full "last synced" goes in a tooltip and aria-label. A stale or error state shows a chip.
- **Body:** rows. No scrolling inside a card. Show up to 5 rows, then "Show all (n)" which opens a drawer.
- **Footer:** none by default.
- **Row:** primary line (500 weight), secondary line (muted), at most one trailing action, optional status chip (mono 11 px, uppercase). Minimum height 44 px. 1 px subtle dividers.
- **Source note** ("connected source", "local") appears once in the header as a small chip, never per row.
- **States:**
  - loading: skeleton rows, not spinners
  - empty: one line and one action
  - not connected: compact "Connect X" row
  - error: message and Retry
  - stale: chip
- **Sizes:** S (tile), M, L.

## 5. Visual tokens

Use the theme tokens. Add tokens if something is missing; do not hard-code colors.
- app background: near-black navy; card: one step lighter; border: subtle
- accent: lavender/violet for primary actions, focus rings, and active items
- status: amber (waiting), green (done or ok), red (error). Always paired with a text label, never color alone.
- radius: 12 px cards, 8 px buttons. No shadows; use borders.
- fonts: Space Grotesk (headings, big numbers), Inter (body), JetBrains Mono (timestamps, counts, shortcuts, chips)
- motion: 150 to 250 ms, none on data refresh that moves layout, respect `prefers-reduced-motion`
- Do not use: gradients, glow, glassmorphism, blobs, decorative rings, emoji icons.
- Style references: Linear, Raycast, macOS.

## 6. Per-widget patterns

- **Needs you:** one ranked list across sources. Each row: kind chip (MAIL, WAITING, MENTION, OVERDUE), title, a "why" line, one action.
- **Glance tiles:** big value, muted label. Settings such as the world-clock timezone move into the widget's settings menu.
- **Editable lists (tasks, backlog):** inline add field at the top; edit and delete on hover and focus; connected-source items are read-only and carry the source chip.
- **Agent activity:** timeline rows with relative time and a status chip. Approvals have Approve and Deny.
- **Dev:** repo name in mono, status chips for CI and review state.
- **Feed:** headline, then "source · age".

## 7. Acceptance

- With no connectors, a fresh Home looks intentional: header, glance strip (weather shows "set location"), Needs you with compact "Connect" rows, task.today, lib.resurface, agent.feed.
- No nested scrollbars at 1440 px and 390 px wide.
- Every system widget is reachable from Home settings and ⌘K.
- Works in every theme.
- Existing tests stay green; update only the tests the redesign breaks.