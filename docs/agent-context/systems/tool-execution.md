# Tool Execution and Permissions

The single dispatch path for every tool call: resolution, schema visibility,
risk classification, the permission gate, guard modes, sandboxing, timeouts,
result shaping and audit.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [AGENT-SYSTEM.md](../AGENT-SYSTEM.md), [systems/auth.md](auth.md),
[MCP-INTEGRATIONS.md](../MCP-INTEGRATIONS.md), [sections/logs.md](../sections/logs.md).

## Contract

`backend/tools/base.py` defines the shape. Builtin, integration and MCP tools are
identical above the dispatcher.

```python
Tool(
    name="write_file",
    description="...",
    parameters={...},          # JSON Schema
    handler=async_fn,          # (arguments, ToolContext) -> ToolResult
    risk=RiskLevel.MEDIUM,
    source=ToolSource.BUILTIN,
    server_name=None,          # MCP only
    touches_paths=False,       # enables sensitive-path escalation
    subtype=None,              # extra key for "don't ask again"
    timeout=None,              # override the registry default
)
```

`ToolResult` is the uniform envelope:

- `content: str`
- `artifacts: list[dict]`
- `is_error: bool`
- `recoverable: bool` (default true; errors are data, not exceptions)

`ToolContext` carries conversation, workspace, read-only mode, an event queue
for in-flight prompts, turn/call ids and the idempotency key.

`compute_idempotency_key(turn_id, tool_name, arguments)` is
`turn:tool:sha256(args)[:16]`. It deliberately excludes `call_id`, so the same
write issued twice in one turn is recognized as a duplicate.

## Registry

`backend/tools/registry.py` is a flat dict of name → `Tool`. There is no
hierarchy and no second dispatch path.

Names:

- Builtin: `write_file`, `run_shell_command`, ...
- MCP: `<tool>__mcp__<server>` (`MCP_DELIMITER = "__mcp__"`).

`register()` refuses a duplicate name. `register_all()` is the bulk form.
`with_confirmation()` returns a view that shares the tool dict and result cache
but swaps the permission callback — used for unattended turns.

`CAPABILITY_MAP` translates a model's high-level intent (`bash`, `grep`,
`calendar`, `gmail`, ...) to a canonical tool name. It is a routing aid, not a
second registry.

`resolve_tool()` accepts exact names, case-insensitive names, bare MCP names
and a close match. An unknown tool returns a `ToolResult.error` naming valid
tools and the closest match.

## Schema visibility

The model only sees schemas it may use:

- Plan mode withholds every tool above `RiskLevel.LOW`.
- A connector switched off for the conversation is not advertised.
- A connector whose sign-in is missing is not advertised.
- A provider's `max_tools` cap trims the list; `fit_tools_to_budget` decides
  what fits.

Withholding is a request, not enforcement. `dispatch()` re-checks all of it,
because the model can name a tool it saw in an earlier turn.

## Dispatch pipeline

`ToolRegistry.dispatch(name, arguments, context)`:

1. Resolve the tool and normalize arguments.
2. Refuse an unknown tool with guidance.
3. Refuse a connector switched off for this conversation.
4. Refuse a mutating tool in plan mode, before the permission gate — a plan turn
   must not raise an approval dialog.
5. Refuse an unsigned connector with sign-in guidance.
6. Check Composio toolkit state and local/provider ownership.
7. Run the permission gate.
8. Answer a repeated read from the result cache when safe.
9. Run the handler under a timeout.
10. Convert exceptions to `ToolResult.error`.
11. Append auth/fallback guidance where relevant.
12. Truncate and project the result.
13. Invalidate or fill the cache.
14. Write the audit row.

Every step returns a result. An exception in the gate is recorded as
`gate_error` and becomes one failed call, not a failed turn.

## Risk model

`RiskLevel = low | medium | high`.

- `low` changes nothing.
- `medium` changes local state.
- `high` can destroy, send, spend or reach a sensitive path.

