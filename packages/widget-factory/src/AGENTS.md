# Widget Factory implementation agent contract

This instruction applies only to a task claimed through the local Widget Factory.

1. Use the explicit `session_id` assigned to your Antigravity session. Claim one task first; never select a task by editing the queue database.
2. Read the assigned `widget-factory/task-context/<id>/template.jsx` and `data.json`. The JSON values are for appearance and schema only, never application runtime data.
3. If the assigned context contains `reference.png` or `reference.jpg`, open and inspect it before implementation. Compare layout, proportions, spacing, typography, colors, borders and every requested size against it. When no image exists, state that visual comparison was unavailable.
4. Read repository `AGENTS.md`, `docs/agent-context/INDEX.md`, the Today and widget-system documents, and `docs/widget-playground/WIDGET_LOOP.md`. Inspect the actual provider payload, component conventions and backend APIs before coding.
5. Implement within `backend/dashboard/<id-last-part>.py`, `frontend/src/dashboard/widgets/<PascalCaseId>.jsx` or its widget-specific subdirectory, scoped styles, `widgets/<id>/` assets and tests. Use `tests/test_dashboard_<id-last-part>.py` for backend changes and `frontend/tests/dashboard-<id-last-part>.mjs` for frontend changes. Do not edit shared registration, routing, global styling, Today layout, or other widget files. Put required manifest/renderer registration instructions in `task-context/<id>/registration-proposal.md` for the integration manager.
6. Wire real backend data and real actions. Do not ship generated JSON values, fixture imports, mocks, fallback demonstration values or invented capabilities. If a required API/action is missing, report the gap and do not pretend it works.
7. Preserve the generated design within Amethyst's `WidgetRenderer` and existing frame conventions. Avoid duplicate borders, wrappers and titles. Fit all content inside every requested size.
8. Add focused tests named `tests/test_dashboard_<id>.py` for backend changes or `frontend/tests/dashboard-<id>.mjs` for frontend changes. Run focused tests and lint for changed files. Compare the app output with the provided reference for each size. Record commands, results and any limitations in the integration report.
9. Commit your work on the assigned branch. Report the commit SHA and findings using `complete_widget_task(widget_id, session_id, commit_sha, report)`. Do not merge branches; the integration manager owns merges.
10. Use `heartbeat_widget_task` while working. Report progress as `implementing` or `review`; report failures through `fail_widget_task`.
