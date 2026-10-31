# Authentication and Trust

How AMETHYST decides who may call what: local trust, paired-device tokens,
permission scopes, OAuth, and the keychain.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [sections/remote-mobile.md](../sections/remote-mobile.md),
[systems/sync.md](sync.md), [MCP-INTEGRATIONS.md](../MCP-INTEGRATIONS.md).

## Model

AMETHYST is single-user and local-first. The primary boundary is the operating
system account, not an application login. That holds while the server binds to
loopback. It stops holding the moment someone runs `--host 0.0.0.0` to reach the
app from a phone.

`RemoteCallerGuard` (`backend/api/main.py`) is the smallest thing that makes a
wide bind survivable:

- Static frontend files are public.
- `/api/ping` is public: it says only that a backend exists.
- `/api/pair/claim` is public by necessity: a device with no credential is what
  it exists to give one to. The 160-bit pair secret is the only thing that opens
  it.
- Every other `/api/*` request from a non-local caller without a valid token is
  403, not 404.
- A supplied token is always checked, including over loopback.
- Requests carrying proxy headers cannot inherit local trust.

This guard does nothing behind a reverse proxy, where every request arrives
from loopback. In that deployment the proxy owns authentication.

## Device tokens

Pairing creates a device row:

- `devices.id` — stable device id.
- `token_hash` — SHA-256 of the token; the plaintext is shown once.
- `role` — `control` for a companion.
- `permissions` — JSON map of capability to boolean.
- `revoked_at` — soft revoke.
- `last_seen_at` — liveness.

`devices.authenticate(conn, token)` hashes the presented token and looks up an
unrevoked row. Rate limiting is applied to failed attempts.

`allowed(device, permission)` requires:

- device exists and is not revoked,
- role is `control`,
- the route has a mapped permission,
- the permission is granted (or is the special `paired` capability).

`current_device(scope)` re-reads the row so an open socket does not retain a
permission that was revoked after the socket opened.

## Route-to-permission map

`backend/security/remote_access.py` is an explicit allowlist. A new route is not
reachable by a paired device until it is added here. Local administration is
deliberately absent.

Examples:

```text
/api/remote/screenshot          screen
/api/remote/input/*             input
/api/remote/files*              files
/api/conversations/*/turn       agent
/api/library*                   library
/api/widgets/*                  dashboard
/api/terminal/*                 terminal
/api/remote/ws                  paired (frames checked individually)
```

WebSocket frames are checked separately (`frame_capability`), because one
socket can carry microphone audio, input events or control messages.

## Permission defaults

`DEFAULT_PERMISSIONS` in `backend/sync/devices.py`:

```text
terminal False  root False  screen False  webcam False  mic False
audio False  files False  input False  power False  clipboard False
system False  agent True  library True  dashboard True
```

A missing field in an older grant is not permission to use a new API.

## Pairing secret and group key

- `new_pair_secret()` creates a 160-bit secret.
- `pair_key(secret)` derives the sealing key.
- The QR payload carries the relay URL, LAN host URL and secret.
- The offer and answer are sealed with the pair key; the relay sees ciphertext.
- On approval the host mints the device and the group key.
- The group key is used for sync ops, not for device auth.

See [systems/sync.md](sync.md) for the op crypto.

## OAuth

Two OAuth flows are implemented outside MCP:

| Provider | Module | Routes |
|---|---|---|
| OpenRouter | `backend/auth/openrouter.py` | `/api/auth/openrouter/*` |
| Microsoft | `backend/auth/microsoft.py` | `/api/auth/microsoft/*` |

Both use a start → browser callback → poll pattern. State is validated. Tokens
are stored through `backend/secrets.py`.

MCP OAuth is separate: `backend/mcp/oauth.py` runs a loopback callback and
stores tokens in the keychain.

## Secrets

`backend/secrets.py` (ADR-0012):

- Default store: OS keychain through `keyring`, service `amethyst`.
- Headless/container fallback: `AMETHYST_SECRETS_FILE` JSON store, only when
  explicitly enabled.
- No silent downgrade from keychain to file.
- `resolve_api_key(ref, env)` checks the keychain reference first, then an
  environment variable.
- `redact(value)` removes secret-looking values before logs and audit rows.

References look like `amethyst/openai`. `providers.yaml` and `mcp.yaml` store
references, not values.

## Threat boundaries

| Boundary | Defended |
|---|---|
| Another OS user on the same machine | No. The OS account is the boundary. |
| A device on the LAN without a token | Yes, when the guard is active. |
| A paired device without a permission | Yes, per-route and per-frame. |
| A revoked device | Yes, on the next request and on socket re-check. |
| The relay | Yes for sync: it holds ciphertext and cannot forge an op. |
| A malicious MCP server | Partially: risk classification and confirmation, not sandboxing of the server process. |
| A reverse proxy deployment | Not by this guard; the proxy must authenticate. |

## Modification guide

| Change | Touch |
|---|---|
| Add a remote-reachable route | `remote_access.capability`, a permission, a test |
| Add a permission | `DEFAULT_PERMISSIONS`, UI, route checks |
| Change the guard | `RemoteCallerGuard`, `_PUBLIC_PATHS`, tests |
| Change token storage | `backend/sync/devices.py` |
| Change secret storage | `backend/secrets.py`, `AMETHYST_SECRETS_FILE` handling |
| Add an OAuth provider | `backend/auth/`, start/callback/poll routes |

Rules:

- Default new permissions to `False`.
- Never add a route to `_PUBLIC_PATHS` unless it is safe with no credential.
- Never store a plaintext token; store its hash.
- Never log a secret; use `redact`.
- Check the token even on loopback if one was supplied.
- A WebSocket must re-check permissions, not only at connect time.

## Known issues

- The guard is not authentication for a reverse-proxy deployment.
- `role == "control"` is required for remote access; there is no other remote
  role implemented.
- A local process can call the full API. That is by design.
- MCP server processes are trusted once configured. Risk classification limits
  what the agent does with their tools, not what the server binary can do.
- `AMETHYST_SECRETS_FILE` is a deliberate weaker store. Use it only on a host
  with no keychain.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
