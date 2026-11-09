# Widget Factory: architecture and implementation plan

## Repository findings

- Today is the existing `/today` dashboard in `frontend/src/dashboard/Home.jsx`; widget manifests, providers, cache and actions are owned by `backend/dashboard/`. `docs/agent-context/components/widget-system.md` and `sections/today.md` are the verified maps.
- Gan-Tu's output already lives in `widgets/<id>/`; the local factory posts the prompt and optional PNG/JPEG reference image to the author-widget endpoint, then saves template/data/metadata and the original reference image. The older `scripts/generate-widget.mjs` remains a single-shot generator.
- `@tugan/widgets` is already installed by the frontend. Amethyst already depends on `mcp`, `httpx`, pytest and uses SQLite/WAL elsewhere.
- Git is on `master` with configured author identity. There is one worktree. The working tree contains 72 changed/untracked paths, including shared dashboard files; these are pre-existing user changes and must be left intact.

## Proposed architecture and ownership

Everything new belongs under `widget-factory/`; do not alter Today registration, global styles, backend API or the existing widget generator. A small `widget_factory/` package separates shared SQLite/prompt helpers, generation/artifact handling, task/worktree/integration operations, and MCP registration; `factory.py` is the CLI entry point. It uses stdlib SQLite, urllib/httpx-compatible installed dependencies, Git CLI and the installed MCP SDK. The queue DB and worktrees are ignored local runtime state; prompts and generated source references are ordinary files under this directory.

- `prompts/widgets.md`: authored prompt list.
- `generated/<id>/`: exact generated template, JSON data, metadata and optional original image.
- `factory.py`: CLI entry point. `widget_factory/common.py`, `generation.py`, `queue.py` and `mcp_server.py` own separate layers; task mutations enforce explicit session ownership.
- `AGENTS.md`: implementation contract copied into task responses and worktree instructions.
- `README.md`: setup, prompt, image, MCP clients, four sessions, recovery and integration process.
- `tests/test_factory.py`: parser, HTTP/retry, artifact/hash/image, SQLite lease/ownership and worktree safety checks.
- `.gitignore`: excludes only local queue and worktree runtime state.

The queue serializes task transitions using SQLite `BEGIN IMMEDIATE`, WAL and lease recovery. A claim selects a generated/ready task, assigns an available one of four fixed worktree slots, and creates a dedicated branch/worktree. Expired leases return to ready; attempts and errors remain in history. Workers may modify only widget-specific application files; registry/shared edits become proposals. Integration is a single serialized CLI operation which checks ownership, branch/commit, changed paths and proposal/report before merging, and stops on conflicts.

Image discovery is limited to observed output from the current endpoint and documented Playground export. The API response path is the first check; if it supplies no binary/image URL, image import validates PNG/JPEG signatures and preserves bytes. No synthetic image fallback.

## Verification and limits

Run only the new factory tests and focused lint. Do not run desktop builds or the broader suite: no application files change, and the existing working tree is already dirty. Do not contact the hosted service during tests. Antigravity's MCP client support is configuration-level only; the stdio server follows MCP SDK conventions and needs a local client smoke test to claim compatibility. Four actual external Antigravity sessions cannot be launched by this repository change; documented commands and atomic slot allocation support the operator launching them.
