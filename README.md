<div align="center">

<img src="docs/images/view-chat.png" alt="Amethyst — the chat view with a live agent turn" width="960">

# Amethyst

**One AI interface to your apps, information, tasks and tools.**

A local-first personal operating system. One FastAPI backend, one React
frontend, one SQLite database — everything stays on your machine.

`Python 3.11+` · `FastAPI` · `React 19` · `SQLite` · `MIT`

</div>

---

Amethyst runs an agent loop that reasons, acts, and observes — streaming every
turn, tracing every tool call, and asking before anything writes or runs. It
connects to your calendar, mail, tasks, and files; keeps a searchable Library of
everything you save; and works with local models through Ollama for a zero-cost,
zero-cloud setup, or with any of 21 cloud provider presets.

**The Library is not an Instagram feature.** Anything with a URL lands in it —
a link pasted in the box, one shared from a phone, a browser bookmark, a
Wikipedia topic, a note you typed, a file you dropped, a reel you commented on,
or a link the agent was told to save. Eight doors, one store, one search index.
See [docs/architecture/library.md](docs/architecture/library.md).

## Features

| | |
|:---|:---|
| <img src="docs/images/view-chat.png" width="480" alt="Main page"> | **Main** — the chat interface with live agent turns, streaming responses and tool traces |
| <img src="docs/images/view-today.png" width="480" alt="Today view"> | **Today** — the whole day on one page: morning briefing, events, what is owed |
| <img src="docs/images/view-tasks.png" width="480" alt="Tasks view"> | **Tasks** — lists and buckets on a board of cards, with a calendar engine that finds free slots and flags conflicts |
| <img src="docs/images/view-library.png" width="480" alt="Library view"> | **Library** — your knowledge vault: articles, videos, podcasts, papers, posts, books and notes from any source; search by meaning and keyword, filter by kind, tag or category, stored as plain markdown on disk |
| <img src="docs/images/view-memory.png" width="480" alt="Memory view"> | **Memory** — per-conversation extracted memories that persist context across sessions |
| <img src="docs/images/view-plugins-overview.png" width="480" alt="Plugin overview"> | **Plugin Overview** — a birds-eye view of all installed connectors and their status |
| <img src="docs/images/view-plugins.png" width="480" alt="Plugins view"> | **Skills & connectors** — Microsoft To Do, Google Workspace, GitHub, Spotify, and more, installed from one page |
| <img src="docs/images/view-automations.png" width="480" alt="Automations view"> | **Automations** — a prompt on an interval, with its own run history |
| <img src="docs/images/view-mail.png" width="480" alt="Mail view"> | **Mail** — Gmail through Google Workspace, or AgentMail for your agent's own inbox |
| <img src="docs/images/view-spotlight.png" width="480" alt="Spotlight"> | **Keyboard-first UI** — command palette (`⌘K`), full shortcut reference on `?`, no mouse required |
| <img src="docs/images/view-palette.png" width="480" alt="Command palette"> | **Command palette** — every view, skill, connector and setting reachable by name |
| <img src="docs/images/view-settings.png" width="480" alt="Settings"> | **Settings** — manage providers, permissions, standing approvals, and preferences |
| <img src="docs/images/turn.png" width="480" alt="Agent turn trace"> | **Live turn trace** — every tool call and argument streams as it happens, so you always know what the agent is doing |

Beyond the screenshots:

