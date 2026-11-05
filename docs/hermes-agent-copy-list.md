# Hermes Agent → Amethyst: What to Copy

Analysis of `/home/wayne/Documents/GitHub/hermes-agent-main` against the Amethyst
working tree. Hermes Agent is MIT-licensed, so code and designs may be adapted
with attribution. This document began as a ranked copy list rather than an
implementation plan. Phases 1–4 are now implemented; see
[Implementation status](#implementation-status-2026-11-04).

Verified against the Amethyst agent context dated 2026-10-31 (`3c363b7`, dirty
tree) and against the Hermes working tree as checked out on 2026-11-03.

---

## Verdict

Amethyst already has the hard parts of an agent runtime: a single Director loop,
durable turn state, a permission gate, provider fallback, native tools, MCP,
subagents, context compression, extracted memory, and progressive-disclosure
skills. Do not rebuild those.

What Hermes has that Amethyst does not is the **loop after the turn**: a system
that reviews what happened, decides what should be remembered or proceduralized,
writes it, measures whether it gets used, and ages out what does not. That is the
"learning part", and it is the highest-value thing to copy.

The second tier is cheap operational visibility: full-text session search,
per-turn token/cost accounting, and a configurable side-model per task.

The third tier is architecture hygiene: prompt-cache invariants, deterministic
work before model work, archive-instead-of-delete, read-before-write, and a
narrow core with capability at the edges.

---

## Implementation status (2026-11-04)

Four phases landed from this list. Everything below is implemented and tested in
the working tree; nothing was mocked.

| Phase | Item | State |
|---|---|---|
| 1 | Token/cost accounting (item 6) | **Landed.** `ModelResponse` cache fields, Anthropic and OpenAI-compatible cache mapping, `agent_runs` usage columns, `AgentState` accumulators, `/api/analytics/activity` reads real columns. Cost reports `unknown`; no price table ships. |
| 2 | Agent-managed skills (item 2) | **Landed.** `skill_manage`, `skills_list`, `skill_view`; create, patch, replace, support files, archive, restore; read-before-write and locked-skill refusal. |
| 3 | Post-turn learning review (item 1) | **Landed, staged.** Off by default. Gated review enqueues a `learning_review` job; proposals sit in `learning_proposals` until approved in Capabilities → Skills. v1 proposes skill *creates* and memory facts; skill patches are deferred. |
| 4 | Skill telemetry and curator (item 3) | **Landed, deterministic.** `.usage.json` counters, `/skill` bumps, 14-day stale / 30-day archive, 7-day grace, pin/lock/builtin/automation protections, daily job, reports on disk. No LLM consolidation. |

Still open from this document: full-text session search (item 5), trajectory
export and evals (item 9), the remaining memory-shape work (item 4 beyond what
extraction and the review already do), compression refinements (item 7), and
per-task routing changes (item 8). The curator's LLM-assisted consolidation
remains deliberately unbuilt.

## Side-by-side: what already exists

| Capability | Hermes | Amethyst | Copy? |
|---|---|---|---|
| Agent loop | `agent/conversation_loop.py`, `agent/turn_*.py` | `backend/agent/director.py` | No, already owned |
| Durable turn phases | Session DB + phase files | `backend/agent/state.py`, `agent_runs` | No |
| Tool dispatch + approval | `tools/registry.py`, approval ladder | `backend/tools/registry.py`, `backend/security/confirmation.py` | No |
| Subagents | `tools/delegate_tool*.py` | `backend/tools/builtin/task.py`, `backend/agent/agents.py` | No |
| Context compression | `agent/context_compressor*.py` | `backend/agent/context_engine.py`, `context_compressor.py` | Improve, do not replace |
| Auto memory extraction | Background review + `memory` tool | `backend/memory/service.py`, post-turn `_remember` | Improve shape |
| Agent-managed memory | `memory` tool, two stores, budgets | `remember` / `recall_memories` / `forget_memory` | Partial |
| Skills | `SKILL.md`, progressive disclosure, hub | `backend/skills/`, `/api/skills/*` | Add agent writes |
| Scheduled jobs | `cron/` | `backend/automation*.py` | No |
| Session search | FTS5 + scroll/browse shapes | `LIKE` search in `conversations.py` | Yes |
| Usage analytics | `agent/insights.py`, `/insights` | JSONL traces behind `AMETHYST_TRACE` | Yes |
| Skill lifecycle | curator, usage telemetry, archive, pin/lock | none | Yes |
| Self-improvement review | `agent/background_review.py` | extraction only | Yes, top priority |
| Prompt caching | Anthropic system + rolling 3, frozen memory | static/volatile split, cache markers | Improve |
| Trajectory export / evals | ShareGPT JSONL, `evals/` | tests only | Yes, later |
| Plugin surfaces | memory/context/model/image ABCs | no plugin registry | Only if needed |

---

## 1. Post-turn learning review (highest value)

### What Hermes does

After a turn, `agent/background_review.py` can fork the agent and replay the
conversation snapshot in a separate context. The fork asks one question: should
any **memory** or **skill** be saved or updated? It writes directly to the
memory and skill stores and never touches the live conversation or its prompt
cache. The fork inherits the parent's runtime so a same-model review reuses the
warm prefix; a cheaper review model gets a compact digest instead.

The review is both **memory** and **skills**, because the two carry different
kinds of learning:

- Memory: who the user is, durable preferences, environment facts.
- Skills: how to do a class of task for this user — procedure, pitfalls,
  corrections.

Hermes also ships two detailed review prompts. They are worth reading in full
(`agent/background_review.py:365-579`) because most of the value is in what they
refuse to save.

### What Amethyst does today

`Director._remember()` (`backend/agent/director.py:3699`) runs one extraction
model call after `done`, returns a create/supersede diff, and applies it. It is
memory-only and runs on every turn with memory enabled. It is consumed inside
the same SSE generator after the terminal event, so the request is not actually
detached from the turn.

There is no skill review, no cadence, no approval gate, and no separate
"environment facts" store.

### What to copy

**Add a `learning_review` job, not an inline call.** Amethyst already has
durable jobs and lanes (`backend/jobs`, `systems/background-jobs.md`). Use them:

1. After the terminal `done` event, enqueue one durable job with the
   conversation id, turn id, and the last user/assistant exchange.
2. The worker loads the last N turns, the current memory, and the skill
   catalogue.
3. One structured call returns a JSON operation batch:
   `{memory: [...], skill: {action, name, ...}}`.
4. Validate every operation, apply it through existing services, and record the
   result on the job row.
5. Coalesce by conversation: a newer turn replaces an older pending review for
   the same conversation. Never run two reviews for one conversation at once.

Start with a one-shot structured call. Do not copy the full agent fork on day
one. Hermes can afford a tool-using review because it already has the fork
machinery; Amethyst's `parse_diff` pattern is simpler and fits the existing
style. Promote to a tool-using review only if one-shot quality is insufficient.

Suggested module boundaries:

```
backend/agent/learning.py        review prompt, parsing, application
backend/tools/builtin/skills.py  skill_manage, skills_list, skill_view
backend/memory/service.py        add scope-aware memory ops
```

Suggested job fields beyond the existing job table: `conversation_id`,
`turn_id`, `review_kind` (`memory`, `skill`, `both`), `status`, `model`,
`input_tokens`, `output_tokens`, `result_json`.

### Review prompt rules worth copying verbatim

These are the rules that keep a self-improving agent from poisoning itself.
Adapt the wording, keep the constraints.

**Grounding**

- Save only facts grounded in the conversation: a user message or tool result
  you can point to.
- Never infer traits, skill level, role, mood, or preferences from topic, tone,
  or tools used.
- Never turn a one-off request into a standing preference unless the user marked
  it general ("always", "from now on", "remember") or stated a standing
  like/dislike ("I hate X", "stop doing Y").
- If unsure, leave it out. A wrong fact misleads every future session.

**Memory routing**

- `user` store: who the user is — persona, preferences, communication and work
  style, personal details, expectations.
- `memory` store: the environment — tool quirks, project conventions, config
  gotchas, paths and endpoints that matter.
- One fact goes to exactly one store. Writing it to both bloats both and
  misroutes the next session.

**Skill shape**

- A skill is a procedure for a class of task, not a session log.
- Procedure first: steps in order, concrete commands/tool calls, decision
  points. Pitfalls attach to the step they affect.
- A pitfall is a generalizable rule plus one clause of why. "Grep the test tree
  for the symbol before widening a helper signature — hand-rolled mocks
  reimplement the old shape." Not "on Tuesday I tried X and it failed."
- No PR numbers, dates, ticket ids, or quoted chat as content. The rule must
  stand without the incident.
- The same lesson learned twice is one rule. Strengthen the existing sentence;
  do not append a second copy.
- Do not duplicate what the environment already teaches (`AGENTS.md`, tool
  schemas). A skill carries workflow and pitfalls.
- Always-on rules live in `SKILL.md`. `references/` is for depth needed only
  sometimes, named by topic, extended in place.
- Fix a wrong skill in place. Do not append "UPDATE: actually...".

**Never capture as a skill**

- Environment-dependent failures: missing binary, fresh-install error,
  unconfigured credential, `command not found`. The user can fix these.
- Negative claims about tools ("browser tools do not work"). These harden into
  refusals long after the problem is fixed.
- Transient errors that resolved before the conversation ended. The lesson is
  the retry pattern, not the failure.
- One-off task narratives.
- Unresolved failures dressed up as a "reliable workflow". If nothing worked,
  save nothing, or save only an independently confident working alternative.

**Preference order for skill updates**

1. Patch a skill that was loaded or consulted this turn.
2. Patch an existing class-level umbrella skill.
3. Add a support file under an existing umbrella.
4. Create a new class-level umbrella skill.

Read before write: re-read the skill during the review before patching it.
Content quoted earlier in the transcript does not count. Hermes enforces this
in `skill_manage`; Amethyst should enforce it in the review service.

### Cost controls

Amethyst currently pays one extraction call every turn. Add what Hermes learned:

- **Cadence:** default every N turns, or trigger immediately on correction,
  explicit "remember", or a completed multi-step workflow. Do not review every
  turn by default.
- **Skip unattended sessions:** automations and cron should not teach the agent
  unless explicitly allowed. Hermes passes `skip_memory=True` for cron.
- **Cheap model slot:** memory extraction already has `memory:` in
  `providers.yaml` (`load_memory_model`). Add a `review:` slot with the same
  shape. Use the conversation's model only as fallback.
- **Defer on a local GPU:** if the review model is the managed local runtime,
  queue the job and run it after an idle window instead of competing with the
  next prompt. Hermes does this for the same reason.
- **Cap input:** `max_input_tokens` for one review. A review that loops is worse
  than no review.
- **Coalesce:** one pending review per conversation. A newer snapshot replaces
  an older one.

### Approval gates

Copy the idea, not the full UX:

- `memory.write_approval`: when on, extracted facts are staged, not applied.
  Show them in the Memory view as "pending" with approve/reject.
- `skills.write_approval`: when on, every agent skill write is staged. Review a
  diff in the Capabilities page. A `SKILL.md` is too large to review in a chat
  bubble.
- Default both to off for a single-user local app, but expose the switch. The
  point is that unprompted self-modification is a policy choice, not a hidden
  behavior.

---

## 2. Agent-managed skills (`skill_manage`)

### What Hermes does

The agent has three tools:

- `skills_list` — names, descriptions, states.
- `skill_view(name, file_path)` — full `SKILL.md` or a support file.
- `skill_manage` — `create`, `patch`, `write_file`, `remove_file`, `delete`.

`skill_manage` is the agent's procedural memory. It supports targeted `patch`
(the preferred, token-efficient form), full rewrites, and support files under
`references/`, `templates/`, `scripts/`. It runs an advisory linter on create
and patch, and it enforces read-before-write.

Amethyst has the filesystem format and the loader, but no tool surface. The
agent can only read skills; the user creates them through `/api/skills/*`.

### What to copy

Add `backend/tools/builtin/skills.py` with three tools, registered in
`backend/tools/registry.py` alongside the other builtins:

```python
Tool(name="skills_list", risk=RiskLevel.LOW, ...)
Tool(name="skill_view", risk=RiskLevel.LOW, ...)
Tool(name="skill_manage", risk=RiskLevel.MEDIUM, ...)
```

`skill_manage` actions:

| Action | Params | Notes |
|---|---|---|
| `create` | `name`, `content`, optional `tags` | Validate with `loader.parse_skill_md` semantics before writing |
| `patch` | `name`, `old_string`, `new_string` | Preferred; fail if the span is not unique |
| `replace` | `name`, `content` | Full rewrite; use rarely |
| `write_file` | `name`, `file_path`, `file_content` | Allow only `references/`, `templates/`, `scripts/`, `assets/` |
| `remove_file` | `name`, `file_path` | Same allowlist |
| `delete` | `name` | Archive, do not hard-delete (see curator) |

Guardrails:

- Resolve the skill directory from `paths().skills_dir`; reject traversal.
- Validate the slug against `NAME_RE` and require directory name == frontmatter
  name.
- Require `skill_view` during the current review/turn before patching or
  overwriting an existing file. Track the read in the tool context.
- Refuse to create a skill whose name is a session artifact (`fix-...`,
  `debug-...-today`, a PR number).
- Run a cheap linter and return findings in the tool result. Warn, do not block:
  body over ~24k chars, references sprawl, incident-log shape.
- Write atomically. A failed write must leave the old skill intact.
- `delete` moves the directory to `skills/.archive/<timestamp>/<name>/`.

System prompt change: add a short instruction to the existing "Memory and
skills" block in `backend/agent/prompt.py`:

> When you solve a non-trivial workflow, or the user corrects your approach,
> save the reusable procedure with `skill_manage`. Skills are procedures;
> memory is facts. Do not save environment failures or one-off narratives.

Do not add a new execution primitive. Skills still run through existing tools.

---

## 3. Skill usage telemetry and curator

### What Hermes does

`tools/skill_usage.py` keeps a sidecar `~/.hermes/skills/.usage.json` keyed by
skill name. It records `use_count`, `view_count`, `patch_count`, timestamps,
`state`, `pinned`, `locked`, and `created_by`.

`agent/curator.py` runs on inactivity, not cron: on session start or maintenance
ticks, if `interval_hours` and `min_idle_hours` have passed. It has two phases:

1. **Deterministic transitions** — unused for `stale_after_days` (14) becomes
   `stale`; unused for `archive_after_days` (30) moves to `.archive/`. No LLM.
2. **LLM consolidation** — off by default. One auxiliary-model pass proposes
   merges into class-level umbrellas. It never deletes; archive is the maximum.

Protections: `pinned` skips auto-transitions; `locked` refuses all agent writes
while staying readable; skills referenced by any cron job are protected;
never-used skills get a grace floor; provenance is declared, never inferred;
every mutation goes to an append-only ledger; snapshots enable whole-run
rollback.

### What to copy

Copy the lifecycle, skip the enterprise machinery.

**v1 — deterministic only.**

- Add `skills/.usage.json` with one entry per skill:
  `use_count`, `view_count`, `patch_count`, `last_activity_at`, `state`,
  `pinned`, `locked`, `created_by`.
- Bump counters from the three tools and from `/skill-name` invocation.
- Add a `skills` maintenance tick to the existing background job lane:
  - every 7 days, if idle for 2 hours;
  - `active -> stale` after 14 days;
  - `stale -> archived` after 30 days;
  - never archive pinned, locked, builtin, or automation-referenced skills;
  - never hard-delete.
- Add API + UI in Capabilities: state badge, pin toggle, lock toggle, archived
  list, restore.
- Archive path: `~/.amethyst/skills/.archive/<utc-iso>/<name>/`.
- Write a small JSON report to `~/.amethyst/logs/curator/<timestamp>/run.json`
  and `REPORT.md`.

**v2 — optional LLM consolidation.**

Only enable when a user asks. Give it the candidate list it can actually read
and write. Exclude builtins, disabled skills, pinned/locked skills, and any
skill referenced by an automation. Tell it to consolidate into class-level
umbrellas and to carry support files, not flatten `SKILL.md` into another
skill's references.

**Skip:** content-addressed blob ledger, single-entry rollback, tar.gz
snapshots, archive TTL purge, multi-profile adoption. A git repo or a simple
timestamped copy of the skills directory is enough for one user.

**Important Amethyst-specific rule:** if an automation grants or references a
skill, treat that skill as pinned for archival. Otherwise a quiet curator can
break a scheduled job.

---

## 4. Memory: two stores, budgets, frozen snapshot

### What Hermes does

- Two files: `MEMORY.md` (environment, 2,200 chars) and `USER.md` (profile,
  1,375 chars).
- Injected into the system prompt as a **frozen snapshot at session start**.
  Writes persist immediately but appear in the prompt only next session.
- The `memory` tool has `add`, `patch`, `remove`. `patch` replaces a unique
  substring inside one entry; `remove` matches a unique substring.
- When a write would exceed the limit, the tool returns an error naming exactly
  how many chars must be freed. The agent consolidates in the same turn.
- Duplicate entries are rejected.
- Entries are scanned for injection/exfiltration patterns and invisible Unicode
  before acceptance.
- `write_approval` stages writes for review.

### What Amethyst does today

- One `memories` table, append-only with `superseded_at`; good.
- `remember`, `recall_memories`, `forget_memory`; no `patch`.
- `MAX_FACTS_IN_PROMPT = 30` caps recall by count, not by characters.
- Memories are appended to the **volatile** system-prompt section every turn
  (`backend/agent/prompt.py:578`). Any memory change busts the provider prefix
  cache for the whole system block.
- Auto extraction after every turn, no approval.

### What to copy

1. **Add a `scope` column** to `memories`: `user` or `memory`. Keep the same
   table and supersede model; do not create a second store on day one.
   - `user`: identity, preferences, communication style.
   - `memory`: environment, project conventions, tool quirks, paths.
   - Extraction prompt must pick one scope per fact and never write both.
2. **Add a character budget per scope**, not just a fact count. Count only live
   rows. On overflow, return the exact deficit and the current entries, and let
   the extractor/reviewer consolidate in one batch.
3. **Add a `patch` operation.** `remember` only appends; a correction today
   creates a new fact and supersedes the old one. That is correct for audit but
   wasteful in the prompt. Permit `patch(old_text, content)` with unique
   substring matching, like Hermes.
4. **Freeze the prompt snapshot per session.** Build the `<memories>` block once
   when the conversation starts, store it on the conversation row (or a small
   cache), and reuse it for the session. Live writes are reflected by the
   `remember` tool result, not by mutating the system prompt mid-conversation.
   This is a direct prompt-cache win and it matches Hermes' strongest invariant.
5. **Stage auto-extracted memory when approval is on.** Manual `remember` can
   stay immediate; the background review's writes are the ones that need review.
6. **Sanitize before insert.** Amethyst already strips control characters and
   caps length. Add a prompt-injection/exfiltration pattern check and reject
   invisible Unicode. Memory is injected into the system prompt, so it is a
   privileged write path.
7. **Keep the existing forget/history surface.** Amethyst already keeps
   superseded rows and exposes history and restore in the Memory view. That is
   better than Hermes' destructive `remove`; do not regress it. Add the
   `patch` action alongside it, not instead of it.

Do not copy the 2,200-character hard cap. It is tuned for Hermes' two-file
design and a terminal agent. Amethyst has a UI and SQLite. Use a configurable
budget with a warning threshold and a hard ceiling.

---

## 5. Full-text session search (FTS5)

### What Hermes does

`tools/session_search_tool.py` searches all past sessions with SQLite FTS5. It
returns actual messages, not LLM summaries, in four shapes inferred from the
arguments:

- `query` — discovery: top sessions, highlighted snippets, ±5 messages around
  the match; the top result is fully hydrated.
- `session_id + around_message_id + window` — scroll forward/backward.
- `session_id` — read the session.
- no args — browse recent sessions.

It dedupes by session lineage, supports role filters, `newest`/`oldest` sorting,
and standard FTS5 syntax (phrases, `OR`, `NOT`, prefix `*`). Typical latency is
tens of milliseconds; scrolling is ~1-2 ms.

### What Amethyst does today

`backend/tools/builtin/conversations.py:198` uses
`m.content LIKE '%query%'`. It scans, cannot rank, cannot use phrases or
boolean operators, and has no scroll window. It works for small stores and
degrades linearly.

### What to copy

Add an FTS5 virtual table over `messages`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61'
);
```

Add insert/update/delete triggers to keep it in sync. Migration is a normal
`backend/db/migrations` step; backfill existing rows once.

Then extend `search_conversations`:

- `bm25(messages_fts)` ranking;
- `snippet(messages_fts, 0, '[', ']', '…', 12)` for the excerpt;
- `role_filter` (default `user,assistant`; tool output is usually noise);
- `sort` = relevance / newest / oldest;
- `detail` = adaptive (hydrate the top result) / compact;
- keep the existing `since_days` and `limit`;
- add `read_conversation(session_id, around_message_id, window)` for scroll,
  and keep `read_conversation(session_id)` for full read.

Do not add a fourth "mode" parameter. Infer from the arguments, as Hermes does;
the tool schema stays small and the model already knows how to call it.

Empty-state hint: "Nothing matches X. Use `list_conversations` for a
date-ordered overview." Preserve Amethyst's current good behavior of naming the
UTC timezone.

---

## 6. Token/cost insights

### What Hermes does

`agent/insights.py` aggregates the session DB into token totals, cost estimates,
model and platform breakdowns, top tools, top skills (loads/edits/last used),
activity patterns, and cache-read/write tokens. `hermes insights --days N` and
`/insights` expose it. Cost can be "included" (subscription) or "unknown",
rather than collapsing to `$0.00`.

### What Amethyst does today

`backend/agent/trace.py` collects per-LLM-call input/output tokens, TTFT,
latency, tool dispatches, errors, and steps. Tracing is on by default
(`agent_config.enable_turn_tracing = True`) and appends each turn to
`logs/turn_traces.jsonl`. But the metrics are not in SQL, there is no cost
accounting, no aggregation, and no UI; `agent_runs` stores the serialized state,
not aggregate usage.

### What to copy

1. **Promote the existing trace data into SQL.** Add `input_tokens`,
   `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `provider`,
   `model`, and `duration_ms` to `agent_runs` (or a `turn_usage` table keyed by
   run id). Keep the JSONL as the raw log. Backfill nothing; start recording on
   the next turn.
