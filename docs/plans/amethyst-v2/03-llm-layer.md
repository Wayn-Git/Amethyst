# Phase 03 — LLM layer hardening

Depends on: Phase 01 (compression signal + summary call must be working
first). Reads: `00-INDEX.md` + this file.

Scope: retries, retry gating, context windows, compaction, prompt caching
shape, bad-key memory, fallback parity, watchdog. No agent-loop semantics
(Phase 04), no memory/recall (Phase 05), no connectors (Phase 02).

Reference implementation: OpenMausBot at
`/home/wayne/Documents/GitHub/OpenMausBot-main` — cited as "port this
shape". Read the cited file when you need the exact algorithm; do not import
anything.

---

## Current state (verified)

| Area | Where | Status |
| :--- | :--- | :--- |
| Retries | `backend/runtime/http.py:28,33,34` — `MAX_RETRIES=3`, `MAX_STREAM_RETRIES=4`, `TRANSIENT_EXCEPTIONS` | exists, ordering unclassified |
| Failure taxonomy | `backend/runtime/failures.py:58-101` — `FailureKind` + `ProviderError` | good, build on it |
| Fallback chain | `backend/runtime/chain.py:66,94` — `MAX_FALLBACK_LINKS=2`, shared `AttemptBudget=10` | brittle (see Task 5) |
| Router | `backend/runtime/router.py:90,249,312` — size/tools/headroom/availability scoring | keep |
| Availability dark-cache | `backend/runtime/availability.py:77,72` — failure TTL 300 s | keep (Phase 01 Task 2 fixes the call site) |
| Timeouts | `openai_compat.py:296` 300 s; anthropic/google 120 s | keep, document |
| Context window | `openai_compat.py:625-641` `_context_window()` → substring match else **128 000**, used at `:675` | guess — Task 2 |
| Compression trigger | `director.py:1315-1318` threshold 0.5 × window; signal fixed in Phase 01 | pipeline incomplete — Task 3 |
| History budget | `backend/agent/prompt.py:1093` `budget_history` drop-oldest | only real compaction today |
| Prompt split | none | Task 4 |
| Bad-key memory | none — 11× opencode `403 FreeTierError` re-hit live | Task 6 |
| Watchdog / `max_seconds` | `director.py:96-107` `max_seconds=0.0` (uncapped); interactive path sets only `max_iterations` (`api/main.py:1341`) | Task 7 |

Live log evidence: `opencode-zen` 403 on non-default models ×11 (turn burns a
hop, warns, then depends on `mistral` (400/401 seen) and `nvidia` (503 seen));
`stream connection dropped before content` ×14 handled by full-stream retry.

---

## Task 1 — One retry classifier, correct ordering

Shape to port: OpenMausBot `server/drivers/retry.ts` — a **pure** module (no
timers, no I/O) that classifies an error, plus scheduling done by callers.

Rules, in order (order is the design — later matches must not preempt
earlier ones):

1. **Terminal, never retry**: auth (401/403 key rejection), invalid request
   (400 schema/param), unknown model, provider safety block, user
   cancellation/interrupt.
2. **Quota/subscription patterns before generic 429** — a subscription
   "usage limit" answer is terminal even though providers label it
   rate-limit. Reference: `retry.ts:54-58`.
3. **Transient**: 429 (true rate limit, honor `Retry-After`), 5xx,
   connection reset, timeout, "stream dropped before content".
4. Retry schedule: 3 attempts, 1s/3s/8s + ±25% jitter (`retry.ts:12,125`).
5. Cancel during backoff returns cleanly — no zombie wake-up.

Implementation: extend `backend/runtime/failures.py` (it already owns the
taxonomy) with `classify(exc, status, body) -> FailureKind`, and make
`http.py` / adapters consult it. Keep `FailureKind` members; add whatever
members are missing (safety-block, user-cancel) rather than string-matching
at call sites.

**Tests:** quota-before-429 ordering; safety block never retried; cancel
during backoff; each transient kind retried up to 3 with the schedule.

## Task 2 — Real context windows

