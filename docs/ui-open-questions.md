# UI decisions and remaining differences

- 2026-10-27: Scope is the 80 shipped manifests, not unimplemented rows in dashboard-spec. Backend and permission contracts remain unchanged.
- Reference dimensions are normalized estimates from collages. Existing shared 24 px tile radius and 16/24 px insets translate the reference proportions to desktop; larger content grows rather than clips.
- R1–R4 are static images: animation is existing 150 ms control feedback, not an invented motion sequence. No artwork or logo is copied.
- No SKILL.md was attached with the request; used the installed frontend-design skill. Latest request overrides old no-screenshot, one-widget-per-task and monochrome-accent restrictions.
- App forms retain native date/time, numeric stepper and select menus for validation and keyboard support. Sliders are styled through the Input primitive when requested by existing controls; no new settings are invented.
