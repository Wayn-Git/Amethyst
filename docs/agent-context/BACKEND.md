# Backend

FastAPI application under `backend/`. The main module is
`backend/api/main.py`: it builds the app, owns the lifespan, installs middleware,
and defines most HTTP routes directly. A few subsystems have dedicated routers.

Python requirement is `>=3.11`; the project metadata is `pyproject.toml`.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## App construction

`backend/api/main.py` creates `FastAPI(title="AMETHYST", lifespan=_lifespan)` and
adds two middleware layers:

1. `RemoteCallerGuard` — refuses non-local, unauthenticated callers anything
   except the public interface and pairing paths.
2. `CORSMiddleware` — added last, so it wraps the guard and a 403 still carries
   CORS headers.

Dedicated routers included by the app:

| Router | Prefix |
|---|---|
| `backend/terminal.py` | `/api/terminal` |
| `backend/remote/router.py` | `/api/remote` |
| `backend/remote/captures.py` | `/api/mobile` |
| `backend/remote/updates.py` | `/api/mobile/update` |
| `backend/converter/router.py` | `/api/converter` |
| `backend/dashboard/router.py` | `/api` (widget routes) |
| `backend/api/today.py` | `/api/today` |

Everything else is an `@app` handler in `main.py`, including conversations,
turns, providers, connectors, MCP, tasks, mail, library, memory, automations,
jobs, sync, devices, settings and health.

## Lifespan

`_lifespan` performs boot recovery before starting work:

1. Configure logging and install the asyncio exception handler.
2. Ensure paths and open the database.
3. Initialize the models.dev catalogue.
4. Seed/update built-in skills.
5. Run `backend.runtime.autostart.auto_setup()`.
6. Mark live agent runs as interrupted and close unanswered tool calls.
7. Recover orphaned durable jobs and decide whether each is replayable.
8. Prune old jobs.
9. Start runners and lanes.

Active background components:

| Component | Start location |
|---|---|
| Automation scheduler | `_runner.start()` |
| Automation/sync job lane | `_automation_lane.start()` |
| Mobile capture lane | `mobile_capture_lane.start()` |
| Worker batch lane | `_worker_lane.start()` |
| Reminders | `_reminders.start()` |
| Journal | `_journal.start()` |
| Instagram | `_instagram.start()` |
| Browser bookmark watcher | `_browser.start()` |
| Library sweeper/enrichment | `_library.start()` |
| MCP connector boot | `_start_connectors()` task |
| Stale subagent cleanup | `_stale_subagent_cleanup_loop()` task |

The root README says “five runners”; the code starts eight plus two lanes and
the connector task. See [systems/background-jobs.md](systems/background-jobs.md).

Shutdown reverses the order: control streams, cleanup task, library, browser,
Instagram, journal, reminders, scheduler, lanes, connector boot, MCP manager,
terminal manager, HTTP clients.

## Route groups

The exact handlers are in `backend/api/main.py`. Use `frontend/src/api.js` to
find the path a view calls, then search that string in the backend.

| Domain | Examples |
|---|---|
| Health and control | `/api/health`, `/api/ping`, `/api/control/stream`, `/api/control/{action}` |
| Conversations and turns | `/api/conversations`, `/api/conversations/{id}/turn`, `/turn/stop`, `/messages`, `/branch` |
| Confirmations and questions | `/api/confirmations`, `/api/questions`, `/api/connector-waits` |

### Turn lifecycle: detached from the HTTP connection