- **Code mode** — a second working surface next to the chat. It embeds a real
  [OpenCode](https://opencode.ai) session: its own process, proxied and
  supervised by the backend, with Amethyst's providers synced into it and live
  sessions listed in the sidebar. Toggle between *Work* and *Code* without
  leaving the app. See `backend/opencode/`.
- **Task-aware search** — a router that classifies the question first (factoid,
  comparison, freshness-sensitive, URL extraction, deep research) and dispatches
  to LangSearch, Exa, Firecrawl or Tavily through a circuit breaker with a live
  provider-health registry, falling back to keyless search when a provider is
  down or unconfigured. Plus a deep-research engine that plans, runs concurrent
  multi-step queries, and synthesises with citations. See `backend/web/`.
- **Composio cloud connectors** — hosted OAuth for SaaS apps, deduplicated
  against local MCP so the agent never sees two paths to the same provider.
  See [docs/architecture/connectors.md](docs/architecture/connectors.md).
- **Subagents** — the `task` tool spawns autonomous workers for parallel
  gathering, with depth limits, heartbeats and automatic reaping of stale runs.
- **8 curated themes** — dark and light palettes with a generated accent ramp,
  bound to semantic CSS variables throughout.
- **Converter** — a local file and media workbench: documents, images, and a
  video/audio conversion pipeline. Nothing uploads anywhere.
- **A full Activity log**, a tray + global hotkey desktop mode, and a phone
  companion that works over the Cloudflare relay while your laptop sleeps.

## How things get into the Library

| From | Path |
|---|---|
| **The Library page** | the box at the top of `/library`: paste a URL and press Enter (the same box searches when it is not a URL). "More capture options" beside it adds an **uploaded or dropped file**, a **note** you type, and a **Wikipedia topic** resolved to its article |
| **The bookmarklet** | drag it out of **Sync & Capture**, click it on any page |
| **Your phone, directly** | share sheet → `POST /api/share/capture` with a bearer token |
| **Your phone, through the relay** | the same call against the Cloudflare Worker, when the laptop may be asleep |
| **Instagram** | a DM, a mention, or a comment on a reel — through the webhook or the relay |
| **Your browser** | continuous capture of Firefox-family bookmarks — off by default, `amethyst bookmarks enable` then `amethyst bookmarks sync` |
| **The agent** | `log_library_item` — "save this link", "remember this recipe" |
| **Anything with a URL** | the generic path: normalise, check it is not a private address, deduplicate, then try Instagram, X, YouTube, Pinterest, then plain readable text |

Every one of them ends in the same two functions, so an Instagram permalink
pasted by hand gets the same caption-and-transcript treatment as one that
arrived by DM. Details, and why partial captures still log:
[docs/architecture/library.md](docs/architecture/library.md).

## Reliability

Things this codebase treats as bugs rather than edge cases, each guarded by a
test:

- **One instance, guaranteed by the kernel** — `amethyst serve` asks the port
  before it binds and raises the running window instead of starting a second
  server against the same SQLite file. No lock file, so nothing goes stale when
  a process dies.
- **One worker, always** — the lifespan starts five in-process runners (the
  MCP manager, automations, reminders, the journal, Instagram capture). A second
  uvicorn worker would run all six twice against one database.
- **Leak-free streaming** — SSE connections are cleaned up through FastAPI's
  `BackgroundTasks`, so a client that vanishes mid-turn does not leave a reader
  behind; stream resume has an explicit budget.
- **Orphan process prevention** — background PTY processes spawned by the
  terminal manager are reaped by process group on shutdown; stale subagents are
  auto-cancelled when their heartbeat expires.
- **A permission gate on every dispatch** — approving a read never approves a
  write, because the operation, not the tool, is what gets approved.

## The agent, briefly

- **Reason → act → observe.** The Director picks the tools; you watch it work.
- **Operation-level permissions.** A prompt names the exact operation —
  `write_file`, `run_shell_command:read-only` vs. destructive — and approving a
  read never approves a write. Standing approvals can be revoked anytime in
  Settings.
- **Skills are markdown.** A skill is a plain `SKILL.md` file. No plugins, no
  code lifecycle. Write one in the app, import a link, or install from the
  catalogue.
- **MCP connectors.** Any Model Context Protocol server — stdio, SSE, or
  streamable HTTP — registers into one flat tool registry.
- **Parallel execution.** Run multiple data-gathering tasks simultaneously with
  automatic task name correction and error recovery.
- **Smart file reading.** Binary detection, image handling, pagination, and
  hard limits prevent token explosion.

## Quick start

**Fastest path** (macOS / Linux / WSL2 — Windows: `run.bat`):

```bash
git clone https://github.com/Wayn-Git/Amethyst.git
cd Amethyst
./run.sh
```

The script sets up the venv, installs dependencies, initializes the database,
builds the frontend, and opens **http://127.0.0.1:8000**.

**As a desktop application** (after the first run, no terminal needed):

```bash
amethyst desktop                    # launch it -- or use the application menu
amethyst-show                       # raise the window of a running instance
amethyst desktop --install-autostart # start it at login, in the background
amethyst desktop --install-shortcut  # bind a global key to open it
```

Launching twice does not start a second copy; it raises the window of the one
already running. Closing the window puts AMETHYST away rather than quitting it —
schedules, jobs and the agent loop keep running. `amethyst serve` remains the
development command. See [docs/architecture/desktop.md](docs/architecture/desktop.md).

**Docker:**

```bash
docker compose up
```

**Models in two minutes, no API keys:**

```bash
# Install Ollama from https://ollama.ai, then:
ollama run llama3.2
```

Ollama models appear in the chat model selector automatically. Prefer cloud?
Add a key to `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, …)
or run `./run.sh --setup` for the interactive wizard. See the
[Quickstart](QUICKSTART.md) for the full guide, including OAuth connectors and
the Cloudflare relay.

## Models

Works with local Ollama out of the box, plus 21 provider presets: OpenAI,
Anthropic, Google Gemini, Groq, OpenRouter, xAI, DeepSeek, Mistral, Cerebras,
Together, Fireworks, NVIDIA, Cloudflare and more — or point `providers.yaml` at
any OpenAI-compatible endpoint.

## Security

- Every tool dispatch passes a permission gate; you approve the *operation*,
  not just the tool.
- Secrets live in the OS keychain, never in the database.
- State is a local SQLite database (WAL mode); Library files are plain
  markdown in `~/.amethyst/library/`.
- Shell tools run sandboxed; the sandbox and permission system are covered by
  the test suite.
- No wildcard CORS, ever — this API reads files and runs shell commands, so
  "any page the user happens to visit" is not an acceptable set of callers.

## Development

```bash
./run.sh --dev          # backend with reload + Vite dev server on :5173
ruff check backend tests
pytest                  # 99 files, ~1600 tests; -m 'not live' is the default
cd frontend && npm run lint && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions the codebase holds —
the one-worker rule, the secrets rule, the `-e` rule, and the comment
philosophy.

## Documentation

Start at **[docs/README.md](docs/README.md)** for the full index. The main ones:

| Doc | What it covers |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | 2-minute start, setup wizard, Ollama, FAQ |
| [docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md) | Every integration: providers, OAuth, Cloudflare relay, Library capture |
| [docs/architecture/overview.md](docs/architecture/overview.md) | Layer diagram, request lifecycle, design principles, ADRs |
| [docs/architecture/library.md](docs/architecture/library.md) | The Library deep dive: all eight capture paths, storage, enrichment, search |
| [docs/interface.md](docs/interface.md) | The web UI: views, keyboard bindings, design rationale |
| [docs/architecture/desktop.md](docs/architecture/desktop.md) | The desktop app: launching, startup order, single instance, tray, global shortcut |
| [docs/architecture/connectors.md](docs/architecture/connectors.md) | What a connector is, what is offered, local vs. Composio ownership |
| [docs/deployment.md](docs/deployment.md) | Local single-process vs. Vercel + Render split deploy |
| [relay/README.md](relay/README.md) | The Cloudflare Worker: why it exists, deploy, routes, the share token |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, conventions, rules of the codebase |

## Project layout

```
backend/          FastAPI app, agent loop, tools, connectors, CLI
  agent/          Director, prompt, tool selector, subagent spawning, state
  api/            Every HTTP route (one main.py), ~50 API prefixes
  tools/          Built-in tools: filesystem, shell, library, mail, tasks, web…
  web/            Task-aware search router, circuit breaker, deep research engine
  workers/        Parallel job execution, collectors, metrics, templates
  library/        Capture, storage, enrichment and search for saved items
  retrieval/      Chunking, embedding, FTS5 + sqlite-vec hybrid search
  instagram/      Webhook handling, reel capture, the relay poll
  browser/        Firefox-family bookmark capture (places.sqlite)
  mcp/            Connector config, catalogue, OAuth, Composio service
  opencode/       Code mode: OpenCode process manager and reverse proxy
  sync/           Microsoft To Do, multi-device sync and intents
  scheduling/     Date resolution, conflicts, free-slot search
  skills/         Skill loader + the built-in SKILL.md files it seeds
  runtime/        Provider adapters, fallback chain, vision, transcription
frontend/         React 19 + Vite SPA
  src/views/      One file per page: chat, today, tasks, library, code, …
  src/components/ UI components including arc primitives and notifications
relay/            Cloudflare Worker: holds webhook and phone-share deliveries
                  while your machine sleeps (see relay/README.md)
agents/           A collection of SKILL.md files; installed skills live in
                  ~/.amethyst/skills/, seeded from backend/skills/builtin/
automations/      Example automation payloads
scripts/          setup_wizard.py — the interactive ./run.sh --setup
docs/             Guides, architecture notes, ADRs, screenshots (docs/README.md)
tests/            99 pytest files — permissions, sandbox, retrieval, streaming
```

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it documents the
conventions (one worker, secrets rule, comment philosophy) the codebase holds.

**thanks to salko for claude**

## License

[MIT](LICENSE)
