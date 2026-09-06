# The relay

The part of Instagram capture that has to be awake when your laptop is not.

## Why it exists

Meta does not queue for a webhook that fails. It retries, and after sustained
failure it **disables the subscription**. So pointing Meta at a laptop does not
degrade into "deliveries arrive late" — it degrades into being silently
unsubscribed, with every future reel gone and nothing anywhere saying so.

Two more deadlines run while a laptop is closed:

- **Instagram's 24-hour messaging window.** A reply to a direct message must go
  within 24 hours of that message. A confirmation the laptop wanted to send on
  Monday cannot be sent on Wednesday.
- **The 60-day access token** refreshes only while it is still valid. Once
  lapsed there is no recovery but a re-paste by hand.

This Worker answers the 200, holds the delivery, sends the receipt, and keeps
the token alive. Everything else — the download, ffmpeg, the transcription, the
enrichment, the library — stays on your machine, because no free platform has a
persistent disk and ADR-0004 makes the filesystem the source of truth for text.

**Capture moves here. Processing does not.**

## It is always on and it is never trusted

The Worker stores the exact bytes Meta sent and the exact `X-Hub-Signature-256`
header. Your machine verifies that signature **again** before a single row
reaches the library — `backend/instagram/relay.py`, `_take_delivery`. That is
why raw bytes are relayed rather than a tidy parsed object: a parsed object
cannot be checked.

A compromised relay can lose a reel. It cannot invent one.

## What it costs

Nothing, and no card. Cloudflare's Workers free plan is 100,000 requests a day
with no cold start; D1 is 5 GB and 100,000 row-writes a day. A laptop polling
every fifteen seconds is about 5,800 requests a day. R2 is the Cloudflare
product that wants a card on file, and this design does not use it — Meta's own
attachment URLs live about seven days, which covers any realistic absence.

## Deploy

From `relay/`:

```bash
npm install
npx wrangler d1 create psok-relay          # prints a database_id
```

Put that id into `wrangler.jsonc`, replacing `PUT-THE-D1-DATABASE-ID-HERE`.
It is an identifier, not a credential.

```bash
npm run schema                              # creates the tables, remotely
npx wrangler secret put APP_SECRET          # Meta's app secret
npx wrangler secret put VERIFY_TOKEN        # any string; the same one Meta gets
npx wrangler secret put RELAY_TOKEN         # openssl rand -hex 32
npm run deploy
```

The last command prints the hostname, `https://psok-relay.<you>.workers.dev`.

## Point the two ends at it

**Meta** — app dashboard → Instagram → Configure webhooks:

| field | value |
|---|---|
| Callback URL | `https://psok-relay.<you>.workers.dev/ig/webhook` |
| Verify token | the same string you gave `VERIFY_TOKEN` |

Then subscribe to the `messages` and `mentions` fields. **Verify and save**
fires a live GET at that URL, so deploy before you press it.

**Your machine**:

```bash
psok instagram relay --url https://psok-relay.<you>.workers.dev \
                     --token <the RELAY_TOKEN> --on
psok instagram relay --sync      # go and look right now
psok instagram queue             # what arrived
```

The relay learns your access token, share token, allowlist and reply setting
from that first sync — they are pushed up on every poll, never configured here.
Until it has them it queues deliveries and sends no receipts, which is correct:
it does not yet know who is allowed to be answered.

## Routes

| route | credential | does |
|---|---|---|
| `GET /ig/webhook` | verify token | Meta's one-time handshake |
| `POST /ig/webhook` | Meta's HMAC | raw bytes + header into D1. 200 |
| `POST /share` | your share token | a URL from a phone, queued the same way |
| `POST /sync` | relay token | ack, push config, take the next batch |
| `GET /health` | none | `{"ok":true}` and deliberately nothing else |
| cron, daily | — | refresh the token under 14 days; prune |

### The receipt, and when it is not sent

The Worker replies "got it" **only** when the laptop has not synced for two
minutes — i.e. only when it is genuinely away. With your machine running it stays
quiet and your machine sends the real `Saved: {title}` a moment later. No double
message, and neither message claims more than happened: the relay's says
received, not saved.

It goes only to senders on the allowlist. Answering "got it" to a stranger whose
reel is then discarded would be a lie *and* a write to a social account on their
behalf.

## Troubleshooting

**`POST /share` answers 404 "no such endpoint".** The share token has not
reached the relay yet: it is pushed on the first `/sync`, which is every fifteen
seconds while your machine is on — so this means either that the machine has not
synced once since you set the share token, or that the relay settings are off
(`psok instagram relay --sync` forces one now). The endpoint exists; it 404s
until then so it does not announce itself half-configured.

**A shortcut or share target gets `400 Bad Request`.** The body must carry a
URL somewhere. All of these work:

```bash
# JSON
curl -X POST https://…/share -H "Authorization: Bearer $SHARE_TOKEN" \
     -H 'content-type: application/json' -d '{"url":"https://example.com"}'
# query parameter — the shape an Android shortcut's HTTP action finds easiest
curl -X POST "https://…/share?url=https://example.com" -H "Authorization: Bearer $SHARE_TOKEN"
# bare URL as text/plain — what a share target that "shares text" sends
curl -X POST https://…/share -H "Authorization: Bearer $SHARE_TOKEN" \
     -H 'content-type: text/plain' -d 'https://example.com'
# form fields
curl -X POST https://…/share -H "Authorization: Bearer $SHARE_TOKEN" \
     -d 'url=https://example.com'
```

The 400 names what arrived (`a text/plain body of 0 bytes`), so the failure is
readable from the toast that shows it.

## What is in D1, stated plainly

Queued raw deliveries (minutes, then deleted), your Instagram access token, your
share token, your allowlist, and `reply_on_save`.

**The access token can read your DMs and post as you.** It is there because the
receipt and the lapse-proof refresh cannot happen anywhere else. The relay token
is therefore as sensitive as the access token, because `/sync` returns it.

Not here: library text, media, the index, conversations, memory, provider keys.

## Watching it

```bash
npx wrangler tail                                            # live logs
npx wrangler d1 execute psok-relay --remote \
  --command "SELECT id, kind, received_at FROM deliveries"   # what is waiting
```

## Taking it away

```bash
psok instagram relay --forget
npx wrangler delete
```

Then point Meta's callback back at a public address for your own machine — see
`docs/deployment.md` — or accept that capture only works while it is awake.