The static `Tool.risk` is a **floor**. The model's self-reported
`operation_type` can escalate it, never lower it:

```text
read-only/safe      -> low
write-only          -> medium
read-write/unsafe   -> high
destructive         -> high
```

`touches_paths=True` adds a sensitive-path check over path-like arguments.
A match forces `high` and cannot be silenced by a standing preference.

Sensitive patterns include:

```text
~/.ssh  ~/.aws  ~/.gnupg  ~/.config/gh  ~/.npmrc  ~/.netrc
.env*   ~/.amethyst/config  *_history  browser profiles
```

## Permission gate

`backend/security/confirmation.py` (ADR-0009).

`ConfirmationService.check(tool, arguments, context)`:

1. Evaluate risk and reason.
2. A write approval requirement raises the floor to medium.
3. A dashboard rule may `deny` or `ask`; an old `allow` cannot cover a write.
4. First use of an untrusted MCP server always confirms. Approval trusts the
   server for later calls.
5. Low risk, not sensitive and not forced → `auto`.
6. A standing preference may allow (`skipped_by_pref`) or deny
   (`denied_by_pref`), except for sensitive paths.
7. Otherwise ask. The request is announced on the context event queue as
   `confirmation_required` before blocking.

Decisions:

```text
auto | approved | denied | skipped_by_pref | denied_by_pref
denied_by_rule | blocked_by_mode | full_access | auto_edit | gate_error
```

A pending prompt has a UUID and a `conversation_id`, so a reloaded interface can
tell which conversation is suspended. The gate promises six hours; a parked call
is marked as a gate suspension so the tool timeout knows it is not a wedge.

## Guard modes

`GUARD_MODES = {guard, read-only, full-access, guard-auto-edit}`.

`GuardedConfirmationService` overrides different parts of the base decision:

| Mode | Behavior |
|---|---|
| `guard` | Ordinary gate: ask above low risk |
| `read-only` | Block every non-low tool, even with a standing allow |
| `full-access` | Allow everything, including high risk and first MCP trust |
| `guard-auto-edit` | Allow named file-edit tools silently; everything else asks |

`AUTO_EDIT_TOOLS` is an explicit set:

```text
replace_file_content  multi_replace_file_content  write_to_file
write_file  create_artifact  create_document  edit_file
```

A dashboard rule always wins over a mode. `guard_instruction()` gives the model
the mode in words, so a refusal is readable as a setting.

Remote devices are restricted to `guard` or `read-only`; they cannot weaken the
host's guard.

## Sandbox

`backend/security/sandbox.py` wraps shell commands only.

- macOS: Seatbelt (`sandbox-exec`).
- Linux: Bubblewrap (`bwrap`).
- Windows: no sandbox in v1; direct mode plus confirmation.

Policy (`~/.amethyst/config/sandbox.yaml`):

```yaml
enabled: true
denied_read_paths: [~/.ssh, ~/.aws, ~/.gnupg, ~/.amethyst/config]
allowed_write_paths: [/tmp, ~/.amethyst/cache]
allow_network: true
```

`wrap_command()` returns `(argv, backend)`. `backend=None` means no sandbox was
available and the command runs directly. `unavailable_reason()` states why.

The tool's `subtype` can distinguish sandboxed from direct shell commands for
"don't ask again", because a preference granted to a contained command must not
cover an uncontained one.

## Timeouts and caching

- `TOOL_TIMEOUT_SECONDS = agent_config.tool_timeout_seconds`.
- A tool may override with `Tool.timeout`; it cannot opt out entirely.
- A timeout becomes an error result the model can reason about.
- A parked confirmation/question/connection extends the window; it is human
  time, not a wedge.
