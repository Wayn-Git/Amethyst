# Phase 04 — Agent loop: tool-call safety, caps, prompt budget

Depends on: Phase 03 (retries/watchdog semantics must be stable first).
Reads: `00-INDEX.md` + this file.

Scope: how tool calls are validated, executed and bounded; how the model is
nudged; what happens at iteration caps; how much tool/skill schema reaches
the prompt. No LLM transport changes (03), no connector changes (02).

Reference: OpenMausBot cited as "port this shape".

---

## Current state (verified)

| Area | Where | Status |
| :--- | :--- | :--- |
| Guards | `backend/agent/director.py:96-107` — `max_iterations=40`, `max_tool_calls=120`, `max_seconds` (Phase 03 adds), `max_repeated=4`, `max_resumes=10` (20 at `director.py:1891`) | caps exist; cap **end behavior** weak — Task 4 |
| Interactive overrides | `api/main.py:1341` sets only `max_iterations=32` (`config.py:496`) | fine |
| Cap exhaustion fallback | `max_iters` defaults to **1000** when guard unset (`director.py:1361`) | dangerous default — Task 4 |
| Tool dispatch guards | `backend/tools/registry.py:462-494` — unknown tool, connector-disabled, plan-mode refusal | good |
| Malformed args | `_parse_arguments` → `{"_raw": …}` silently tolerated (openai_compat) | decision — Task 2 |
| Duplicate tool-call IDs | not validated | Task 1 |
| Batch validation before execution | not done — calls execute as they parse | Task 1 |
| Announce-only replies ("Checking…") | no nudge | Task 3 |
| Repeat detection | `max_repeated=4` hard stop only | Task 5 |
| Iteration cap end | turn dies; no handoff | Task 4 |
| Tool schemas | ~29.6k tokens over 132–178 tools (`director.py:1443-1446`, `types.py:44-53`); progressive disclosure `offered 13, withheld 65` (`tool_search.py:36-57`) | big win available — Task 6 |
| Skill loading | `backend/skills/loader.py:28,101,118` name+description, 5 s scan TTL, `view_file` disclosure; pinned skills inlined (`prompt.py:477-479`) | sound; no byte budget — Task 7 |
| `agents/skills/` | 50 dirs, ~1.1 MB, referenced by **no** code/config/Dockerfile | dead — Task 7 |
| MCP/Composio result size | untrimmed | Task 8 |

---

## Task 1 — Validate the whole tool batch before executing any

Port `openai-chat.ts:677-682` + `openai-chat-protocol.ts:38-95`:

1. Accumulate the model's tool calls for a round, then **validate the full
   batch before executing call 1**:
   - every call has a stable, unique id (duplicate id → **hard refuse**,
     result text: "refusing to repeat an operation" — a duplicate id is a
     protocol violation, not a retry signal);
   - names resolve in `registry` (`registry.py` unknown-tool path);
   - count within `max_tool_calls` remaining;
   - arguments parse as JSON with a callable name.
2. Only then execute, in order, each writing a result row.
3. Header rule to preserve: **assistant content is never parsed as a tool**
   (`openai-chat-protocol.ts:1`).

Find where `director.py` drains the assistant's tool calls (the loop around
`director.py:1394`) and insert the batch gate at that boundary.

**Tests:** duplicate id refused + loop stops; mixed valid/invalid batch —
nothing executes; over-cap batch refused whole.

## Task 2 — Malformed arguments: decide and enforce

Two schools, pick one deliberately:

- **Current amethyst:** `_parse_arguments` coerces anything to `{"_raw": …}`
  — the tool then runs with junk or errors at its own layer.
- **Reference (Maus):** incomplete JSON → protocol error → tool result
  `ok:false` → turn ends `tool_error` with a receipt, and the model is
  **not** invited to retry the same call in the same turn
  (`openai-chat.ts:695-697, 665-671`).

**Recommended:** keep coercion for *extra/unknown fields* (providers differ),
but treat **unparseable JSON** as `ok:false` + recorded tool error; if two
consecutive rounds produce unparseable arguments, end the turn
`stopReason=tool_error` with an explicit receipt message so the user sees
which call broke. Rationale: silently running `{"_raw": …}` is how a turn
burns iterations on a tool that can never work.

Document the chosen rule in a comment at `_parse_arguments` and in
`docs/architecture/turns.md`.

## Task 3 — One nudge for announce-only replies

Port `openai-chat.ts:141-149, 660-664`: a short reply that ends in `:`/`…`
or starts "Checking…/Let me…" — i.e. *announces* work without calling a tool
— gets **exactly one** nudge per turn: "the steps above already ran; call the
tool or answer now." Second occurrence: no nudge (it becomes a stop
condition with a visible reason).

Regex lives next to the guards in `director.py`. Test: announce → nudge →
tool call proceeds; announce twice → turn ends with reason, no infinite
nudge loop.

## Task 4 — Cap exhaustion: handoff, not death

Today `max_iterations=40` (or 32) simply ends the turn. Port
`server/turn-continuation.ts:41-178`:

1. On cap, write a **handoff record**: original task, ordered tool calls
   completed, last assistant text, continuation instructions (markdown, stored
   with the run row or as a file — follow how `state.carried` is persisted).
