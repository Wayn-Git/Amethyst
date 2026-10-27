# UI decisions and remaining differences

- 2026-10-27: Scope is the 80 shipped manifests, not unimplemented rows in dashboard-spec. Backend and permission contracts remain unchanged.
- Reference dimensions are normalized estimates from collages. Existing shared 24 px tile radius and 16/24 px insets translate the reference proportions to desktop; larger content grows rather than clips.
- R1–R4 are static images: animation is existing 150 ms control feedback, not an invented motion sequence. No artwork or logo is copied.
- No SKILL.md was attached with the request; used the installed frontend-design skill. Latest request overrides old no-screenshot, one-widget-per-task and monochrome-accent restrictions.
- App forms retain native date/time, numeric stepper and select menus for validation and keyboard support. Sliders are styled through the Input primitive when requested by existing controls; no new settings are invented.

- First browser pass found gallery overflow and inherited dark-mode attributes; gallery now uses document scrolling and resolves palette plus mode together. Early shared API startup ping is intercepted before imports, and library artwork uses badges instead of thumbnail requests.
- Home raw-control lint is an error. Older controls outside Home still warn; a full-product migration would change navigation and unrelated pages, so it is not included in this Home redesign.
- Long provider text and expanded forms may grow beyond reserved skeleton height. There is no claim of zero layout shift for arbitrarily long live payloads; no clipping or internal scrollbar is used to conceal this.
