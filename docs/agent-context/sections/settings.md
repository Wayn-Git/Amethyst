# Settings

The preferences and administration page at `/settings`. It is a large,
section-based screen covering personal preferences, model providers, devices,
permissions and integrations.

**Verified 2026-11-04 · commit `f52a7d1` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Settings.jsx` |
| Sub-views | `frontend/src/views/settings/Integrations.jsx`, `Configuration.jsx`, `Storage.jsx` |
| Client | `frontend/src/api.js` → `api.settings`, `api.updateSettings`, `api.preferences`, `api.providers`, `api.tiers`, `api.devices` |
| Routes | `/api/settings`, `/api/preferences`, `/api/providers`, `/api/tiers`, `/api/devices`, `/api/confirmations/preferences` |
| Config | `backend/config.py`, `~/.amethyst/config/providers.yaml` |
| State | `frontend/src/store.jsx` |

## Sections

| Id | Group | Covers |
|---|---|---|
| `general` | Personal | Workspace, external editor, window behaviour, speed, composer, confetti |
| `configuration` | Personal | Approval policy, sandbox, web search, reasoning effort, workspace tools |
| `storage` | Personal | Disk usage, chat cleanup, worktrees, archived conversations |
| `notifications` | Personal | Desktop alerts, sound, turn completion, briefing, BoardUI |
| `shortcuts` | Personal | Keyboard shortcuts, global launcher hotkey |
| `appearance` | Personal | Themes, accent, text scaling, loader, glass |
| `profile` | Personal | Display name, full name, email, avatar |
| `usage` | Personal | Token usage, provider telemetry, latency |
| `activity` | Personal | Recent tasks, session turns, audit log |
| `data` | Personal | Local storage, compaction, clear memories, reset preferences |
| `integrations` | Integrations | MCP servers, Composio, search providers, notifier |
| `models` | Integrations | Providers, API keys, tiers, Ollama, post-turn learning |
| `devices` | Integrations | Pairing, device permissions, sync |
| `permissions` | Coding | Guards, shell/file/network confirmation |
| `about` | Coding | Version, licenses, acknowledgements |

The page is driven by the `SECTIONS` array. Settings links are filtered by
`forSettings(beta)` from `frontend/src/nav.js`.

## Preferences

Two different stores:

1. **Server settings** (`/api/settings`) — durable application settings.
2. **Synced preferences** (`/api/preferences`) — the allowlisted UI preferences
   that follow the user between devices.

`PATCH /api/preferences` validates names against `SYNCED_PREFERENCES` and
writes `app_settings` plus a sync op in one transaction. Per-device values
(`panelWidth`, `sidebar`, `textSize`, `activeId`, `workspace`) are deliberately
excluded.

A local preference that should follow devices must be added to
`backend/sync/registry.py`; otherwise the endpoint returns 400 listing the
allowed names.

## Providers and tiers

- `GET/POST /api/providers` — list and add.
- `PATCH /api/providers/{name}` — enable/disable.
- `POST /api/providers/{name}/ping` and `/ping-all` — health probes.
- `POST /api/providers/warmup` — pre-load a model.
- `GET /api/providers/{name}/models` — model list.
- `POST /api/providers/{name}/verify` — verify a key.
- `GET/PUT/DELETE /api/tiers[/{tier}]` — tier to model mapping.

Provider keys are stored by reference in the OS keychain. `providers.yaml`
holds names, endpoints and model lists, not secrets.

## Post-turn learning

`LearningEditor` in the `models` section controls `learning:` in
`providers.yaml`:

- `GET /api/learning` — settings, pending proposals and counts.
- `POST /api/learning/settings` — `enabled`, optional `provider` + `model`.
- `POST /api/learning/proposals/{id}/approve` and `/reject`.

The feature is off by default. When on, the reviewer model is the configured
one, else the memory model, else the `fast` tier, else the model that answered
the turn. Name both a provider and a model or neither; the route refuses half a
pair. Proposals are approved in Capabilities → Skills, not here — the switch and
the count live in Settings, the decision lives next to the skills it changes.

## Permissions

`frontend/src/views/Settings.jsx` Permissions section controls:

- Default guard.
- Shell confirmation.
- Filesystem confirmation.
- Network gate.
- Standing approvals (per operation key).
- Sandbox settings.

Standing approvals are listed from `/api/confirmations/preferences` and can be
revoked individually or all at once. Approving a read never approves a write:
the operation key, not the tool name, is the unit.

## Devices

`Devices` section:

- List paired devices with role, last seen and permissions.
- Pair a device (LAN or relay).
- Approve/reject pending requests.
- Edit permissions per device.
- Revoke a device.
- Show the host app URL for pairing links.

See [sections/remote-mobile.md](remote-mobile.md) and
[systems/sync.md](../systems/sync.md).

## Integrations

`settings/Integrations.jsx` covers:

- Search provider preference and API keys.
- Composio status, toolkits, login, API key.
- Notifier recipient and AgentMail settings.
- MCP server management is shared with `/capabilities`.

This is a second management surface for connectors. Keep it consistent with
`/capabilities`; do not duplicate state derivation.

## Modification guide

| Change | Touch |
|---|---|
| Add a section | `SECTIONS`, render branch, nav link if needed |
| Add a preference | `store.jsx`, `/api/settings` or `SYNCED_PREFERENCES` |
| Add a provider field | `backend/config.py`, provider routes, `Models` section |
| Change learning settings | `backend/config.py`, `/api/learning*`, `LearningEditor` |
| Add a permission | `backend/security/confirmation.py`, Permissions section |
| Change device controls | `Devices`, `/api/devices*` |
| Change theme tokens | `frontend/src/index.css`, `globals.css`, `store.jsx` |

Rules:

- Do not store secrets in `providers.yaml` or `app_settings`.
- A preference that follows devices must be allowlisted.
- Keep the section ids stable; deep links and tests use them.
- Server-derived values must come from the server, not be recomputed in JSX.

## Known issues

- `Settings.jsx` is one of the largest files in the frontend. Prefer extracting
  a section into `views/settings/` before adding another block.
- Connector management exists in both Settings and `/capabilities`.
- `docs/ui-design-system.md` describes an older token set. Current tokens are
  in `frontend/src/index.css`, `frontend/src/globals.css` and
  `frontend/src/motion.js`.
- Some settings are per-device and some sync. The UI does not always label
  which is which.

## Related

- [systems/state.md](../systems/state.md)
- [systems/auth.md](../systems/auth.md)
- [systems/model-providers.md](../systems/model-providers.md)
- [sections/capabilities.md](capabilities.md)
- [sections/remote-mobile.md](remote-mobile.md)

_Last verified: 2026-11-04 · commit `f52a7d1` · dirty working tree._
