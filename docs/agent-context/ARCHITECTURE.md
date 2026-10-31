# Architecture

Amethyst is a single-user, local-first personal operating system. One FastAPI
process serves the API, runs the agent loop, and owns all background work. One
React application is the interface. Persistent state is SQLite plus the local
filesystem; secrets are in the OS keychain. There is no multi-tenancy and no
separate worker service.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Deeper rationale: [`../architecture/overview.md`](../architecture/overview.md).

## Runtime shape

```mermaid
flowchart TB
  subgraph Client
    WEB[React SPA]
    MOB[Capacitor companion]
    DESK[Electron or pywebview shell]
  end
  subgraph Process[One FastAPI process]
    API[HTTP + SSE API]
    DIR[Agent Director]
    RUN[Lifespan runners and job lanes]
    MCP[MCP manager]
  end
  WEB --> API
  MOB --> API
  DESK --> API
  API --> DIR
  API --> RUN
  DIR --> MCP
  DIR --> DB[(SQLite WAL)]
  DIR --> FS[Filesystem]
  DIR --> KEY[OS keychain]
  RUN --> DB
  MCP --> EXT[External MCP servers]
```

The process is the deployment unit. `amethyst serve` refuses to start a second
server on the same port; the kernel's port bind is the lock. `backend/cli.py`
performs that check before starting uvicorn.

## Layers and ownership

| Layer | Owns | Does not own |
|---|---|---|
| Interface | Rendering, input, streaming display, approvals | Provider, tool or storage details |
| Agent loop | Reason/act/observe cycle, prompt assembly, termination, turn state | Individual tool behavior |
| AI runtime | Provider adapters, schema translation, streaming, fallback | Tool semantics, conversation state |
| Tool registry | Flat namespace, permission gate, result normalization, audit | What a tool does internally |
| Domain services | Tasks, library, mail, memory, automations, dashboard, sync | Transport or UI concerns |
| Data layer | SQLite, migrations, repositories, filesystem, keychain | Business rules |

The agent loop is the hub, not a pipeline stage. It calls the runtime, the tool
registry and retrieval repeatedly. Skills are markdown content read through
filesystem tools; MCP tools register into the same flat registry as builtins.

## Repository map

| Path | Responsibility |
|---|---|
| `backend/api/main.py` | Main FastAPI app, most route handlers, lifespan, middleware |
| `backend/api/today.py` | Legacy `/api/today` router |
| `backend/terminal.py` | PTY sessions and terminal WebSocket |
| `backend/remote/` | Remote-control API, captures, updates, screen, input, files |
| `backend/converter/` | Local conversion service and router |
| `backend/dashboard/` | Widget manifests, providers, cache, layout, actions |
| `backend/agent/` | Director, prompt, state, planning, subagents, traces |
| `backend/runtime/` | Provider adapters, routing, fallback, availability |
| `backend/tools/` | Tool base types, registry, builtin tools |
| `backend/security/` | Confirmation gate, sandbox, remote-access permissions |
| `backend/db/` | Connection, schema bootstrap, repositories |
| `backend/mcp/` | MCP config, lifecycle, OAuth, Composio, risk, SSRF |
| `backend/library/`, `backend/retrieval/` | Capture, storage, indexing, hybrid search |
| `backend/sync/` | Devices, HLC ops, sync registry, Microsoft To Do projection |
| `backend/jobs/` | Durable job state, store, lanes |
| `frontend/src/` | React shell, views, dashboard, components, API client |
| `frontend/src/mobile/`, `frontend/src/lib/sync/` | Capacitor companion and sync client |
| `electron/`, `backend/desktop.py` | Desktop shells |
| `relay/` | Cloudflare Worker for always-on capture and sync relay |
| `notifier/` | Separate morning-brief/digest package used by CI |
| `tests/`, `frontend/tests/` | Python and frontend verification |

## Request path

A chat turn is the canonical path:

1. `frontend/src/api.js` sends `POST /api/conversations/{id}/turn` and reads SSE.
2. `backend/api/main.py` validates the conversation and starts one Director.
3. The Director assembles the prompt and tool catalogue, resolves a provider,
   calls the model, and streams events.
4. Tool calls go through `backend/tools/registry.py`; the permission gate may
   suspend the turn.
5. Results return to the model; the loop continues until it answers or a guard
   stops it.
6. Messages, run state and audit rows persist in SQLite.

Full sequence: [DATA-FLOW.md](DATA-FLOW.md#1-chat-turn).

## Invariants

- One server process against one database. Background work runs in the same
  lifespan, not in a second worker.
- Every tool dispatch passes the permission gate and writes an audit row.
- A tool's static risk floor can be raised by the model's self-report, never
  lowered.
- Provider differences stay inside adapters. The loop sees one normalized type
  surface.
- Secrets live in the keychain; the database holds references only.
- SQLite is the relational store; captured text and vault files are real files;
  vector and keyword indexes live in SQLite.
- A turn always emits a terminal frame (`done`, `error`, or `guard`).
- Local callers are trusted by the OS boundary. Remote callers need a paired
  device token and an explicit permission scope.

## Configuration and data locations

Default home is `~/.amethyst`, overridable with `AMETHYST_HOME`.

| Path | Contents |
|---|---|
| `~/.amethyst/amethyst.db` | SQLite database |
| `~/.amethyst/config/providers.yaml` | Providers, tiers, embeddings, memory model |
| `~/.amethyst/config/mcp.yaml` | MCP servers |
| `~/.amethyst/config/sandbox.yaml` | Sandbox settings |
| `~/.amethyst/config/workers.yaml` | Remote worker accounts |
| `~/.amethyst/skills/` | Installed skills |
| `~/.amethyst/library/` | Captured markdown and media |
| `~/.amethyst/logs/` | Logs |

## Related

- [BACKEND.md](BACKEND.md) — process and API detail
- [FRONTEND.md](FRONTEND.md) — interface structure
- [DATABASE.md](DATABASE.md) — schema and repositories
- [AGENT-SYSTEM.md](AGENT-SYSTEM.md) — loop and turn state
- [MCP-INTEGRATIONS.md](MCP-INTEGRATIONS.md) — external capability
- [systems/desktop.md](systems/desktop.md) — desktop shells

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