2. **Persist tool-call counters.** `execution_logs` already has the calls; add a
   cheap aggregate per run or query it.
3. **Add a usage endpoint and a small UI panel.** Sections:
   - totals and trend for 7/30/90 days;
   - cost estimate with `included` / `unknown` buckets;
   - per-model sessions/tokens;
   - top tools by call count and error rate;
   - top skills by loads and edits (once telemetry exists);
   - activity by day/hour.
4. **Price table.** Keep a small `model_pricing` map in config; never invent a
   price. If unknown, say unknown. This is the same rule as the rest of
   Amethyst: no mock data.
5. **Use it to tune routing.** Once per-task models exist, the insights panel is
   how you decide whether the cheap review model is actually cheap.

Do not build a billing system. The value is: "which model, tool, and skill is
costing me time and money, and is the learning loop paying for itself?"

---

## 7. Context compression refinements

Amethyst already has the important algorithm: deterministic dedup/prune,
head/tail protection, user-boundary snapping, structured-ish summary, previous
summary update, deterministic fallback, cooldown, and an ineffective-compression
breaker. Do not replace it. Copy these smaller pieces.

### 7.1 Skill-pruned markers

Hermes tags every `skill_view` result that compression stubs or summarizes away:

```
[SKILL_PRUNED: content lost in compression; reload with skill_view(name='…')]
```

