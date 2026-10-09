# Phase 05 — Memory: recall, timeouts, extraction, upkeep

Depends on: Phase 03 (context budget owns big history; memory must not fight
it). Reads: `00-INDEX.md` + this file.

Scope: recall path, retrieval reliability, extraction, upkeep. Conversation
compaction is Phase 03 — do not touch it here.

---

## Current state (verified)

| Area | Where | Status |
| :--- | :--- | :--- |
| Fact caps | `backend/memory/service.py:28` — `MAX_FACTS_IN_PROMPT=30`, `MAX_FACT_CHARS=400` | sane, keep |
| Recall injection into turn | `director.py:2799` — **0.4 s timeout**, `except Exception → []` | fails silently and constantly — Task 1 |
| Retrieval injection | `director.py:2932` — **0.4 s timeout**, same swallow | same — Task 1 |
| Embeddings | `backend/retrieval/embeddings.py:33` `_UNREACHABLE` — Ollama down ⇒ keyword-only | ×77 live warnings; BM25 fallback exists (commit `004abbb`) — Task 2 |
| Memory extraction | post-turn (`commit a93bc7b` isolated it) | live failure: `401 Invalid API Key` (2026-10-05) — Task 3 |
| Upkeep (merge/contradict) | none | Task 4 |
| Fidelity guards | `budget_history` (`prompt.py:1093`) orphan healing **leading only** (`:1107`) | extend in Phase 03 Task 3 if not already done |
| Live evidence | log: `semantic search unavailable…Ollama` ×77, DNS `Temporary failure in name resolution` ×187, `memory extraction candidate failed … 401` | |

---

## Task 1 — Make recall/retrieval timeouts real

Both side channels answer in 0.4 s or return `[]` with no log line — a
timeout is indistinguishable from "nothing matched". That is why memory
*looks* broken even when it works.

1. Raise budgets: recall **2.0 s**, retrieval **2.0 s** (they run per turn;
   Phase 03's watchdog has headroom). Keep them configurable beside
   `config.py`.
2. **Log every timeout separately from empty results:**
   `log.warning("recall timed out after %.1fs (provider=%s)", …)`.
3. Distinguish three outcomes in code: `ok(results)`, `empty`, `failed` —
   only `empty` is allowed to disappear silently.
4. Never let a memory failure fail the turn (current contract, keep it).

**Tests:** timeout path logs and returns empty; provider error path logs;
real hit returns within budget with a fake fast provider.

## Task 2 — Recall works without embeddings

Port the shape of `OpenMausBot server/recall.ts:1-41` — SQL-only recall,
**no model call**:

1. Keyword/FTS pass over memory facts + conversation history (SQLite FTS5 —
   `server/message-db.ts` shows the pattern; amethyst's schema lives in
   `backend/db/`).
2. Caps: **6000 chars total**, ≤4 memory hits + ≤4 conversation hits,
   ≥2 matched terms for long queries.
3. Prepended to the **current user message**, never the system prompt (so
   volatile content isn't re-sent as stable prefix — pairs with Phase 03
   Task 4).
4. Fence neutralization: strip/escape fence markers inside recalled text so
   a note cannot close the block (`recall.ts:11`); framing text states the
   block is data, not instructions (`recall.ts:37-41`).
5. When vector search is down (Ollama unreachable), FTS/keyword is the
   **primary** path, not a degraded warning — promote what `004abbb` already
   built: BM25/keyword runs first or in parallel, warning only when *both*
   fail.
6. Keep embeddings as the enhancer when available; add the already-promised
   deadline discipline (vector deadline measured in `004abbb`, verify it is
   still the value you think — `director.py:2932` may have since tightened
   it to 0.4 s).

**Tests:** Ollama down → recall still returns keyword hits; injection frame
present; caps enforced; fence-marker note cannot break the block.

## Task 3 — Extraction actually runs

1. Fix the 401: extraction model credentials — find which key
   `memory extraction candidate failed: mistral … 401` used and repoint it
   to a configured provider (fast tier). Reuse Phase 03 Task 6's bad-key
   fingerprint so a dead extraction key does not retry forever.
2. Extraction stays post-turn and isolated (commit `a93bc7b` did this — do
   not re-couple it to the turn's success path).
3. Failure contract: extraction failure logs once, marks nothing, never
   touches the turn (same as today, but with the log line actually
   appearing — verify it does).
4. Caps: new facts respect `MAX_FACTS_IN_PROMPT` / `MAX_FACT_CHARS`.

**Tests:** extraction called with a configured model; 401 → logged, turn
unaffected; fact caps applied.

## Task 4 — Upkeep (merge, contradict, expire)

Port the shape of `server/memory-upkeep.ts:1-36`:

1. Background job (daily/nightly — amethyst already has
   `backend/scheduling` / `backend/workers` — reuse the scheduler):
   - archive/expire stale facts;
   - merge duplicates (same-subject facts);
   - strike contradictions (flag older claim, keep newest, note why).
2. The contradiction pass runs only with **≥5 entries** (Maus threshold —
   below that it compares noise).
3. Model steps use `generateText`-equivalent with **60 s timeout**; if the
   model is unavailable, the deterministic passes (expire, exact-duplicate
   merge) still run.
4. **Every write is a journal row** with actor `upkeep`, visible in the
   existing Memory panel, **Undo works** (amethyst has
   `backend/journal` — route through it, don't invent a log).
5. Capture pass: quiet turns (no tool calls, short exchanges) are scanned
   for "about me" facts, bounded (`CAPTURE_MAX_TURNS=6` per cycle).

**Tests:** merge collapses two same-subject facts; contradiction keeps newest
+ journals the strike; undo restores; model-down still expires; nothing runs
without journal rows.

## Task 5 — Recall/extract UI honesty

- If memory subsystem is down (Ollama unreachable / DB errors), the user
  should see it once somewhere sensible (status/settings), not 77 identical
  warnings in the log. Deduplicate the log line (log transition, not every
  occurrence) — keep a counter.
- No new UI screens beyond surfacing existing state.

---

## Non-goals

- Vector DB migration, new embedding providers, or changing Ollama's role
  beyond the fallback ordering.
- RAG over documents / retrieval pipeline redesign (that is
  `backend/retrieval`'s existing job — only its reliability is in scope).
- Cross-user/team memory (no such feature exists; do not create one).
- Compaction/history budget (Phase 03 Task 3).

## Verify

```bash
uv run pytest tests/ -x -k "memory or recall or retrieval or embedding or journal or upkeep"
uv run pytest tests/ -x
uv run ruff check backend/
# live sanity (log transitions, not counts):
#   - no repeated identical "semantic search unavailable" spam after Ollama stop/start
#   - memory extraction success/failure line appears after a turn
```

## Done when

- [ ] Recall/retrieval timeouts raised, logged, and distinguishable from
      empty results.
- [ ] Keyword/FTS recall path works with Ollama down; caps + fence guards
      tested; injection on message, not system prompt.
- [ ] Extraction uses a configured key; 401 path tested.
- [ ] Upkeep job runs deterministic passes without a model, model passes
      with 60 s timeout, every mutation journaled + undoable.
- [ ] Log spam replaced by transition logging with a counter.
- [ ] `uv run pytest tests/ -x` green, `ruff check backend/` clean.
- [ ] Registry row in `00-INDEX.md` updated.
