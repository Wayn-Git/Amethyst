# Amethyst v2 overhaul — plan index

Created 2026-10-09. Eight files. One session per phase.

## Session protocol

Every session that works a phase reads exactly two files:

1. `docs/plans/amethyst-v2/00-INDEX.md` (this file)
2. Its own phase file (`0NN-*.md`)

Do not read the other phase files. Each phase file is self-contained: it
carries its own context, findings with `file:line` citations, numbered tasks,
non-goals, verify commands and done criteria. Nothing a phase needs lives only
in another phase file.

When a phase finishes: update the registry table below (status + one-line
outcome), then stop.

## Target architecture

Decided 2026-10-09. Three layers, no overlap:

| Layer | What lives there | How |
| :--- | :--- | :--- |
| **Composio** | SaaS integrations: Google (Gmail, Calendar, Drive), Vercel, Spotify, LinkedIn, Microsoft To Do. GitHub only if the existing hosted MCP proves unreliable (then Composio — never both). | Hosted MCP session (`composio_service.py`, `mcp=True`), managed OAuth |
| **Direct APIs** | Research providers: Tavily (general search), Exa (semantic), Firecrawl (extraction/crawl), LangSearch (supplementary) — behind the research router | Free-tier API keys in keychain, `backend/web/router.py` |
| **Local/native** | `chrome-devtools`, `fetch`, `playwright`, `memory`, `thesvg` MCP servers + native tools: filesystem, shell, screenshots, clipboard, computer automation, browser | Local processes / in-process |

### Hard rules (apply to every phase)

1. **No fabrication.** Never invent a tool, integration, test result or
   provider capability. Unverified things are reported as unverified.
2. **Test before decommission.** A working integration is not removed until
   its replacement has been tested end to end.
3. **Free tier only.** No paid plan, paid feature or credit burn without
   explicit user approval. Free-tier keys only for research providers.
4. **Cost honesty.** Never silently switch to a paid provider or paid feature.
   Quota exhaustion produces a clear error, not a silent downgrade.
5. **Per-provider accounting.** Composio tool calls, and each research
   provider's usage, are tracked separately.
6. **Secrets stay in `backend/secrets`** (keychain refs like `psok-mcp/*`).
   Never in the frontend, model context or logs.
7. **Modality:** provider implementations stay modular — Composio, Tavily or
   any other provider must be swappable without rewriting agent orchestration.
8. **Scope discipline.** No unrelated redesigns. No removing existing
   functionality outside a phase's stated non-goals.

## Verify commands

```bash
# full backend suite (default skips live tests)
uv run pytest tests/ -x

# targeted
uv run pytest tests/ -x -k "<phase keyword>"

# lint (repo standard)
uv run ruff check backend/

# live tests (network + real MCP servers) — opt in only, per phase
uv run pytest -m live

# frontend
cd frontend && npm run lint && npm run build
```

A phase is not done until its verify block passes and `ruff check backend/`
is clean.

## Phase registry

| # | File | Depends on | Status | Outcome |
|---|---|---|---|---|
| 01 | `01-triage-fixes.md` | — | done | T1–T7 fixed, T6 recorded as a decision in `turns.md`, 8a–8e added (4 new test files, 17 tests, all pass; `stop_turn` test now async). ruff and `npm run lint` add no new errors from this work. The 7 suite failures are not Phase 01's: 2 fail at HEAD too, the other 5 trace to uncommitted resume/catalogue edits outside this phase (proven by re-running them at HEAD + only Phase 01 patches: 91 passed, same 2 failures). |
| 02 | `02-integrations.md` | — (parallel with 03) | not started | |
| 03 | `03-llm-layer.md` | 01 | not started | |
| 04 | `04-agent-loop.md` | 03 | not started | |
| 05 | `05-memory.md` | 03 | not started | |
| 06 | `06-evals.md` | 01 (benefits from 02–05) | not started | |
| 07 | `07-desktop-electron.md` | — (independent track) | not started | |

Suggested order: **01 → (02 ∥ 03) → 04 → 05 → 06.**
Phases 02 and 03 are independent — safe to run as two sessions at once.
Phase 07 is a separate track: it blocks nothing and nothing blocks it.

## Why this plan exists (one paragraph)

The live system's last 150 agent runs completed 73, failed 66. 52 of those
failures are `CancelledError` from the client disconnecting mid-turn, 5 ended
with no terminal frame at all, context compression has never fired (wrong
argument at `director.py:1587` and a broken summary call), subagent model
resolution always returns `None` (`runner.py:380`), and connector failures
(Google OAuth refresh 400 ×3586, vercel 401 ×120) hide 190 turns' worth of
tools from the model. Phase 01 fixes the verified bugs. Phase 02 rebuilds the
connector architecture per the table above. Phases 03–05 harden the LLM
layer, agent loop and memory. Phase 06 puts a regression net under all of it,
using the real failed turns as fixtures.

## Reference material (read-only, outside this plan)

- OpenMausBot at `/home/wayne/Documents/GitHub/OpenMausBot-main` — analyzed
  as the reference implementation. Specific files are cited inline in phases
  03–05 (e.g. `server/drivers/retry.ts`). Treat those citations as "port this
  shape", not as a dependency.
- `docs/architecture/connectors.md` — current connector design (lifecycle
  states, withholding rules, Google 7-day expiry history, Composio ownership
  split). Phase 02 amends this doc when done.
- `docs/architecture/mcp.md`, `docs/architecture/turns.md`,
  `docs/architecture/providers.md`, `docs/architecture/skills.md`.