The summary lists each pruned skill, and a `## Skill Safety Rule` tells the model
to reload before relying on it. This prevents the model from half-remembering a
procedure after compaction.

Amethyst already loads skills into the prompt and tracks `active_skill`. Add the
marker in `_prune_old_tool_results` and in the summary builder. This is cheap and
directly protects correctness.

### 7.2 Configurable compression model

`ContextCompressor` accepts `compression_model`, but `Director.__init__` passes
only `getattr(self, "_compression_model", None)`, and nothing sets it.
`_DEFAULT_COMPRESSION_MODEL` is empty, so it routes to the fast tier.

Add a `compression:` row to `providers.yaml`, next to `memory:`:

```yaml
compression:
  provider: ollama
  model: qwen2.5:3b
```

Load it in `backend/config.py` the same way as `load_memory_model`, and pass it
to `ContextCompressor`. Summarization is mechanical; a small non-reasoning
instruct model is usually better than the main model.

### 7.3 Telemetry per attempt

Log one content-free JSON line per compression attempt: trigger source
(`manual`, `threshold`, `overflow`, `idle`), method (`llm`, `fallback`),
messages before/after, tokens before/after/reclaimed, duration, failure class.
No message text, no summary text.

Amethyst already logs a summary line. Structured telemetry makes it possible to
answer "is compression actually reclaiming tokens, or is it thrashing?"

