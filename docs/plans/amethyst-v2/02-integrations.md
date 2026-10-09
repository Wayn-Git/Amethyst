# Phase 02 — Integrations: Composio cutover, research router, local whitelist

Depends on: none (runs parallel with Phase 03).
Reads: `00-INDEX.md` + this file. Also skim
`docs/architecture/connectors.md` — it is the design doc you will amend.

This phase implements the target architecture from the index:

- **Composio** for SaaS: Google (Gmail, Calendar, Drive), Vercel, Spotify,
  LinkedIn, Microsoft To Do. GitHub stays on its existing hosted MCP unless
  it proves unreliable — never both.
- **Direct free-tier APIs** for research: Tavily, Exa, Firecrawl, LangSearch,
  behind the existing research router.
- **Local/native** for everything local: `chrome-devtools`, `fetch`,
  `playwright`, `memory`, `thesvg`, filesystem, shell, screenshots, clipboard,
  computer automation.

Hard rules from the index apply in full — especially *test before
decommission*, *free tier only*, and *verify availability before migrating*.

---

## Why (live evidence)

| Symptom | Count (log, last ~2 weeks) | Cause |
| :--- | :--- | :--- |
| Google token refresh `400` | **3586** | Test-grant expiry; one refresh attempt per Google connector every ~30–60 s |
| `withholding tools of connectors not verified usable` | **190** | Dead OAuth ⇒ agent can't see Gmail/Calendar/Drive/Sheets/Workspace tools |
| `mcp.vercel.com` `401` | 120 | Local vercel OAuth dead |
| `OAuth flow error` | 120 | Same family |
| Google 7-day sign-in expiry | chronic | Google refuses production verification (`connectors.md`, "Why Google sign-in expires weekly") |

Composio's managed OAuth removes the 7-day grant problem and the local OAuth
maintenance entirely. That is the whole point of the cutover.

---

## Current-state inventory (19 servers in `~/.amethyst/config/mcp.yaml`)

| Server | Type today | Target | Action |
| :--- | :--- | :--- | :--- |
| `google-gmail`, `google-calendar`, `google-drive`, `google-sheets`, `google-workspace` | local `uvx workspace-mcp`, OAuth | **Composio** | migrate (Task 2) |
| `vercel` | local OAuth | **Composio** | migrate (Task 3) |
| `linkedin` | local OAuth/API | **Composio** | migrate (Task 3) |
| `spotify` | local OAuth | **Composio** | migrate (Task 3) |
| `microsoft-todo` | local OAuth, mirrors into tasks table | **Composio** | migrate (Task 3) — see note |
| `github` | GitHub hosted MCP, OAuth works | **keep as-is** | verify only (Task 4) |
| `exa` | remote MCP + `psok-mcp/exa.api_key` | **direct API** | replace with native router path (Task 5) |
| `firecrawl` | remote MCP **and** direct REST (`web.py:283`) | **direct API** | drop MCP entry, keep REST (Task 5) |
| `tavily` | remote MCP + key | **direct API** | replace with native router path (Task 5) |
| `fetch`, `chrome-devtools`, `playwright`, `memory`, `thesvg` | local | **keep** | whitelist (Task 8) |

Duplicate detection already exists: `backend/mcp/provider_ownership.py`
maps gmail/googlecalendar/github/spotify between local and Composio with
precedence rules. That module is the seam you edit — do not build a second
dedup mechanism.

---

## Task 0 — Audit gate (write the table before touching code)

Fill this table in this file as the first commit of the phase. Every row
needs evidence (file:line or API response), not guesses.

```markdown
| Service | Current path (file:line) | Composio toolkit verified? | Required actions vs available tools | Duplicate today? | Migration verdict |
|---|---|---|---|---|---|
| gmail | ... | yes/no | ... | ownership map | go / blocked / keep |
| google-calendar | ... | ... | ... | ... | ... |
| google-drive | ... | ... | ... | ... | ... |
| vercel | ... | ... | ... | ... | ... |
| spotify | ... | ... | ... | ... | ... |
| linkedin | ... | ... | ... | ... | ... |
| microsoft-todo | ... | ... | ... | ... | ... |
| github | api.githubcopilot.com/mcp | n/a | n/a | none | keep (verify) |
```