2. End the visible turn with an honest message: what finished, what remains.
3. Optionally spawn a continuation task — **if** implemented, obey the guard
   rails: max 5 per run/hour, never a continuation of a continuation, never
   the same source thread twice, failure escalates to the user instead of
   recursing (`turn-continuation.ts:121-175`). A cheap v1: handoff record +
   honest message, no auto-spawn.
4. **Fix the `1000` default** at `director.py:1361`: when a guard is unset,
   fall back to the config default (32/40), never 1000.

## Task 5 — Repeat detector (observe-only first)

`max_repeated=4` currently hard-stops. Add the observe-only layer from
`server/repeat-detector.ts:1-44`:

- Count identical (tool, args-hash) executions per turn.
- Thresholds 5/10/20 → **log only** at first (bounded LRU, ~256 keys/turn).
- Do not auto-intervene until the logs show it firing on real turns; the
  hard stop at 4 stays as the actual guard. The detector exists to make the
  *log* honest about pathological loops before we wire it to a breaker.

## Task 6 — Tool schema budget + omission notice

Observed: 13 tools offered, 65 withheld, ~29.6k tokens of schemas total.

1. Keep progressive disclosure (`tool_search.py` CORE_TOOLS).
2. **Add the omission notice** the model currently never gets — port
   `skills.ts:1431-1438`: when tools are withheld, the prompt says so
   explicitly: "N tools hidden from this turn. Use `tool_search` before
   declaring a capability missing." Without it the model believes 65 tools
   do not exist.
3. Budget: aim for the offered set ≤ ~8k tokens of schema by default
   (tune against measured `tool_schema_tokens`); CORE_TOOLS stays the floor.
4. Audit the heaviest schemas — shrink descriptions, not parameter
   correctness. Every schema edit gets a before/after token count in the PR.

## Task 7 — Skill index budget + dead skills dir

1. Cap skill presence in the prompt: **max 30 skills, max 4000 bytes of
   index** — one line each (`- name: description Read "path".`), port
   `skills.ts:72-73, 1442`. Over the cap: emit the same explicit omission
   notice naming `skills_list`/loader as the escape hatch, and log omitted
   names once per signature.
2. Pinned skills (`prompt.py:477-479`) count against the budget — pinned
   must beat dynamic, but the byte cap is absolute.
3. **`agents/skills/` fate:** it is referenced by nothing. Either delete it
   in this phase (preferred — dead weight in the repo) or wire it as the
   source for `~/.amethyst/skills` with a documented loader. Half-dead is
   the worst option. Record the decision in the phase report.
4. Security posture (cheap, worth porting): imported/agent-authored skills
   land **disabled** until a human enables them; only `SKILL.md` content
   enters prompts; provenance (source + sha256) recorded at import — port
   `skills.ts:8-25`. If amethyst's skill loader has no import path today,
   this is a design note in `docs/architecture/skills.md`, not new code.

## Task 8 — Trim MCP/Composio results

Composio and remaining MCP servers can return arbitrarily large results into
the context. Port `server/mcp-trim.ts:21-47`:

- Budget **8000 chars (≈2k tokens)** per tool result, floor 512.
- Over budget: keep head + tail with an explicit
  `[N chars truncated — full output saved to <path>]` marker.
- **Do not** offer "read the spill file" hints by default — Maus measured
  the hint *increased* total tokens (210 913 vs 196 183) and shipped it off
  with the numbers in the comment (`mcp-trim.ts:38-47`). Copy that comment's
  spirit: if you enable spill hints, measure first.
- Trim at the point every external result enters the loop — the same seam
  Phase 02's registry dispatch already owns.

**Tests:** oversized Composio-shaped result trimmed with marker; small
results untouched; truncation marker contains the true original length.

---

## Non-goals

- Changing guard *values* beyond the `1000` default fix (no lowering
  `max_iterations` etc.).
- Rewriting the loop structure (`while True` at `director.py:1394` stays).
- Subagent architecture changes (Phase 01 fixed its model resolution;
  nothing else).
- Prompt persona/content edits unrelated to the omission notices.
- Anything from Phases 02/03/05.

## Verify

```bash
uv run pytest tests/ -x -k "tool or director or guard or skill or budget or trim or repeat or continuation"
uv run pytest tests/ -x -k "turn_resilience or dangling or stop"
uv run pytest tests/ -x
uv run ruff check backend/
cd frontend && npm run lint   # only if cap-exhaustion message rendering changed
```

## Done when

- [ ] Batch gate live: duplicate ids refused, nothing executes on an invalid
      batch, tested.
- [ ] Malformed-args rule chosen, documented, tested (consecutive failures
      end the turn with a receipt).
- [ ] Announce-only nudge fires at most once per turn.
- [ ] Cap exhaustion writes a handoff + honest message; `1000` default gone.
- [ ] Repeat detector logging at 5/10/20 with bounded memory.
- [ ] Omission notices present for both tools and skills; offered schema
      tokens measured and reported.
- [ ] Skill index capped (30 / 4000 B); `agents/skills/` decision recorded.
- [ ] External results trimmed at 8k chars with accurate markers.
- [ ] `uv run pytest tests/ -x` green, `ruff check backend/` clean.
- [ ] Registry row in `00-INDEX.md` updated.
