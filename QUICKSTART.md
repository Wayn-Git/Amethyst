# 🚀 AMETHYST Quick Start Guide

Welcome to **AMETHYST** (Personal Operating System with Knowledge)! This guide will get you up and running in **less than 2 minutes**.

---

## ⚡ 1-Minute Automated Start (Recommended)

AMETHYST includes automated startup scripts:
- **macOS / Linux / WSL2**: Run `./run.sh`
- **Windows**: Run `run.bat` *(in Command Prompt or PowerShell, or double-click it)*

*(Note: If your operating system hides file extensions, `run.sh` and `run.bat` may both appear simply as `run`. Choose `run.bat` for Windows and `run.sh` for Unix/Mac/Linux).*

```bash
# 1. Clone the repository
git clone https://github.com/your-username/amethyst.git
cd amethyst

# 2. Run the startup script (macOS/Linux/WSL)
./run.sh

# Or on Windows:
run.bat
```

The script automatically sets up `.venv`, installs dependencies, initializes the database, builds the frontend, and opens the app in your browser at:
👉 **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

---

## 🧙‍♂️ Interactive Setup Wizard (API Keys, OAuth & Connectors)

If you or a friend want a guided interactive setup for your AI models, app connectors (Google, Microsoft, GitHub), Cloudflare embeddings, and the Library:

```bash
./run.sh --setup
# Or on Windows:
run.bat --setup
```

For detailed manual instructions for every integration, see the **[Complete Configuration & Connectivity Guide](docs/CONFIGURATION_GUIDE.md)**.

---

## 📋 Prerequisites

Before running, ensure your machine has:
- **Python 3.11+** (`python3 --version`)
- **Node.js 18+** & **npm** (`node -v && npm -v`)

<details>
<summary><b>Need to install prerequisites? (Click to expand)</b></summary>

### macOS
```bash
brew install python@3.12 node
```

### Ubuntu / Debian
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm
```

### Fedora
```bash
sudo dnf install -y python3 python3-pip nodejs npm
```

### Windows
- Download Python: [python.org](https://www.python.org/downloads/) (check "Add python.exe to PATH")
- Download Node.js: [nodejs.org](https://nodejs.org/)

</details>

---

## 🐳 Option 2: Docker Compose

If you have Docker installed, you don't need Python or Node on your host:

```bash
docker compose up
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)**. Your data is stored locally in `./data/amethyst`.

---

## 🛠️ Option 3: Manual Installation

If you prefer installing step-by-step:

```bash
# 1. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Initialize AMETHYST database & configuration
amethyst init

# 4. Build the web frontend
cd frontend
npm install
npm run build
cd ..

# 5. Start the server
amethyst serve --open
```

---

## 🧠 Setting Up AI Models (2 Minutes)

AMETHYST works with **100% free local models** as well as **cloud providers** (Anthropic Claude, OpenAI, Groq, Gemini).