Inspect at minimum: `backend/mcp/config.py`,
`backend/mcp/composio_service.py`, `backend/mcp/provider_ownership.py`,
`backend/mcp/manager.py`, `backend/tools/registry.py:412-560`,
`backend/mcp/guidance.py`, `~/.amethyst/config/mcp.yaml`,
`frontend/src/**/ConnectorsTab*`.

## Task 1 — Composio capability verification gate

**No service migrates without this.** For each target service, query the
Composio SDK/API and record the actual toolkit slug and tool slugs:

```python
# run with the configured key: backend/secrets ref "amethyst/composio"
from composio import Composio
composio = Composio(api_key=...)
# list candidate toolkits, then tools per toolkit
toolkits = composio.toolkits.get()          # or GET https://backend.composio.dev/api/v3.1/toolkits
# for slug in ("gmail", "google-calendar", "google-drive", "vercel",
#              "spotify", "linkedin", "microsoft_todo", "outlook", "todoist"):
#     tools = composio.tools.get(toolkit=slug)
```

For each service record: **exact toolkit slug**, **every tool slug
available**, and **the actions amethyst's current MCP server exposes today**
(compare against the local server's `tools/list`). A missing required action
= `blocked` in the audit table; the service keeps its current path and the
gap goes in the final report.

Terminology (SDK v3.1): toolkit not "app", tool not "action",
`user_id` not "entity id". Use `SESSION_PRESET_DIRECT_TOOLS` where a fixed
tool list is known — it keeps schemas scoped (see index rule 7).

## Task 2 — Google cutover

Prerequisite: Tasks 0–1 show gmail/calendar/drive (at minimum) available.

1. Connect each Google toolkit through the existing flow:
   `POST /api/composio/toolkits/{toolkit}/connect`
   (`composio_service.py` + ConnectorsTab already implement hosted OAuth).
2. Update `backend/mcp/provider_ownership.py` so Composio owns gmail and
   google-calendar whenever the local servers are gone. The precedence rule
   (local-signed-in wins) stays — it must simply find no local servers.
3. `mcp.yaml`: remove `google-gmail`, `google-calendar`, `google-drive`,
   `google-sheets` **only after Task 11 tests pass for each**. Keep them
   present-but-disabled until then (rule: test before decommission).
   `google-workspace` (the merged five-in-one) goes last.
4. Confirm the migration path `amethyst mcp merge-google` is no longer
   offered for new installs — the catalogue entry for `google-workspace`
   local should stop being advertised once Composio covers it.
5. Expected win: the 3586× refresh-400 loop and the 190× withheld-tools
   warnings disappear. Verify in the log after a live run.

## Task 3 — Vercel, Spotify, LinkedIn, Microsoft To Do

Same pattern per service, gated on Task 1:

1. Verify toolkit + tools.
2. Connect through Composio; confirm green `Connected` in ConnectorsTab
   (honest-state contract in `connectors.md` already defines what green
   means: an active connected account, nothing else).
3. For **microsoft-todo**: amethyst mirrors its items into the local tasks
   table and marks `ready` only after the first pull
   (`connectors.md`, lifecycle table). Re-home that sync: the sync job must
   read from the Composio tool results instead of the local server. If that
   is more than a small change, leave `microsoft-todo` local and mark the
   row `keep (sync dependency)` in the audit table — reported, not forced.
4. Remove local `mcp.yaml` entries only after per-service tests pass.
5. If a service is `blocked` (Task 1), leave it running exactly as it is and
   put it in the report's limitations section.

## Task 4 — GitHub (exception path)

GitHub's hosted MCP (`https://api.githubcopilot.com/mcp/`, already OAuth'd in
`mcp.yaml`) is explicitly allowed to stay. Verify:

- [ ] Sign-in completes and tools list.
- [ ] A real call works (e.g. list issues on a repo) —
      `uv run pytest -m live` or a manual turn.
- [ ] No Composio `github` toolkit is simultaneously enabled
      (`composio_service.DEFAULT_TOOLKITS` currently contains `"github"` —
      remove it there or exclude it in session creation so there is exactly
      one GitHub path).

