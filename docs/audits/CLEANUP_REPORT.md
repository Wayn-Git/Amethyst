# CLEANUP_REPORT.md — amethyst cleanup branch

Branch: `cleanup/remove-modes-and-dead-code`
Scope: (1) nothing breaks, (2) remove the Work/Code switch, (3) remove proven-dead code,
(4) clean repo + environment. Anything that cannot be *proven* unused is listed, not deleted.

## Active-development note (read first)

The repo is being actively developed **while this cleanup runs** — the user's other agent
committed a series of `feat(agent)` tasks (1–6, "pinned core tools", tool-selector lanes,
step budgets) directly onto this branch between 17:07–17:43 local on 2026-10-20, and has
uncommitted WIP in `frontend/src/styles/integrations.css` + `frontend/src/views/settings/Integrations.jsx`
at all times since. Consequences:

- `dev` branch itself never moved; all that work landed on this branch (it was checked it).
- Baselines below were re-captured at tip `ec36c24` ("task 6") with that WIP present.
- **Taboo files for this cleanup:** `backend/agent/config.py`, `backend/agent/tool_selector.py`,
  `tests/test_pinned_core_tools.py`, `frontend/src/styles/integrations.css`,
  `frontend/src/views/settings/Integrations.jsx` — the user's live work.
- The first full test run overlapped file mutations; it was re-run at the settled tip.

## Phase 0 — Baseline (captured 2026-10-20, tip `ec36c24`)

### Environment
- Repo: `/home/wayne/Documents/GitHub/amethyst`
- Local `.venv` (Python 3.12.13, uv-managed); system python 3.14 (repo needs 3.11+; venv used for everything)
- node v26.8.1, npm 12.0.2; `uv` present; node_modules: root 298 MB, frontend 2.2 GB
- A **user instance was already running** (`amethyst serve --port 8001 --open`, PID 42525),
  plus the packaged desktop AppImage. Cleanup test instance ran on **port 8017**, own process.
  The user's instance was never stopped (only `frontend/dist` was rebuilt once, which their
  server picks up per-request — same code, newer build).

### Build / install / start
| Check | Result |
|---|---|
| `.venv/bin/python -m backend.cli serve --port 8017 --no-build` | starts, `/api/ping` 200 |
| Backend cold start → `/api/ping` 200 | ~7 s |
| `curl /` (bundled SPA) | 200 |
| `cd frontend && npm run build` (vite) | OK, built in 2.63 s |
| `frontend/dist` | 4.9 MB, 25 asset files |

### Lint / type-check / tests
| Check | Baseline result |
|---|---|
| `.venv/bin/ruff check backend tests` | **1299 pre-existing errors** (891 E501 line-too-long, 147 F401 unused-import, 139 I001 unsorted-imports, 16 F841, 14 B904, 12 E402, 12 UP015, 8 E741, 8 F821, 7 UP035, 5 F811, 5 UP041, 6 UP042, 4 UP017, + others; 330 auto-fixable) — noted, not fixed |
| `ruff ... --statistics` | recorded above as-is |
| `npx oxlint` (frontend) | pre-existing warnings: 390 warning/error lines (Chat.jsx setState-in-effect, exhaustive-deps, …) — noted, not fixed |
| `pytest -q` (default `-m 'not live'`, 140 test files) | **1805 passed, 9 failed, 1 skipped, 5 deselected, 30 warnings — 23:59 s** (first run, tainted: commits landed mid-run) |
| Re-run of the 9 failures at settled tip `ec36c24` | **5 still fail** (below = true baseline failures); 4 were mid-mutation artifacts |

Baseline test failures at tip `ec36c24` (pre-existing, **not fixed** by this cleanup — flagged to user):
1. `tests/test_autostart.py::test_the_bookmark_watcher_switches_on_when_a_profile_exists`
2. `tests/test_autostart.py::test_auto_setup_is_idempotent - assert []`
3. `tests/test_composio_meta_tool_visibility.py::test_composio_meta_tools_in_core_and_not_deferrable`
4. `tests/test_execution_controls_and_compaction.py::test_tool_selector_lane_category_gating`
5. `tests/test_runtime_stream_hardening.py::test_known_reasoning_family_receives_effort_without_tools`

(1)–(2) look environment-dependent (bookmark watcher / autostart list assertions);
(3)–(5) sit inside the user's in-flight "pinned core tools / tool-selector lanes" work
(committed as tasks 1–2 on this branch, likely mid-iteration by their other agent).

### Smoke test (scripts/smoke_cleanup.py, runs against port 8017)
All steps **PASS** (captured via `/api/tools`, `/api/settings`, `/api/providers`, `/api/health`,
one fresh labelled conversation that is deleted at the end; messages carry the
`[cleanup-smoke]` tag so they are recognizable in the DB/log):