### Method A: 100% Free & Local (Ollama - No API Keys)
1. Download and install [Ollama](https://ollama.ai/).
2. Pull any model (for example, Llama 3.2 or Qwen 2.5):
   ```bash
   ollama run llama3.2
   ```
3. AMETHYST connects to Ollama automatically! Simply pick it from the model selector in the chat.

### Method B: Cloud Providers (OpenAI, Anthropic, Groq)
Copy `.env.example` to `.env` (the startup script does this automatically):
```bash
cp .env.example .env
```
Add your API key(s) to `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```
*Or* configure them via the web UI in **Settings → Models**, or via the CLI:
```bash
amethyst secrets set amethyst/anthropic
amethyst secrets set amethyst/openai
amethyst secrets set amethyst/groq
```

---

## 🧰 Useful Commands

| Command | Description |
|---|---|
| `./run.sh` / `run.bat` | Builds frontend (if needed), initializes DB, and serves on port 8000 |
| `./run.sh --setup` / `run.bat --setup` | Interactive setup wizard for API keys, OAuth, Cloudflare & connectors |
| `./run.sh --dev` | Starts backend with hot-reload + Vite dev server concurrently |
| `./run.sh --doctor` / `run.bat --doctor` | Runs system diagnostics (checks models, DB, tools, connectors) |
| `./run.sh --build` | Rebuilds the frontend bundle |
| `amethyst doctor` | Checks what is working and what is missing |
| `amethyst chat "Hello"` | Run a chat turn directly from your terminal |

---

## ❓ Frequently Asked Questions & Troubleshooting

### Q: Why do I see two `run` files in the repository root?
There is **`run.sh`** (for macOS, Linux, and WSL2) and **`run.bat`** (for Windows Command Prompt / PowerShell). If your file explorer has "Hide extensions for known file types" turned on, they might both display as "run". Run `run.bat` on Windows and `./run.sh` on Mac/Linux.

### Q: How do I configure OAuth (Google Workspace, Microsoft To Do, etc.)?
1. **Microsoft To Do**: Zero configuration! Click **Add** → **Connect** in **Connectors & Skills** (`/capabilities`) and approve with your Microsoft account via device code.
2. **Google Workspace**: Create an OAuth desktop client in Google Cloud Console, add the Client ID/Secret in `.env` or run `./run.sh --setup`, then click **Connect**.
See [docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md) for step-by-step instructions.

### Q: How does the Cloudflare Worker Relay work for Instagram and Library capture?
The relay in `relay/` is a free Cloudflare Worker that stays awake on the edge. When you or someone else sends/comments a reel on Instagram or shares a link from a phone, the relay holds it until your machine pulls it, transcribes the audio, and saves it into your Library. See [docs/CONFIGURATION_GUIDE.md#4-cloudflare-worker-relay](docs/CONFIGURATION_GUIDE.md#4-cloudflare-worker-relay).

### Q: The page is blank when opening http://127.0.0.1:8000?
Run `./run.sh --build` (or `cd frontend && npm install && npm run build`). AMETHYST serves the SPA from `frontend/dist`.

### Q: How do I test if everything is functioning?
Run `./run.sh --doctor` or `run.bat --doctor`. It validates the database, model providers, tools, and skills.

### Q: Can I run frontend and backend separately with live hot-reloading?
Yes! Simply run:
```bash
./run.sh --dev
```
This starts the backend on port `8000` and the Vite dev server on `http://127.0.0.1:5173`.

---

## 🗺️ Your First Five Minutes

Now that the app is open at http://127.0.0.1:8000, here is the fastest path to a useful answer:

1. **Pick a model** — the model selector beside the composer lists every configured provider. Ollama models appear automatically if Ollama is running.
2. **Send one line** — try `summarise ~/Documents` or `what meetings do I have this week?`. The agent decides which tools to use.
3. **Approve carefully** — anything that writes or runs asks first, naming the *operation* (`write_file`, `run_shell_command:read-only`), not just the tool. Approving a read-only command never approves a destructive one.
4. **Press `?`** — every keyboard binding in the app, one screen.
5. **Turn on beta pages** — Settings (`⌘,`) → **Beta pages** adds Mail and Automations to the rail.

### Q: `Error: address already in use` or the port is taken?
Another AMETHYST (or something else) is on port 8000:
```bash
./run.sh --port 8001
```
Or stop the old one first (`Ctrl+C` in its terminal).

### Q: The model replies "not configured" or no provider appears?
- Ollama: check it is running (`curl http://127.0.0.1:11434`) and you pulled a model (`ollama run llama3.2`).
- Cloud: the key did not reach the process — keys in `.env` are read at start, so restart after editing. `amethyst doctor` says exactly which providers are up.

### Q: The turn just stopped — is that a bug?
A permission prompt suspends the turn until answered; check for an amber prompt above the composer, or another conversation holding it (announced as a line above the transcript). `Escape` denies, `Enter` allows, `R` arms "remember this decision".

---

## 🚀 New Features

### Parallel Execution

Run multiple data-gathering tasks simultaneously for faster research:

```
# Example: Research multiple topics at once
dispatch_parallel_jobs([
  {task: "web_search", params: {query: "AI news"}},
  {task: "web_search", params: {query: "climate change"}},
  {task: "urls", params: {urls: ["https://example.com"]}},
])
```

**Available tasks:** `urls`, `web_search`, `gmail`, `github_activity`, `git_status`, `file_info`, `system_info`, `briefing`, `todo`, `rss`

**Auto-correction:** Common mistakes are automatically fixed:
- `fetch_url` → `urls`
- `search` → `web_search`
- `git` → `git_status`

### Smart File Reading

Files are read intelligently with hard limits:
- **50KB max** file size
- **2,000 lines** maximum
- **2,000 characters** per line
- **Binary detection** — automatically handles binary files
- **Image recognition** — shows images as base64

**Pagination for large files:**
```python
view_file("large_file.py", offset=100, limit=50)  # Lines 100-150
```

### LLM Intelligence Rules

The agent follows strict rules to prevent mistakes:
1. **Never guess tool names** — Must check available tools first
2. **Never retry failed tools** — Must understand why it failed
3. **Never generate fake data** — Must tell user honestly what happened
4. **Always have fallback strategy** — Primary → Alternative → Manual
5. **Tool inspection protocol** — Mandatory check before every tool call

These rules ensure the agent is reliable and transparent. See [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) for details.