- `_execute` takes the turn's hard limit as an absolute `deadline`
  (`started + hard_timeout`, evaluated per call). When a call starts after that
  deadline it answers with a "was not run" error result without running its
  handler; before it, the per-call window is clamped to the remaining turn
  budget. Gate windows still re-arm beyond the clamp. The Director checks the
  same limit between iterations, so a long tool batch no longer runs to
  completion before the limit is looked at — see `backend/agent/director.py::_execute`.
- One final-answer synthesis call (`_guaranteed_final_answer`) runs at the
  moment the turn is out of budget, so it is bounded by
  `agent_config.final_answer_timeout_seconds` (`AMETHYST_FINAL_ANSWER_TIMEOUT`,
  default 45s) per candidate instead of the provider's 300s read timeout, and
  skips providers with an open circuit breaker.

Result cache:

- `RESULT_CACHE_TTL_SECONDS = 60`.
- `RESULT_CACHE_MAX = 128`.
- Only `RiskLevel.LOW` tools are cached.
- `NEVER_CACHE` includes `ask_user`, `collect_jobs`, `list_today_items`,
  `dispatch_parallel_jobs`, `index_status`, `task`.
- Any non-low call clears the whole cache.

The TTL is short on purpose: a file the user edits in another program must not
be served stale to an agent that then writes over it.

## Result shaping

`truncate()`:

1. `backend/agent/projection.py` projects the result for the model.
2. `backend/agent/scratch_store.py` compacts large payloads, spilling the full
   value to scratch storage.
3. `agent_config.max_payload_chars` is the ceiling.

`MAX_RESULT_CHARS = 8_000` in the registry is the older constant; the effective
limit comes from agent config. The goal is the same: the model gets a useful
summary, the full result remains recoverable.

## Audit

Every dispatch writes `execution_logs`:

- tool name and source,
- conversation id,
- arguments (redacted),
- result summary or error,
- risk level,
- confirmation decision,
- duration,
- idempotency key.

`backend/secrets.py` redacts credential-shaped keys and values before logging.
The audit row is what `replayable_after_crash` reads to decide whether a dead
job may repeat its work.

## MCP-specific checks

Before dispatch, the registry verifies:

- the connector is enabled for this conversation,
- the server is signed in,
- Composio does not require re-auth,
- a local MCP server does not own a provider that Composio also owns, and vice
  versa.

An auth failure can suspend an interactive call on a connection card and retry
the whole call after the user connects the app. An unattended call gets the
original error instead of waiting for a person.

See [MCP-INTEGRATIONS.md](../MCP-INTEGRATIONS.md).

## Modification guide

| Change | Touch |
|---|---|
| Add a builtin tool | `backend/tools/builtin/`, register it, set risk and schema |
| Change the gate | `backend/security/confirmation.py`, tests |
| Add a guard mode | `GUARD_MODES`, `GuardedConfirmationService`, UI, prompt text |
| Change sandbox policy | `sandbox.yaml`, `backend/security/sandbox.py` |
| Change result limits | `agent_config.max_payload_chars`, projection/scratch |
| Change audit fields | `ExecutionLogRepository`, `execution_logs` schema |
| Change tool visibility | `agent/tool_search.py`, registry `schemas()` |
| Change caching | `RESULT_CACHE_*`, `NEVER_CACHE` |

Rules:

- One dispatch path. Do not call a handler directly from a route.
- Risk floor can only escalate.
- Sensitive paths always confirm.
- Errors are data, not exceptions.
- Never log an unredacted argument or result.
- A new tool must declare a realistic risk and a JSON Schema.
- A tool that can write must set `touches_paths` when it takes paths.

## Known issues

- Windows has no shell sandbox in v1.
- The result cache is per-process and cleared by any write; it is not a
  correctness mechanism.
- A standing "allow" is keyed by operation, not by arguments, except where a
  tool supplies a `subtype`.
- MCP server processes are trusted once configured. The gate limits what the
  agent does with their tools, not what the server binary can do.
- `full-access` skips the first-use MCP trust prompt by design.
- A tool timeout cannot stop work a handler started in the background.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
