# Phase 01 — Triage fixes

Depends on: none. Reads: `00-INDEX.md` + this file.
Scope: six verified bugs, one design decision, four gap tests. No new
subsystems, no refactors beyond what each fix requires.

Every finding below was verified by reading the code on 2026-10-09 — the
line numbers are real, not inferred. Live evidence comes from
`~/.amethyst/amethyst.db` (150 `agent_runs`: 73 completed / 66 failed / 10
cancelled) and `~/.amethyst/amethyst.log`.

---

## Task 1 — Subagent model resolution always fails

**Evidence.** `backend/agent/runner.py:380-387`:

```python
providers = configured_providers()
if providers:
    first = providers[0]          # KeyError — configured_providers() returns a dict
    return resolve(first.name, first.default_model)
except Exception:
    pass
return None
```

`configured_providers()` returns `dict[str, ProviderConfig]`
(`backend/config.py:261-271`). `providers[0]` raises `KeyError`, the bare
`except Exception: pass` swallows it, and every subagent ends at
"No model available for subagent".

**Fix.**
- Iterate the dict properly: `first = next(iter(providers.values()))`.
- Replace `except Exception: pass` with an `except KeyError` (or drop it) and
  `log.warning("subagent model fallback failed: %s", exc)` — swallowed
  exceptions are how this bug survived.
- Keep the return-`None` contract; the caller already handles it.

**Files.** `backend/agent/runner.py`

---

## Task 2 — Worker failures never reach the availability cache

**Evidence.** `backend/workers/llm.py:172`:

```python
availability.record_failure(provider, "unreachable", str(exc))
```

`record_failure(name: str, kind: FailureKind, message: str = "")`
(`backend/runtime/availability.py:205`) guards with
`if kind not in (FailureKind.UNREACHABLE, FailureKind.UPSTREAM_UNHEALTHY, FailureKind.NON_RETRYABLE_RATE_LIMIT): return`
(`availability.py:218`). A plain `str` never matches, so the call is a
**silent no-op** — the router learns nothing. The comment at the call site
says the opposite: "A worker that fails silently teaches the router nothing."

**Fix.** Pass `FailureKind.UNREACHABLE`. Import the enum at module top.
Add a regression test (Task 8c).

**Files.** `backend/workers/llm.py`

---

## Task 3 — Context compression never fires (wrong argument)

**Evidence.** `backend/agent/director.py:1585-1591`:

```python
if (
    self._context_engine is not None
    and self._context_engine.should_compress(
        estimate_tokens(system_prompt) + tool_schema_tokens(tool_schemas)
    )
):
```

`should_compress` decides "is the conversation near the window edge". The
argument passed is system prompt + tool schema size — a near-constant that
does not grow with the conversation. Compression can therefore never trigger.
Only `budget_history` drop-oldest runs (`backend/agent/prompt.py:1093`), so
long chats silently lose the middle.

**Fix.** Pass the history size:

```python
self._context_engine.should_compress(
    estimate_tokens(history) + estimate_tokens(system_prompt) + tool_schema_tokens(tool_schemas)
)
```

Confirm against `ContextCompressor.should_compress`'s actual signature before
editing (`backend/agent/context_compressor.py`). Keep the schema tokens in
the sum — schemas count against the window too.

**Files.** `backend/agent/director.py`, read `backend/agent/context_compressor.py`.

---

## Task 4 — Summary LLM call is triple-broken

**Evidence** (all in `backend/agent/context_compressor.py`):

1. `:405` — `client.complete(messages, params={"max_tokens": self.max_tokens})`
   passes a raw dict where `ModelParameters` is expected → `AttributeError`,
   swallowed at `:414` as `log.warning("summary LLM call failed: %s", exc)`.
   Correct shape (see `backend/workers/llm.py:166`):
   `client.complete(messages, None, ModelParameters(max_tokens=max_tokens))`.
