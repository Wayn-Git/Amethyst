# Multi-Device Sync

How a host machine and paired control devices converge: pairing, sealed ops,
hybrid logical clocks, per-field merge, transcript projection, the relay
protocol, and remote intents.

**Verified 2026-11-06 · commit `9606fbbf` · phone connectivity improvements.**

Related: [systems/auth.md](auth.md), [sections/remote-mobile.md](../sections/remote-mobile.md),
[DATABASE.md](../DATABASE.md), [DATA-FLOW.md](../DATA-FLOW.md).

## Model

One machine is the **host**. It holds the vault, the database, the keychain and
the model credentials. A **control** device (phone, second laptop) holds a
replica and may ask the host to do a small set of things. Sync is not
multi-master replication of the whole application.

- The relay (Cloudflare Worker, `relay/`) is a mailbox. It stores sealed ops and
  routes them. It cannot read them or forge one.
- The host polls the relay through `RelayPoller`
  (`backend/instagram/relay.py`), which already existed for Instagram capture.
  Sync is a passenger on that round trip.
- A control device talks to the relay's `/ops` routes with a per-device bearer.
- Device authority is the local `devices` table. The relay holds a mirror,
  refreshed on every poll.

## Source map

```text
backend/sync/registry.py     which tables and columns may cross
backend/sync/ops.py          emit, apply, outbox, seen table, placeholders
backend/sync/hlc.py          hybrid logical clock and total order
backend/sync/crypto.py       group key, pair key, AES-256-GCM sealing
backend/sync/service.py      outgoing/incoming halves, config mirror, pair answers
backend/sync/project.py      transcript/library/run publication by watermark sweep
backend/sync/devices.py      device rows, tokens, permissions, pairing
backend/sync/intents.py      the only remote commands: turn, new_conversation, stop
backend/sync/microsoft_todo.py  Microsoft To Do's separate two-way sync
backend/instagram/relay.py   RelayPoller and the relay HTTP client
relay/src/ops.ts             op envelope, fan-out, acks, retention
frontend/src/lib/sync/       client replica, pairing, transportManager (dual LAN/relay), useSync (visibility sleep)
```

## Pairing

Pairing is a three-message handshake carried by the relay. The relay never sees
the group key.

1. Host opens a pairing window (`devices.new_pair_secret()`), 160 bits, valid
   for `PAIRING_TTL_SECONDS = 300`. The QR payload carries the relay URL, LAN
   URL and the secret.
2. Control seals an offer under `crypto.pair_key(secret)` and posts it.
3. Host opens it, records a `PendingPairing`, and either auto-approves or asks
   the user (`PairingApprovalModal`). Approval mints:
   - a `devices` row with a random token, stored only as SHA-256;
   - a role (`control`);
   - a permissions map;
   - the group key, wrapped under the pair key and returned in the answer.
4. Host rewinds transcript watermarks (`project.rewind`) so the new replica
   receives history from the beginning, `BATCH` rows per poll.

A pairing code is single-use once unsealed. A restart invalidates an open
pairing. Failed authentication attempts are rate limited in-process.

The control device's bearer is separate from the group key. The bearer
authenticates it to the relay; the group key decrypts ops.

## Ops and merge

Every local write that should cross is followed by `ops.emit(...)`. Repositories
remain the only code that writes their own tables.

An op is:

```json
{"op_id": "...", "device_id": "...", "hlc": "0000017...:000001:device",
 "entity": "tasks", "key": "<uuid>", "fields": {"title": "..."}}
```

Rules:

- `op_id` and `device_id` travel in the clear so the relay can deduplicate and
  route. The sealed payload omits them.
- The AEAD associated data is `op_id + "\0" + device_id`, so moving a ciphertext
  to another envelope fails authentication.
- `fields` is an allowlist intersection on emit **and** on apply. A column added
  later does not cross by accident; a tampered device cannot write one.
- Merge is per-field last-write-wins, ordered by HLC. Two devices editing
  different fields of one task both survive.
- An op for an unknown entity is recorded as seen and dropped. That is forward
  compatibility, not an error.