### 7.4 Per-model thresholds

Hermes supports `compression.model_thresholds` with longest-substring matching
and provider-scoped keys. Amethyst computes `threshold_tokens` once from the
resolved model. Add a small map so a 1M-context model can compress later and a
32K local model can compress earlier. Re-resolve on `/model` switch and
fallback.

### 7.5 Prepared compaction (optional, later)

Hermes can prepare the next summary in the background near the trigger and
splice it if the covered messages are unchanged. This removes the mid-session
stall. It is real work; only copy it if stalls are a measured problem.

### 7.6 Micro-compaction (opt-in, later)

Micro-compaction absorbs one exchange per turn into a running summary. It keeps
occupancy flat but breaks the prompt-cache prefix every turn. Hermes ships it
off by default for that reason. Amethyst should do the same: implement only if
users complain about long compaction stalls, and make the cache trade-off
explicit in the setting description.

### Do not copy

- Native provider compaction paths (Codex/Responses). Amethyst does not need
  provider-specific compaction yet.
- The exact 4-phase assembly. Amethyst's is already equivalent for its scope.
- Session rotation on compression. Hermes moved to in-place compaction; Amethyst
  already keeps a stable conversation id, which is the better design.

---

## 8. Per-task model routing

Hermes has an `auxiliary:` config block with a slot per side task: memory,
compression, curator, title, session search, vision, embedding, background
review. Each slot can pin provider/model/base_url/timeout/reasoning effort.
"Auto" means the main model.