2. `:21` / `:189` — default model `mistralai/mistral-7b-instruct-v0.3`
   parses to provider `mistralai`, which is not configured → resolution fails
   before any call. Default must resolve to a configured provider (use the
   fast tier from `config/providers.yaml`, never a hard-coded model id).
3. `:400-407` — `asyncio.new_event_loop()` + `loop.run_until_complete` on a
   sync path inside the async turn. If this ever ran it would block the event
   loop and stop SSE heartbeats (`backend/api/main.py:1004-1056` expects a
   frame every 10 s).

**Fix.**
- Correct the `complete()` call shape.
- Default model = configured fast-tier provider, resolved at call time; if
  none resolves, return `None` (deterministic fallback path) — never raise.
- Make the call properly async (the surrounding turn is already async) or,
  if the compressor must stay sync, run it via `asyncio.to_thread` on a
  caller-provided loop. No `new_event_loop()` inside the turn.
- Keep the `except` → `log.warning` → `None` contract: a failed summary must
  degrade to drop-oldest, never fail the turn.

**Files.** `backend/agent/context_compressor.py`

---

## Task 5 — Stop endpoint runs on the threadpool

**Evidence.** `backend/api/main.py:3253` defines `def stop_turn(...)` (sync →
Starlette threadpool) while its own docstring at `:3256-3259` says
"Async on purpose". It sets an `asyncio.Event` (`backend/agent/director.py:271`)
from the wrong thread — `Event.set()` off-loop is not guaranteed to wake a
waiter, so Stop can silently do nothing.

**Fix.** `async def stop_turn`. Confirm no blocking work inside (if there is,
move it off the loop explicitly). Verify Stop actually interrupts a running
stream (test below).

**Files.** `backend/api/main.py`

---

## Task 6 — Client disconnect kills the server turn (decision + fix)

**Evidence.**
- `backend/agent/director.py:996-1013`: `except BaseException` records
  `the turn was interrupted: CancelledError`, yields an `error` event,
  re-raises. **52 of 66 failed runs** in the live DB carry exactly this
  string. The comment explains it is deliberate — Starlette drops the task
  when the SSE client goes away, and swallowing would keep a zombie loop
  alive.
- The frontend promises the opposite: `frontend/src/views/Chat.jsx:2124` and
  `frontend/src/api.js:547-549` tell the user aborting the read leaves the
  turn running.

The backend and the UI are describing two different systems. Pick one.

**Decision (recommended): detach, don't kill.** The UI copy is the behavior
users should get — aborting the *read* should not cancel the *work*. Amethyst
already has the pieces: turns are recorded in `agent_runs`, dangling tool
calls are healed in `finally` (`director.py:800-831`), and the frontend has
a reconnect/watchdog path (`Chat.jsx:74, 1756-1763`).

**Fix sketch.**
- Run the director as a detached task keyed by `agent_runs.id`. SSE
  subscription is an observer; client disconnect unsubscribes the observer
  but does not cancel the task.
- On reconnect, replay from the run row (events must be persisted as they are
  produced, or at minimum final state + text — check what `state.carried`
  already gives you).
- Explicit user **Stop** still cancels — that path stays `director.py:1835-1848`.
- Server shutdown may still cancel; the `BaseException` handler stays as the
  last-resort reporter.
- **Do this in a branch and load-test it**: detached turns mean a closed
  browser can still burn provider tokens. Bound them (see Phase 03's
  `max_seconds`) before shipping.

If this proves too large for Phase 01, fall back to the cheap fix: correct
`Chat.jsx:2124` / `api.js:547-549` to say the turn *stops* when you leave —
but record the decision in `docs/architecture/turns.md`. Silence is not an
option: today the docs and the code disagree.

**Files.** `backend/agent/director.py`, `backend/api/main.py`,
`frontend/src/views/Chat.jsx`, `frontend/src/api.js`,
`docs/architecture/turns.md`

---

