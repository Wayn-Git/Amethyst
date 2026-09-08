# Deploying AMETHYST

Two hosts: the interface on Vercel, the API on Render. They are joined by two
settings that must agree, and everything that goes wrong on a first deploy goes
wrong because one of them does not.

There is also a third option that is neither, and is worth reading first.

## Before you split it: you may not need to

`amethyst serve` serves the built interface and the API from one process on one
port. `npm run build` writes `frontend/dist`, and if that directory exists the
API mounts it — one process, one port, no CORS, no second deploy, no cold start
between the halves. On a laptop, on a home server, or on any single container
that stays up, that is the whole product.

The split below exists for one situation: the interface should be free and
instant on a CDN while the API is a small container that is allowed to sleep.
It costs a cold start and a CORS configuration. Take it deliberately.

## What runs where

| | Vercel | Render |
|---|---|---|
| serves | the built bundle, static | the FastAPI app |
| state | none | SQLite, config, skills, secrets — on a disk |
| config | `VITE_API_BASE`, at build time | `AMETHYST_HOME`, `AMETHYST_CORS_ORIGINS`, keys |

## The backend, on Render

`render.yaml` in the repository root is a blueprint: point Render at the repo,
choose **Blueprint**, and it reads that file. Three parts of it are load-bearing.

**The disk.** `AMETHYST_HOME=/var/amethyst`, mounted on a 1GB disk. A container's own
filesystem is discarded on every deploy and on every wake from idle, so without
this, every conversation, task, connector and key is gone by the next restart —
which on the free plan is roughly every fifteen minutes of quiet. This is the
setting people skip and then report as "it keeps logging me out".

**`AMETHYST_CORS_ORIGINS`.** Your Vercel origin, exactly: scheme and host, no
trailing slash, no path. Comma-separate to add preview deployments. There is no
wildcard and there will not be one — this API reads files and runs shell
commands, so "any page the user happens to visit" is not an acceptable set of
callers.

```
AMETHYST_CORS_ORIGINS=https://amethyst.vercel.app,https://amethyst-git-main-you.vercel.app
```

**`AMETHYST_SECRETS_FILE`.** A container has no OS keychain. Without this, adding a
provider key in the interface answers 503 and says so; with it, keys go to a
JSON file on the private disk, created 0600. That is a real reduction in
protection compared with a keychain and it is stated rather than hidden — see
the docstring at the top of `backend/secrets.py`. The alternative, below, avoids it.

**Provider keys.** Every preset now writes an `api_key_env` into
`providers.yaml`, so a key can arrive as an ordinary environment variable and
never touch a file at all:

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GROQ_API_KEY=...
```

The keychain reference is still checked first; the variable is the fallback. If
you set keys this way you can leave `AMETHYST_SECRETS_FILE` unset, and the only cost
is that the interface's "add a key" field stops working — which is the honest
trade, since there is nowhere safe for it to write.

One worker, deliberately. AMETHYST holds MCP subprocesses, the reminder loop and the
automation runner as process state; a second worker starts a second copy of all
three against one SQLite file.

## The frontend, on Vercel

`vercel.json` in the repository root builds `frontend/` and serves
`frontend/dist`. Import the repo and set one environment variable:

```
VITE_API_BASE=https://amethyst-api.onrender.com
```

Scheme and host, no trailing slash, no `/api` — `api.js` appends that. It is
read at **build** time, so changing it means redeploying the frontend, not
restarting anything.

Leave it unset and the bundle talks to `/api` on its own origin, which is what
the single-process build and `npm run dev` both want.

## The cold start, and what the interface does about it

A free Render service stops when nothing has asked it for anything, and the
request that wakes it waits out the boot — tens of seconds. Three things keep
that from reading as a broken deploy:

1. **The wake starts before React does.** `api.js` fires `GET /api/ping` while
   the module graph is still being evaluated, so the container is booting during
   parse and paint rather than after them. `/api/ping` and not `/api/health`:
   health surveys every configured provider over the network, and making a cold
   start wait for a boot *and* a round of probes is the wrong request to lead
   with.
2. **A preconnect goes out with it,** so DNS, TCP and TLS to the API host are
   done before the first byte of the first request.
3. **Nothing else is fetched until it answers.** The store holds the three
   opening calls behind the wake, and `App` renders `BootScreen` — which says
   what is happening and counts the seconds once the wait is worth mentioning —
   instead of mounting seven views that each fail and stay failed.

If the wake gets no answer for ninety seconds the screen says so and offers to
try again, rather than counting forever.

## Checking a deploy

```sh
curl -s https://amethyst-api.onrender.com/api/ping
# {"status":"ok","version":"0.1.0"}