Amethyst has `memory:` in `providers.yaml` and tiers (`fast`, `default`,
`heavy`, `background`) in `backend/runtime/router.py`. That is close, but there
is no per-task slot.

Copy the shape, not the full config surface:

```yaml
memory:
  provider: ollama
  model: qwen2.5:3b
compression:
  provider: ollama
  model: qwen2.5:3b
review:
  provider: ollama
  model: qwen2.5:3b
titles:
  provider: ollama
  model: qwen2.5:1.5b
```

One loader (`load_task_model(task)`) with a documented fallback order:
task slot -> `fast` tier -> conversation model. Log which one was used. Add a
Settings row per task with a "use fast tier" default.

This is a prerequisite for the learning loop being affordable. A review on the
main model every few turns is a real cost; a 3B local model is not.

---

## 9. Trajectory export and evals

### What Hermes does

- Saves successful and failed conversations as ShareGPT-compatible JSONL
  (`trajectory_samples.jsonl`, `failed_trajectories.jsonl`), with model,
  timestamp, completion flag, tool stats, and error counts.
- `batch_runner.py` generates trajectories from prompt sets.
- `trajectory_compressor.py` compresses long trajectories for training.
- `evals/` holds scripted probes: compaction, token accounting, provider wire,
  prompt footprint, session search schema, delegation, fallback, and more.