- Rows are materialised with placeholders for `NOT NULL` columns when an update
  arrives before its create. A placeholder carries no stamp and loses to the
  first real value.
- `agent_runs`, `subagent_sessions` and `messages` are `insertable=False`: the
  host is their only writer.
- Deletion is a tombstone field (`superseded_at`, `archived`, `revoked_at`), not
  an operation.

Idempotency is triple:

1. `sync_seen` refuses a second delivery (`SEEN_RETENTION_DAYS = 30`).
2. A tie does not replace an incumbent stamp.
3. The write is the same bytes.

## Synced entities

`backend/sync/registry.py` is authoritative. Current entries:

| Entity | Table | Key | Notes |
|---|---|---|---|
| `settings` | `app_settings` | `key` | Only `ui.*` keys in `SYNCED_PREFERENCES`; per-device UI state is excluded |
| `memories` | `memories` | `uuid` | Fact, conversation, tombstone |
| `conversations` | `conversations` | `id` | Title, provider, model, pinned, archived |
| `tasks` | `tasks` | `uuid` | Field-independent task edits |
| `agent_runs` | `agent_runs` | `id` | Phase/link/error only; not insertable |
| `subagent_sessions` | `subagent_sessions` | `id` | Tree metadata; not insertable |
| `messages` | `messages` | `uuid` | Transcript; not insertable; content capped |
| `intents` | `sync_intents` | `id` | The one phone-to-host entity |
| `library` | `library_items` | `uuid` | Metadata only; file paths never cross |

Deliberately absent:

- `messages.tool_calls`, token counts, full `AgentState`.
- Library file paths and media bytes.
- Provider keys and any credential column.
- Per-device preferences (`panelWidth`, `sidebar`, `textSize`, `activeId`,
  `workspace`).

`MAX_SYNCED_CONTENT = 8_000` characters. Longer message content is truncated
with `TRUNCATION_MARKER` before sealing, because the relay rejects an op over
64KB and a silent drop is worse than a visible truncation.

## Transcript projection

Messages are written from the agent loop, tool dispatcher, automations and
subagents. Threading an emit through all of them would put sync inside the most
changeable code. Instead `backend/sync/project.py` sweeps once per poll, before
the outbox is sealed.

- Messages use `messages.id` as a monotonic watermark. No clock, no ties.
- Conversations, runs and library use an `(updated_at, id)` cursor with the ids
  already published inside the newest second. A bare `>=` watermark republished
  the same rows forever; this was measured at roughly 7,700 ops/day for about 40
  real changes and took the relay over its read limit.
- `BATCH = 50` rows per table per poll.
- `project.rewind()` clears the four watermarks when a device pairs.

## Relay protocol and limits

