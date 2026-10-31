# Code

The Coding Agents page at `/code`. This is a placeholder, not an implemented
coding-agent runtime.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Code.jsx`, `code.css` |
| Route | `/code` |
| Backend | none |
| Issue | `https://github.com/Wayn-Git/Amethyst/issues/70` |

## What exists

`Code.jsx` renders a marketing-style “In Development” page:

- Badge: `In Development`.
- Hero: “Coding Agents Manager”.
- Description naming AntiGravity, Claude Code, Codex and Aider as intended
  integrations.
- A link to issue #70.
- No forms, no API calls, no persisted state.

There is no backend route, no tool, no job lane and no database table for
coding agents. The workspace value from the store is displayed as a label only.

## What does not exist

- Agent orchestration across coding CLIs.
- Worktree or multi-session management for coding agents.
- Execution streams.
- Provider selection for coding agents.
- Any API under `/api/code`.

Do not document or assume these as implemented.

## Modification guide

If this page becomes real:

1. Add a domain module under `backend/` (for example `backend/coding/`).
2. Add routes and a job lane; do not run long agent processes inside a request.
3. Add tables for sessions, worktrees and runs.
4. Replace the placeholder view with real state and error handling.
5. Add a section doc and update [INDEX.md](../INDEX.md).
6. Keep the existing issue link only if it still tracks the work.

Until then, changes should be limited to copy, layout or removing the page.

## Known issues

- The page promises integrations that do not exist. That is intentional
  placeholder copy, but it can mislead a reader of the repository.
- The route is in the rail. Users can reach a page with no function.
- No test covers the page beyond rendering.

## Related

- [FRONTEND.md](../FRONTEND.md)
- [sections/chat.md](chat.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