`POST /{id}/turn` starts a *pump task* (`backend/api/main.py`, `run_turn`) that
runs the whole turn -- director build, model calls, tools, approval waits,
memory extraction -- and pushes SSE frames into a per-request queue. The
`StreamingResponse` is only a frame reader. A client whose TCP connection dies
mid-turn (navigation, sleep, a stale bundle reloading the page) cancels the
reader and nothing else: the log records `[CLIENT DETACHED]`, the turn keeps
running, and its run row and transcript settle normally. Cancellation paths
that still end a turn are the user's Stop (or a device asking to stop), not
the socket. Because the turn may outlive the response, `_active_turns` is
deregistered by the pump's `finally`, and a concurrent `POST /turn` that
arrives while a detached turn is running gets 409. The frontend is
contract-paired: `views/Chat.jsx` blames the provider only for the backend's
real transport wording (`input stream`); a bare fetch `network error` reads
as a client-side connection loss whose turn continues server-side (see
`FRONTEND.md`).
| Providers and routing | `/api/providers`, `/api/routing`, `/api/tiers`, `/api/variant/{model}` |
| Setup and auth | `/api/setup/*`, `/api/auth/openrouter/*`, `/api/auth/microsoft/*` |
| Capabilities | `/api/capabilities`, `/api/skills/*`, `/api/connectors/*`, `/api/mcp/*` |
| Automations and jobs | `/api/automations/*`, `/api/jobs/*`, `/api/notifier/*` |
| Tasks and calendar | `/api/tasks/*`, `/api/calendar/*` |
| Mail | `/api/mail/*` |
| Library | `/api/library/*`, `/api/share/*` |
| Memory | `/api/memory/*` |
| Widgets | `/api/widgets/*`, `/api/layout`, `/api/dashboard/*` |
| Sync and devices | `/api/sync/*`, `/api/devices/*`, `/api/pair/*` |
| Remote control | `/api/remote/*` |
| Mobile | `/api/mobile/captures`, `/api/mobile/update` |
| Converter | `/api/converter/*` |
| Terminal | `/api/terminal/*` |
| Journal and Instagram | `/api/journal/*`, `/api/instagram/*` |

## Service modules

| Module | Responsibility |
|---|---|
| `backend/agent/` | Director loop, prompt, state, planning, subagents, traces |
| `backend/runtime/` | Provider adapters, routing, fallback, availability, variants |
| `backend/tools/` | Registry, base types, builtin tools |
| `backend/security/` | Confirmation, sandbox, remote access |
| `backend/tasks/` | Task service and Microsoft To Do projection |
| `backend/library/` | Capture, enrichment, storage, sweeper |
| `backend/retrieval/` | Chunking, embeddings, indexing, hybrid search |
| `backend/mail/` | Gmail and AgentMail clients |
| `backend/memory/` | Fact extraction and storage |
| `backend/automation.py`, `backend/automation_worker.py` | Scheduler and run execution |
| `backend/jobs/` | Durable jobs and lanes |
| `backend/dashboard/` | Widget manifests, providers, cache, actions |
| `backend/sync/` | Devices, HLC, ops, registry, projection |
| `backend/remote/` | Screen, input, power, media, files, camera, captures |
| `backend/converter/` | Local conversion service |
| `backend/web/` | Search, extraction, research, authority, circuit breaker |
| `backend/mcp/` | MCP config, lifecycle, OAuth, Composio, risk, SSRF |
| `backend/skills/` | Skill discovery, install, catalogue |
| `backend/journal/`, `backend/instagram/`, `backend/browser/` | Background capture and writing |

## Configuration

`backend/config.py` defines `paths()` and loads YAML configuration. Default home
is `~/.amethyst`, overridable with `AMETHYST_HOME`. Provider config is read from
`providers.yaml`; MCP from `mcp.yaml`; sandbox from `sandbox.yaml`; workers from
`workers.yaml`.

Writes use `write_atomic` (temporary file plus `os.replace`) so a crash cannot
leave truncated YAML.

Secrets are resolved through `backend/secrets.py` and the OS keychain. See
[systems/auth.md](systems/auth.md) and [systems/storage.md](systems/storage.md).

## Conventions

- New routes belong in the domain router when one exists; otherwise add them to
  `main.py` near related handlers.
- Keep request/response shapes Pydantic models or explicit `dict` contracts, as
  the surrounding code does.
- Long-running work goes through a lane or a background task, not a blocking
  route.
- A route that a paired device may call must be added to
  `backend/security/remote_access.py`; remote access is an allowlist.
- Domain logic belongs in a service module, not in the route handler.
- Do not issue SQL outside `backend/db/repositories.py`.

## Verification

```bash
pytest                      # Python suite; live tests excluded by default
pytest -m live              # opt-in live MCP/network tests
ruff check backend tests
cd frontend && npm run lint
```

## Known issues

- `backend/api/main.py` is a very large module. Prefer a dedicated router for
  new, separable domains.
- `backend/api/today.py` serves `/api/today`, while `/today` renders the newer
  dashboard. Treat the router as legacy unless a caller proves otherwise.
- The README runner count is stale.

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE.md](DATABASE.md)
- [AGENT-SYSTEM.md](AGENT-SYSTEM.md)
- [systems/background-jobs.md](systems/background-jobs.md)
- [systems/model-providers.md](systems/model-providers.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
