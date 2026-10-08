# Amethyst Quick Start

This gets you running in about two minutes. For what the system *is*, start at
[README.md](README.md); for every integration in detail, [docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md);
for the full doc index, [docs/README.md](docs/README.md).

---

## 1. Start it

**macOS / Linux / WSL2:**

```bash
git clone https://github.com/Wayn-Git/Amethyst.git
cd Amethyst
./run.sh
```

**Windows** (Command Prompt or PowerShell): `run.bat` instead of `./run.sh`.

The script creates `.venv`, installs dependencies, initializes the database,
builds the frontend, and opens **http://127.0.0.1:8000**.

> If your file explorer hides extensions, `run.sh` and `run.bat` both display as
> `run`. `run.sh` is for macOS/Linux/WSL2, `run.bat` for Windows.

### Prerequisites

- **Python 3.11+** — `python3 --version`
- **Node.js 18+** and npm — `node -v && npm -v`

<details>
<summary>Install commands by platform</summary>

```bash
# macOS
brew install python@3.12 node

# Ubuntu / Debian
sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm

# Fedora
sudo dnf install -y python3 python3-pip nodejs npm
```

Windows: [python.org](https://www.python.org/downloads/) (check "Add python.exe
to PATH") and [nodejs.org](https://nodejs.org/).

</details>

### Alternatives

<details>
<summary><b>Docker Compose</b> — no Python or Node on the host</summary>

```bash
docker compose up
```

Open http://127.0.0.1:8000. Data lives in `./data/amethyst`.

</details>

<details>
<summary><b>Manual install</b> — step by step</summary>

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
amethyst serve --open
```

`amethyst serve` is the whole product in one process: it prepares the database
on first run, builds the interface if there is none, and starts every background
service — automations, reminders, the journal, both job lanes, the relay poll,
the browser watcher and your MCP connectors — inside that one process. It then
prints which optional pieces are configured and which are not, so a phone that
will not pair tells you the relay is missing rather than leaving you guessing.

Flags: `--no-build` skips the interface build, `--rebuild` forces one,
`--port 8001` moves it, `--reload` restarts on source changes, `--host
127.0.0.1` keeps it off the LAN, `--open` opens a browser once it is up.

</details>

---

## 2. Setup wizard

```bash
./run.sh --setup      # Windows: run.bat --setup
```

Interactive, for API keys, OAuth apps (Google, Microsoft), the Cloudflare relay,
and Library capture. Manual instructions for everything it covers are in
[docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md).

---

## 3. Models

### Option A — free and local, no API key

1. Install [Ollama](https://ollama.ai/).
2. Pull a model: `ollama run llama3.2`
3. Ollama providers appear in the chat model selector automatically.

### Option B — cloud

```bash
cp .env.example .env      # ./run.sh does this automatically
```

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

Keys in `.env` are read at process start — restart after editing. Or configure
in **Settings → Models**, or through the CLI:

```bash
amethyst secrets set amethyst/anthropic
amethyst secrets set amethyst/openai
amethyst secrets set amethyst/groq
```

`amethyst doctor` names exactly which providers are up.

---

## Commands

| Command | What it does |
|---|---|
| `./run.sh` / `run.bat` | Build the frontend if needed, initialize the DB, serve on :8000 |
| `./run.sh --setup` | Interactive configuration wizard |
| `./run.sh --dev` | Backend with hot reload + Vite dev server concurrently |
| `./run.sh --doctor` | System diagnostics: models, DB, tools, connectors |
| `./run.sh --build` | Rebuild the frontend bundle |
| `./run.sh --port 8001` | Serve on a different port |
| `amethyst serve` | Everything: database, interface, every background service |
| `amethyst serve --reload` | The same, restarting on source changes |
| `amethyst doctor` | What is working, what is missing |
| `amethyst chat "Hello"` | One turn straight from the terminal |
| `amethyst device --pair` | A pairing code for another machine; **Settings → Devices** shows it as a QR code |
| `amethyst device` | List paired devices |
| `amethyst device --revoke <id>` | Disconnect one |
| `amethyst share-token --new` | The token a phone posts a link with |

---

## Your first five minutes

With the app open at http://127.0.0.1:8000:

1. **Pick a model** — the selector beside the composer lists every configured
   provider. Ollama models appear automatically if Ollama is running.
2. **Send one line** — try `summarise ~/Documents` or `what meetings do I have
   this week?`. The agent decides which tools to use.
3. **Approve carefully** — anything that writes or runs asks first, naming the
   *operation* (`write_file`, `run_shell_command:read-only`), not just the tool.
   Approving a read-only command never approves a destructive one.
4. **Press `?`** — every keyboard binding in the app, on one screen. `⌘K` is
   the command palette.
5. **If a page is missing from the rail** — Settings (`⌘,`) → **Beta pages**
   controls Mail and Automations. They are marked beta; if either is not where
   you expect it, that switch is why.

Two more surfaces worth knowing about:

- **Code mode** — the *Work / Code* control in the sidebar swaps the chat for a
  live OpenCode session, with Amethyst's providers synced into it.
- **Converter** — a local file and media workbench. Nothing is uploaded.

---

## Using it from your phone

Your computer keeps your files and runs your work. Your phone attaches to it,
watches what it publishes, and can send it more. Everything between the two is
sealed — the relay carrying it cannot read any of it.

**On your computer:** **Settings → Devices** → **Pair a device**. A QR code
appears, good for five minutes, once.

**On your phone:** open Amethyst and point the camera at the code. The code
carries the relay address as well as the secret, so there is nothing to type.

Two things make it smoother:

- **A relay.** Pairing completes through it, so without one nothing can answer
  your phone. `amethyst serve` says so at startup if it is missing. See
  [relay/README.md](relay/README.md).
- **Where your phone opens Amethyst** (Settings → Devices). Set this and the QR
  code becomes an ordinary `https` link your own camera app opens. Leave it
  blank and it still works — it just has to be scanned from the pairing screen
  inside the app.

**Revoke** beside a device disconnects it, cancels anything it had queued, and
stops it being recognised within one poll.

> Opening Amethyst on a phone always shows the pairing screen or the remote
> control, never the desktop interface — that layout needs a screen a phone does
> not have. If you want it anyway, add `?desktop=1` to the address.

---

## Troubleshooting

**The page is blank at http://127.0.0.1:8000**
Run `./run.sh --build` (or `cd frontend && npm install && npm run build`).
Amethyst serves the SPA from `frontend/dist`.

**`Error: address already in use`**
Another Amethyst — or something else — is on port 8000:

```bash
./run.sh --port 8001
```

or stop the old one first (`Ctrl+C` in its terminal). A second `amethyst serve`
does not start a second copy against the same database; it raises the window of
the one already running.

**The model replies "not configured", or no provider appears**
- Ollama: check it is up (`curl http://127.0.0.1:11434`) and pull a model
  (`ollama run llama3.2`).
- Cloud: keys in `.env` are read at start, so restart after editing.
  `amethyst doctor` names which providers are up.

**The turn just stopped**
A permission prompt suspends the turn until it is answered. Look for an amber
prompt above the composer, or another conversation holding it (announced as a
line above the transcript). `Escape` denies, `Enter` allows, `R` arms "remember
this decision".

**OAuth connectors (Google Workspace, Microsoft To Do)**
- **Microsoft To Do** is zero-config: **Add → Connect** in **Connectors &
  Skills** (`/capabilities`), approve with a device code.
- **Google Workspace** needs an OAuth desktop client from the Google Cloud
  Console; put the Client ID/Secret in `.env` or run `./run.sh --setup`, then
  **Connect**.

**The Cloudflare relay**
The Worker in `relay/` stays awake on the edge. When someone sends or comments
on a reel, or shares a link from a phone, it holds the delivery until your
machine pulls it, transcribes it, and files it in the Library. Deploying it is
in [relay/README.md](relay/README.md) and
[docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md).

**Frontend and backend with hot reload, separately**

```bash
./run.sh --dev
```

Backend on :8000, Vite on http://127.0.0.1:5173, which proxies `/api` to :8000.

---

## Where to next

| | |
|---|---|
| [docs/README.md](docs/README.md) | Full documentation index |
| [docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md) | Every integration, step by step |
| [docs/interface.md](docs/interface.md) | The views and keyboard bindings |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup for development and the rules of the codebase |
