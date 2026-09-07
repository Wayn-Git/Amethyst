# Instagram capture with the laptop off — the relay

Written 4 September 2026.

## The problem

`backend/instagram/` is complete and tested. It cannot be used, because it needs
a public HTTPS address and PSOK runs on a laptop that is closed most of the day.

A closed laptop is not a slow endpoint, it is a *down* endpoint. Meta retries a
failed webhook and, after sustained failure, disables the subscription — so the
naive answer (a Cloudflare Tunnel to the laptop) does not degrade into
"deliveries arrive late". It degrades into "you are silently unsubscribed and
every future reel is gone with no error anywhere".

Two further deadlines run while the laptop is off:

- **Instagram's 24-hour messaging window.** A reply to a direct message must be
  sent within 24 hours of that message. A confirmation the laptop wanted to send
  on Monday cannot be sent on Wednesday.
- **The 60-day access token** refreshes only while it is still valid. Once
  lapsed there is no recovery but a re-paste by hand.

## The constraint that shapes everything

No free platform offers a persistent disk. R2 wants a card; Render's free tier
discards its filesystem on every spin-down; Fly, Koyeb and Railway no longer
have a usable free always-on tier at all.

So the library cannot move. ADR-0004 — the filesystem is the source of truth for
text — is not negotiable and is not being negotiated. ffmpeg does not run in a
Worker either.

**Capture moves. Processing does not.**

## Shape

A Cloudflare Worker on the free plan (100k requests/day, 10 ms CPU/request, no
cold start, no card, a stable `*.workers.dev` hostname) holds a D1 queue.

```
reel → Worker: verify Meta's HMAC → D1 → 200          always on
                                       → ack DM        only when the laptop is away
laptop, when running: POST /sync → re-verify HMAC → existing InstagramEventStore
                                → existing runner → transcript, enrichment, library
```

The relay is **always on but never trusted**. It stores the exact bytes Meta
sent and the exact `X-Hub-Signature-256` header, and the laptop verifies that
signature again with `signature.verify_signature` before anything reaches the
library. Two independent checks; a compromised Worker cannot inject an item.

## Interface

| route | credential | does |
|---|---|---|
| `GET /ig/webhook` | verify token | Meta's one-time handshake |
| `POST /ig/webhook` | Meta's HMAC | raw bytes + header into D1, keyed on `sha256(body)`. 200 |
| `POST /share` | share token | a URL from a phone, queued the same way |
| `POST /sync` | relay token | ack the last batch, push config, take the next batch, take the current token |
| cron, daily | — | refresh the access token under 14 days; prune settled rows |

`/sync` is one round trip doing four things because the laptop does all four on
every poll, and four endpoints would be four chances for them to disagree.

### Dedup, twice, for different reasons

The Worker keys on `sha256(raw body)` — that is what Meta's *retry of an
unacknowledged delivery* collides with, and it needs no payload parsing, so the
route-classification logic in `webhook.py` is not duplicated in TypeScript where
it would drift.

The laptop keys on `delivery_key` via the existing UNIQUE index. That is what a
*re-delivery through a different path* collides with. Both are needed; neither
substitutes for the other.

### The ack DM, and why it is conditional

The Worker sends "got it" only when `now - last_pull_at > 120s` — i.e. only when
the laptop is genuinely away. With the laptop running, the Worker stays quiet
and the laptop sends the real `Saved: {title}` within a minute. No double
message, and neither message claims more than happened: the relay's says
received, not saved.

It is sent only to senders on the allowlist, mirrored into D1 on every `/sync`.
Replying "got it" to a stranger whose reel is then discarded would be a lie, and
a write to a social account on their behalf.

## What lives in the cloud, stated plainly

D1 holds: queued raw deliveries (minutes, then deleted), the Instagram access
token, the share token, the allowlist, and `reply_on_save`.

The access token can read your DMs and post as you. It is there because the
chosen behaviour — an instant ack and a lapse-proof refresh — cannot be done
anywhere else. The relay token is therefore as sensitive as the access token,
since `/sync` returns it.

Not in the cloud: library text, media, the index, conversations, memory,
provider keys, the app secret's use for anything but verification.

## Laptop side

- `backend/instagram/relay.py` — `sync()`: POST, re-verify each row's HMAC,
  `webhook.parse`, `store.enqueue`, remember ids to ack on the next call.
- `InstagramRunner.tick()` calls it on its own 15-second interval, not the 5s
  drain tick.
- Config: `relay_url`, `relay_enabled` in `app_settings`; the relay token in the
  keychain beside the other three.
- CLI: `psok instagram relay --url … --token … | --status | --sync`.
- Library panel: last sync, count waiting at the relay.

Nothing in the processing pipeline changes. A relayed delivery and a direct one
land in the same table by the same call.

## Failure behaviour

- Relay unreachable: `tick` logs and carries on; the local webhook path is
  untouched; rows stay in D1 until acked.
- Laptop crashes after enqueue, before ack: rows are re-delivered and
  `store.enqueue` drops them on the UNIQUE index. Safe by construction.
- Queue over 500: the Worker still answers 200 (refusing only makes Meta retry)
  and stops writing. The panel says so.
- Forged row from a compromised relay: fails `verify_signature`, is dropped and
  logged, never acked.

## Out of scope

Mirroring video to R2 (needs a card; CDN assets live ~7 days, which covers any
realistic absence). Running transcription or enrichment in the cloud. Serving
the library from anywhere but the laptop.
