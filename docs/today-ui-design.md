# Today presentation

The `/today` route mounts `dashboard/Home.jsx`. Existing providers, saved layouts, independent widget states and reviewed writes remain authoritative. The attached references guide presentation, not product data or new integrations.

[design-pipeline]
0. laws-of-ux → Common Region: one rounded surface per source, 16px gutters; Proximity: 8px within related controls, 24px card insets; Similarity: consistent headers, pill controls and focus outlines; Pareto: time, forecast and next event get distinct glanceable faces; Fitts: 44px action targets; Doherty: 150–200ms feedback, zero decorative motion under reduced motion.

Direction: quiet neutral canvas, white and charcoal cards, soft depth, restrained typography, a blue weather surface and calendar-red date details. Use theme tokens exclusively. Preserve real values, source freshness and explicit unavailable states. No screenshots. The user's reference-led design request supersedes the older no-gradient restriction for the weather card only.

- [x] dash.gallery: shared card hierarchy, responsive spacing and accessible controls.
- [x] glance.weather: real hourly temperature/rain strip and atmospheric blue surface.
- [x] glance.clock: analog dial with accessible digital time and timezone.
- [x] glance.next-event: calendar date hierarchy with real countdown.
- [x] glance.music: album metadata, music symbol and familiar transport controls.

Verification: 23 adopted widget fixtures cover source states, real values and reviewed actions across nine themes. Production desktop checks cover 1440/1024/768/390px, location changes, fit/undo, 44px shell controls and reduced motion. Playback review tests, focused JSX lint and production build pass. Screenshots and live connector/OS checks omitted; existing bundle-size/import warnings remain.

## Usability corrections · 2026-10-27

[design-pipeline]
0. laws-of-ux → Common Region: bounded card previews and separate editing sheets; Proximity: 24px card insets and 8px control gaps; Similarity: one connection state shared by Home and Integrations; Hick: choose a widget before size/options; Fitts: 44px controls; Doherty: preserve content during refresh and cancel superseded layout animations. Typography changes are deferred at the owner's request.

- [x] glance.music: artwork and explicit player selection with unchanged approval gates.
- [x] sys.connectors / dash.sync: shared account truth, refresh on return, actionable disconnected states.
- [ ] dash.gallery / glance.clock: stable card bounds, gallery selection, settings and padding.
- [x] need.drafts / need.waiting: composers and reviews in sheets instead of expanding cards.