1. `_context_window()` (`openai_compat.py:625-641`): source the window from,
   in order: (a) explicit `context_window` in `providers.yaml` entry,
   (b) `~/.amethyst/config/models_dev_catalog.json` (already on disk),
   (c) pattern table, (d) 128 000 last resort. Log which source won for the
   chosen model at turn start (debug level).
2. Declare `context_window` for the live defaults in
   `~/.amethyst/config/providers.yaml` (`opencode-zen/space-bunny-free`,
   `mistral/ministral-8b-2512`) — today none is declared, so every
   compaction decision runs on the guess.
3. Do not fetch a remote catalog at turn time; if you add fetching, cache it
   like `providers.yaml` backups already do and degrade to the on-disk copy.

Reference: OpenMausBot `server/context-budget.ts` (three-source precedence)
and `server/model-catalog/catalog.ts` (never throw, never replace good cache
with empty).

## Task 3 — Compaction pipeline (post-Phase-01)

Phase 01 fixed the *signal* (`should_compress(history…)` broken at
`director.py:1587`) and the *summary call* (`context_compressor.py:405`).
This task completes the pipeline:

1. **Trigger**: measured tokens (fall back to `chars/4`) ≥
   `min(0.8 × window, window − safety)` — replace the 0.5 × window constant
   at `director.py:1315-1318` only if the math says so; document the chosen
   formula in a comment with the numbers.
2. **Keep the last 2 exchanges verbatim** — fold only what is above the
   fold point (port `compaction-summary.ts:5-11` `foldPoint`).
3. **Summary via auxiliary LLM, 20 s timeout, deterministic fallback** —
   if the summary call fails/times out/returns junk, build a deterministic
   truncation summary (head + tail markers), never fail the turn
   (port `compaction-summary.ts:47-73`).
4. **Prompt-injection framing**: the summary prompt must state the summary
   is *data, never instructions* (`compaction-summary.ts:38`).
5. **Record it**: persist a `compaction` marker (tokens before, fold point,
   which method ran) so long chats are debuggable — mirror
   `context-rebuild.ts:56`'s anchor check so replay still works after a fold.
6. **Orphan healing**: `prompt.py:1107` heals *leading* orphan tool results
   only — extend to any orphan pair created by the fold.

**Tests:** fires near threshold; keeps last 2 exchanges; summary timeout →
deterministic fallback, turn still succeeds; injection framing present;
budget_history no longer the only path in a long synthetic conversation.

## Task 4 — Stable/volatile prompt split

Port `server/system-prompt.ts:46-62` + `server/drivers/prompt-split.ts`:

- System prompt becomes `stable` (persona, rules, skill index — changes
  rarely) + `volatile` (time, environment, current connector state —
  changes every turn).
- Stable rides the cached system prefix; volatile rides the **newest user
  message**, so provider prefix caching survives volatile churn.
- Start conservative: keep both in one system message if the provider
  adapter can't split, but order stable-first and stop re-emitting volatile
  blocks that did not change.

Touch points: `backend/agent/prompt.py` (builder), the adapters' message
assembly. Measure: same second turn should have an identical stable prefix
hash — add a debug log of the stable-prefix sha256 to prove it.

## Task 5 — Fallback chain: capability parity

