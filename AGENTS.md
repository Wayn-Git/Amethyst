Task: build the Home dashboard. Spec: docs/dashboard-spec.md
Repo map: backend/api/main.py (API mount), backend/dashboard/ (widget API/providers/manifests), backend/agent/ (Director/traces), backend/security/confirmation.py (permission gate), frontend/src/dashboard/ (Home/components/registry), backend/db/ (SQLite connection/core schema), backend/dashboard/schema.sql (widget tables), tests/test_dashboard_*.py and frontend/tests/dashboard-*.mjs (tests).
- Read spec section 0, then only the rows for the current task.
- Build in tier order, one widget per task.
- Existing conventions win. Drafts only; writes go through the permission gate.
- Theme tokens only. Never invent features or data.
- Edit in place. Never reprint files or diffs. No plans or explanations.
- No screenshots. Run only tests for touched code.
- After each widget: commit, tick Done box, one line in docs/dashboard-changelog.md.
- Final reply max 5 lines: ids done, test result, blockers.