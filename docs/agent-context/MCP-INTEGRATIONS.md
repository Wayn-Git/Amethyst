# MCP, Connectors and Skills

How AMETHYST reaches external tools: local MCP servers, the hosted Composio
gateway, and filesystem skills. These are three different mechanisms with
different trust and lifecycle rules. Do not treat them as one system.

**Verified 2026-11-04 · commit `f52a7d1` · dirty working tree.**

Related: [AGENT-SYSTEM.md](AGENT-SYSTEM.md) for how tools enter a turn,
[systems/tool-execution.md](systems/tool-execution.md) for the dispatch path,
[systems/auth.md](systems/auth.md) for credentials, and
[sections/capabilities.md](sections/capabilities.md) for the UI.

## Three integration planes

| Plane | What it is | Transport | Owner code |
|---|---|---|---|
| Local MCP | A subprocess or HTTP server the user configures | stdio, SSE, streamable HTTP | `backend/mcp/` |
| Composio | Hosted tool gateway with OAuth-managed app accounts | HTTPS through `composio` pseudo-server | `backend/mcp/composio_service.py` |
| Skills | Directories with `SKILL.md`, read on demand | Filesystem | `backend/skills/` |

The first two register tools in the same flat `ToolRegistry`. Skills do not
register tools: the model reads a skill body with `skill_view` (or the ordinary
`view_file` tool) when it decides the skill applies. There is no `invoke_skill`
tool by design (`backend/skills/loader.py`).

## Local MCP servers

### Configuration

Servers live in `~/.amethyst/config/mcp.yaml` under `mcpServers`. A one-click
add from the catalogue writes an ordinary entry the user can edit or delete.

```yaml
mcpServers:
  playwright:
    transport: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
  github:
    transport: streamable-http
    url: https://api.githubcopilot.com/mcp/
    oauth: true
```

`backend/mcp/config.py` defines the accepted fields:

- Transports: `stdio`, `sse`, `streamable-http`.
- stdio: `command`, `args`, `env`, `cwd`.
- HTTP: `url`, `headers`, `allow_local`.
- Auth: `oauth`, `oauth_client_id`, `oauth_client_secret_ref`, `oauth_scopes`,
  `api_key_ref`, `api_key_header`, `api_key_query_param`.
- Behaviour: `enabled`, `startup`, `timeout_seconds` (default 180),
  `auth_timeout_seconds` (default 300), `source`, `catalogue_id`, `account`.
- Secrets: `${VAR}` interpolates from the environment. `keychain:<ref>` in an
  env value resolves from the OS keychain at spawn time. Prefer
  `api_key_ref: amethyst/<name>` over a literal token.

Two trust categories exist, both full trust: `configured` (user-written) and
`bundled` (added from the catalogue). The administrator and the user are the
same person, so there is no restricted tier.

### Catalogue

`backend/mcp/catalogue.py` holds curated entries with an `auth` kind:

- `none` — works immediately.
- `oauth` — clicking through reaches the provider login page.
- `setup` — needs credentials or a local file first.

`runtime` declares an external dependency such as Node, `uv`, ffmpeg,
OpenCode or CUA. Adding an entry does not install that dependency.

### Lifecycle

`MCPManager` (`backend/mcp/manager.py`) owns connections, tool discovery and
reconnection.

1. `load_servers()` reads and validates `mcp.yaml`.
2. The lifespan starts configured servers, bounded by
   `STARTUP_DEADLINE_SECONDS = 30.0`. Startup does not block the API for
   longer than that.
3. Discovery registers each tool as `<tool>__mcp__<server>` in the flat
   registry, with `source=ToolSource.MCP` and `server_name` set.
4. `reconcile()` diffs config against live state: starts new servers, stops
   removed ones, rebinds the registry when the workspace changes.
5. A server becomes `ready` when its tools are present. It is demoted only
   after three consecutive hard failures or when its tools disappear
   (`is_ready`). A single transient error does not mark a working connector
   failed.

`backend/mcp/lifecycle.py` derives one named state per connector:
`Adding → Setting up → Authenticating → Syncing → Ready`, with `Failed` as a
branch. Each state carries one `action` (`connect`, `sign_in`, `credentials`,
`sync`, `retry`) or `None` when waiting is correct. The API and UI consume this
derivation instead of reimplementing it in JSX.

`backend/mcp/status.py` defines the lower-level, mutually exclusive states:
`not_configured`, `off`, `starting`, `connecting`, `auth_required`,
`authenticating`, `connected`, `disconnected`, `account_mismatch`,
`auth_error`, `token_expired`, `server_error`, `unavailable`,
`health_check_failed`, `tool_execution_error`.

### OAuth and credentials

