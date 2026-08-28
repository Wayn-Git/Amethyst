# Home visual redesign progress

Branch: ui-redesign. Shipped inventory: 80 widgets. Updated 2026-10-27.

- [x] Phase 0: reference atlas with measurements and explicit assumptions.
- [x] Phase 1: all 80 manifest IDs mapped; inventory/snapshot/registry check passes.
- [x] Phase 2: shared controls and field patterns; native validation/submission retained.
- [x] Phase 3: all ten groups captured and verified; receipts below.
- [x] Phase 4: Home, Library, Coding Agents, Skills, Connectors and Settings reviewed with isolated empty fixtures.
- [x] Phase 5: fixture sweep, app-wide control lint and production build/exclusion checks complete; limits below.

Implementation is applied to all 80 shipped widgets. Final checks cover all manifest sizes, six states, nine themes, 360–2560 px, keyboard controls, reduced motion, draft approval/rejection, pin sandboxing and Home drag/resize/undo. The product-wide JSX raw-control rule is now an error; primitive implementations remain exempt. A syntax audit verified all props and native submit defaults for 1,187 migrated controls across 136 product files. No navigation routes or backend contracts were changed.

Common implementation commits: 6f8e400 (atlas/map), 08d0609 (controls/gallery), cc22029 (widget adoption, combined by the concurrent workflow), 7859870 (product control enforcement). Existing concurrent commits are preserved; group-specific commits below record completion evidence rather than rewriting that history.

Final proof: all 80 IDs and 169 manifest sizes; six states; all nine themes; widths 360, 390, 768, 1024, 1440 and 2560. All ten reference captures pass in Paper/Graphite at 1440/390. The computed-text AA audit passes across all six states and nine themes. Home interactions, reference actions, primitives, pin sandbox checks, foundation controls, product-page review and Library static-render tests pass. Production build passes and emitted JavaScript contains no gallery route, sample fixture copy or mock transport strings. App-wide lint has no errors; existing warnings remain.

No further implementation is queued. Exact collage geometry, zero layout shift for arbitrary live text, live account/OAuth, native menu rendering and hardware profiling are not claimed; see ui-open-questions.md. These limits remain explicit rather than marking unshipped features or backend integrations done. Contact sheets and machine-readable reports are local, gitignored files in ui-review/.

## Group completion receipts

- [x] **glance** — 7 IDs / 18 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/glance-contact-sheet.png`.

- [x] **needs-you** — 9 IDs / 18 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/needs-you-contact-sheet.png`.

- [x] **communication** — 7 IDs / 14 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/communication-contact-sheet.png`.

- [x] **agent** — 14 IDs / 28 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/agent-contact-sheet.png`.

- [x] **library** — 11 IDs / 22 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/library-contact-sheet.png`.

- [x] **tasks** — 13 IDs / 26 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/tasks-contact-sheet.png`.

- [x] **developer** — 7 IDs / 14 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/developer-contact-sheet.png`.

- [x] **feed** — 2 IDs / 4 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/feed-contact-sheet.png`.

- [x] **system** — 4 IDs / 12 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/system-contact-sheet.png`.

- [x] **dashboard** — 6 IDs / 13 sizes; six states; Paper/Graphite × 1440/390; nine-theme responsive and contrast checks. Contact sheet: `ui-review/dashboard-contact-sheet.png`.
