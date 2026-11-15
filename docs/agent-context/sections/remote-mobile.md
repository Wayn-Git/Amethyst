# Remote and Mobile

The phone companion and remote-control surfaces: `/pair`, `/remote`, the
Capacitor app, and the `/api/remote/*` backend.

**Verified 2026-11-09 · commit `f6303e8d` · remote library permissions and credential sync.**

## Entry points

| Layer | Path |
|---|---|
| Pairing view | `frontend/src/views/Pair.jsx` |
| Remote view | `frontend/src/views/Remote.jsx` |
| Phone frame | `frontend/src/views/RemoteOnly.jsx` |
| Companion tabs | `frontend/src/mobile/Companion.jsx` |
| Transport manager | `frontend/src/lib/sync/transportManager.js` |
| Sync hook & client | `frontend/src/lib/sync/useSync.js`, `client.js` |
| Connection diagnostics | `frontend/src/mobile/ConnectionDiagnosticsModal.jsx` |
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

### CONTRACT v2 (Self-hosted LAN pairing)

CONTRACT v2 runs zero-relay, self-hosted pairing (`backend/pairing/`):
- QR contains NO keys: base64url JSON `{"v":2, "hosts":[...], "port":<int>, "token":"<128-bit>", "fp":"<SHA-256 cert>", "exp":<ts>}`.
- Ephemeral HTTPS pairing server runs on a free port on LAN only while QR is active.
- Phone POSTs `https://<host>:<port>/pair` with cert pinned by fingerprint.
- Constant-time token verification, burned on first valid use, max 5 attempts lockout, 2-minute lifetime.
- Host prompts "Pair '<device_label>'? Approve / Deny" in UI.
- On Approve, returns bundle `{"device_id", "llm", "composio", "drive", "prompts"}` and shuts server down.
- Auto-captures existing PC LLM providers (`llm.providers[]`, `llm.default`) and main Composio credentials by default. Backward-compatible `llm.provider`, `llm.model`, `llm.api_key` alias default provider.
- Optional hardening setting: "Use separate phone-only keys" (default OFF). When ON, pairing enforces dedicated phone-only LLM and Composio credentials and blocks pairing if missing.
- Approve prompt on PC lists shared provider names/models and Composio account without exposing keys, warning that keys must be rotated if the phone is lost.
- Revoke forgets the device locally, presents checklist of shared provider keys, and states plainly that Revoke does not rotate keys.

## Permissions

`DEFAULT_PERMISSIONS` in `backend/sync/devices.py`:

```text
terminal  root  screen  webcam  mic  audio  files  input  power
clipboard  system  agent  library  dashboard
```

Defaults are `False` for the invasive capabilities and `True` for `agent`,
`library` and `dashboard`. A missing field in an older grant is not permission
to use a new API. `backend/security/remote_access.py` checks the grant on every
call and re-reads it so an open socket does not retain a revoked permission:
- Library read/enrichment/mutation routes (`GET /api/library*`, `POST /api/library/{id}/enrich`, `reindex`, `sync`, `DELETE /api/library/{id}`) require the `library` permission.
- AI transformation routes (`POST /api/ai/transform`) and credentials bundle retrieval (`GET /api/remote/credentials/bundle`) require `paired` access.

## Remote API

`backend/remote/router.py` under `/api/remote`:

| Area | Routes |
|---|---|
| Credentials | `GET /credentials/bundle` |
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

`GET /api/remote/credentials/bundle` provides point-to-point credential synchronization
to authenticated companion devices. Companion clients automatically sync credentials on
WebSocket `credentials_updated` events, app resume (`visibilitychange`), and transport
transitions to `direct` mode, storing updated keys in the mobile secure keystore.

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

Companion tabs: `today`, `tasks`, `library`, `agent`, `pc`, `terminal`, `settings`. Styled with Apple iOS 18 / Liquid-Glass design system (`companion.css`) with frosted glass pill navigation, fluid gesture/view transitions (`framer-motion`), and live backend data (no mock data). It reads
through the sync replica and the remote API, caches snapshots in native
storage, and queues captures when offline.