`backend/mcp/oauth.py` wires the MCP SDK OAuth client to:

- a fixed loopback callback (`CALLBACK_BIND:CALLBACK_PORT`, redirect URI baked
  into the registered client),
- the OS keychain for tokens and client secrets,
- a five-minute interactive sign-in window.

Only one authorization wait can hold the loopback port at a time. Multiple
concurrent sign-ins queue rather than overwrite each other's redirect. Docker
requires the callback to be reachable from the host; see the module comment.

`backend/mcp/commands.py` implements the CLI-facing operations: catalogue
listing, add/remove, OAuth client registration, env secrets, login/logout,
account counting, and connect-and-report. It rejects implausible client IDs and
credentials before storing them.

### Tool risk

`backend/mcp/risk.py` classifies discovered tools instead of treating every MCP
tool as `MEDIUM`:

1. Server-declared annotations: `destructiveHint` → HIGH, `readOnlyHint` → LOW,
   anything else declared → MEDIUM.
2. Name heuristics only when nothing is declared: leading `get_`, `list_`,
   `search_`, `read_`, `fetch_`, `find_`, `describe_`, `query_`, `show_`,
   `view_`, `check_`, `count_` read; leading `delete_`, `remove_` destroy.

The name can raise a declared rating, never lower it. An unmatched tool stays
MEDIUM: unknown is not safe.

## Composio

Composio is a hosted gateway for app toolkits such as Gmail, Google Calendar,
GitHub and Spotify. `backend/mcp/composio_service.py` manages the account and
toolkit catalogue; `ComposioService.is_configured()` decides whether the plane
is active.

Key behaviours:

- Meta-tools are always visible with full schemas. Individual toolkit tools are
  discovered on demand and cached.
- `FAST_LANE_CONFIG` pins a small set of high-value tool slugs per toolkit so
  common reads do not need a discovery round trip. `FAST_LANE_TTL` is one hour.
- Tool arguments are normalized before schema validation:
  `normalize_composio_search_tools_args`,
  `normalize_composio_multi_execute_args`,
  `normalize_composio_remote_workbench_args`.
- Results are sanitized by `backend/mcp/composio_sanitizer.py` before entering
  model context.

### Provider ownership

`backend/mcp/provider_ownership.py` enforces one owner per provider. When a
local MCP server for a provider is configured and signed in, local takes
ownership and the matching Composio toolkit is withheld and hidden.

```text
gmail            -> google-workspace, google-gmail
googlecalendar   -> google-workspace, google-calendar
github           -> github
spotify          -> spotify
```

Builtin local tools also suppress their Composio equivalents (`search_email`,
`send_email`, calendar tools).

### Connection gate

`backend/mcp/connection_gate.py` turns a missing app connection into an
interactive card instead of a model-relayed error. `wait_for_connection()`
publishes `connection_required`, parks the turn for up to
`CONNECTION_WAIT_SECONDS` (default 600), and resumes when the UI connects the
app, the turn stops, or the wait expires. Identical waits join rather than
stack. Subagents and batch paths never wait: they get the error back.

## HTTP surface

MCP management routes in `backend/api/main.py`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/mcp/catalogue` | Curated servers to add |
| GET | `/api/mcp/servers` | Configured servers with state |
| POST | `/api/mcp/servers` | Add from catalogue or custom |
| PATCH/PUT | `/api/mcp/servers/{name}` | Edit an entry |
| DELETE | `/api/mcp/servers/{name}` | Remove server and credentials |
| POST | `/api/mcp/servers/{name}/test` | Probe connection |
| POST | `/api/mcp/servers/import` | Import client configuration |
| POST | `/api/mcp/servers/{name}/oauth-client` | Store OAuth client |
| POST | `/api/mcp/servers/{name}/api-key` | Store API key |
| POST/DELETE | `/api/mcp/servers/{name}/env[/{key}]` | Manage env secrets |
| POST | `/api/mcp/servers/{name}/login` | Start sign-in (202) |
| DELETE | `/api/mcp/servers/{name}/login` | Cancel sign-in |
| POST | `/api/mcp/servers/{name}/logout` | Forget account |
| GET | `/api/mcp/authorizations` | Pending authorization URLs |
| POST | `/api/mcp/servers/{name}/connect` | Connect and report tools |
| POST | `/api/mcp/reconcile` | Reconcile all servers |

Composio and capability routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/connectors/catalog` | Composio toolkit catalogue |
| GET | `/api/connectors/connected` | Connected accounts |
| GET | `/api/connectors/tools` | Toolkit tools |
| GET | `/api/connectors` | Connector rows |
| POST | `/api/connectors/{slug}/authorize` | Start app OAuth |
| DELETE | `/api/connectors/{slug}` | Disconnect toolkit |
| DELETE | `/api/connectors/{slug}/accounts/{account_id}` | Remove one account |
| POST | `/api/connectors/{slug}/test` | Probe toolkit |
| GET | `/api/capabilities` | Unified capability overview |
| GET/POST | `/api/capabilities/profiles[/{name}/apply]` | Named connector sets |
| POST/DELETE | `/api/capabilities/{kind}/{name}` | Toggle a capability |

