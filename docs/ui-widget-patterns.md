# Home widget patterns

Pilot on `ui-redesign`: `glance.clock`, `need.inbox`, `task.today`, `agent.feed`.
The three supplied references are collages of compact instruments and cards.
Borrow their strong value hierarchy, rounded silhouettes and restrained metadata;
retain Amethyst's existing palette, fonts, controls and real data. No additional
pattern or widget is implied by a decorative chart or image in a collage.

## Shared frame and states

Use `WidgetCard`, `CardHeader`/`WidgetHeader`, `WidgetRow`, `Tile`, `WidgetChip`,
`Skeleton` and `StateView` from `frontend/src/dashboard/primitives.jsx`.
`WidgetState` owns loading, empty, error and disconnected messages;
`ConnectionRow` in `WidgetFrame.jsx` owns the connect link and dismiss action.
There are no separate EmptyState or ErrorState components to duplicate.
The widget styles live in `frontend/src/dashboard/widget-patterns.css`, after
the legacy widget and shell CSS. It overrides legacy form sizing where that
would otherwise shrink the shared controls; control implementations and tokens
are unchanged.

Cards use the panel fill, a transparent border, 12 px panel radius, 16 px padding
and 12 px header/body gap. No gradients, decorative shadows or hover translation.
The clock tile uses the text token as its contrasting surface and the panel token
for its foreground, so the contrast follows each palette without fixed colors.
Header anatomy: unboxed 20 px icon, 14/20 display heading, optional count,
freshness, refresh and menu. Omit the redundant source chip visually except in
the combined Needs you region; keep source explanations and connected-source
editing restrictions in their existing content. Body text is 13/20; descriptions
12/18; short dates and freshness 11/16 mono. Never infer a status from a title.
Chips use raised fill, border, 8 px radius and 11/16 text in sentence case.
Only an existing warning/error condition gets confirm/stop color.

At less than 320 px container width hide source and direct refresh; Refresh
remains in the existing menu. Keep freshness and the menu reachable. List
previews still use the existing five-row cap and Show all drawer. Content never
creates a scrolling region. Long titles wrap or clamp visually; DOM text and
accessible names retain the full value. Forms, open explanations and unusually
long metadata may grow the card instead of clipping controls or hiding data.

Reserve body minima across loading, empty, error and normal rendering:
Glance tiles share a 192 px total height; inbox 464 px body; Today 360 px body; timeline 300 px
body. These are five-row preview bounds, not fixed-height content clips. Other
widgets receive shared primitive styling but need their own height calibration
when adopted. Skeletons use three static raised bars; no pulsing decoration.
Stale content stays visible with its stale chip and last-sync description.
Empty editable widgets retain their add form. Error messages retain alert
semantics and the existing retry action. Disconnected widgets retain Connect
and Dismiss. Do not fabricate sample content or connection success.

## Instrument tile — glance.clock

Use `ClockFace` for both the Home tile and the clock settings content. Stack a
short local date, the time, and a quiet timezone label, with 8 px gaps. Time is
Space Grotesk with tabular numerals, scaling from 28 to 48 px with the actual
slot width. Keep the localized day period separately at 12/18 so AM/PM does not
compete with the digits. The date and timezone are 11/16 mono; the timezone sits
in a quiet inset on the contrasting tile. The time is the dominant mark, without
a background illustration or synthetic clock face. The tile header omits the
icon badge and uses a quiet 11/16 title. Below 240 px hide the secondary timezone
text. Keep the date and real time legible.

The tile retains refresh/menu access and its stable height. The full view
retains world timezone rows, Remove and the timezone add form. Validation,
four-zone limit and settings requests retain existing behavior. No extra
seconds display, countdown, progress bar or invented location is introduced.

## Read-only list — need.inbox

Rows use the full width, without horizontal dividers, and 8 px block padding. Each row has a sender/date metadata line (sender left, supplied date
right), a 13/20 subject, an optional snippet, and the supplied ranking reason.
Clamp the subject to one line; never parse or rewrite the provider's date.
Above 360 px container width show the snippet and ranking reason together in
one context row, with the reason retaining readable width. At narrower widths
omit the snippet and allow sender/date to stack. Ranking reasons remain visible
at every width, using ordinary text rather than a colored tile or accent rule.

Keep the model-ranking control above the list, using the shared small ghost button.
Fallback copy remains visible when ranking is off or unavailable. Generating
and failed setting changes keep their status/alert semantics. Move the existing
source/privacy explanation into an expandable “About this inbox” after the
list. There are no new row actions, avatars, badges or unread counts. The
combined Needs you region still opens this widget through the existing drawer.

## Editable list — task.today

Keep the inline Add item form first, in a raised 8 px rounded inset with a
36 px input and shared small submit button. Each row has a 28 px completion
action with a circular outline, a wrapping task title with optional due metadata
underneath, and an Actions disclosure at the trailing edge. Use 12 px gaps and
8 px row padding, without horizontal table dividers. A
completed title is struck through; its completion mark uses accent/on-accent.
Due metadata uses the actual due condition and confirm/stop text without an
extra badge fill or border.
Do not invent categories, progress percentages or counts beyond the provider.

Actions opens a bordered opaque menu of the existing Edit, Complete and Delete
buttons. It remains the same disclosure at narrow widths, without crowding the
row with extra buttons. Source-managed rows show “Edit in connected source.”
and have no local completion/edit/delete controls. The note may wrap at narrow
widths. Add, edit, complete and delete retain the existing review draft and
Approve/Reject flow; no click applies a source change directly. The edit form
and draft review can expand the card. Shared Items consumers keep those same
handlers and adopt the existing shared Input/Button controls.

## Timeline — agent.feed

Use the provider's order and existing title/detail fields. A 24 px leading lane
contains a small point and a 1 px vertical connector; omit the connector after
the last item. Only the first point uses accent, indicating list position rather
than fabricated success or live status. Rows have no horizontal dividers.

A two-line 13/20 title leads, with the provider's tool/model-call detail at
12/18 underneath. Never synthesize timestamps, event categories, success icons
or elapsed durations. Five preview rows, then the existing Show all drawer.
The feed has no new row actions. Empty/loading/error/disconnected/stale states
use the shared frame exactly as other read-only lists.

## Pilot validation

Existing primitive and inbox browser tests pass without test changes. Isolated
synthetic-fixture browser checks cover task review approval/rejection,
source-managed restrictions, all five states, equal loading/populated heights,
and no card overflow in graphite and paper at 1440, 768 and 360 px. The first pass used two 1440 px reference captures (graphite and paper). No
additional screenshots were taken for this revision. Full Home fixture checks
now also exercise the actual glance strip at 1440, 1024, 768 and 360 px, plus
isolated clock slots at 148, 180, 220 and 280 px; these establish layout and
behavior, not a visual-fidelity verdict.
No live accounts, backend changes, contract changes or new dependencies.
