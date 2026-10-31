# Development Guide

How to set up, verify and change AMETHYST safely. Read
[ARCHITECTURE.md](ARCHITECTURE.md) first for the shape of the system.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Requirements

- Python 3.11+
- Node.js and npm
- SQLite with FTS5 (bundled with Python's `sqlite3` on supported builds)
- Optional: `uv`, Docker, Ollama, a Cloudflare account for the relay,
  Android Studio / Xcode for the mobile app

## Setup

Fast path:

```bash
./run.sh --dev
```

This starts the backend with reload and the Vite dev server. The Vite proxy
sends `/api` to `http://127.0.0.1:8000`.

Manual:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
amethyst init

cd frontend && npm install
```

`uv pip install -e '.[dev]'` is equivalent. The `-e` matters: the backend
resolves the built SPA relative to `backend/api/main.py`. A non-editable
install breaks that path and serves a blank page with no error. See
`CONTRIBUTING.md`.

Run modes:

```bash
./run.sh              # build frontend, serve unified app on :8000
./run.sh --dev        # backend reload + Vite
./run.sh --doctor     # diagnostics
./run.sh --setup      # configuration wizard
./run.sh --desktop    # tray + global hotkey
./run.sh --build      # force frontend build
```

Direct commands:

```bash
amethyst serve
amethyst doctor
amethyst init
amethyst chat
```

## Where state lives

`AMETHYST_HOME` defaults to `~/.amethyst`.

```text
~/.amethyst/
  amethyst.db            SQLite database (WAL)
  config/providers.yaml  model providers and tiers
  config/mcp.yaml        MCP servers
  config/sandbox.yaml    sandbox policy
  config/workers.yaml    remote worker accounts
  library/               captured text, one file per item
  library/media/         thumbnails and video
  skills/                user-installed skills
  logs/                  logs
```

Secrets live in the OS keychain. `AMETHYST_SECRETS_FILE` can point at a JSON
file for headless or container use. Never commit it.

## Verification

Run before every push:

```bash
ruff check backend tests
pytest
```

`pytest` defaults to `-m 'not live'` (`pyproject.toml`). Live tests spawn real
MCP servers and reach the network:

```bash
pytest -m live
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
npm run smoke        # against a running server with a configured model
```

Targeted suites:

```bash
pytest tests/test_api_surface.py
pytest tests/test_agent_state.py
pytest tests/test_connection_gate.py
cd frontend && npm run test:widgets
cd frontend && npm run test:sync
cd frontend && npm run test:mobile
```

`npm run smoke` and the other `frontend/tests/*.mjs` scripts are plain Node
scripts, not a browser test runner. Many of them inspect source or run DOM
shims; check the script before assuming it exercises a live UI.

The widget registry parity check:

```bash
python scripts/check-widget-map.py
```

## Architectural rules

These are load-bearing. Breaking one produces a bug that tests may not catch.

1. **One uvicorn worker.** The lifespan starts in-process runners, job lanes and
   live stdio MCP subprocesses. `--workers N` duplicates all of them against one
   SQLite file.
2. **One dispatch path.** Every tool call goes through
   `ToolRegistry.dispatch`: permission gate, timeout, truncation, audit row. Do
   not call a tool handler directly from a route.
3. **Repositories own SQL.** Routes and services do not issue SQL. Add a method
   to `backend/db/repositories.py` or the domain repository.
4. **Filesystem is the source of truth for text.** Library text lives in
   `~/.amethyst/library/`. The database indexes it; it does not replace it.
5. **Risk can only escalate.** A tool's declared risk is a floor. Confirmation
   may raise it, never lower it.
6. **Remote devices cannot weaken the guard.** Enforced at the turn endpoint
   and in `backend/security/remote_access.py`.
7. **Secrets never enter the repository or an image layer.** Catalogue entries
   carry environment variable names, not values. `tests/test_docker_context.py`
   enforces this.
8. **Sync is allowlisted.** A new column does not cross devices until it is
   listed in `backend/sync/registry.py`.
9. **Comments explain why.** Keep the defect or trap that motivated the code.
   Do not replace a why-comment with a restatement.
10. **Frontend and backend widget registries stay in parity.** Use
    `scripts/check-widget-map.py`.

## Change recipes

### Add a page

1. Create the view under `frontend/src/views/`.
2. Register it in `frontend/src/views/registry.js` (lazy import and metadata).
3. Add navigation in `frontend/src/nav.js`.
4. Add API calls to `frontend/src/api.js`, not inline `fetch`.
5. Add a route only if the page is not covered by the registry-driven router.
6. Document it under `docs/agent-context/sections/` if it is a primary surface.

### Add an API endpoint

1. Put domain logic in `backend/<domain>/`.
2. Add the route in `backend/api/main.py` or the domain router.
3. Validate input with Pydantic models; return plain JSON.
4. Add the client method in `frontend/src/api.js`.
5. Add a test under `tests/`, preferably asserting the response shape and one
   failure mode.
6. Update [BACKEND.md](BACKEND.md) if the surface changes materially.

### Add a tool

1. Define the tool in `backend/tools/` with a `Tool` object: name, description,
   JSON schema, handler, `RiskLevel`, `ToolSource`.
2. Register it in the domain's `register_*` function called from
   `backend/tools/registry.py`.
3. Do not bypass the registry. Do not add a second dispatch path.
4. Add a permission test and a result-shape test.
5. Update [systems/tool-execution.md](systems/tool-execution.md) if the risk or
   timeout contract changes.

### Add a provider

1. Implement or extend an adapter in `backend/runtime/`.
2. Add the provider preset and routing entry.
3. Store the key by reference in the keychain, never in `providers.yaml`.
4. Add a model-list or health test.
5. Update [systems/model-providers.md](systems/model-providers.md).

### Change the schema

1. Edit `backend/db/schema.sql`.
2. Add an idempotent migration path if existing databases must survive. The
   schema is applied at startup; check `backend/db/connection.py` for how
   missing tables and columns are handled.
3. Update the repository.
4. Add the table to `backend/sync/registry.py` only if it should cross devices,
   with an explicit field allowlist.
5. Update [DATABASE.md](DATABASE.md).

### Add a widget

1. Add a manifest in `backend/dashboard/registry.py`.
2. Add the data provider under `backend/dashboard/`.
3. Add the frontend renderer and register it in
   `frontend/src/dashboard/registry.js`.
4. Add layout defaults and any settings schema.
5. Run `python scripts/check-widget-map.py`.
6. Update [components/widget-system.md](components/widget-system.md).

### Change the agent loop

1. Read [AGENT-SYSTEM.md](AGENT-SYSTEM.md) and
   [systems/tool-execution.md](systems/tool-execution.md).
2. Keep phase transitions legal; `backend/agent/state.py` rejects illegal moves.
3. Emit events through the existing event types. A new event type needs a
   frontend consumer and a documented name.
4. Preserve cancellation, disconnect handling and the one-active-turn rule.
5. Add a regression test for the failure the change prevents.

### Change sync

1. Read [systems/sync.md](systems/sync.md).
2. Add fields to `backend/sync/registry.py`, never `SELECT *`.
3. Emit ops in the same transaction as the write.
4. Keep merges idempotent; `sync_seen` is a backstop, not the design.
5. Test two replicas converging, not one replica writing.

## Documentation maintenance

This directory is part of the codebase. Update it in the same change as the
code.

### When to update

| Change | Update |
|---|---|
| New or removed route | [FRONTEND.md](FRONTEND.md), [BACKEND.md](BACKEND.md), section doc |
| New table, column or index | [DATABASE.md](DATABASE.md) |
| New tool, risk rule or gate behaviour | [systems/tool-execution.md](systems/tool-execution.md) |
| Agent phase, event or prompt contract | [AGENT-SYSTEM.md](AGENT-SYSTEM.md) |
| MCP lifecycle, auth or connector rule | [MCP-INTEGRATIONS.md](MCP-INTEGRATIONS.md) |
| Cross-boundary flow | [DATA-FLOW.md](DATA-FLOW.md) |
| New widget or layout rule | [components/widget-system.md](components/widget-system.md) |
| New primary screen | `sections/` and the index routing table |
| Setup, test or release command | This guide |

Cosmetic changes do not need a documentation update unless they change a
documented convention.

### How to update

1. Change only the affected document. Do not regenerate the library.
2. Verify every path and symbol you cite against the source.
3. Keep implemented, experimental and planned features distinct. Do not
   describe an intention as shipped behaviour.
4. Update the document's `_Last verified_` line with the date and short commit.
5. If a document gains or loses a section, update
   [INDEX.md](INDEX.md).
6. Record an uncertainty in the index instead of guessing.

### Accuracy rules

- Source code is authoritative.
- Do not invent file paths, endpoints, table names or dependencies.
- Prefer linking `docs/architecture/` over duplicating a deep dive.
- If a document and the code disagree, fix the document and note the drift.
- Keep the verification baseline in [INDEX.md](INDEX.md) current.

## Recommended documentation automation

Not built. Recommended next step if drift becomes frequent:

1. A CI job on pull requests that extracts route decorators from
   `backend/api/main.py`, tables from `backend/db/schema.sql`, views from
   `frontend/src/views/registry.js`, and widget ids from both registries.
2. Compare the extracted sets with the code spans cited in
   `docs/agent-context/`. Fail on a missing or stale path.
3. Run a link checker over the Markdown tree.
4. Post a summary comment listing documents whose `_Last verified_` commit is
   older than the changed subsystem.
5. Optionally, an OpenCode task that proposes doc diffs from the changed files.
   Keep a human approval step: generated prose that invents behaviour is worse
   than stale prose.

Do not generate the whole library on every commit. Targeted checks catch drift;
bulk regeneration destroys hand-written rationale.

## Debugging

| Symptom | First check |
|---|---|
| Blank page after install | Editable install and `frontend/dist` path |
| Turn hangs with no output | `status`/`ping` frames; connector reconcile deadline |
| 409 on turn | Another turn is active for that conversation |
| Tool never runs | Permission gate, timeout, registry visibility |
| Connector shows connected but no tools | `MCPManager.state()`, tool count, reconcile |
| Widget empty | Cached payload, source error, `requires` unmet |
| Sync not arriving | Pairing, group key, relay reachability, outbox |
| Tests pass locally, fail in CI | Live-marked tests, network, missing env |

Useful commands:

```bash
amethyst doctor
amethyst mcp status
amethyst embeddings status
curl -s http://127.0.0.1:8000/api/ping
curl -s http://127.0.0.1:8000/api/health
```

The API also serves `/docs` (FastAPI's generated schema) while running.

## Release and packaging

- Desktop: Electron shell under `electron/`, packaging config
  `electron-builder.yml`, workflow `.github/workflows/desktop-release.yml`.
- Python desktop: `backend/desktop.py`, entry points `amethyst-palette` and
  `amethyst-show`.
- Mobile: Capacitor under `frontend/android` and `frontend/ios`; build with
  `npm run mobile:sync`, then `npm run mobile:android` or `mobile:ios`.
- Docker: `Dockerfile`, `docker-compose.yml`. Keep the editable install and the
  build-time assertion.
- Relay: `relay/`, deployed with Wrangler. `POST /api/relay/deploy` and
  `POST /api/relay/verify` drive deployment from the app.
- Notifier: separate package in `notifier/`, driven by GitLab CI
  (`.gitlab-ci.yml`).

The relationship between the Electron shell and the Python tray app is not
documented in the repository. Treat both as shipped until confirmed otherwise.

## Related documents

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [FRONTEND.md](FRONTEND.md)
- [BACKEND.md](BACKEND.md)
- [DATABASE.md](DATABASE.md)
- [AGENT-SYSTEM.md](AGENT-SYSTEM.md)
- [MCP-INTEGRATIONS.md](MCP-INTEGRATIONS.md)
- [DATA-FLOW.md](DATA-FLOW.md)
- [`../architecture/`](../architecture/) — deep dives and ADRs

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
