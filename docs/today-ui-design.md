# Today presentation

The `/today` route mounts `dashboard/Home.jsx`. Existing providers, saved layouts, independent widget states and reviewed writes remain authoritative. The attached references guide presentation, not product data or new integrations.

[design-pipeline]
0. laws-of-ux → Common Region: one rounded surface per source, 16px gutters; Proximity: 8px within related controls, 24px card insets; Similarity: consistent headers, pill controls and focus outlines; Pareto: time, forecast and next event get distinct glanceable faces; Fitts: 44px action targets; Doherty: 150–200ms feedback, zero decorative motion under reduced motion.

Direction: quiet neutral canvas, white and charcoal cards, soft depth, restrained typography, a blue weather surface and calendar-red date details. Use theme tokens exclusively. Preserve real values, source freshness and explicit unavailable states. No screenshots. The user's reference-led design request supersedes the older no-gradient restriction for the weather card only.

- [x] dash.gallery: shared card hierarchy, responsive spacing and accessible controls.
- [x] glance.weather: real hourly temperature/rain strip and atmospheric blue surface.
- [x] glance.clock: analog dial with accessible digital time and timezone.
- [x] glance.clock review (2026-10-28): rounded square dial, live midnight rollover, saved world clocks and dates on Today, immediate settings updates, duplicate/invalid timezone validation, recoverable save failures and 44px settings controls. Browser checks cover nine themes, three widths and all three manifest sizes; screenshot fidelity remains for owner review.
- [x] glance.next-event: calendar date hierarchy with real countdown.
- [x] glance.music: album metadata, music symbol and familiar transport controls.

Verification: 23 adopted widget fixtures cover source states, real values and reviewed actions across nine themes. Production desktop checks cover 1440/1024/768/390px, location changes, fit/undo, 44px shell controls and reduced motion. Playback review tests, focused JSX lint and production build pass. Screenshots and live connector/OS checks omitted; existing bundle-size/import warnings remain.

## Usability corrections · 2026-10-27

[design-pipeline]
0. laws-of-ux → Common Region: bounded card previews and separate editing sheets; Proximity: 24px card insets and 8px control gaps; Similarity: one connection state shared by Home and Integrations; Hick: choose a widget before size/options; Fitts: 44px controls; Doherty: preserve content during refresh and cancel superseded layout animations. Typography changes are deferred at the owner's request.

- [x] glance.music: artwork and explicit player selection with unchanged approval gates.
- [x] sys.connectors / dash.sync: shared account truth, refresh on return, actionable disconnected states.
- [x] dash.gallery / glance.clock: stable card bounds, gallery selection, settings and padding.
- [x] need.drafts / need.waiting: composers and reviews in sheets instead of expanding cards.

Usability verification: 43 connector/fast-lane backend tests pass. Needs and Glance browser fixtures cover retained draft text, approval/rejection, source states, content containment, nine themes and reduced motion. Production preview covers connection transitions, gallery selection/add/remove, drag/drop/undo and card bounds at 1440/1024/768/390px. Frontend rebuilt; existing raw-control lint and bundle/import warnings remain. Desktop backend was unavailable on port 8000; live OAuth and OS playback were not checked.

## Complete component review · 2026-10-28

- [x] All 80 registered Today widgets and shared shell/settings components reviewed. Per-component findings and verification: [Today component review](today-component-review.md). Theme tokens retained; responsive containers, source labels, overdue contrast, input retention, source navigation and shared settings corrected. Exact screenshot fidelity remains for manual owner review.