# The preflight the browser will send. `access-control-allow-origin` has to come
# back with your Vercel origin on it; a 400 means AMETHYST_CORS_ORIGINS does not
# list it.
curl -si -X OPTIONS https://amethyst-api.onrender.com/api/ping \
  -H 'Origin: https://amethyst.vercel.app' \
  -H 'Access-Control-Request-Method: GET' | grep -i access-control
```

## Reaching AMETHYST from a phone, without publishing your shell

**AMETHYST has no authentication. That is a decision, not an omission** (ADR-0001):
the security model is that it is only reachable from the machine it runs on.
Every `/api` route assumes that — a public URL hands anyone who finds it your
filesystem, your shell and your mail.

There is exactly one endpoint built to be reached from elsewhere:

```
POST /api/share/capture     Authorization: Bearer <token>     {"url": "..."}
```

It can log a URL into the library and nothing else — no reads, no lists, no
tools. It does not exist until you make a token:

```bash
amethyst share-token --new        # shown once; stored in the OS keychain
amethyst share-token --revoke     # the endpoint returns 404 again
```

**A token is not a substitute for a proxy.** It protects one route; the other
fifty are untouched. If AMETHYST is reachable from the internet, publish that path
and nothing else:

```caddy
share.example.com {
    @capture path /api/share/capture
    handle @capture {
        reverse_proxy 127.0.0.1:8000
    }
    handle {
        respond 404
    }
}
```

The nginx equivalent is a `location = /api/share/capture` block with
`proxy_pass`, and a `location /` returning 404. Keep `amethyst serve` bound to
`127.0.0.1` so the proxy is the only way in — `amethyst serve --host 0.0.0.0` prints
a warning saying exactly this, and `amethyst doctor` reports whether a token exists.

On the phone, an iOS Shortcut or an Android sharing app posting JSON is enough:

```
URL     https://share.example.com/api/share/capture
Method  POST
Headers Authorization: Bearer <token>
Body    {"url": "<the shared link>"}
```

On the machine AMETHYST runs on you need none of this — the Library page's
bookmarklet opens `/library?url=…` with the link filled in, which is a
navigation rather than a cross-origin request, so nothing has to be switched on.

## The Instagram webhook, and the laptop that is closed

The webhook needs a stable public HTTPS address. The obvious answer -- a tunnel
to the machine AMETHYST runs on -- has a failure mode worth stating before anything
else, because it does not look like a failure:

**Meta does not queue for a webhook that fails.** It retries, and after sustained
failure it disables the subscription. A laptop with the lid shut is not a slow
endpoint, it is a down one. So a tunnel straight to a laptop does not mean
"deliveries arrive late". It means being silently unsubscribed, with every reel
after that gone and nothing anywhere saying so.

Two more clocks run while the machine is off. Instagram's messaging window is 24
hours, so a confirmation the laptop wanted to send on Monday cannot be sent on
Wednesday. And the 60-day access token refreshes only while it is still valid;
once lapsed there is no recovery but a re-paste by hand.

### The relay

`relay/` is a Cloudflare Worker that answers the 200, holds the delivery in a
free D1 queue, sends the receipt, and keeps the token alive. AMETHYST collects from
it on a fifteen-second poll and processes everything exactly as it would a
direct delivery. `relay/README.md` is the setup, in full.

It is free with no card and needs no domain: Workers' free plan is 100k requests
a day with no cold start, D1 is 5GB, and `*.workers.dev` is a stable HTTPS
hostname. A laptop polling every fifteen seconds is about 5,800 requests a day.

```bash
cd relay && npm install
npx wrangler d1 create amethyst-relay        # put the id in wrangler.jsonc
npm run schema
npx wrangler secret put APP_SECRET       # Meta's app secret
npx wrangler secret put VERIFY_TOKEN     # any string; Meta gets the same one
npx wrangler secret put RELAY_TOKEN      # openssl rand -hex 32
npm run deploy

amethyst instagram relay --url https://amethyst-relay.<you>.workers.dev \
                     --token <the RELAY_TOKEN> --on
