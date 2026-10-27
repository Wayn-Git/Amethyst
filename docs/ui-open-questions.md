# UI decisions and remaining differences

- 2026-10-27: Scope is the 80 shipped manifests, not unimplemented rows in dashboard-spec. Backend and permission contracts remain unchanged.
- Reference dimensions are normalized estimates from collages. Existing shared 24 px tile radius and 16/24 px insets translate the reference proportions to desktop; larger content grows rather than clips.
- R1–R4 are static images: animation is existing 150 ms control feedback, not an invented motion sequence. No artwork or logo is copied.
- No SKILL.md was attached with the request; used the installed frontend-design skill. Latest request overrides old no-screenshot, one-widget-per-task and monochrome-accent restrictions.
- App forms retain native date/time, numeric stepper and select menus for validation and keyboard support. Sliders are styled through the Input primitive when requested by existing controls; no new settings are invented.

- First browser pass found gallery overflow and inherited dark-mode attributes; gallery now uses document scrolling and resolves palette plus mode together. Early shared API startup ping is intercepted before imports, and library artwork uses badges instead of thumbnail requests.
- Product-wide raw-control migration is complete: the lint rule is now an error, with exemptions only for existing primitive implementation directories. Navigation routes, handlers and native submit semantics are preserved; existing page classes remain on the controls.
- Long provider text and expanded forms may grow beyond reserved skeleton height. There is no claim of zero layout shift for arbitrarily long live payloads; no clipping or internal scrollbar is used to conceal this.

## Final visual comparison

All 80 widgets retain the common desktop translation: 24 px radius rather than the collage’s estimated 28–36 px at a 200 px width; 16/24 px insets rather than a fixed 10% inset; token fonts rather than copied artwork typography. Body text is 14/20, labels 11/16, titles 16/22. These are remaining fidelity differences, not a claim of pixel equality. Compact S content reserves 144 px; ordinary M/L content reserves 184 px. Expanded forms and longer live payloads may grow. Exact zero layout shift for every payload remains unproven.

| Group | Radius / padding | Type / tone | Alignment / density and remaining differences |
|---|---|---|---|
| Glance | Common 24 px / 16–24 px | 40–64 px real readings; dark clock/music, violet sun, blue weather | Centered dial and aligned forecast; provider attribution and accessible 44 px actions take more room than collage chrome. |
| Needs you | Common 24 px / 16–24 px | 16 px subjects, muted dates; dark Slack and violet approvals | Initials lead rows; review controls remain below draft text. Long arguments grow vertically. |
| Communication | Common 24 px / 16–24 px | 16 px people/subjects; violet digest/tone and dark contacts | Circular initials replace photos; native selects and explicit review steps are denser than the reference action pills. |
| Agent | Common 24 px / 16–24 px | 48 px usage where numeric; violet brief and dark feed/usage | Timelines and disclosed configuration; prose-only providers stay editorial, with no invented charts. |
| Library | Common 24 px / 16–24 px | 16 px titles; violet capture/daily | 48 px circular badges replace image covers; left-aligned text reclaims the former empty artwork column. |
| Tasks | Common 24 px / 16–24 px | Large real ring/bar values; dark Focus and violet Goals | Focus remains centered; forms and Kanban columns grow for readable labels. Today/Focus retain 240/360 px reservations. |
| Developer | Common 24 px / 16–24 px | 16 px repo/status titles; dark unpushed | Left-aligned status and configuration; long paths wrap instead of truncating or scrolling. |
| Feed | Common 24 px / 16–24 px | 20 px editorial titles; dark RSS | Dense left-aligned headlines; summaries remain provider text and grow with content. No fake cover art. |
| System | Common 24 px / 16–24 px | 16 px status titles; dark Vault | Native provider controls and descriptive status need taller tiles than the reference device meters. |
| Dashboard | Common 24 px / 16–24 px | 16 px labels; violet palette and dark quiet hours | Gallery previews five entries with Browse all; pinned content keeps its isolated renderer; time fields retain native platform UI. |

Three visual passes addressed large reserved gaps, artwork-column waste, gallery scrolling, inherited paragraph/menu colors and accent-label contrast. The remaining differences above apply to all 80 IDs through their mapped patterns. Static references cannot establish motion timing; existing reduced-motion-safe feedback is retained.

Browser/tool interruptions: early long-lived HMR sessions caused module/import failures; final captures run one group per process after source edits. Product fixtures initially returned the wrong Skills catalogue shape; corrected to the real collection contract. These are resolved test harness issues, not hidden live-service claims.

Validation limits: contrast is measured on labelled fixture text and token backgrounds; third-party iframe contents, native popup menus, arbitrary user content and OS controls are outside that audit. Live connectors, OAuth, device location, hardware frame timings and all unrelated product workflows were not exercised. Library static-render tests retain existing React key warnings; lint/build retain existing nonblocking hook and chunk warnings.
