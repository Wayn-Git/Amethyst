# Home visual redesign progress

Branch: ui-redesign. Shipped inventory: 80 widgets. Updated 2026-10-27.

- [x] Phase 0: measured reference atlas and explicit assumptions.
- [x] Phase 1: full widget map and executable inventory check.
- [x] Phase 2: shared field/control language, preserving form semantics.
- [ ] Phase 3: Glance, Needs you, Communication, Agent, Library, Tasks, Developer, Feed, System, Dashboard.
- [ ] Phase 4: product consistency review.
- [ ] Phase 5: browser sweep, raw-control enforcement and production build.

Current proof: inventory check passes for 80 IDs; Glance, Needs you and Communication action/state suites pass across nine themes. New fixture action checks pass native form submission, proposal-before-approval, rejection, keyboard switches/segments and numeric progress. All groups have produced first-pass screenshots. Remaining: finish isolation/overflow sweep (latest run timed out entering System), inspect final contact sheets, product pages, production bundle exclusion and commits per group.

Shared field language is applied in Home only; legacy controls elsewhere in the app keep their existing styling and warning severity so navigation is unchanged. Home and its new gallery reject raw controls as lint errors. Full-product raw-control migration remains outside this Home pass.