`relay/src/ops.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `SYNC_BATCH` | 100 | Ops per sync, both directions |
| `MAX_OP_BYTES` | 64KB | Ciphertext ceiling; larger ops are refused |
| `MAX_OPEN_OPS` | 5,000 | Queue ceiling; uploads stop above it |
| `KEEP_SECONDS` | 24h | Unacknowledged op retention |
| ack retention | 8 days | Applied op ids kept for dedup |

One poll carries: outgoing sealed ops, incoming ops, op acks, pairing offers and
answers, config mirror, and the existing Instagram/job/worker mailboxes.

Acknowledgement is late by design: an op taken on one poll is acked on the next
successful poll. A crash in between re-offers it; re-applying is free. Losing a
change is unrecoverable, taking one twice is not.

The host pushes a config mirror every poll: device id, live devices and token
hashes, share token, Instagram settings. Revocation therefore takes effect at
the relay within one poll.

`service.outgoing()` returns nothing when:

- no group key exists (never paired), or
- `devices.has_peers()` is false (every device revoked).

The second check was added after a revoked group left the host sealing and
uploading for an empty room.

### Client transport and quota protection

Phone clients manage connectivity through `frontend/src/lib/sync/transportManager.js` and `useSync.js`:

1. **Dual-Path Resolution**: The client probes the host LAN (`/api/remote/status`) with a 1.5s timeout. If reachable, direct LAN is used, generating 0 Cloudflare Worker/D1 requests. If LAN is unreachable or times out, it falls back seamlessly to the Cloudflare relay (`/ops`).
2. **Visibility Sleep**: Whenever `document.visibilityState === 'hidden'` (e.g. phone screen locked or app backgrounded), sync poll timers are cleared immediately. When the screen becomes visible, sync wakes immediately with a prompt poll.
3. **Adaptive Backoff**: Polling bursts at 3s intervals during active user interaction, eases to 30s at rest, and uses exponential backoff up to 60s with jitter when idle or encountering network errors.

## Remote intents

A control device cannot call tools, read files or choose a provider. It writes
an `intents` row. `backend/sync/intents.py` decides what each kind means.

| Kind | Effect |
|---|---|
| `turn` | Enqueue a `remote_turn` job for an existing conversation |
| `new_conversation` | Create a conversation with the host's default provider/model; id is the intent id |
| `stop` | Cancel the host's active turn through `_active_turns` |

Every other kind is refused. Each intent is accepted or refused once. The intent
id is also the job idempotency key, so a redelivered op does not start a second
turn. Device liveness and the `agent` permission are re-checked at dispatch.

## Device permissions

`DEFAULT_PERMISSIONS` in `backend/sync/devices.py`:

```text
terminal False  root False  screen False  webcam False  mic False
audio False  files False  input False  power False  clipboard False
system False  agent True  library True  dashboard True
```

`backend/security/remote_access.py` maps routes to capabilities. A route absent
from that map is unreachable by a paired device. Missing fields in an older
grant are false, never inherited.

See [systems/auth.md](auth.md) for the guard, tokens and threat model.

## Failure behavior

| Failure | Result |
|---|---|
| Relay unreachable | Ops stay in the outbox; pending acks and pair answers are restored |
| Op cannot be unsealed | Logged, acked and dropped; it will never open |
| Op applies to an unknown entity | Seen, dropped |
| Op violates an allowlist | Seen, dropped |
| Op hits a foreign key with no parent | Logged, acked, dropped |
| Apply raises | Logged, acked, batch continues |
| Group key absent | Incoming ops acked and dropped |
| Device revoked | Next request/socket check fails; relay mirror updates next poll |

An op that cannot apply is garbage, not work held for later. Leaving it would
block every op behind it.

## Modification guide

| Change | Touch |
|---|---|
| Sync a new table or column | `backend/sync/registry.py` only; no wire change |
| Change merge semantics | `backend/sync/ops.py`, `hlc.py`, tests |
| Change op crypto | `backend/sync/crypto.py`, `relay/src/ops.ts` envelope |
| Change relay limits | `relay/src/ops.ts`, `backend/sync/service.py` batch |
| Add a remote command | `backend/sync/intents.py` handler table, permission check, tests |
| Change pairing | `backend/sync/devices.py`, `PairingApprovalModal`, `views/Pair.jsx` |
| Change transcript publication | `backend/sync/project.py` watermarks |
| Change device permissions | `DEFAULT_PERMISSIONS`, `remote_access.py`, settings UI |

Rules:

- Never add a credential column to an entity's `fields`.
- Never make `messages`, `agent_runs` or `subagent_sessions` insertable.
- Never ack an op before it is applied.
- Keep the relay unable to read payloads.
- Keep device authority on the host, not the relay.
- Add a remote capability by adding a handler, not by accepting arbitrary JSON.

## Known issues

- ADR-0024 is still marked "Proposed" while the implementation is live.
- Sync rides the Instagram relay poller. A deployment without relay configured
  has no sync.
- The relay stores ciphertext but sees metadata: op ids, device ids, sizes and
  timing.
- There is no key rotation after a device is revoked. Revocation stops future
  access; it does not re-key the group.
- Microsoft To Do has a separate sync path (`backend/sync/microsoft_todo.py`)
  with different merge rules.
- `relay/` has its own tests and deployment; the Python test suite does not
  exercise the Worker.

_Last verified: 2026-11-06 · commit `9606fbbf` · phone connectivity improvements._