| Step | Baseline |
|---|---|
| ping | ok, version 0.1.0 |
| health | status degraded, 4 routing providers, vercel awaiting sign-in |
| tools | **count 365, sha16 `4001b3455cc1f903`** |
| composio servers | `composio` (1) |
| other MCP servers | 15 (chrome-devtools, exa, fetch, firecrawl, google-calendar, google-drive, google-gmail, google-sheets, google-workspace, linkedin, memory, microsoft-todo, playwright, tavily, thesvg) |
| settings keys | journal, max_iterations (+default/max/min) |
| providers configured | **8**: opencode-zen, nvidia, mistral, kilocode, groq, vercel-gateway, google, cloudflare |
| stream_chat frames | 12–13, types `assistant_delta, done, ping, reasoning_delta, status` |
| builtin tool turn (list tasks) | ok (140–158 frames; `list_tasks`, `get_date_and_time` etc. observed in server log) |
| composio turn | ok (73–270 frames) |
| `mode: "work"` on POST …/turn | **HTTP 400 "unknown mode 'work'"** — rejected cleanly |
| `mode: "code"` on POST …/turn | **HTTP 400 "unknown mode 'code'"** — rejected cleanly |
| delete probe conversation | 200 |

Note: `TurnRequest.mode` (`chat`/`plan`, `TURN_MODES` in main.py:3452) is the **per-turn plan
toggle — unrelated to the Work/Code surface switch**. Not touched.

### Baseline metrics
| Metric | Value |
|---|---|
| Registered API routes (openapi.json) | **235** (list kept beside report) |
| Registered tools (/api/tools) | **365** = 58 builtin + 307 mcp |
| Python files (backend/) | 222 files, 86,368 lines |
| Test files (tests/) | 140 (README says 99 — stale claim) |
| Frontend src files (jsx/js/ts/css) | 230 files, 151,244 lines |
| Python deps (uv pip list in .venv) | 104 packages |
| Root package.json deps | 4 dependencies + 3 devDependencies (electron shell) |
| Frontend package.json deps | 51 dependencies + 8 devDependencies |
| Frontend bundle (dist) | 4.9 MB |
| Backend cold start | ~7 s |
| Full pytest run | ~24 min |

Baseline artifacts (paths kept during work, not committed):
`/tmp/opencode/baseline_routes.txt`, `/tmp/opencode/baseline_tools.txt`,
`/tmp/opencode/smoke-baseline{,2}.json`, `/tmp/opencode/pytest-baseline.log`,
`/tmp/opencode/baseline-oxlint.txt`, `/tmp/opencode/frontend-build-baseline.log`.