- `frontend/src/components/AmethystLogo.jsx` — authentic Amethyst crystal facet vector icon.
- `frontend/src/mobile/companion.css` — Liquid-Glass tokens (`#F2F2F7` surface, `#FFFFFF` rounded-3xl cards, `#111113` dark blocks, `#0071E3` accent, `.glass` blur/saturate, `.pill` dock).
- `frontend/src/mobile/views/MobileToday.jsx` — live profile, quick telemetry carousel, day schedule, agent activity heatmap, background jobs, unread mail, PR status, and audio playback.
- `frontend/src/mobile/views/MobileTasks.jsx` — live tasks, week calendar selector, status banner, completion toggle, and quick add.
- `apps/web/src/mobile/views/MobileLibrary.jsx` & `MobileLibraryItem.jsx` — Library revamp (12-screen liquid-glass design, `lb-*` styles in `companion.css`): timeline cards (Today/Yesterday/This-week/Earlier months), jump-back-in rail, full search screen (results, recent searches, browse creators/sources), collections 2×2-thumb grid + smart groups (Favorites/Wishlist/Not opened), create bottom sheet (paste-link field, 8 type tiles, manual composer with checklist builder), filter sheet, and FAB. All reads/writes go through `syncCollections` + Library APIs with optimistic inserts; no mock data. Library detail routing uses saved kind/category/entity/resource metadata to show video, article/post, movie, recipe, game, book, place, or note screens. Movie/game/book/place status uses the Library PATCH API; recipes parse saved text/resources for ingredients and steps; note/checklist items render a `ChecklistCard` (toggle/add entries and reminder via `PATCH /library/{id}` `checklist`/`remind_at`).
- `frontend/src/mobile/views/MobileAgentSessions.jsx` & `MobileAgentChat.jsx` — live agent conversations, turn grouping (`groupMessagesIntoTurns`), structured `Markdown` rendering (`.m-shell`), and integrated `MobileActivity` drawer.
- `frontend/src/mobile/components/MobileActivity.jsx` — desktop-parity activity drawer with pulsing `BrandMark`, elapsed ticker, collapsible `<thought>` reasoning, and category-badged tool execution rows.
- `frontend/src/mobile/agent/toolRegistry.js` — in-memory tool cache (5-minute TTL) avoiding repetitive multi-second Composio network roundtrips per prompt.
- `frontend/src/mobile/views/MobilePC.jsx` & `MobileTerminal.jsx` — live PC screenshot/telemetry, app launcher, remote power, and interactive WebSocket terminal.
- `frontend/src/mobile/views/MobileSettings.jsx` — preferences, connectors, Face ID, pairing diagnostics, and device management.
- `frontend/src/mobile/modals/MobileQuickCapture.jsx` — frosted liquid glass bottom sheet for saving to library, task, or agent.
- `frontend/src/lib/sync/transportManager.js` — dual-path network manager probing LAN first (`/api/remote/status` with 1.5s timeout) before falling back to relay (`/ops`).
- `frontend/src/lib/sync/useSync.js` — visibility sleep (`document.visibilityState === 'hidden'` clears poll timers to prevent Cloudflare D1/Worker quota exhaustion), adaptive backoff (3s burst on user activity, 30s idle, exponential backoff up to 60s with jitter).
- `frontend/src/mobile/ConnectionDiagnosticsModal.jsx` — Happy-inspired diagnostic sheet showing transport mode, latency, pending outbox, LAN/relay addresses, and copyable diagnostics.
- `frontend/src/mobile/captures.js` — durable capture queue.
- `frontend/src/mobile/storage.js` — snapshot and record storage.
- `frontend/src/mobile/native.js` — native bridges.
- `frontend/src/mobile/updates.js` — Android APK update flow.
- `POST /api/mobile/captures` — 202, durable job, re-checks library permission.
- `GET /api/mobile/update` and `/apk` — update metadata and download.

In `Companion.jsx`, `refresh()` decouples direct LAN capabilities probing from sync polling: an unreachable host LAN does not block replica synchronization through the Cloudflare Worker relay.

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

## Sync and Connectivity

The phone holds a replica and exchanges sealed ops through either direct LAN or the relay. See
[systems/sync.md](../systems/sync.md) for the op format, HLC merge and
allowlists. The short version:

- Pairing establishes the group key and records direct LAN and relay endpoints.
- `TransportManager` continuously tracks network health and routes requests to the fastest available path (`direct` -> `relayed` -> `offline`).
- Every synced write goes to an outbox and is sealed.
- Cloudflare quotas are safeguarded: polling stops completely when the screen is locked/backgrounded (`visibilityState === 'hidden'`).
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

_Last verified: 2026-11-06 · commit `9606fbbf` · phone connectivity improvements._
