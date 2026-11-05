# Capabilities

The skills and connectors page at `/capabilities`. One page, two tabs: what the
agent can read, and what it can reach.

**Verified 2026-11-04 · commit `f52a7d1` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Capabilities.jsx` |
| Tabs | `frontend/src/views/capabilities/SkillsTab.jsx`, `ConnectorsTab.jsx` |
| Client | `frontend/src/api.js` → `api.capabilities`, `api.toggleCapability`, `api.capabilityProfiles`, `api.skills`, `api.skillCurator`, `api.learning`, `api.mcpServers` |
| Routes | `/api/capabilities*`, `/api/skills*`, `/api/learning*`, `/api/mcp/*`, `/api/connectors/*` |
| Service | `backend/capabilities.py`, `backend/learning/` |
| Skills | `backend/skills/` |
| MCP | `backend/mcp/` |
| Connectors | `backend/mcp/composio_service.py` |

## UI structure

Top bar: tab switch, search, add action.

**Skills tab**

- Installed skills with name, description, version and badges: engaged,
  installed, stale, archived, pinned, locked, builtin, agent, use count.
- Catalogue search and install.
- Create a skill.
- Archive (reversible), restore, pin, lock, engage/stand down.
- Filters: All, Installed, Not installed, Archived.
- Curator bar: thresholds, last pass, "Run now".
- Pending learning proposals with Approve/Reject.

Archive replaced Uninstall. The backend moves the directory to
`skills/.archive/<timestamp>/<name>/`; restore moves the newest copy back.
A proposal is not a skill until approved.

**Connectors tab**

- One row per connector: local MCP server, Composio toolkit, or builtin.
- Derived state and the single next action.
- Tool count and live connection state.
- Add from catalogue, custom MCP server, import config.
- OAuth sign-in, API key, environment variables, logout, remove.
- Profiles: named sets of connectors applied to a conversation.

The page deliberately merges “add” and “manage”. They used to be separate
surfaces, which produced two cards for one connector with different controls.

## Capability model

`backend/capabilities.py` defines a `Capability` with a `Kind`:

- `SKILL`
- `CONNECTOR`
- `TOOL` (where relevant)

`CapabilityService.overview(conversation_id)` returns grouped rows. Connector
rows are merged with live `MCPManager.state()` in `GET /api/capabilities`, so a
row's `live` field is authoritative about what is running now.

Profiles are stored in `capability_profiles`. Applying a profile enables or
disables the listed connectors for a conversation, which is cheaper than
toggling each one by hand.

## Connector states

`backend/mcp/lifecycle.py` derives one state and one action per connector:

```text
Adding -> Setting up -> Authenticating -> Syncing -> Ready
                                       \-> Failed (retry)
```

Actions: `connect`, `sign_in`, `credentials`, `sync`, `retry`, or `None` when
waiting is correct. `backend/mcp/status.py` defines the lower-level states
(`connected`, `auth_required`, `token_expired`, `account_mismatch`, and so on).

The UI must render the derived state, not recompute it from five booleans.

## Skills

- A skill is a directory with `SKILL.md`.
- Discovery caches name, description and path; the body is read on demand.
- Install, create, archive, restore, pin, lock and state changes go through
  `/api/skills/*`.
- Skills grant no execution authority. Tool calls still pass the registry and
  permission gate.

### Agent writes

The agent writes skills through `skill_manage` (`backend/tools/builtin/skills.py`
→ `backend/skills/manage.py`). The rules enforced at the write:

- the name is a slug and matches the frontmatter name;
- `patch` replaces a span that occurs exactly once;
- a patch requires `skill_view` earlier in the same turn, and locked skills
  refuse edits;
- support files stay under `references/`, `templates/`, `scripts/` or `assets/`;
- removes archive rather than delete.

`skills_list` and `skill_view` are read tools; `skill_manage` carries actions
`create`, `patch`, `replace`, `write_file`, `remove_file`, `archive`, `restore`.

### Usage and curation

`backend/skills/usage.py` keeps a `.usage.json` sidecar per library with
`use_count`, `view_count`, `patch_count`, `created_by`, `state`, `pinned`,
`locked`, timestamps. `/skill` invocation and agent reads bump the counters.

`backend/skills/curator.py` is deterministic and daily:

- `active` → `stale` after 14 days unused;
- `stale` → `archived` after 30 days unused, directory moved to the archive;
- used again inside the stale window → `active`.

It only manages skills whose `created_by` is `agent`. Pinned, locked, `.seeded`
builtins, automation-referenced skills and skills younger than 7 days are never
touched. Reports land in `logs/curator/<timestamp>/run.json` and `REPORT.md`.
No LLM is in this loop.

The curate job runs on the `skills_curator` lane; the API exposes
`GET /api/skills/curator`, `POST /api/skills/curator/run`,
`GET /api/skills/archived`, `POST /api/skills/{name}/state`,
`POST /api/skills/{name}/flags`, `POST /api/skills/{name}/restore`.

### Learning proposals

`backend/learning/` adds the post-turn review. After an eligible turn it asks a
model whether the work produced a reusable skill or a durable fact, and stores
the answer in `learning_proposals` as `pending`. Nothing is written to the skill
library or memory until a person approves it here.

The gate: the feature must be enabled in Settings → Models, the answer must be
at least 160 characters, and the turn must have made a tool call or contain a
correction phrase. A skipped turn costs no model call. Approval applies through
`manage.create` or `MemoryService.apply`, the same paths the rest of the system
uses. See [sections/memory.md](memory.md) and
[sections/settings.md](settings.md).

See [MCP-INTEGRATIONS.md](../MCP-INTEGRATIONS.md) for the full skill contract.

## Data flow

```mermaid
sequenceDiagram
  participant UI as Capabilities
  participant API as /api/capabilities
  participant CAP as CapabilityService
  participant MCP as MCPManager
  UI->>API: GET /api/capabilities?conversation_id=...
  API->>CAP: overview()
  API->>MCP: state()
  API-->>UI: rows + live state
  UI->>API: POST /api/capabilities/{kind}/{name}
  API->>CAP: enable/disable
```

Adding a server is a multi-step flow:

1. `POST /api/mcp/servers` writes `mcp.yaml`.
2. If OAuth is required, `POST /api/mcp/servers/{name}/login` starts the
   loopback flow and returns 202.
3. The UI polls `GET /api/mcp/authorizations` for the provider URL or state.
4. `POST /api/mcp/servers/{name}/connect` or `/api/mcp/reconcile` brings the
   tools in.
5. `GET /api/capabilities` shows the derived state.

Composio toolkits use `/api/connectors/{slug}/authorize` instead.

## Modification guide

| Change | Touch |
|---|---|
| Add a capability kind | `backend/capabilities.py`, API, both tabs |
| Change connector state derivation | `backend/mcp/lifecycle.py`, `status.py` |
| Change a connector card | `ConnectorsTab.jsx`, `settings/Integrations.jsx` |
| Change skills install | `backend/skills/install.py`, `catalogue.py` |
| Change skill writes | `backend/skills/manage.py`, `backend/tools/builtin/skills.py` |
| Change curation thresholds | `backend/skills/curator.py` |
| Change learning review | `backend/learning/review.py`, `service.py` |
| Add a profile action | `CapabilityService`, profile routes, UI |
| Change the catalogue | `backend/mcp/catalogue.py` |

Rules:

- Derive state on the server. Two screens must not disagree.
- Keep one next action per state. A card with no action and no explanation is
  the bug this page was built to fix.
- Do not show “connected” without live evidence.
- A skill is not a connector. Do not merge their storage or permissions.
- Archive, never delete. The archive is the recovery path the report links to.
- The curator runs without a model. Do not add an LLM step to it.
- A learning proposal becomes a skill or a fact only through approval.

## Known issues

- `Integrations.jsx` under Settings also manages Composio and notifier settings.
  Connector management is split between `/capabilities` and
  `/settings?section=integrations`.
- The connector catalogue and the Composio catalogue are different lists. A
  provider can appear in both; provider ownership decides which one is active.
- A connector may be `ready` with zero tools if the server connected but
  exposed nothing. The state derivation reports tool count, so read it.
- OAuth sign-in holds a single loopback port. Two simultaneous sign-ins queue.

## Related

- [MCP-INTEGRATIONS.md](../MCP-INTEGRATIONS.md)
- [systems/auth.md](../systems/auth.md)
- [systems/tool-execution.md](../systems/tool-execution.md)
- [sections/settings.md](settings.md)
- [sections/chat.md](chat.md)

_Last verified: 2026-11-04 · commit `f52a7d1` · dirty working tree._