```

**The relay is always on and it is never trusted.** It stores the bytes Meta
signed and the signature header verbatim, and `backend/instagram/relay.py`
verifies that signature again here before anything reaches the library. That is
why the raw bytes are relayed rather than a parsed object: a parsed object cannot
be checked. A compromised relay can lose a reel; it cannot invent one.

What does live in D1: queued deliveries for minutes, the Instagram access token,
the share token, the allowlist. The access token can read your DMs and post as
you, and it is there because the receipt and the token refresh cannot happen
anywhere else. The relay token is as sensitive as it, because `/sync` returns it.

What does not: library text, media, the index, conversations, memory, provider
keys.

### With the relay, nothing here is reachable from the internet

That is the real prize. Meta talks to the Worker; AMETHYST talks *out* to the Worker.
No inbound port, no tunnel, no NAT hole, no exact-path bypass rule to get wrong.
Keep `amethyst serve` on `127.0.0.1` and there is nothing to publish.

## Reaching the interface from a phone, with Cloudflare

Only if you want to *read* the library from elsewhere -- capture does not need
this. **AMETHYST has no login and is not meant to have one** (ADR-0001), so the
identity has to sit in front of it.

Cloudflare Tunnel plus Cloudflare Access does that without changing a line of
AMETHYST. The tunnel gives a hostname with no port forwarding and no open inbound
port; Access puts a Google login in front of the whole thing, free for up to 50
users. You need a domain on Cloudflare (about £10 a year); a `trycloudflare.com`
quick tunnel is free but its hostname changes on every restart.

```bash
cloudflared tunnel login
cloudflared tunnel create amethyst
cloudflared tunnel route dns amethyst amethyst.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: amethyst
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: amethyst.example.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Point it at the one `amethyst serve` process, never the Vite dev server. Then an
Access application covering `amethyst.example.com`, policy *Allow* -> emails -> your
address.

```bash
AMETHYST_CORS_ORIGINS=https://amethyst.example.com amethyst serve
```

### The rule, stated plainly

With a relay in place, **no path needs a bypass at all** -- Meta never reaches
this machine. Without one, `/api/share/capture` and `/api/instagram/webhook` are
the only two that may ever be bypassed, and each carries its own credential: a
bearer token and a signature. Every other route runs shell commands, reads your
files and reads your mail, with no authentication.

A bypass on `/api/*`, or on a path *prefix* rather than an exact path, publishes
all of that to the internet. Widening it by one character is the whole risk.

Keep `amethyst serve` bound to `127.0.0.1`. `amethyst serve --host 0.0.0.0` prints a
warning saying exactly this, and `amethyst doctor` reports which endpoints are on and
whether a relay is catching for them.

### On a phone

The library is just the site, behind the Access login. To *send* something without
opening it, an iOS Shortcut or an Android sharing app posting JSON is enough --
and with a relay deployed it can post there instead, so a share survives the
laptop being off exactly as a reel does:

```
URL     https://amethyst-relay.<you>.workers.dev/share
Method  POST
Headers Authorization: Bearer <amethyst share-token --new>
Body    {"url": "<the shared link>"}
```

On the machine AMETHYST runs on you need none of this -- the Library page's
bookmarklet opens it with the link filled in, which is a navigation rather than a
cross-origin request.

## What does not survive the split

Honest list, because finding these one at a time is worse.

- **The filesystem and shell tools reach the container, not your machine.**
  `read_file` on a deployed AMETHYST reads the container's disk. Anything about
  *your* files needs AMETHYST running where your files are.
- **stdio MCP connectors** spawn subprocesses in the container. A connector that
  is a local binary has to be installed in the image to exist at all.
- **OAuth sign-ins** need their redirect URL to be the Render host, registered
  with the provider — the loopback URL a laptop uses will not come back. For a
  connector that runs its *own* flow this is not a setting to change but a wall:
  `workspace-mcp` binds its callback listener on `localhost:8765` inside the
  container, so the browser that opened the Google page has nowhere to deliver
  the code to. The Google connectors are local-only until something else holds
  that callback.