### What to copy

1. **Export from `messages` + `agent_runs`.** One JSONL line per finished turn:
   system prompt, messages, tool calls/results, final answer, provider/model,
   token usage, terminal phase, tool errors. ShareGPT role mapping is trivial
   (`user -> human`, `assistant -> gpt`, `tool -> tool`).
2. **Separate completed and failed turns.** Failed turns are the useful ones for
   debugging and for training recovery behavior.
3. **Add a small eval harness.** Not the whole `evals/` tree. Start with:
   - a compaction fixture: long transcript, assert head/tail/anchors survive;
   - a tool-repair fixture: malformed tool call, assert repair or clean error;
   - a memory-extraction fixture: fixed transcript, assert no duplicate and no
     ungrounded fact;
   - a review fixture: correction turn, assert a skill patch is proposed;
   - a session-search fixture: known message, assert it is found by FTS.
4. **Use evals before changing prompts.** The learning loop is prompt-heavy;
   without fixtures, every prompt tweak is a vibe check.

Do not copy the training pipeline or the compressor. Amethyst is not training a
model. The export + fixtures are enough.

---

## 10. Plugin seams (only if Amethyst grows)

Hermes defines narrow ABCs for memory providers, context engines, model
providers, image generation, and browser backends. Plugins live outside core and
must not modify core files. The selection is explicit config, never automatic.