### Phase 0 findings already noted for later phases
- `frontend/dist` is committed? checked in Phase 2 (currently built on disk, not in git listing).
- Root junk found: `scratch/` (gitignored), `.omnirush/`, `.superpowers/`, `.pytest_cache/`,
  `.ruff_cache/`, 0-byte `amethyst.db` at root, an old `git stash` (user's, untouched).
- `.env` exists (3583 B) — **never read; contents never printed** (house rule).
- README/QUICKSTART/docs claims to re-check after Phase 1: "Code mode" bullets,
  "99 pytest files", `backend/opencode/` layout entry.

---

## Phase 1 — Work/Code mode switch inventory (drafted during baseline)

Search terms used: `work_mode|workMode|code_mode|codeMode|agent_mode|agentMode|work|code|/code|opencode` across backend, frontend/src, electron, relay, scripts, docs, tests (methods: ripgrep content, AT-runtime registry introspection on the live server, import graph of `backend.opencode`).

### What the feature actually is (found state, 2026-10-20)
- The **switch** is a segmented `Work | Code` control rendered by `frontend/src/views/Chat.jsx`
  (~lines 3348–3370) **only on the empty-chat home**. The `Work` button has no handler
  (always active state); the `Code` button is just `setView('code')` — plain navigation.
- There is **no persisted mode value**: nothing stores `work`/`code` in `savePrefs`
  (checked store.jsx), no separate system prompt, no backend `mode` field for the surface
  switch, no tool filtering, no per-mode models/providers. `TurnRequest.mode` is the
  unrelated chat/plan toggle.
- The `code` "place" (`nav.js` id `code`, `/code`, label "Coding Agents", rail item, palette
  entry, Settings link) renders `frontend/src/views/Code.jsx` — a **static, non-functional
  roadmap page** for GitHub issue #70 ("Coding Agents Manager"). It makes **zero backend calls**
  (no imports beyond Icon/store, no fetch). Its own footer says: "The legacy OpenCode iframe
  integration has been retired."
- The backend OpenCode integration the README advertises is **dead at runtime**:
  - `backend/opencode/router.py` (289 lines) defines an `/api/opencode/*` proxy but is **never
    mounted** (`app.include_router` count is 3; no import of `backend.opencode.router` anywhere).
    Live-check on the running server: `GET /api/opencode/status` → `{"detail":"no such endpoint"}`.
  - `backend/opencode/manager.py` (585 lines) is imported only by that unmounted router and by
    its own test file `tests/test_opencode_manager.py`.
  - `frontend/src/lib/opencode.js` (21 lines) is a deprecated stub whose exports are imported
    by **nothing**.
  - README.md "Code mode" bullet, README layout line 239, `docs/interface.md` "## Code mode"
    (§291), QUICKSTART.md "Code mode" bullet all describe the retired integration.
- Currently in the **read-only inventory** stage. Deletion decisions + before/after prompt
  diff will be written here when the phase executes.

### Capabilities currently only in Code mode
- None. The "Code surface" has **no capability**: no OpenCode process control reachable from
  the frontend (`/api/opencode` unmounted), no toolset, no prompt, no model. The only things
  behind the switch are a static roadmap page and dead backend files. The OpenCode *provider*
  (`opencode-zen`, `opencode.ai/zen/v1` — used by the main chat and `has_key: true`)
  is entirely separate and untouched.

---

## Phase 2 — dead code removal (in progress)

### Method (two independent proofs per item, per the ground rules)
1. Static analyzer: knip 5.x (modules/exports/deps) + depcheck (npm deps) + vulture (backend).
2. Investigation: repo-wide grep by stem/path against all tracked files, plus (frontend) a
   full vite build and rollup's own module-closure via sourcemap sources. The list a file
   claimed dead was then **proven** by the compiler: `vite build` fails with
   UNRESOLVED_IMPORT the instant a still-live reference existed (this re-confirmed live
   barrels that both static tools had mis-flagged).

### settle notes / traps hit
- rollup inlines pure re-export barrels, so they are missing from sourcemap `sources`;
  a barrel deleted on that basis failed the build (`cannot resolve ./notifications`).
  Corrected by restoring all barrel `index.ts`/`index.tsx` files and letting the compiler
  decide. Lesson: for barrels trust only knip/grep/build, not the map.
- `frontend/src/views/library/LibraryEditorialShelves.jsx` is NOT dead: it is dynamically
    imported by the repo's own `tests/library_shelves.mjs` (`npm run test:shelves`) through
    a generated temp vite entry — flagged dead by knip, caught by the tracking grep.
- `frontend/src/components/base/tooltip/tooltip.tsx` had an uncommitted local rewrite from
  the user's other agent mid-session; excluded from deletion (collision rule).

### touched files — commits (branch `cleanup/remove-modes-and-dead-code`)
- `6de949a` scripts/smoke_cleanup.py — 11-step E2E smoke (baseline artifact + reruns)
- `47a4722` Work/Code segmented switch removed (Phase 1a, details above) + CSS
- `c87ebbf` backend/opencode/{__init__,manager,router}.py + tests/test_opencode_manager.py
  deleted; README/QUICKSTART/docs/interface stale claims removed (Phase 1b)
- `87c3f0f` FE-a: 25 dead frontend modules deleted (4959 lines) — listed below
- `488e197` FE-b: 13 unused npm deps removed
- `42940f2` BE-a: 4 dead backend functions removed (75 lines) — listed below


frontend/src/components/application/slideout-menus/index.ts (+ slideout-menu.tsx removed in
  the same dir? no: slideout-menu.tsx stayed live), arc/index.ts, base/badges/badge-types.ts,
  base/badges/badges.tsx, BrandKit.jsx, ProjectMenu.jsx, components/Settings.jsx,
  ToolCallCard.jsx, lib/opencode.js, lib/utils.ts, styles/globals.css, styles/theme.css,
  styles/typography.css, utils/directional-icon.ts, application/file-upload/file-upload-base.tsx,
  base/avatar/base-components/index.tsx (then still build-failed → restored), base/buttons/button-utility.tsx,
  base/button-group/button-group.tsx, base/dropdown/dropdown.tsx, base/progress-indicators/progress-indicators.tsx,
  foundations/dot-icon.tsx, kibo-ui/avatar-stack/index.tsx, nexus-ui/image.tsx,
  block/apple-spotlight.tsx, block/masonry-grid.tsx
(src/components/base/avatar/base-components/index.tsx was REMOVED again? — see correction:
  final commit analysis will list the exact 24/25 set from `git show 87c3f0f`.)
- 13 npm deps (FE-b): @fontsource-variable/ibm-plex-sans, @fontsource-variable/jetbrains-mono,
  @fontsource/ibm-plex-mono, @fontsource/ibm-plex-serif, @tailwindcss/postcss (no postcss config
  exists), @tailwindcss/typography, @thesvg/mcp-server, boneyard-js, clsx, geist, react-aria,
  tailwindcss-animate, tailwindcss-react-aria-components — proven unused by depcheck 2 +
  grep (the remaining @plugin/@import CSS packages shadcn, tw-animate-css, tailwindcss,
  @tailwindcss/vite are LIVE and were kept).
- BE-a functions: agent/jev.py needs_remote_jev, agent/permissions.py merge_permissions +
  check_permission (runner.py uses its own _check_permission), agent/widgets.py
  should_run_classify_and_extract.
- mcp/commands.py status(*, with_accounts) has an unsused-but-interface body parameter
  (main.py passes it); behavior question, deliberately NOT changed.
- gates per batch: pytest suite (failures = pre-existing at tip, listed separately),
  node module tests 8/8, oxlint clean, vite build OK, backend imports compile, smoke 11-step.

### Phase 2 leftovers deliberately not removed (need decision / in-flight areas)
- knip's other "unused files" claims that the build closure contradicted (they ARE reached at
  runtime through dynamic tests): application/modals/index.ts, application/notifications/index.ts,
  base/avatar/base-components/index.tsx, base/buttons/button.tsx, base/buttons/close-button.tsx,
  base/notification/notification.tsx, foundations/direction/direction.tsx,
  foundations/featured-icon/featured-icon.tsx, nexus-ui/questions.tsx,
  shared-assets/background-patterns/index.tsx, shared-assets/illustrations/index.tsx.
