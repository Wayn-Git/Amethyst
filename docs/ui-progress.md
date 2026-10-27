# Home visual redesign progress

Branch: ui-redesign. Shipped inventory: 80 widgets. Updated 2026-10-27.

- [x] Phase 0: reference atlas with measurements and explicit assumptions.
- [x] Phase 1: all 80 manifest IDs mapped; inventory/snapshot/registry check passes.
- [x] Phase 2: shared controls and field patterns; native validation/submission retained.
- [ ] Phase 3: final per-group captures and verification receipts below.
- [x] Phase 4: Home, Library, Coding Agents, Skills, Connectors and Settings reviewed with isolated empty fixtures.
- [ ] Phase 5: final all-state contrast, responsiveness and production-exclusion checks in progress.

Implementation is applied to all 80 shipped widgets. Final checks cover all manifest sizes, six states, nine themes, 360–2560 px, keyboard controls, reduced motion, draft approval/rejection, pin sandboxing and Home drag/resize/undo. The product-wide JSX raw-control rule is now an error; primitive implementations remain exempt. A syntax audit verified all props and native submit defaults for 1,187 migrated controls across 136 product files. No navigation routes or backend contracts were changed.

Common implementation commits: 6f8e400 (atlas/map), 08d0609 (controls/gallery), cc22029 (widget adoption, combined by the concurrent workflow), 7859870 (product control enforcement). Existing concurrent commits are preserved; group-specific commits below record completion evidence rather than rewriting that history.

Remaining verification: finish captures and expanded contrast sweep, update group receipts, final build/exclusion check. Known fidelity and validation limits are in ui-open-questions.md. No live account/OAuth or hardware profiling is claimed.

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