Amethyst already has the seeds: `backend/agent/context_engine.py` is an ABC with
one implementation, and provider adapters are behind a registry.

If you want third-party extension later, copy the **interface shape**, not the
catalog:

- `MemoryProvider` ABC: `initialize`, `system_prompt_block`, `prefetch`,
  `sync_turn`, `shutdown`, optional `on_pre_compress`.
- `ContextEngine` ABC is already there; add a registry keyed by name and a
  config `context.engine`.
- Plugin loading should be explicit (`amethyst plugins install`), pinned by
  commit, and refused if it tries to write core files.

Do not build a plugin marketplace. A single-user local app does not need one.
The value is keeping optional backends out of the core dependency tree.

---

## Design rules worth stealing (no code)

These are the reasons Hermes behaves well more than any single feature.

1. **Prompt caching is an invariant, not an optimization.** The system prompt is
   byte-stable for a conversation. Only compression may break the prefix.
   Anything that must inject content mid-conversation rides a user message or a
   tool result. Slash-command state changes defer to the next session.
2. **Deterministic work before model work.** Prune tool results before
   summarizing. Curator auto-transitions before LLM consolidation. Duplicate
   checks before a write. Every model call must justify itself.
3. **Archive, never delete.** Superseded facts, stale skills, and old sessions
   stay recoverable. Auditability is a feature.