## Task 7 — Terminal frame audit

**Evidence.** 5 failed runs have `phase='failed'`, `error=NULL`,
`iteration=0` — no terminal frame written. The UI renders
"The turn ended without a result" (`frontend/src/views/Chat.jsx:1809`,
`backend/api/main.py:~3240`). There is a guaranteed-terminal-frame path
(`main.py:~3238`) but some `_run` return path reaches the DB without it.

**Fix.**
- Enumerate every return/raise path of the turn runner (`_run` and the SSE
  endpoint above it). Each must either yield a terminal event (`done` /
  `error`) or be one of the explicit detached cases from Task 6.
- Where a path can return empty, write a synthetic
  `error: "turn ended without a result"` so `agent_runs.error` is never NULL
  for `phase='failed'`.

**Files.** `backend/api/main.py`, `backend/agent/director.py`

---

## Task 8 — Tests (the four known gaps + Stop)

These four paths have zero coverage today; they are why the bugs above
survived.

- **8a.** `tests/test_context_compressor.py` — imports `ContextCompressor`,
  covers: `should_compress` fed growing history fires; summary call with the
  correct `ModelParameters` shape; summary failure falls back to
  deterministic/drop-oldest without raising; unresolvable default model
  returns `None`. (No test in the repo imports `context_compressor` at all.)
- **8b.** `tests/test_subagent_model_resolution.py` — `runner._resolve_model`
  with an empty registry, a populated one, and `configured_providers()`
  returning a dict (the Task 1 bug: `providers[0]` on a dict).
- **8c.** Availability kinds — `record_failure("x", FailureKind.UNREACHABLE)`
  writes the cache entry; `workers/llm.py` passes an enum, not a str (assert
  the call site via a small unit test of the worker's failure path).
- **8d.** Terminal frame — for every `_run` return path, the SSE stream ends
  with a terminal event and the run row has a non-NULL `error` when
  `phase='failed'`.
- **8e.** Stop — `stop_turn` is async and actually interrupts a running turn
  (reuse the harness in `tests/test_stop_and_streaming.py`).

---

## Non-goals

- No retry/compaction/fallback redesign (Phase 03).
- No tool-loop or prompt-budget changes (Phase 04).
- No connector/MCP changes (Phase 02).
- No renaming, no formatting passes, no comment archaeology beyond what a
  task requires.

## Verify

```bash
uv run pytest tests/test_context_compressor.py tests/test_subagent_model_resolution.py -x
uv run pytest tests/ -x -k "stop or terminal or availability or runner or compress"
uv run pytest tests/ -x
uv run ruff check backend/
cd frontend && npm run lint   # Task 6 touches Chat.jsx / api.js
```

## Done when

- [x] All six fixes merged with their tests green.
- [x] Task 6 decision recorded either in code (`turns.md` updated) or as the
      detach implementation. (Chose `turns.md`; detach stays out of Phase 01's
      scope.)
- [x] No `agent_runs` row can have `phase='failed'` and `error IS NULL`. (The
      backstop enforces it from now on; the 8 historical rows were backfilled
      with `the turn ended without a result` — the same text the SSE frame
      uses — and the table checked back to 0. Backup:
      `/tmp/opencode/amethyst.db.bak-*`.)
- [ ] `uv run pytest tests/ -x` green, `ruff check backend/` clean. **Not
      achievable in this tree, and not Phase 01's to fix:** the suite has 7
      failures, all proven outside this phase — 2 fail at pristine HEAD, the
      other 5 trace to uncommitted resume/catalogue edits (re-running them at
      HEAD plus *only* Phase 01's patches gives the same 91-passed/2-failed
      split as bare HEAD). `ruff check backend/` carries pre-existing E501
      noise (the plan's "clean" was aspirational); this phase added zero new
      errors (verified against HEAD via `ruff --stdin-filename`).
- [x] Registry row in `00-INDEX.md` updated.