If it is unreliable → move to Composio and remove the hosted MCP entry.
Either way, end state: **one GitHub integration, documented in the audit
table.**

## Task 5 — Research providers go direct

Goal: Exa, Firecrawl, Tavily (and LangSearch if a key is configured) are
called through **direct APIs behind the research router**, not through their
MCP servers.

1. **Audit what already exists** (much of this is built):
   - `backend/web/router.py` — task-type → provider preference
     (`GENERAL_WEB: [langsearch, exa, tavily, firecrawl]`,
     `SEMANTIC_RESEARCH: [exa, langsearch, tavily, firecrawl]`).
   - `backend/web/circuit_breaker.py` — per-provider availability.
   - `backend/web/search_service.py` (1568 L), `query_planner.py`,
     `research_engine.py`, `extractor.py`, `reader.py`.
   - Direct Firecrawl REST already exists: `backend/tools/builtin/web.py:283`
     (`_fetch_via_firecrawl_rest`, secret `amethyst/firecrawl`).
   - Provider preference plumbing: `backend/api/main.py:6998`.
   Fill a second table: provider | direct path exists? (file:line) | MCP path
   only? | key secret ref | gaps against Task 6 requirements.
2. **Add whatever direct paths are missing** (likely exa + tavily REST
   calls in `web.py` or `backend/web/`), using the existing keychain refs
   (`psok-mcp/exa.api_key`, `psok-mcp/tavily.*` — verify actual ref names in
   `mcp.yaml`) or new refs under `amethyst/<provider>`.
3. **LangSearch**: add only if a free-tier key is provided. No key → skip,
   note in report. Never buy a plan (rule 3).
4. **Remove MCP entries** `exa`, `firecrawl`, `tavily` from `mcp.yaml` only
   after: direct path called successfully in a test AND the MCP server was
   demonstrably redundant (both existed for firecrawl; verify the others).

## Task 6 — Research router hardening (fill gaps, don't rebuild)

Requirements from the spec, checked against what exists:

| Requirement | Exists today? | Work |
| :--- | :--- | :--- |
| Select provider per request, never all | yes (`router.py`) | audit only |
| Request limits | circuit breaker yes; per-key quotas unclear | add per-provider daily/monthly caps |
| Timeouts | partial | one budget per provider, documented |
| Caching | unclear | add TTL cache for identical queries (SQLite or in-memory) |
| Error handling + fallback | circuit breaker + preference order | verify fallback skips exhausted providers |
| Per-provider quota/usage tracking | **no** | **new**: usage ledger (below) |
| Honest failures | must assert | test: a failed search returns an error, never empty-success |