- **Reminders have nowhere to arrive.** This is the one that surprises people,
  and it is not about the plan. `backend/notify.py` shells out to `notify-send`,
  `osascript` or `powershell` — it asks the platform what it has rather than
  assuming a desktop. A container has none of them, so `_notifier()` returns
  None, logs once, and drops the message. The loop still runs and still stamps
  `reminded_at`, so from the inside it looks like it worked. Until AMETHYST grows a
  delivery channel that is not a desktop session, a deployed reminder is a
  reminder nobody gets.

  Automations are the half that does survive, because their output is a
  conversation you can open and read rather than a notification you have to be
  present for. The journal is the same shape: a briefing and a review are rows
  you open, not notifications you have to be present for, so they survive the
  split as long as the service is up when their hour comes round.

- **Both loops run only while the service is up.** A free service that has
  spun down is not running either of them. An automation due during a quiet
  spell fires when something next wakes the container, not on time. Same rule
  as a laptop with the lid shut — the lid just closes far more often here.

- **A free service has no disk at all**, so `AMETHYST_HOME` is discarded on every
  spin-down. Provider keys given as environment variables survive (they are
  service config, not disk) and `providers.yaml` regenerates on boot with the
  `api_key_env` for each preset, so the agent can still answer. Tasks come back
  too, because To Do is the source of truth. Conversations, memory, the
  execution log and `mcp.yaml` — every connector added and its sign-in — do not.
  Do not set `AMETHYST_SECRETS_FILE` on a free service: it would accept a key into
  storage that is about to vanish, where leaving it unset gives an honest 503
  and points at the environment variable instead.

## The container: `docker compose up`

One image, one process, one origin — the "before you split it" option above,
packaged. See `Dockerfile` for what is inside and why, and
[ADR-0018](architecture/decisions/0018-container-image.md) for the decisions.
What a container operator actually needs to know:

**Linux default: `network_mode: host`.** The API binds `127.0.0.1` only, and
the three loopback OAuth callbacks (AMETHYST's `:33418`, workspace-mcp's `:8765`,
Spotify's `:8888`) resolve against the host's loopback, so all sign-ins work
unmodified. macOS and Windows cannot share the host network namespace: use
`docker compose -f docker-compose.yml -f docker-compose.bridge.yml up`, which
publishes `127.0.0.1:8000` and `127.0.0.1:33418` and sets
`AMETHYST_OAUTH_CALLBACK_BIND=0.0.0.0` so AMETHYST's own sign-in survives. Google
and Spotify (8765/8888) are **deliberately not published**: their listeners
are not ours to rebind, and a forwarded port would fail at redirect with an
error that reads like a console misconfiguration — host networking or no
sign-in, honestly stated.

**Two volumes, because connector state lives outside `AMETHYST_HOME`:**

- `./data/amethyst:/data/amethyst` — the database, the library and its media, config,
  logs, skills, `secrets.json`. A bind mount: it is yours to browse, back up
  and grep.
- `amethyst-connector-home:/home/amethyst` — token caches written by the connector
  processes themselves (`~/.google_workspace_mcp/credentials/`,
  `~/.config/microsoft-todo-mcp/`, `~/.linkedin-mcp/`, `~/.spotify-mcp/`). A
  named volume: opaque files nobody should hand-edit, and no uid-mismatch
  class of bug.

**Secrets arrive via `.env`** (see `.env.example`; copy it, fill it, it is
git-ignored) — never via `ARG`/`ENV` in the Dockerfile, both of which are
visible in `docker history` forever.

**Known-degraded inside a container, stated rather than discovered:**

| feature | what happens | where |
|---|---|---|
| desktop notifications | one warning then silence; reminders still recorded and shown in the UI | `backend/notify.py` |
| shell sandbox | `bwrap` may fail on hardened hosts (Ubuntu 24.04 userns restriction) → commands run direct, the container is the boundary, `amethyst doctor` says so | `backend/security/sandbox.py` |
| bookmark watcher | finds no browser profile; the loop no-ops | `backend/browser/places.py` |
| office conversion | named error, no `soffice`; add it with `docker compose exec amethyst apt-get install -y libreoffice-writer` | `backend/tools/builtin/convert.py` |
| Instagram webhook inbound | needs a public address; use the relay in `relay/` rather than publishing this container | §"the laptop that is closed" above |
| Google/Spotify sign-in | host networking only (§ this section) | — |

The release gate: `docker run --rm --entrypoint sh amethyst:local -c 'ls -A
/data/amethyst /home/amethyst'` must print nothing — those directories are created
at runtime, and anything listed leaked into a layer.