`/api/capabilities` merges declared configuration with live manager state.
A connector row's `live` field is authoritative about what is running now.

## Skills

A skill is a directory with `SKILL.md`. Discovery caches name, description and
path only; the body is read on demand (progressive disclosure).

- Roots include bundled skills under `backend/skills/builtin/`, the repository
  `agents/skills/`, and the user's `~/.amethyst/skills/`.
- `NAME_RE` requires lowercase alphanumeric with hyphens, 1–64 characters.
- Frontmatter is YAML between `---` fences.
- `SCAN_TTL_SECONDS = 5.0`; install, remove and agent writes call
  `forget_scan_cache()`.
- `backend/skills/install.py` handles installation; `catalogue.py` lists
  available skills.
- `backend/skills/manage.py` handles agent and in-app writes: create, patch,
  replace, support files, archive, restore. Removes archive to
  `skills/.archive/`; never hard-delete.
- `backend/skills/usage.py` keeps the `.usage.json` sidecar (`use_count`,
  `view_count`, `patch_count`, `state`, `pinned`, `locked`, `created_by`).
- `backend/skills/curator.py` ages agent-created skills: stale at 14 days
  unused, archived at 30. Deterministic, no model, protected by pin, lock,
  `.seeded`, age and automation references.
- Routes: `GET /api/skills`, `/api/skills/search`, `/api/skills/catalogue`,
  `/api/skills/archived`, `/api/skills/curator`,
  `POST /api/skills/install`, `POST /api/skills/create`,
  `POST /api/skills/curator/run`, `POST /api/skills/{name}/state`,
  `POST /api/skills/{name}/flags`, `POST /api/skills/{name}/restore`,
  `DELETE /api/skills/{name}` (archives).
- Agent tools: `skills_list`, `skill_view`, `skill_manage`. A patch requires a
  read in the same turn; locked skills refuse writes.

The post-turn review proposes new skills in `learning_proposals`; approval
writes through `manage.create`. See
[sections/capabilities.md](sections/capabilities.md#learning-proposals).

Skills grant no execution authority by themselves. Anything a skill tells the
model to do still passes the ordinary tool registry and permission gate.

## Modification guide

| Change | Touch |
|---|---|
| Add a curated MCP server | `backend/mcp/catalogue.py`, then test add/login in the UI |
| Change MCP config fields | `backend/mcp/config.py`, `mcp.yaml` template, API payloads, tests |
| Change connection state names | `backend/mcp/status.py` and `lifecycle.py`; update the UI consumer |
| Change tool naming | `backend/tools/registry.py` (`MCP_DELIMITER`, capability map) and `manager.py` |
| Change MCP risk rules | `backend/mcp/risk.py`; add cases to tests |
| Change Composio behaviour | `backend/mcp/composio_service.py`; check `provider_ownership.py` |
| Change connector UI | `frontend/src/views/capabilities/`, `frontend/src/views/settings/Integrations.jsx` |
| Change skills discovery | `backend/skills/loader.py`; keep the 5s cache contract |

Rules:

- A new MCP tool must arrive through discovery. Do not hand-register a tool with
  `source=MCP` unless it is a deliberate builtin.
- Never bypass `MCPManager` to spawn a server.
- Never write a token into `mcp.yaml`. Use `api_key_ref` or `keychain:`.
- Keep the capability-name contract stable: the frontend, CLI and API all read
  the same names.
- `composio` is a pseudo-server. Special cases keyed on its name are expected,
  but keep them in the Composio modules rather than spreading them.

## Known issues and drift

- README and older docs describe MCP as an undifferentiated `MEDIUM` risk tier.
  Current code classifies by annotations and names (`backend/mcp/risk.py`).
- ADR-0007 describes the original two-tier trust model. The implementation adds
  catalogue entries, lifecycle derivation, account matching and provider
  ownership on top of it.
- The `composio` pseudo-server bypasses the normal transport lifecycle. Its
  state comes from the Composio service, not from a subprocess connection.
- `mcp.yaml` is read at reconcile time. Editing it by hand while the app runs
  requires `POST /api/mcp/reconcile` or a restart to take effect.

_Last verified: 2026-11-04 · commit `f52a7d1` · dirty working tree._