**Usage ledger** (one small table, e.g. `research_usage`: provider, day,
calls, units, last_error): every direct call records provider + status.
Exhaustion marks the provider unavailable for the period and the router
falls to the next preference. Surface counts somewhere readable
(`GET /api/...` or existing status screen — reuse, don't build a dashboard).

## Task 7 — Composio usage counter

Composio free tier = **100 000 tool calls/month**. Track it separately from
research providers (rule 5):

- Count every Composio tool execution (session execute / MCP tool call —
  wherever the call leaves the process; likely
  `backend/mcp/manager.py` or `registry.dispatch` where toolkit prefix
  matches `extract_composio_toolkit`, `registry.py:721`).
- Persist in the same usage ledger, `provider='composio'`.
- Expose current month count; warn at 80% in logs. No auto-downgrade of any
  kind (rules 3–4).

## Task 8 — Local whitelist + prune

After Tasks 2–5 have *tested* replacements:

1. `mcp.yaml` final state: `chrome-devtools`, `fetch`, `playwright`,
   `memory`, `thesvg`, `github` (unless moved), plus any `keep (…)` rows
   from the audit table.
2. Remove: google-* (5), vercel, linkedin, spotify, microsoft-todo (if
   migrated), exa, firecrawl, tavily.
3. The catalogue (`backend/mcp/catalogue.py`) must stop advertising removed
   servers; local OAuth docs (`docs/architecture/mcp-oauth.md`) updated.
4. Native tools untouched: filesystem, shell, desktop/screenshots/clipboard,
   browser — verify they are not MCP-dependent
   (`backend/tools/builtin/{filesystem,shell,desktop,browser}.py`).
5. Confirm nothing outside `mcp.yaml` hard-codes a removed server name
   (`grep -rn "google-workspace\|microsoft-todo\|firecrawl" backend/ frontend/src/`).

## Task 9 — UI

- Connectors tab: **Cloud Connectors section = Composio toolkits only**;
  **Local section = whitelisted servers**. Remove rows for decommissioned
  servers. The unconfigured-Composio honest banner already exists — keep it.
- Settings: research provider keys (Tavily/Exa/Firecrawl/LangSearch) with
  free-tier labels and usage readout (Task 6 ledger).
- Every `Connect` button must still land on the real hosted OAuth flow and
  reflect `lifecycle` truthfully (`connectors.md` honest-state contract).
- No secret values ever rendered (rule 6).

## Task 10 — Secrets audit

- Composio key: existing ref `amethyst/composio`
  (`composio_service.py:SECRET_KEY_REF`) — keep.
- Research keys: keychain refs only. Grep the frontend build and SSE payloads
  for key material: `grep -rn "api_key\|apiKey" frontend/src/ | grep -v
  keychain` — nothing real should surface.
- Logs: confirm no Authorization headers / keys in `~/.amethyst/amethyst.log`
  after a live run.

## Task 11 — Test matrix + report

Automated (add to `tests/`, mocked like the rest of the suite):

1. **Auth**: Composio connect flow mock → toolkit `ready`; unconnected
   toolkit → schema withheld + instructional dispatch error
   (`guidance.composio_sign_in_instruction` path, `registry.py:527-552`).
2. **Tool execution**: one mocked Composio tool call end to end through
   `registry.dispatch`.
3. **Failure**: Composio unreachable → clear error, no retry storm.
4. **Quota exhaustion**: research provider at cap → router falls back;
   Composio counter increments; no silent paid fallback.
5. **Fallback**: preferred provider down → next preference used.
6. **No duplicates**: exactly one path per service (ownership assertions).
7. **Local whitelist**: only whitelisted servers appear in
   `registry.schemas()` output.

Live (opt-in, `pytest -m live` or manual): one real turn per migrated
service using its tools; Google sign-in through Composio completes; log
shows no refresh-400 loop.

**Final report** (append to this file when done — required by the spec):

```markdown
## Migration report — <date>
Migrated: <service → toolkit, evidence>
Remains local: <server, reason>
Kept as-is: github (verified <date>)
Unverified / blocked: <service, missing tools, what would unblock>
Limitations: <quota, sync gap, anything the tests did not cover>
```

## Non-goals

- No new connector framework — `composio_service` / `manager` / `registry`
  are reused, not rewritten.
- No moving local execution (shell, filesystem, screenshots, clipboard,
  computer automation) to the cloud.
- No paid tiers anywhere. No buying a domain / Google verification work
  (the old path — it is explicitly abandoned in favor of Composio).
- No changes to the agent loop, prompts, memory or LLM providers
  (Phases 03–05).
- No migrating a service whose Task 1 verification failed.

## Verify

```bash
uv run pytest tests/ -x -k "composio or connector or mcp or registry or research or router"
uv run pytest tests/ -x
uv run ruff check backend/
cd frontend && npm run lint && npm run build
uv run pytest -m live            # opt-in, needs network + keys
# live log sanity after a real turn:
grep -c "withholding tools of connectors" ~/.amethyst/amethyst.log   # expect 0 new
grep -c "oauth2.googleapis.com" ~/.amethyst/amethyst.log             # expect no new 400 storm
```

## Done when

- [ ] Audit table + Composio verification table filled with real data.
- [ ] Every `go` service migrated and individually tested; replacements
      tested before any `mcp.yaml` removal.
- [ ] Exactly one GitHub path; exactly one path per other service.
- [ ] Research providers call direct; usage ledger records per-provider
      counts; Composio counter separate.
- [ ] `mcp.yaml` matches the whitelist; catalogue and docs updated.
- [ ] Test matrix green; report appended with limitations.
- [ ] `connectors.md` amended (new architecture section replaces the
      "Ownership: Local vs. Composio Split" section).
- [ ] Registry row in `00-INDEX.md` updated.
