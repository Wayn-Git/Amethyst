# Phase 06 — Evals: a regression net that catches the next failure class

Depends on: Phase 01 (its four gap tests are the seed).
Benefits from: 02–05 being done first, so fixtures capture the fixed
system. Can start the skeleton earlier if a session wants — read this file
then.

Reads: `00-INDEX.md` + this file.

Scope: evaluation harness, fixtures, skill bench, CI wiring. No production
code changes except tiny hooks the harness needs (test seams), each called
out explicitly.

---

## Why

Amethyst has 100 test files (79 mocked, none against a live LLM) and still
shipped: a compression path that never fired, a subagent resolver that
always returned `None`, a failure recorder that silently no-op'd, and 5 runs
that ended with no terminal frame. Unit tests mock the layers that fail;
nothing exercises **the turn as a whole**. Meanwhile the live DB holds
**66 real failed runs** — free, honest fixtures.

Principle to adopt (from the reference implementation,
`OpenMausBot-main/evals/README.md:5`): **evaluate the harness, never the
models.** Scripts drive turns; no network in the default suite.

---

## Task 1 — Tier 1: hermetic scenario harness

Port the shape of `evals/` (scenarios → run → snapshot → score):

1. **Scripted provider**: a fake provider that replays a *plan* — a list of
   scripted assistant turns (text, tool calls, errors, truncations) — through
   the **real** `director` loop, registry and prompt assembly. No network,
   no API keys, deterministic.
   - The repo already fakes providers in `tests/` — locate the shared fake
     (grep the `test_turn_resilience.py` / `test_stream_resume.py` helpers)
     and build on it rather than starting a parallel one.
2. **Scenario format**: one JSON/YAML per scenario in
   `tests/evals/scenarios/`:
   ```yaml
   name: compression-keeps-last-two-exchanges
   script:            # provider responses, in order
     - tool_call: {name: "web_search", args: {...}}
     - text: "..."
   expect:
     tool_calls: [web_search]
     prompt_includes: ["skill index line"]
     prompt_omits: ["<withheld tool>"]
     terminal_frame: done
     run_phase: completed
   ```
3. **Assertion kinds** (minimum set, port from `evals/types.ts:89-124`):
   `toolCalls`, `toolNames`, `turnOrder`, `promptIncludes`,
   `promptOmits`, `terminalFrame`, `runPhase`, `retries`,
   `compactionMarker`.
4. **Runner**: `uv run pytest tests/evals/` (or a `scripts/run_evals.py`)
   — runs every scenario, prints a pass/fail table. Frozen expected prompt
   snapshots live beside scenarios and are re-recorded only deliberately
   (`--record`), never automatically in CI.

**Seed scenarios — one per bug this plan fixed:**

| Scenario | Asserts |
| :--- | :--- |
| subagent gets a model | subagent path resolves (Phase 01 T1) |
| compression fires on history | `should_compress` sees history (P01 T3) |
| summary fallback | summary timeout → deterministic fold, turn completes (P01 T4) |
| terminal frame always | every script end state → `terminalFrame` + non-NULL error on failure (P01 T7) |
| stop interrupts | `stop_turn` async ends run `cancelled` (P01 T5) |
| malformed batch | duplicate tool id → refuse, no execution (P04 T1) |
| quota then fallback | scripted 429-quota → classified terminal → next link (P03 T1/T5) |
| 403 fingerprint | second turn skips known-bad model pair (P03 T6) |
| watchdog kill | no-activity script → `failed`, error names the stall (P03 T7) |
| omission notice | withheld tools ⇒ prompt says so (P04 T6) |
| result trim | oversized tool result → 8k + marker (P04 T8) |
| recall without embeddings | Ollama-down script → keyword recall in prompt (P05 T2) |

## Task 2 — Tier 2: golden fixtures from real failures

1. Take representative rows from `~/.amethyst/amethyst.db` `agent_runs`
   where `phase='failed'` (66 available) — especially the 5
   `error=NULL, iteration=0` and a sample of the 52 `CancelledError` ones.
2. **Redaction pipeline** (port `evals/golden/redact/`): rewrite ids, names,
   emails, URLs, key material; then run a **leak scan** that fails the
   pipeline if anything resembling a secret survives. Only redacted fixtures
   are committable.