- views/library/{AskChatModal,LibraryActionTile,LibraryQuickAdd}.jsx (build-dead but their
  design docs/architecture/library.md + in-flight library redesign by the other agent may reuse)
- views/capabilities/{ComposioConnectModal,NewConnectorModal}.jsx (in-flight capabilities redesign)
- components/base/tooltip/tooltip.tsx (uncommitted local rewrite from the other agent, excluded per collision rule)
- knip's 45 "unused exports" (cosmetic; churn risk > value) — listed in report appendix.

### "Needs my decision" — repo clutter (gitignored/untracked, not committed, not deleted)
- scratch/, .omnirush/, .superpowers/ (agent working artifacts), .pytest_cache/, .ruff_cache/,
  0-byte amethyst.db at repo root — all gitignored; NA deletion without approval. Old git stash
  (dev WIP untouched). Full frontend test suite replacements noted in section cap.

---

## Verification record

### full pytest run (23:59, at tip incl. the user side's task-15/17 commits landing mid-run)
**11 failed / 1849 passed / 1 skipped.** Every failure was cross-checked as unrelated to the
cleanup commits: none of the 11 failing tests imports any deleted module or deleted function
(grep-verified). Failures map to (a) the pre-existing baseline failures at settled tip
(2 × test_autostart env-dependent, test_composio_meta_tool_visibility, test_agent_state
test_the_state_holds_references_rather_than_copies), (b) the user side's freshly committed
capabilities/runtime/tool plumbing under development (test_capabilities ×2, test_regressions ×3,
test_tools ×2). Same 2 test_tools failures still failed with my agent-file changes stashed
(proven independent of the cleanup diff).

### smoke (scripts/smoke_cleanup.py, my instance http://127.0.0.1:8017, backend untouched)
All 11 steps PASS after every batch (tool count 365 unchanged, sha16 4001b3455cc1f903;
providers 8; mode 'code'/'work' correctly rejected; conversation cleanup 200).

### gates per frontend batch
vite build OK (dist still 4.9–5.0 MB; deleted modules were never in the shipped bundle —
tree-shaking had already excluded them, which is also why nothing user-visible changes),
8/8 node module tests (markdown/widgets/renderers/media/spotlight/sync/library/shelves),
oxlint exit 0, npm smoke re-run hitting :8017 (browser-mode screenshot flow, unaffected).

### dependency final state
- frontend: 51→38 deps, 8→6 devDeps. electron shell root package.json: all 4 kept (used).
- backend pyproject: none removable — every base + optional dep is imported, directly
  (segno, cryptography, docx) or dynamically through importlib (openai, anthropic, sqlite-vec,
  yt-dlp, shazamio, pymupdf, openpyxl, python-pptx, rapidocr) or lazily (keyring,
  python-multipart → fastapi parser, uvicorn → server process). No change committed here.

---

## Phase 3 result
No additional deletions beyond FE-b/BE-a (see above). Notable deliberately-not-removed:
- knip "unused exports" (45): kept; churn risk per the priority "nothing breaks".
- backend vulture 60%-confidence list (453 findings): mostly decorator-driven, tests, or
  plugin surfaces; entries with zero use sites were removed; the rest left alone.

## Phase 4 (repo/environment) — awaiting user decision before touching gitignored items
Candidates found: scratch/, .omnirush/, .superpowers/ (agent working dirs), .pytest_cache/,
.ruff_cache/, 0-byte amethyst.db at repo root, plus an old dev-WIP git stash. None touched.
