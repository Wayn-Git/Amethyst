# Remote and Mobile

The phone companion and remote-control surfaces: `/pair`, `/remote`, the
Capacitor app, and the `/api/remote/*` backend.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| Pairing view | `frontend/src/views/Pair.jsx` |
| Remote view | `frontend/src/views/Remote.jsx` |
| Phone frame | `frontend/src/views/RemoteOnly.jsx` |
| Companion tabs | `frontend/src/mobile/Companion.jsx` |
| Sync client | `frontend/src/lib/sync/client.js` |
| Crypto | `frontend/src/lib/sync/crypto.js`, `hlc.js`, `keystore.js` |
| Remote subviews | `frontend/src/views/remote/` |
| Backend remote | `backend/remote/` |
| Pairing/sync | `backend/sync/` |
| Mobile captures | `backend/remote/captures.py` |
| App shell | `frontend/capacitor.config.json`, `frontend/android`, `frontend/ios` |

## Pairing

The host opens a pairing window and shows a QR code. The payload carries the
relay URL, a LAN host URL and a pair secret. Three ways in:

1. The phone's camera app opens the `https://.../pair#s=...` link.
2. The in-app scanner reads the QR.
3. The code is typed.

Direct LAN pairing calls `POST /api/pair/claim`; the phone polls
`GET /api/pair/claim?request_id=...` while the host approves. Relay pairing
uses the Cloudflare Worker's pairing endpoints. Both paths seal the offer with a
key derived from the pair secret, so neither the relay nor the LAN sees the
plaintext.

On approval the host mints a device id, a token (shown once, stored hashed) and
a group key. The phone adopts the identity and key.

## Permissions

`DEFAULT_PERMISSIONS` in `backend/sync/devices.py`:

```text
terminal  root  screen  webcam  mic  audio  files  input  power
clipboard  system  agent  library  dashboard
```

Defaults are `False` for the invasive capabilities and `True` for `agent`,
`library` and `dashboard`. A missing field in an older grant is not permission
to use a new API. `backend/security/remote_access.py` checks the grant on every
call and re-reads it so an open socket does not retain a revoked permission.

## Remote API

`backend/remote/router.py` under `/api/remote`:

| Area | Routes |
|---|---|
| Capabilities | `GET /capabilities` |
| System | `GET /status`, `/processes`, `/applications`, `POST /command` |
| Media | `GET /media`, `POST /media/*` |
| Power | `POST /power/{action}`, `GET /power/wake` |
| Input | `POST /input/mouse`, `/input/keyboard` |
| Clipboard | `GET/POST /clipboard` |
| Screen | `GET /screenshot`, `GET /screen/stream` |
| Camera | `GET /camera/*` |
| Files | `GET/POST/DELETE /files*` |
| Drafts | `POST /actions/{draft_id}/decision` |
| Terminal | `WS /ws` |

Every route requires an authenticated device token and the matching permission.
`RemoteCallerGuard` rejects non-loopback callers without a token. The terminal
WebSocket checks permission on each message.

`GET /api/remote/capabilities` reports what the host can actually do. For
example, screen capture is unavailable on Wayland or without ffmpeg, and
`wake_available` is currently false.

## Mobile app

Capacitor config:

```json
{
  "appId": "app.amethyst.companion",
  "appName": "Amethyst",
  "webDir": "dist",
  "server": { "androidScheme": "https" }
}
```

Build and open:

```bash
cd frontend
npm run mobile:sync
npm run mobile:android
npm run mobile:ios
```

Companion tabs: `today`, `library`, `agent`, `activity`, `devices`. It reads
through the sync replica and the remote API, caches snapshots in native
storage, and queues captures when offline.

- `frontend/src/mobile/captures.js` — durable capture queue.
- `frontend/src/mobile/storage.js` — snapshot and record storage.
- `frontend/src/mobile/native.js` — native bridges.
- `frontend/src/mobile/updates.js` — Android APK update flow.
- `POST /api/mobile/captures` — 202, durable job, re-checks library permission.
- `GET /api/mobile/update` and `/apk` — update metadata and download.

`startup.js` shows a recovery panel if the bundle or native storage fails to
load within 15 seconds.

## Phone routing

`App.jsx` decides the frame:

- Unpaired + pair intent → `Pair`.
- Paired on a phone → `RemoteOnly`.
- Paired on desktop → the normal workbench, with `Remote` available as a page.
- Backend down or `remoteFirst` → the phone frame rather than a dead workbench.

A revoked device is detected by a 401 from sync (`reason: 'revoked'`) and shown
as the end of the pairing, not as a temporary failure.

## Sync

The phone holds a replica and exchanges sealed ops through the relay. See
[systems/sync.md](../systems/sync.md) for the op format, HLC merge and
allowlists. The short version:

- Pairing establishes the group key.
- Every synced write goes to an outbox and is sealed.
- Ops are acknowledged on the next poll.
- Merge is per-field last-write-wins by HLC.
- Transcripts are published by a watermark sweep.

## Modification guide

| Change | Touch |
|---|---|
| Add a permission | `DEFAULT_PERMISSIONS`, `remote_access`, the remote route, Settings UI |
| Add a remote action | `backend/remote/`, router, permission check, phone view |
| Change pairing | `backend/sync/devices.py`, `relay/src/pairing.ts`, `client.js`, `Pair.jsx` |
| Change the phone frame | `RemoteOnly.jsx`, `Companion.jsx` |
| Change capture queue | `mobile/captures.js`, `backend/remote/captures.py` |
| Change mobile build | `capacitor.config.json`, `package.json` scripts |
| Change updates | `mobile/updates.js`, `backend/remote/updates.py` |

Rules:

- Every remote route checks a permission. There is no “paired means allowed”.
- New permissions default to `False`.
- Never send plaintext through the relay.
- A revoked device must fail closed and say so.
- Keep the phone frame separate from the desktop workbench. A phone cannot
  render the rail, artifact panel or terminal drawer.

## Known issues

- Two pairing transports (direct LAN and relay) must stay behaviorally
  compatible. A change to one needs a test for the other.
- Screen capture is unavailable on Wayland. The capability response says so,
  but the UI must not offer a dead button.
- The mobile app is a Capacitor wrapper around the web bundle. A web change can
  break native startup; run the mobile tests.
- `frontend/src/views/Remote.jsx` and `RemoteOnly.jsx` serve different frames.
  Check which one a change targets.

## Related

- [systems/sync.md](../systems/sync.md)
- [systems/auth.md](../systems/auth.md)
- [systems/desktop.md](../systems/desktop.md)
- [FRONTEND.md](../FRONTEND.md)
- [sections/settings.md](settings.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
