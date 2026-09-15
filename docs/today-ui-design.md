# Today presentation

The `/today` route mounts `dashboard/Home.jsx`. Existing providers, saved layouts, independent widget states and reviewed writes remain authoritative. The attached references guide presentation, not product data or new integrations.

[design-pipeline]
0. laws-of-ux → Common Region: one rounded surface per source, 16px gutters; Proximity: 8px within related controls, 24px card insets; Similarity: consistent headers, pill controls and focus outlines; Pareto: time, forecast and next event get distinct glanceable faces; Fitts: 44px action targets; Doherty: 150–200ms feedback, zero decorative motion under reduced motion.

Direction: quiet neutral canvas, white and charcoal cards, soft depth, restrained typography, a blue weather surface and calendar-red date details. Use theme tokens exclusively. Preserve real values, source freshness and explicit unavailable states. No screenshots. The user's reference-led design request supersedes the older no-gradient restriction for the weather card only.

- [x] dash.gallery: shared card hierarchy, responsive spacing and accessible controls.
- [x] glance.weather: real hourly temperature/rain strip and atmospheric blue surface.
- [x] glance.clock: analog dial with accessible digital time and timezone.
- [ ] glance.next-event: calendar date hierarchy with real countdown.