3. Each fixture becomes: transcript (roles + tool calls) → replayed through
   the scripted provider → expected end state. The point: **the exact
   failures that hurt you become tests that must never recur.**
4. Fixtures live in `tests/evals/golden/` with a `README` line each saying
   what failure class it represents.

## Task 3 — Skill bench

Port `evals/runners/run-skill-bench.ts` + `evals/scorers/skill-bench.ts`:

1. For each bundled skill (Phase 04's budgeted index), run a prompt twice
   through the scripted harness: **skill enabled vs disabled**.
2. Score the *contrast* (did the skill change the tool calls / prompt as
   designed — not "did the model answer well").
3. Flag **non-discriminating** assertions (identical both arms = control,
   not effect) and **high-variance** assertions (flip across repeats).
4. Token accounting: `chars/4` estimate, reported per arm — this is also the
   evidence for Phase 04's skill budget.
5. Trigger sets: each skill ships the user phrases that should activate it,
   with train / held-out split (`evals/skill-bench/triggers/` pattern).

Cheap v1 acceptable: bench runs for the 3–5 bundled skills in
`backend/skills/builtin/` only; `agents/skills/` is Phase 04's decision.

## Task 4 — Tier 3 (optional, env-gated live evals)

Only if a session has budget for it after 1–3:

- Gated behind `AMETHYST_EVAL_LIVE=1`, never in default CI.
- Thresholds in a committed config (`minScore`, `maxDrift`, timeouts).
- **Judge prompts sha256-pinned** in the manifest — loader refuses a
  mismatch; edits require an intentional bump (port
  `evals/live/judge/judge.ts:25-40`).
- Strict verdict schema (0–1 + reason) so a chatty judge cannot flatter a
  pass.
- Uses the live providers from `providers.yaml` — counts against their
  quotas, so keep runs small and recorded in the usage ledger (Phase 02
  Task 6).

## Task 5 — CI wiring

1. Inspect `.github/workflows/` — `amethyst-automation.yml` and
   `automation-runner.yml` exist; **neither is a test gate** unless proven
   otherwise. Add `tests.yml`: on PR — `uv sync`, `uv run pytest tests/ -x`,
   `uv run ruff check backend/`, frontend lint+build.
2. Eval suite (`tests/evals/`) runs in the same job — it is hermetic, so it
   is free in CI.
3. No live tests in CI (keys don't exist there; `addopts = "-m 'not live'"`
   already enforces this — keep it).

## Task 6 — Document the harness

Short `tests/evals/README.md`: how to add a scenario, how to re-record a
snapshot deliberately, what each assertion kind means, how to read a skill
bench contrast, and the rule *"fixtures are redacted or they are not
committed"*. This file is what makes future sessions able to extend the net
without re-deriving it.

---

## Non-goals

- No LLM-as-judge in the default suite (hermetic only).
- No coverage targets or flaky-test quarantine infrastructure.
- No replaying *production* prompts containing user content without
  redaction — the leak scan is mandatory, not best-effort.
- No changes to production behavior; if a harness seam is unavoidable
  (e.g. exposing the scripted provider), add it as an explicit, minimal,
  commented test seam and list it in the phase report.

## Verify

```bash
uv run pytest tests/evals/ -x          # hermetic, fast
uv run pytest tests/ -x                # whole suite still green
uv run ruff check backend/ tests/evals
# redaction leak scan must fail loudly on a planted secret (self-test)
# CI: open a PR and confirm tests.yml runs the two commands above
```

## Done when

- [ ] Scripted provider runs the real director loop with zero network.
- [ ] ≥12 seed scenarios green (the table in Task 1).
- [ ] ≥5 real failed runs redacted, committed, replaying to a defined
      expected state; leak scan has a self-test.
- [ ] Skill bench runs with/without arms and flags non-discriminating
      assertions.
- [ ] CI runs pytest + ruff (+ frontend lint) on PRs.
- [ ] `tests/evals/README.md` exists.
- [ ] (If Tier 4 skipped: note "not built, on purpose" with the reason.)
- [ ] Registry row in `00-INDEX.md` updated.