Problem today: `chain.py:174` — each fallback link uses its own
`default_model`; a 128k history can land on a much smaller model, and
`director.py` already warns about exactly this ("Carrying a 200,000-token
history into a 32,000-token fallback…"). Rules:

1. Before invoking a fallback link, check the *rebudgeted* history fits its
   window (Task 2 data + Phase 01 compaction). If it cannot fit even after
   compaction, skip that link with a logged reason — do not send it.
2. One attempt per chain index per turn (no index retries) — matches the
   shared `AttemptBudget` intent; make it explicit.
3. Consider raising `MAX_FALLBACK_LINKS` from 2 only if Task 5 tests show a
   single bad hop still kills turns; if raised, keep `AttemptBudget` total
   capped (10) so raising links cannot multiply spend.
4. `router: nothing can answer` (5 live occurrences, 3 with **0 providers
   considered**) — find and fix: every failure mode must leave at least the
   configured chain *considered* and the reason recorded.

Reference: OpenMausBot `server/automatic-recovery.ts:8-20` (recovery only on
`TurnNotStartedError` + capability parity gate) and
`server/index.ts:10996-11050`.

## Task 6 — Bad-key / free-tier memory

Live: opencode `403 FreeTierError` ×11 on non-default models — each burns a
hop before discovery.

Port `server/key-rejections.ts:10-53`:

- On 401/403 with a key/model rejection signature, record
  `fingerprint = sha256(key_ref + base_url + model_pattern)` → TTL cache.
- While cached, the router skips that (provider, model) pair and says why
  in the turn's fallback notice.
- Clear on next success with the same pair.
- Never store the key itself — only the fingerprint (rule 6, index).

**Scope check:** the 403 is "free tier can only be used from within
OpenCode" — that is a *provider policy* failure, so classify it terminal
for that model and route to the next link immediately (Task 1 rule 1).

## Task 7 — Watchdog + wall-clock cap

1. `max_seconds`: interactive path must set it (`api/main.py:1341` builds
   guards with only `max_iterations`). Choose a default (e.g. 600 s),
   configurable next to `config.py:496`.
2. **Activity-based watchdog**, port `server/turn-watchdog.ts:1-16`:
   - Reset on *any* turn event (token, tool call, heartbeat) — a
     1-hour streaming turn is healthy.
   - Kill when zero activity for N minutes (default 20, configurable).
   - Exempt turns `awaiting_approval` / `awaiting_input` (the frontend
     silence watchdog at `Chat.jsx:74,1756-1763` already exempts them —
     match it).
   - On kill: terminal frame + `phase='failed'` +
     `error="stalled: no activity for N minutes"` (never NULL — Phase 01
     Task 7).
3. Surface watchdog kills distinctly from provider errors in logs.

## Task 8 — Retry visibility

A retry the user can't see reads as a hang. Port the surfacing pattern
(`OpenMausBot server/index.ts:7938-7945`): emit a turn event on retry —
`retrying — attempt N/3 in Ns (<short reason>)` — rendered as the existing
activity chip. Check `backend/api/main.py` SSE event vocabulary and extend it
once.

---

## Non-goals

- Changing providers/keys beyond what Tasks 2/5 need (no new providers).
- Streaming protocol rework (adapters keep their SSE handling; only the
  classification of errors changes).
- Prompt content/persona changes (Phase 04 owns prompt budgets; the persona
  text itself is untouched).
- A provider-level circuit breaker beyond the existing `availability.py`
  dark-cache.

## Verify

```bash
uv run pytest tests/ -x -k "retry or failure or chain or fallback or router or watchdog or budget or compress"
uv run pytest tests/ -x -k "turn_resilience or streaming or routing"
uv run pytest tests/ -x
uv run ruff check backend/
```

Existing suites that must stay green: `test_turn_resilience.py`,
`test_providers_and_fallback.py`, `test_routing_and_exhaustion.py`,
`test_stream_resume.py`.

## Done when

- [ ] One classifier module with the 4 ordering rules, tested.
- [ ] Context window sourced (yaml → catalog → pattern → 128k) with the
      source logged; live defaults declared in `providers.yaml`.
- [ ] Compaction fires on history, keeps last 2 exchanges, falls back
      deterministically, records itself.
- [ ] Stable prefix hash identical across consecutive turns (debug log).
- [ ] Fallback skips links that cannot fit the rebudgeted history;
      `nothing can answer` always names considered providers.
- [ ] 403-key pair skipped by fingerprint on subsequent turns.
- [ ] Interactive turns have `max_seconds`; activity watchdog kills stalls
      with a terminal frame, exempting approval waits.
- [ ] Retries visible as a turn event.
- [ ] `uv run pytest tests/ -x` green, `ruff check backend/` clean.
- [ ] Registry row in `00-INDEX.md` updated.