4. **Provenance is declared, never inferred.** `created_by: agent` is a policy
   flag, not a guess from file location. Adoption is manual. A telemetry
   heuristic that decides "the agent probably wrote this" will eventually
   archive something the user wrote.
5. **Read before write.** Patching an existing document requires reading it in
   the current review. This prevents blind overwrites and stale-context edits.
6. **Fail open for telemetry, fail closed for gates.** A broken ledger write must
   not block a skill change. A broken approval store must block the write.
7. **Narrow core, capability at the edges.** Every tool schema is sent on every
   request. The bar for a new core tool is high: extend existing code, then a
   CLI command + skill, then a plugin, then a core tool.
8. **Separate "what happened" from "what should happen next".** Turn state is a
   state machine; display status is a vocabulary; memory is facts; skills are
   procedures. Blurring these is how agents become incoherent.
9. **Make cost visible.** Tokens, cache reads, model, and tool counts per turn.
   You cannot tune a learning loop you cannot measure.
10. **Write constraints, not aspirations.** "No PR numbers in a skill" is
    enforceable. "Write good skills" is not.

---

## Suggested order

| Order | Work | Why now | Effort |
|---|---|---|---|
| 1 | Usage columns + capture in `agent_runs` | Everything else needs measurement | S |
| 2 | `skill_manage` + `skills_list` + `skill_view` | Unlocks procedural learning | M |
| 3 | `learning_review` job (memory + skill, one-shot) | The actual self-improvement loop | M |
| 4 | Skill usage telemetry + deterministic curator | Keeps the library from rotting | M |
| 5 | FTS5 session search + scroll | Cheap, immediate recall win | S/M |
| 6 | Memory scope + budget + frozen snapshot | Correctness and cache savings | M |
| 7 | Review/compression model slots | Makes the loop affordable | S |
| 8 | Compression markers + telemetry | Protects long sessions | S |
| 9 | Trajectory export + eval fixtures | Keeps prompt changes honest | M |
| 10 | Insights UI | Visibility into cost and usage | S/M |

Do 1-4 before anything else. Without the review and the skill tool, there is no
learning loop. Without telemetry and the curator, the loop creates a library
nobody can trust.

---

## What not to copy

- The 20-platform messaging gateway, multi-profile isolation, and six terminal
  backends. Amethyst is a local desktop app; these are distribution
  infrastructure, not learning.
- Honcho or any external memory SaaS. Amethyst's append-only SQLite memory is a
  better fit for local-first. Copy the two-store split, not the dependency.
- The full curator ledger with content-addressed blobs and single-entry
  rollback. Use git or timestamped copies.
- The 2,200-character memory cap. Use a configurable budget.
- Micro-compaction by default. It breaks the prompt cache every turn.
- The full `skill_manage` batch grammar and write-approval chat UX. A local UI
  can stage a diff, which is simpler and clearer.
- The plugin catalog and admission policy. Only add plugin seams if there is a
  concrete second implementation.

---

## Attribution

Hermes Agent is MIT-licensed (`LICENSE` in the Hermes repository). If code is
adapted, keep the copyright notice and note the source in the commit or file
header. Design ideas do not require attribution, but it is good practice to
record where a non-obvious mechanism came from.

---

_Last verified: 2026-11-03. Amethyst source references checked against the working
tree; Hermes references checked against the checked-out repository._
