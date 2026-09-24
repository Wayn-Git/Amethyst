# ⚙️ AMETHYST Complete Configuration & Connectivity Guide

Welcome to the comprehensive configuration guide for **AMETHYST**! This guide covers everything needed to connect external apps, set up OAuth, deploy the Cloudflare 24/7 relay, and master the personal Library.

---

## 🧭 3 Ways to Configure AMETHYST

You can configure AMETHYST using any of the following methods:

| Method | Best For | How to Access |
|---|---|---|
| **1. Interactive Setup Wizard** *(Easiest)* | Beginners & Friends | Run `./run.sh --setup` (or `run.bat --setup` on Windows) |
| **2. Web Interface** | Visual management | Open **Settings** (gear icon) or **Skills & connectors** (`Cmd/Ctrl+4`) in the web app |
| **3. Configuration File (`.env`)** | Power users & Docker | Edit `.env` in the repository root |

---

## 🤖 1. AI Models & Providers

AMETHYST gives you freedom to choose between **100% free local models** (no API keys, zero cloud costs) and **cloud model providers**.

### Option A: 100% Free & Local via Ollama (Zero API Keys)
1. Download and install [Ollama](https://ollama.ai/).
2. Run any model in your terminal:
   ```bash
   ollama run llama3.2
   # Or for larger capacity:
   ollama run qwen2.5:7b
   ```
3. AMETHYST detects Ollama running on `http://127.0.0.1:11434` automatically! Select it from the model dropdown in the chat.

### Option B: Cloud Providers
Add your keys into `.env` (or pass them via `./run.sh --setup`):
```env
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
GROQ_API_KEY=gsk_...
```

---

## 🔗 2. Apps Connectivity & OAuth

AMETHYST uses Model Context Protocol (MCP) to interact with external tools and services. You can manage connectors in the **Skills & connectors** view (`/capabilities`, `Cmd/Ctrl+4`) or via the CLI (`amethyst mcp catalogue`, `amethyst mcp status`).

The catalogue is the list — **`amethyst mcp catalogue`** prints exactly what is
offered on your machine, including the setup hint each server carries. What
follows is the shape of it.

### 📋 Connector Matrix

| Connector | How it authenticates | Setup difficulty | Description |
|---|---|---|---|
| **Microsoft To Do** | Microsoft's own public device-code flow | **Zero registration** | Sign in with your personal or work Microsoft account. Scope is `Tasks.ReadWrite` — your to-do lists and nothing else. |
| **Google Workspace** (Gmail, Calendar, Drive, Docs, Sheets) | OAuth; **your** Google Cloud desktop client | **Easy (2 mins)** | One sign-in runs all five services. One process instead of five. Individual `google-gmail`, `google-drive`, … entries exist too. |
| **GitHub** | OAuth against GitHub's own hosted MCP server | **Easy (2 mins)** | Register one OAuth app (callback `http://127.0.0.1:33418/oauth/callback`), paste the id/secret, sign in. Scopes: `repo`, `read:org`, `read:user`, `gist`, `notifications`, `workflow`. |
| **Vercel** | OAuth, self-registering | **Easy (1 min)** | Projects, deployments, logs, Web Analytics. Needs nothing registered by hand. |
| **Spotify** | OAuth; **your** Spotify developer app | **Easy (2 mins)** | Redirect URI `http://127.0.0.1:8888/callback`. Everything works on a free account except volume control. |
| **LinkedIn** | Signs into your real account in a browser | **Read the warning first** | No API exists for this; automated access violates LinkedIn's ToS and accounts do get restricted. One session at a time. |
| **Tavily / Exa / Firecrawl** | An API key in the keychain | **Easy (1 min)** | Search (Tavily, Exa) or turn one page into markdown (Firecrawl). |
| **Playwright / Chrome DevTools** | None | **Zero setup** | Real browser automation; needs Node.js (`npx`), Chrome for the second. |
| **Web Fetch / Knowledge Graph Memory / theSVG** | None | **Zero setup** | Fetch a URL as markdown, a model-curated knowledge graph, brand icons. |
| **Mail** *(not an MCP connector)* | Gmail OAuth, or an AgentMail API key | **Easy** | Built-in tool, beta page. `AGENTMAIL_API_KEY` gives the agent its own inbox. |

**Mail and Google's OAuth client are settable without the CLI** — both have an
HTTP route, so a phone can finish them: `POST /api/mcp/servers/{name}/oauth-client`,
and Mail is configured from **Settings**. The environment variables
(`AMETHYST_DEFAULT_GOOGLE_CLIENT_ID`, …) are only what the process falls back to
when no client has been set that way.

---

### 🟢 Setting Up Microsoft To Do (Zero Config)
Microsoft To Do uses Microsoft's public device-code flow:
1. In the Web UI, go to **Skills & connectors** (`/capabilities`) → **Connectors** tab → **Microsoft To Do**.
2. Click **Connect**. A device code will appear.
3. Visit [microsoft.com/devicelogin](https://microsoft.com/devicelogin), enter the code, and approve.
4. AMETHYST is now connected to your tasks and task lists!

---

### 🔵 Setting Up Google Workspace (Gmail, Calendar, Drive)
Because Google requires OAuth credentials for desktop applications:
1. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create Credentials** → **OAuth Client ID**:
   - **Application type**: Desktop app
   - **Name**: AMETHYST
3. In **APIs & Services → Library**, enable every service you intend to use:
   - Gmail API, Google Calendar API, Google Drive API, Google Docs API, Google Sheets API
4. Copy your **Client ID** and **Client Secret**, then hand them to AMETHYST —
   either through the environment (read once, at start):
   ```env
   AMETHYST_DEFAULT_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   AMETHYST_DEFAULT_GOOGLE_CLIENT_SECRET=your-client-secret
   ```
   or over HTTP, which takes effect without a restart and can be done from a phone:
   ```bash
   curl -X POST http://127.0.0.1:8000/api/mcp/servers/google-workspace/oauth-client \
     -H 'Content-Type: application/json' \
     -d '{"client_id":"…apps.googleusercontent.com","client_secret":"…"}'
   ```
   The setup wizard (`./run.sh --setup`) asks for the same two values.
5. Open **Skills & connectors** in AMETHYST and click **Connect**. Approve in your browser.
6. **One Account Signs into All**: the merged `google-workspace` connector authorises
   Gmail, Calendar, Drive, Docs and Sheets in one sign-in and runs them in one
   process. The per-service `google-gmail`, `google-drive`, … entries share that
   same account — five of them is five processes on one OAuth client, which is
   why the merged one exists.

> A grant from a Google Cloud project left in *Testing* mode lasts **7 days**.
> Publish the app or re-approve when it lapses — a lapsed grant looks exactly
> like a connector that stopped working for no reason.

---

### 🐙 Setting Up GitHub
GitHub's connector is OAuth against GitHub's own hosted MCP server — no
personal access token, no scope checkboxes to get wrong:
1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**.
2. Authorization callback URL: `http://127.0.0.1:33418/oauth/callback`
3. Generate a client secret.
4. In AMETHYST: **Skills & connectors → GitHub → Connect**, paste the client id and
   secret, sign in — or from the terminal:
   ```bash
   amethyst mcp add github
   amethyst mcp auth github --client-id <your-client-id> --client-secret <your-client-secret>
   amethyst mcp login github
   ```

Scopes requested: `repo`, `read:org`, `read:user`, `gist`, `notifications`, `workflow`.

---

### 🔍 Setting Up Web Search (Tavily)
1. Sign up for a free key at [tavily.com](https://tavily.com).
2. Store it under the reference the connector reads, then add the server:
   ```bash
   amethyst secrets set amethyst-mcp/tavily.api_key
   amethyst mcp add tavily
   ```
   Exa (`dashboard.exa.ai`) and Firecrawl (`firecrawl.dev`) are the same shape:
   `amethyst secrets set amethyst-mcp/exa.api_key` / `amethyst-mcp/firecrawl.api_key`.
   Tavily's key travels as a URL query parameter — Tavily's documented path for
   clients with no OAuth of their own, which is what this is.

---

## ⚡ 3. Embeddings (and what Cloudflare is actually for)

Embeddings are what make Library search answer *"that thing about mortgages"* by
meaning rather than by keyword. **The default is local**: Ollama on your own
machine with `nomic-embed-text`, no account and no bill
([ADR-0013](architecture/decisions/0013-local-first-ai-default-posture.md)).

```bash
amethyst embeddings status     # what is configured, reachable, what built the index
amethyst embeddings detect --set   # first configured provider that answers
```

The chosen pair lives in `providers.yaml`, beside `memory:` and `tiers:`:

```yaml
embeddings:
  provider: cloudflare
  model: "@cf/baai/bge-base-en-v1.5"
```

**Any provider that speaks chat-completions can embed** — the cloud embedder is
configured through the same provider entries the chat models use, not a parallel
system. Cloudflare Workers AI is the usual cloud choice because it has a no-card
tier:

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and copy
   your **Account ID** (right sidebar, or in the URL).
2. Create an API token at [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   with the **Workers AI (Read)** template.
3. Add the provider and give it the key:
   ```bash
   amethyst providers add cloudflare
   amethyst secrets set amethyst/cloudflare      # the API token
   ```
4. **Edit `~/.amethyst/config/providers.yaml`** and replace `ACCOUNT_ID` in the
   `cloudflare` entry's `base_url` with yours. Leaving it makes every call 404 —
   the placeholder fails loudly on purpose, so a wrong one is visible.
5. Choose it:
   ```bash
   amethyst embeddings set cloudflare "@cf/baai/bge-base-en-v1.5"
   ```
   Candidates on that endpoint: `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-m3`.

> **No HTTP route sets the embedder.** It is a `providers.yaml` edit plus
> `amethyst embeddings set`, and `CLOUDFLARE_*` variables in `.env` are not read
> by anything — the key belongs in the keychain or in `AMETHYST_CLOUDFLARE_API_KEY`.

**What Cloudflare does here, otherwise:** it hosts the [relay](#4-cloudflare-worker-relay-instagram--247-mobile-share)
that holds webhook and phone-share deliveries while your machine sleeps, and it
is a lane for durable background jobs ([ADR-0022](architecture/decisions/0022-durable-jobs.md),
[ADR-0023](architecture/decisions/0023-dynamic-routing.md)). Neither needs
Workers AI.

---

## ☁️ 4. Cloudflare Worker Relay (Instagram & 24/7 Mobile Share)

### Why It Exists
Meta requires webhook deliveries to receive a `200 OK` within seconds. If your laptop is asleep or offline, Meta will retry and eventually **permanently disable your subscription**.
The Cloudflare Worker in `relay/` solves this:
- **Always awake on Cloudflare's free edge** (100,000 free requests/day, D1 database).
- Catches Instagram reels, DMs, mentions, and mobile share links 24/7.
- Holds them securely in Cloudflare D1 until your laptop opens, which then pulls, verifies the cryptographic signature, transcribes audio, and saves them to your Library!

### Step-by-Step Deployment (Takes 3 Minutes):

Two names in `relay/wrangler.jsonc` are the maintainer's own and will not exist
on your account: `"name": "psok-relay"` (the Worker — which is also your
hostname) and `database_name`/`database_id` (the D1 database). Give both your
own, or the commands below will address a database that is not yours.

```bash
# 1. Navigate to relay directory and install dependencies
cd relay
npm install

# 2. Create the Cloudflare D1 database (free)
npx wrangler d1 create amethyst-relay
```
The command outputs a `database_id`. Open `relay/wrangler.jsonc` and set
`database_name` and `database_id` to the database you just created — both of
them. The binding is by id, so a wrong `database_name` reads as if it were
addressing your database and silently is not.

```bash
# 3. Create the database tables
#    `npm run schema` runs `wrangler d1 execute <name>`, so use the name you chose:
npx wrangler d1 execute amethyst-relay --remote --file=./schema.sql

# 4. Set the 3 Worker secrets
npx wrangler secret put APP_SECRET       # Your Meta App Secret from developers.facebook.com
npx wrangler secret put VERIFY_TOKEN     # Any random string you choose (e.g. my-secret-verify-token)
npx wrangler secret put RELAY_TOKEN      # A random token for AMETHYST sync (e.g. openssl rand -hex 32)

# 5. Deploy the worker!
npm run deploy
```
The deploy command prints your worker URL, `https://<worker-name>.<you>.workers.dev`.
The Worker's own name is what appears in the hostname — the shipped one,
`psok-relay`, is a name older than this project and is kept only so the
maintainer's existing deployment does not have to be rebuilt.

### Connecting the Relay to Meta & AMETHYST:
1. **In Meta App Dashboard (Instagram Webhooks)**:
   - **Callback URL**: `https://amethyst-relay.<your-name>.workers.dev/ig/webhook`
   - **Verify Token**: The exact string you gave to `VERIFY_TOKEN`.
   - **Fields**: Subscribe to `messages` and `mentions`.
2. **In AMETHYST**:
   ```bash
   amethyst instagram relay --url https://amethyst-relay.<your-name>.workers.dev --token <RELAY_TOKEN> --on
   ```

---

## 📚 5. The Library Section (Your Knowledge Vault)

The **Library** (`/library`, `⌘9`) is where everything you decide to keep lands —
and it is deliberately not an Instagram feature. Unlike a bookmark app:

- Saved pages are converted to **markdown on disk** at `~/.amethyst/library/`,
  one readable file per item, so the vault outlives the app.
- Search is **hybrid**: SQLite FTS5 keywords plus vector embeddings, over
  chunks (a page is split, not embedded whole).
- A capture is enriched — summary, tags, kind, category, transcript where there
  is audio — by whatever model you have configured, unless you turn that off.

### Eight ways content lands in it:

The same eight as [architecture/library.md](architecture/library.md), written
for a person rather than a code path:

1. **The Library page** — the box at the top of `/library`: paste a URL and
   press Enter, and it captures. Anything that is not a URL searches instead, so
   one box is both. **More capture options** beside it covers the rest:
   - **Upload / drop** — PDF, EPUB, `.txt`, `.md`, `.csv`, images and `.mp4`.
     The file is stored under `~/.amethyst/attachments/` and indexed so
     `search_documents` finds it next week; the Library row is the pointer that
     makes it browsable.
   - **A note** — your own words, no URL at all. What you wrote about a book is
     the searchable thing about it.
   - **Wikipedia** — a topic, resolved to `https://en.wikipedia.org/wiki/<slug>`.
2. **The bookmarklet** — drag it from **Sync & Capture**; clicking it on a page
   opens `/library?url=…`, and the Library captures it on arrival.
3. **Your phone, directly** — the share sheet posts `POST /api/share/capture`
   with a bearer token: `{ "url": "…", "note": "…" }`.
4. **Your phone, through the relay** — the same body to `POST /share` on the
   Cloudflare Worker, which holds it until the laptop polls.
5. **Instagram** — a comment mentioning your account, a DM, or a reel: the
   webhook (or the relay) delivers it, the audio is transcribed through a
   whisper model on a provider you already configured (Groq's
   `whisper-large-v3-turbo` or OpenAI's `whisper-1`), then summarised.
6. **Your browser** — continuous capture of browser bookmarks:
   `amethyst bookmarks enable`, then `amethyst bookmarks sync`.
   **Firefox-family only** (Firefox, Zen, Librewolf — `places.sqlite`), and
   **off by default**: `places.sqlite` holds every page you have ever visited.
   `amethyst bookmarks status` reports what it sees.
7. **The agent** — *"save this link"*, *"remember this recipe"* calls
   `log_library_item`, the same store from the other side.
8. **Anything with a URL** — the generic path: normalise, reject private
   addresses, deduplicate, then try Instagram, X, YouTube and Pinterest
   embedders in turn and fall back to the readable text.

Every one of them ends in the same two functions, so an Instagram permalink
pasted by hand gets the same treatment as one that arrived by DM. What is
captureable but not *enrichable* still logs: a fetch that fails, or a page that
returns nothing readable, becomes a row with a URL and a note saying what went
wrong rather than a silent failure.

Two switches govern the rest:

| Switch | Default | Where it lives |
|---|---|---|
| `library.auto_enrich` | **on** | An `app_settings` row — summarise and tag fresh captures out of band. Off means no model calls on capture at all: right for a machine with no provider key. No UI for it today; it is `save_library({"auto_enrich": False})` or a direct `UPDATE app_settings`. |
| `browser.enabled` | **off** | `amethyst bookmarks enable` / `disable` (the `PATCH /api/browser` route does the same, but the interface has no client for it yet). |

Everything else — routes, item fields, the enrichment pipeline, search internals,
what "partial capture" means — is one file:
**[docs/architecture/library.md](architecture/library.md)**.

---

## 🩺 6. Verification & Troubleshooting

To check whether all your models, database, tools, and connectors are functioning properly:

```bash
./run.sh --doctor
# Or on Windows:
run.bat --doctor
```

You will see an instant, clear report showing:
- 🟢 Database & file storage status
- 🟢 Configured model providers & active keys
- 🟢 Live registered tools
- 🟢 Vector embeddings status & index chunk count
- 🟢 Instagram relay connection status
- 🟢 Social reading permissions
