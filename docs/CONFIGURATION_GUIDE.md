# ⚙️ PSOK Complete Configuration & Connectivity Guide

Welcome to the comprehensive configuration guide for **PSOK**! This guide covers everything needed to connect external apps, set up OAuth, deploy the Cloudflare 24/7 relay, and master the personal Library.

---

## 🧭 3 Ways to Configure PSOK

You can configure PSOK using any of the following methods:

| Method | Best For | How to Access |
|---|---|---|
| **1. Interactive Setup Wizard** *(Easiest)* | Beginners & Friends | Run `./run.sh --setup` (or `run.bat --setup` on Windows) |
| **2. Web Interface** | Visual management | Open **Settings** (gear icon) or **Connectors & Skills** (`Cmd/Ctrl+3`) in the web app |
| **3. Configuration File (`.env`)** | Power users & Docker | Edit `.env` in the repository root |

---

## 🤖 1. AI Models & Providers

PSOK gives you freedom to choose between **100% free local models** (no API keys, zero cloud costs) and **cloud model providers**.

### Option A: 100% Free & Local via Ollama (Zero API Keys)
1. Download and install [Ollama](https://ollama.ai/).
2. Run any model in your terminal:
   ```bash
   ollama run llama3.2
   # Or for larger capacity:
   ollama run qwen2.5:7b
   ```
3. PSOK detects Ollama running on `http://127.0.0.1:11434` automatically! Select it from the model dropdown in the chat.

### Option B: Cloud Providers
Add your keys into `.env` (or pass them via `./run.sh --setup`):
```env
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
GROQ_API_KEY=gsk_...
```

---

## 🔗 2. Apps Connectivity & OAuth

PSOK uses Model Context Protocol (MCP) to interact with external tools and services. You can manage connectors in the **Connectors & Skills** view (`/capabilities`) or via the CLI.

### 📋 Connector Matrix

| Connector | Auth Kind | Setup Difficulty | Description |
|---|---|---|---|
| **Microsoft To Do** | OAuth (Device Code) | **Zero setup** | Sign in with your personal or work Microsoft account. No developer registration needed. |
| **Google Workspace** | OAuth 2.0 | **Easy (2 mins)** | Gmail, Google Calendar, Google Drive, Docs, and Sheets with one unified sign-in. |
| **GitHub** | Token | **Easy (1 min)** | Read/write repositories, create issues, search code. |
| **Spotify** | OAuth 2.0 | **Easy (2 mins)** | Search tracks, control playback, manage playlists. |
| **Playwright / Browser** | Local | **Zero setup** | Real headless or visual browser automation. |
| **Tavily / Exa** | API Key | **Easy (1 min)** | Real-time web search and content retrieval. |

---

### 🟢 Setting Up Microsoft To Do (Zero Config)
Microsoft To Do uses Microsoft's public device-code flow:
1. In the Web UI, go to **Connectors & Skills** (`/capabilities`) → click **Add** next to **Microsoft To Do**.
2. Click **Connect**. A device code will appear.
3. Visit [microsoft.com/devicelogin](https://microsoft.com/devicelogin), enter the code, and approve.
4. PSOK is now connected to your tasks and task lists!

---

### 🔵 Setting Up Google Workspace (Gmail, Calendar, Drive)
Because Google requires OAuth credentials for desktop applications:
1. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create Credentials** → **OAuth Client ID**:
   - **Application type**: Desktop app
   - **Name**: PSOK
3. In **APIs & Services → Library**, enable:
   - Gmail API
   - Google Calendar API
   - Google Drive API
4. Copy your **Client ID** and **Client Secret**.
5. Set them in `.env`:
   ```env
   PSOK_DEFAULT_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   PSOK_DEFAULT_GOOGLE_CLIENT_SECRET=your-client-secret
   ```
   *Or* enter them when prompted in `./run.sh --setup`.
6. Open **Connectors & Skills** in PSOK and click **Connect**. Approve in your browser.
7. **One Account Signs into All**: Signing into Google Workspace automatically authorizes Gmail, Calendar, and Drive at once!

---

### 🐙 Setting Up GitHub
1. Generate a Personal Access Token (Classic) at [github.com/settings/tokens](https://github.com/settings/tokens).
2. Select scopes: `repo`, `read:user`.
3. In PSOK, run:
   ```bash
   psok mcp add github
   psok mcp env github GITHUB_PERSONAL_ACCESS_TOKEN=<your-token>
   ```

---

### 🔍 Setting Up Web Search (Tavily)
1. Sign up for a free key at [tavily.com](https://tavily.com).
2. Store the key:
   ```bash
   psok secrets set psok/tavily
   psok mcp add tavily
   ```

---

## ⚡ 3. Cloudflare Workers AI & Embeddings

Cloudflare provides 100% free cloud embeddings (`@cf/baai/bge-base-en-v1.5`) and fast inference on the edge.

### How to Configure:
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Find your **Account ID** (visible on the right sidebar of the dashboard or in the URL).
3. Create an API Token at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) using the **Workers AI (Read)** template.
4. Store your credentials in `.env`:
   ```env
   CLOUDFLARE_ACCOUNT_ID=your_account_id_here
   CLOUDFLARE_API_KEY=your_api_token_here
   ```
5. Set Cloudflare as the default embedding provider:
   ```bash
   psok embeddings set cloudflare @cf/baai/bge-base-en-v1.5
   ```

---

## ☁️ 4. Cloudflare Worker Relay (Instagram & 24/7 Mobile Share)

### Why It Exists
Meta requires webhook deliveries to receive a `200 OK` within seconds. If your laptop is asleep or offline, Meta will retry and eventually **permanently disable your subscription**.
The Cloudflare Worker in `relay/` solves this:
- **Always awake on Cloudflare's free edge** (100,000 free requests/day, D1 database).
- Catches Instagram reels, DMs, mentions, and mobile share links 24/7.
- Holds them securely in Cloudflare D1 until your laptop opens, which then pulls, verifies the cryptographic signature, transcribes audio, and saves them to your Library!

### Step-by-Step Deployment (Takes 3 Minutes):

```bash
# 1. Navigate to relay directory and install dependencies
cd relay
npm install

# 2. Create the Cloudflare D1 database (free)
npx wrangler d1 create psok-relay
```
The command outputs a `database_id`. Open `relay/wrangler.jsonc` and paste that ID into `database_id`.

```bash
# 3. Create the database tables
npm run schema

# 4. Set the 3 Worker secrets
npx wrangler secret put APP_SECRET       # Your Meta App Secret from developers.facebook.com
npx wrangler secret put VERIFY_TOKEN     # Any random string you choose (e.g. my-secret-verify-token)
npx wrangler secret put RELAY_TOKEN      # A random token for PSOK sync (e.g. openssl rand -hex 32)

# 5. Deploy the worker!
npm run deploy
```
The deploy command prints your worker URL:
`https://psok-relay.<your-name>.workers.dev`

### Connecting the Relay to Meta & PSOK:
1. **In Meta App Dashboard (Instagram Webhooks)**:
   - **Callback URL**: `https://psok-relay.<your-name>.workers.dev/ig/webhook`
   - **Verify Token**: The exact string you gave to `VERIFY_TOKEN`.
   - **Fields**: Subscribe to `messages` and `mentions`.
2. **In PSOK**:
   ```bash
   psok instagram relay --url https://psok-relay.<your-name>.workers.dev --token <RELAY_TOKEN> --on
   ```

---

## 📚 5. The Library Section (Your Knowledge Vault)

The **Library** (`/library`) is your central, unified personal knowledge vault. Unlike standard bookmark apps, PSOK:
- Converts saved content into clean markdown stored locally at `~/.psok/library/`.
- Runs full-text indexing + semantic vector embeddings for hybrid search.
- Uses local LLMs or cloud providers to extract summaries, tags, and key entities.

### 5 Ways Content Lands in Your Library:

1. **Instagram Reels & Posts**:
   - Comment `@your.account` on any Instagram reel or post, or DM it to your account.
   - Captured by the relay → audio extracted → transcribed with Whisper → summarized and saved into the Library.
2. **Mobile Share Sheet (iOS Shortcut / Android)**:
   - Share any web link, article, or YouTube video from your phone.
   - Sends a simple `POST /share` to your Cloudflare Worker with `{ "url": "https://..." }`.
3. **Browser Bookmarks Sync**:
   - Run `psok bookmarks sync` to auto-ingest your Chrome, Brave, or Safari bookmarks.
4. **Drag & Drop Files**:
   - Drop PDFs, DOCX, PPTX, or images directly into the chat or Library view.
5. **In-Chat Conversations**:
   - Tell the assistant: *"Save this conversation to my library"* or *"Bookmark this link: https://..."*.

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
