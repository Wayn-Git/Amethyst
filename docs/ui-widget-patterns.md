# Widget patterns — session 4

Use the session 1 foundation and session 2 Home grid. Paper is the baseline; all other palettes inherit the same light, dark and accent tone tokens. No backend, permission or payload changes are introduced by these patterns. Pilot selectors live in `frontend/src/dashboard/widget-pilots.css`; widgets keep their existing providers and actions.

## Shared anatomy and states

Each tile has one title, a 40 px circular house icon badge, quiet mono freshness and hover/focus chrome. Primary actions are violet. Small status chips use current tone foreground and a faint solid fill. Space Grotesk owns titles and values, Inter owns body text, JetBrains Mono owns labels. Use 24 px corners and 16 px grid gutters; light tiles alone cast shadows. Retain the DOM reading order and the existing Show all drawer after five preview records.

Loading reserves the same content footprint as the normal preview: 128 px for glance heroes, 480 px for Today, 360 px for Focus, 400 px for other list pilots. Skeletons are static. Long real content and expanded forms may grow; do not clip content to keep these minimums. These reservations prevent shifts for ordinary bounded previews, not arbitrarily long provider text. Empty states use explicit source copy; editable empty states retain their controls. Error states retain Retry. Stale remains a small freshness label. Disconnected sources use Connect rather than a blank chart. Do not replace unknown numbers with zero.

Rings animate their numeric stroke over 250 ms. Hero value changes enter over 200 ms with opacity and a two-pixel translation; tabular figures keep digit widths stable. Checkbox presses scale briefly; checked state changes only after the approved data refresh. Ranking switches retain their controlled server-backed value. All these motions are removed for reduced motion. No decorative bars or graphs: bars in later adoptions must use actual numeric values and the same motion tokens.

## Hero stat — glance.clock, glance.weather

Compact S tile. Clock uses the dark tone, weather uses accent. The shell badge identifies the widget; do not duplicate a large illustration inside it. Clock stacks small local date, large time with quiet day period, then local timezone. Weather has a large temperature with small °C unit and a muted timezone label; rain alerts are chips based on the existing flag. No weather-code inference or invented conditions. Unavailable temperature is text without a unit.

The clock settings view retains saved world clocks and its timezone form. Weather settings retains explicit coordinates, hourly observations, rain probabilities and attribution links; a sparkline appears only when the supplied hourly temperatures are all finite numbers. Neither hero uses a fabricated gauge.

## Ranked list — need.inbox

Light M tile, five preview rows. Each row has a circular sender-initials badge, sender, small Mail/Unread kind chip, mono date, one-line subject and supplied ranking reason. Preserve provider order; the UI never calculates importance. Unknown sender is explicitly named. The single widget action is the Rank with model switch; busy disables it. Model-off/unavailable copy explains unread/recent fallback. Source/privacy details appear once in the footer disclosure. No fabricated reply action or external message URL.

## Checklist — task.today

Light M/L tile. A compact ring and label sit above inline title input and Add item. Rows pair an accessible round checkbox with title and a small due chip; secondary edit/delete actions remain in their disclosure. Connected rows have no local checkbox and source ownership is stated by the shell, not repeated visibly in every row.

Inline add creates a draft directly. Checkbox, edit and delete still open the existing approval review; rejection cannot change the source. Completion does not imply support for un-completing a task. The ring uses the complete supplied list, not the five-row preview. **Contract limit:** the current provider returns open tasks only, so this is labelled “completed in current list”, normally zero; it is not daily completion history. Do not invent a daily completion percentage. Zero tasks displays text without a ring.

## Ring timer — task.focus

Light M tile. A 200 px ring surrounds a stable-width MM:SS reading. The existing saved start timestamp and duration determine remaining seconds; clamp between zero and duration. A small Ready/Focusing/Break chip sits below. Start focus is primary; Start break and Stop timer are secondary. Settings and session history live in disclosures. Start, stop and configure preserve the LocalReview approval gate and server conflict checks. Invalid duration displays Unavailable without geometry.

**Blocked requirement:** pause/resume is absent from the existing focus actions and storage. The tile explicitly says pause is unavailable. A browser-only pause would misrepresent the running persisted timer and its notification, so this UI-only session does not implement one. Completing pause requires a separately authorized backend/data-contract change.

## Timeline — agent.feed

Dark M tile. Five events form one vertical rail: muted circular nodes, first node accented, hairline connectors ending before the final item. Each event has its existing title and a small mono detail line. Keep actual provider order. The provider supplies call counts, not event timestamps or status; do not manufacture either, parse timestamps out of prose or imply a live-running state. No per-event action is added. Empty/error/freshness use the shell states.

## Split counts — task.deadlines

Light M tile. Two equal cells separated by a subtle rule show Overdue and Today · upcoming as large numerals. Counts use the full payload. Overdue means due at or before now; Today means still upcoming on the user's local calendar date, so the columns never double-count. Later deadlines remain in the existing list underneath, with countdowns and existing review actions. No deadlines means two real zero counts. Count summaries do not truncate the underlying data or replace the Show all drawer.

## Compact connection — dev.prs

Light S tile until connected. The shared ConnectTile displays Connect GitHub and one violet Connect action opening the existing connection panel. No synthetic PR count, runtime “nothing to show” copy or decorative chart. Connected PR rows keep the existing repository links, source/status chips and data contract. Source errors remain errors, not connection requests.

## Adoption boundary and verification

These eight IDs are the pilot set; other widgets await review. Reuse the pattern that fits actual data and actions, not a new per-widget abstraction. Weather air/sun/travel redesigns and other session work remain out of scope. Browser proof: `frontend/tests/dashboard-pilots.mjs` covers synthetic numeric payloads, gated actions, switch, Connect, all nine theme modes at 1440/390, loading footprint and reduced motion. `home-revamp.mjs` covers the integrated Home grid. No screenshots are required. Hardware frame timing is not established.
