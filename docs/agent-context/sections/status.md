# Status

The machine and service status page at `/dash`. It is reached from the degraded
banner, the command palette, or Settings, not from the rail.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Dashboard.jsx` |
| Client | `frontend/src/api.js` → `api.health()`, `api.gitStatus()` |
| Route | `/dash` |
| Endpoint | `GET /api/health`, `GET /api/git-status` |
| Store | `frontend/src/store.jsx` health poll |
| Availability | `backend/runtime/availability.py` |

## UI structure

The page renders only values from `/api/health`. It used to include a literal
guard string; that was removed because a status page that prints one unchecked
number cannot be trusted about the others.

Sections:

- Provider lines: configured providers, unavailable providers with reasons.
- Tools: registered count, connector tool count.
- Connectors: live, reconciled, awaiting sign-in, errors.
- Skills: loaded count, failed count.
- Overall status: `ok` or `degraded`.
- Module cards for chat, capabilities, memory, logs.
- Memory count.
- Git status for the workspace.

The health tick also drives model-picker capabilities in the store.

## Health payload

`GET /api/health` returns:

| Key | Meaning |
|---|---|
| `status` | `degraded` if any connector is broken, else `ok` |
| `connectors_awaiting_sign_in` | Connector names waiting on a person, not faults |
| `providers` | Enabled providers in `providers.yaml` order |
| `routing` | Whether Auto can choose a provider |
| `provider_core` | Providers grouped as core |
| `provider_no_auto` | Enabled but excluded from Auto |
| `providers_unavailable` | Configured providers known not to answer, with reasons |
| `tiers` | Tier to provider/model map |
| `provider_defaults` | Declared default model per provider |
| `tools` | Total registered tools |
| `mcp_tools` | Tools from MCP servers |
| `mcp_reconciled` | Whether connectors have been started in this process |
| `connector_errors` | Error strings by connector |
| `skills` | Loaded skill count |
| `skill_errors` | Failed skill loads |

A connector nobody signed in to is separated from a broken connector. Otherwise
one unconfigured server marks the whole system degraded and the word stops
meaning anything.

## Availability

`availability.survey(providers)` probes providers that declare no key (for
example a local Ollama endpoint) and remembers results from real turns for the
rest. A provider with a key is not assumed reachable. Unavailable providers stay
in the list with a reason instead of disappearing.

## Degraded banner

The app shell shows a degraded/offline banner when the backend is not answering
or health reports `degraded`. The banner links to `/dash` and `/remote` where
relevant. It is intentionally not a rail entry: it is a page you open when
something looks wrong.

## Modification guide

| Change | Touch |
|---|---|
| Add a health field | `backend/api/main.py` health route, `Dashboard.jsx` |
| Change degraded rules | health route (`broken` vs `waiting`) |
| Change availability probing | `backend/runtime/availability.py` |
| Change the banner | `frontend/src/App.jsx`, store |
| Change git status | `GET /api/git-status` |

Rules:

- Every line on the page must come from the response.
- Keep “awaiting sign-in” distinct from “broken”.
- Do not count a throwaway registry; use the live one.
- Do not hide an unavailable provider. Show it with the reason.

## Known issues

- `/api/health` surveys providers and can be slower than `/api/ping`. Use
  `/api/ping` for liveness, not health.
- `mcp_reconciled` is process-local. A fresh process reports false until the
  boot connector task completes.
- The page shows the workspace git status, which may be a repository other than
  the one the user expects if the workspace changed.
- Status is not a metrics system. There is no history, alerting or retention.

## Related

- [BACKEND.md](../BACKEND.md)
- [systems/model-providers.md](../systems/model-providers.md)
- [systems/background-jobs.md](../systems/background-jobs.md)
- [sections/logs.md](logs.md)
- [FRONTEND.md](../FRONTEND.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
