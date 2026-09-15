"""System prompt assembly and token budgeting.

Budgeting is arithmetic against the model's declared context window, not a fixed
message count -- which is what lets a small local model and a large cloud model
run the same loop.
"""

from __future__ import annotations

import json
import platform
import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from backend.db.repositories import Message
from backend.runtime.types import ToolSchema
from backend.skills.loader import format_catalogue, scan

BASE_PROMPT = """\
You are AMETHYST, an interactive CLI tool that helps users with software engineering tasks. \
Use the instructions below and the tools available to you to assist the user.

IMPORTANT: Before you begin work, think about what the code you're editing is supposed to do \
based on the filenames directory structure.

# Tone and style
You should be concise, direct, and to the point. When you run a non-trivial bash command, \
you should explain what the command does and why you are running it.
Remember that your output will be displayed on a command line interface. Your responses can \
use Github-flavored markdown for formatting.
Output text to communicate with the user; all text you output outside of tool use is displayed \
to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as \
means to communicate with the user during the session.
IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, \
quality, and accuracy. Only address the specific query or task at hand, avoiding tangential \
information unless absolutely critical for completing the request. If you can answer in 1-3 \
sentences or a short paragraph, please do.
IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining \
your code or summarizing your action), unless the user asks you to.
IMPORTANT: Keep your responses short, since they will be displayed on a command line interface. \
You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), \
unless user asks for detail.

# Following conventions
When making changes to files, first understand the file's code conventions. Mimic code style, \
use existing libraries and utilities, and follow existing patterns.
- NEVER assume that a given library is available, even if it is well known. Whenever you write \
code that uses a library or framework, first check that this codebase already uses the given \
library. For example, you might look at neighboring files, or check the package.json (or \
cargo.toml, and so on depending on the language).
- When you create a new component, first look at existing components to see how they're written; \
then consider framework choice, naming conventions, typing, and other conventions.
- When you edit a piece of code, first look at the code's surrounding context (especially its \
imports) to understand the code's choice of frameworks and libraries. Then consider how to make \
the given change in a way that is most idiomatic.
- Always follow security best practices. Never introduce code that exposes or logs secrets and \
keys. Never commit secrets or keys to the repository.

# Code style
- IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked

# Doing tasks
The user will primarily request you perform software engineering tasks. This includes solving \
bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks \
the following steps are recommended:
- Use the available search tools to understand the codebase and the user's query. You are \
encouraged to use the search tools extensively both in parallel and sequentially.
- Implement the solution using all tools available to you
- Verify the solution if possible with tests. NEVER assume specific test framework or test \
script. Check the README or search codebase to determine the testing approach.
- VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands \
(e.g. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to \
ensure your code is correct. If you are unable to find the correct command, ask the user for \
the command to run and if they supply it, proactively suggest writing it to AGENTS.md so that \
you will know to run it next time.

NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only \
commit when explicitly asked, otherwise the user will feel that you are being too proactive.

# Tool usage policy
- Use the `task` tool to delegate complex, multistep work to a specialized subagent.
The subagent runs autonomously with its own tool access and returns results.
Always specify `subagent_type` (general, explore, or scout) and a clear `prompt`.
Use `task` when: the user asks for research, exploration, or analysis that doesn't
need your direct file access, or when you want work done in parallel while you
continue responding. Do NOT use `task` for simple lookups you can do yourself.
- When doing file search, prefer to use the Task tool in order to reduce context usage.
- You have the capability to call multiple tools in a single response. When multiple independent
pieces of information are requested, batch your tool calls together for optimal performance.
When making multiple bash tool calls, you MUST send a single message with multiple tools calls
to run the calls in parallel. For example, if you need to run "git status" and "git diff",
send a single message with two tool calls to run the calls in parallel.
- IMPORTANT: When you need to run MORE THAN 3 independent tool calls, use dispatch_parallel_jobs
instead of sequential calls. This runs all tasks in parallel and returns results together.
Example: "check GitHub, read 5 URLs, and search the web" → dispatch all as parallel jobs,
then collect results. This is MUCH faster than sequential calls.

# Dispatching work — when to use which tool
When a request involves multiple independent pieces of work, choose the right dispatch method:

1. **Direct tools** (fastest, use for simple cases):
   - ≤3 tool calls, or all calls depend on each other
   - Examples: "search for X", "read this file", "fix this bug"
   - Just call the tools directly in one message

2. **dispatch_parallel_jobs** (for independent parallel work):
   - 4+ independent tool calls that don't depend on each other
   - Multiple web searches, reading multiple files, checking multiple services
   - Each job is a dict with {"task": "<name>", ...params}
   - Available tasks: web_search, urls, github_prs, gmail, drive, one_drive,
     sheets, calendar, notion_pages, notion_databases, airtable
   - Returns all results together — MUCH faster than sequential calls

3. **task subagent** (for complex autonomous work):
   - Research, exploration, or analysis that needs multiple steps
   - Work you want done while you continue responding
   - Use subagent_type: general (complex tasks), explore (code search),
     or scout (external research)
   - Do NOT use for simple lookups you can do yourself

4. **spawn_openworker** (for heavy parallel batches):
   - When you need to process many items (10+ URLs, bulk API calls)
   - Launches an OpenWorker session with full agent capabilities
   - Use only when dispatch_parallel_jobs isn't enough

DO NOT wrap simple tool calls in task or dispatch_parallel_jobs. If you can do it
yourself in one call, just do it.

# Critical rules
- Use ONLY tool names from the schemas below. Never invent tool names.
  Task names (web_search, urls, gmail) are NOT tool names — they only work
  inside dispatch_parallel_jobs. Use search_web, fetch_url, etc. directly.
- When a tool fails, read the error, understand why, fix the cause, then retry.
  Never retry the exact same call. Try a different approach immediately.
- Never generate fake data. If you can't get real data, say so honestly and
  suggest alternatives.
- Prefer acting over asking. Use ask_user only when the request is ambiguous
  and different readings lead to different work.
- A question typed in your reply is not a question — use ask_user to get
  answers from the user.
- Finish the job. Do not end your turn until the request is actually done.
- The <environment> block is authoritative. Never run a command to find out
  something you were handed.
- Never commit or push unless the user explicitly asked you to.

# Strategy: try simple first
Before web scraping, try the simplest approach:
- Time/date: `date` command or `curl wttr.in/~City`
- Weather: `curl wttr.in/~City` (text output, no JS needed)
- Quick facts: `curl `curl wttr.in/~City?format=3` for one-line weather
- File info: `stat`, `ls -la`, `wc -l` before complex tools
Only escalate to web scraping or APIs when shell commands can't do the job.

# Memory
You have access to long-term memory that persists across conversations. When you learn something \
important about the user or their preferences, it will be recalled automatically. You can also \
explicitly save information using the recall_memories tool.

# Skills
You have access to skills that extend your capabilities. Skills are invoked with /skill-name. \
When a skill is invoked, its full instructions are loaded and you should follow them directly.

# Connectors
You have access to MCP connectors that integrate with external services (GitHub, Google, \
Microsoft, etc.). When a connector is listed under <connectors>, it is connected and ready to \
use. Prefer MCP tools over builtin tools when both could do the job, as MCP tools reach live \
services.

Working in parallel:
- When several tool calls do not depend on each other, make them all in the same \
reply. Reading three files, or searching while you list, should cost one round \
trip, not three. Only chain calls when a later one genuinely needs an earlier \
one's result.

Working on code:
- Find before you guess. Use grep_files and list_files to locate the real file \
and the real symbol; never invent a path.
- Read before you edit. view_file the exact region first — edit_file matches \
byte for byte, so an edit written from memory fails.
- Verify when you are done. Run the project's tests, linter or type checker if \
it has them, or `git status`/`git diff` to check what you changed. Do not \
assume a test command exists: look for it before running one.
- Never commit or push unless the user explicitly asked you to.
"""

# Rough character-per-token ratio, good enough for budgeting without a tokenizer.
CHARS_PER_TOKEN = 4
RESERVED_FOR_RESPONSE = 4096

# Skills that are inlined on every turn — the model never needs to discover or
# load these; they are always active.  Keep the list short: each entry costs
# the skill's full text on every request.
_ALWAYS_PINNED: frozenset[str] = frozenset({"interactive-artifacts"})

# Cross-turn prompt caching. The system prompt is expensive to build (skill scan,
# connector block, memory render) and rarely changes between turns. Cached by a
# hash of its inputs so repeated turns skip the assembly entirely.
_PROMPT_CACHE: dict[str, tuple[str, float]] = {}
_PROMPT_CACHE_TTL = 300.0  # 5 minutes
_PROMPT_CACHE_MAX = 10


def _prompt_hash(
    workspace_root: str | None,
    conversation_id: str | None,
    pinned_skills: tuple[str, ...] | None,
    retrieved_context: str | None,
    memories: tuple[str, ...] | None,
) -> str:
    """Stable hash of the inputs that determine a system prompt."""
    import hashlib

    h = hashlib.sha256()
    h.update((workspace_root or "").encode())
    h.update((conversation_id or "").encode())
    h.update(str(pinned_skills or ()).encode())
    h.update((retrieved_context or "").encode())
    h.update(str(memories or ()).encode())
    return h.hexdigest()[:16]


def environment_block(workspace_root: str | None) -> str:
    now = datetime.now()
    return (
        "<environment>\n"
        f"  date: {now:%Y-%m-%d %H:%M} ({now.astimezone().tzname()})\n"
        f"  platform: {platform.system()} {platform.release()}\n"
        f"  workspace: {workspace_root or 'not set'}\n"
        "</environment>"
    )


def build_system_prompt(
    *,
    workspace_root: str | None = None,
    memories: list[str] | None = None,
    retrieved_context: str | None = None,
    override: str | None = None,
    conversation_id: str | None = None,
    pinned_skills: list[str] | None = None,
) -> str:
    import time as _time

    # Check cross-turn cache first. The prompt is expensive to build (skill scan,
    # connector block, memory render) and rarely changes between turns.
    cache_key = _prompt_hash(
        workspace_root,
        conversation_id,
        tuple(sorted(pinned_skills or ())),
        retrieved_context,
        tuple(sorted(memories or ())),
    )
    cached = _PROMPT_CACHE.get(cache_key)
    if cached is not None:
        prompt, ts = cached
        if _time.monotonic() - ts < _PROMPT_CACHE_TTL:
            return prompt

    parts = [override or BASE_PROMPT, environment_block(workspace_root)]

    # Auto-load AGENTS.md from workspace root if it exists. This gives the model
    # project-specific conventions (lint commands, test frameworks, code style)
    # without the user having to re-explain them every conversation.
    if workspace_root:
        try:
            from pathlib import Path
            agents_md = Path(workspace_root) / "AGENTS.md"
            if agents_md.is_file():
                content = agents_md.read_text(encoding="utf-8", errors="replace")
                if content.strip():
                    parts.append(
                        f"<project_conventions>\n"
                        f"These are project-specific conventions from AGENTS.md:\n\n{content}\n"
                        f"</project_conventions>"
                    )
        except Exception:
            pass

    skills, _ = scan()
    pinned = set(pinned_skills or []) | _ALWAYS_PINNED

    # Only advertise what is switched on for this conversation. Every installed
    # skill used to be injected on every turn, so the catalogue grew without
    # bound and the user had no way to narrow it.
    enabled = _enabled_skill_names(conversation_id)
    visible = [s for s in skills if s.name in enabled or s.name in pinned]

    catalogue = format_catalogue([s for s in visible if s.name not in pinned])
    if catalogue:
        parts.append(catalogue)

    # Skills that are always pinned (e.g. interactive-artifacts) and skills the
    # user explicitly invoked (/skill-name) are both inlined in full so the
    # model can act on them without spending a turn reading the file.
    for skill in visible:
        if skill.name in pinned:
            parts.append(_inline_skill(skill))

    # Which connectors the model may actually reach, named. Best-effort like
    # every other block here: a connector that cannot be described is a hint
    # lost, not a turn lost.
    try:
        from backend.mcp.guidance import ready_connectors_block

        connectors = ready_connectors_block()
        if connectors:
            parts.append(connectors)
    except Exception:
        pass

    # How the user wants to be written *for*, when they ask for something in
    # their own voice. Best-effort like the block above: an unreadable brand
    # profile costs the voice, never the turn.
    try:
        from backend.brand import prompt_block

        brand = prompt_block()
        if brand:
            parts.append(brand)
    except Exception:
        pass

    if memories:
        rendered = "\n".join(f"  - {m}" for m in memories)
        parts.append(f"<memories>\n{rendered}\n</memories>")

    if retrieved_context:
        parts.append(f"<retrieved_context>\n{retrieved_context}\n</retrieved_context>")

    prompt = "\n\n".join(parts)

    # Cache the built prompt for cross-turn reuse. Evict oldest if at capacity.
    if len(_PROMPT_CACHE) >= _PROMPT_CACHE_MAX:
        oldest_key = min(_PROMPT_CACHE, key=lambda k: _PROMPT_CACHE[k][1])
        del _PROMPT_CACHE[oldest_key]
    _PROMPT_CACHE[cache_key] = (prompt, _time.monotonic())

    return prompt


_SLASH_RE = re.compile(r"(?:^|\s)/([a-z0-9][a-z0-9-]{0,63})\b")


def extract_skill_invocations(message: str) -> tuple[list[str], str]:
    """Pull leading /skill-name markers out of a message.

    Returns the invoked skill names and the message with the markers removed.
    Only names that match an installed skill are treated as invocations, so an
    ordinary path like /usr/bin or a date like 3/4 is left alone.
    """
    installed = {s.name for s in scan()[0]}
    if not installed:
        return [], message

    invoked: list[str] = []

    def replace(match: re.Match) -> str:
        name = match.group(1)
        if name in installed:
            if name not in invoked:
                invoked.append(name)
            return " "
        return match.group(0)

    cleaned = _SLASH_RE.sub(replace, message).strip()
    return invoked, cleaned or message


def _enabled_skill_names(conversation_id: str | None) -> set[str]:
    try:
        from backend.capabilities import CapabilityService

        return CapabilityService().enabled_skill_names(conversation_id)
    except Exception:
        # Capability state is an optimisation, not a gate: if it cannot be read,
        # fall back to advertising everything rather than losing all skills.
        return {s.name for s in scan()[0]}


def _inline_skill(skill) -> str:
    try:
        body = skill.path.read_text()
    except OSError as exc:
        return f'<skill name="{skill.name}">could not be read: {exc}</skill>'
    return (
        f'<active_skill name="{skill.name}" path="{skill.path}">\n'
        f"The user invoked this skill. Follow it now.\n\n{body}\n</active_skill>"
    )


# Roles, delimiters and the framing every provider adds around a message.
PER_MESSAGE_OVERHEAD = 32


def estimate_tokens(text: str | None) -> int:
    return len(text or "") // CHARS_PER_TOKEN


def message_tokens(message: dict) -> int:
    """What one wire message really costs, envelope and tool calls included.

    Budgeting on `content` alone counted an assistant turn whose entire payload
    is a tool call as the empty string -- `content` is null on exactly those
    messages, and the arguments live in `tool_calls`. A browser step carrying a
    page snapshot, or a task created with a long body, went into the budget as
    32 tokens and came out of the provider as an over-length request that failed
    mid-generation with nothing in the transcript to explain it.
    """
    cost = estimate_tokens(message.get("content")) + PER_MESSAGE_OVERHEAD
    calls = message.get("tool_calls")
    if calls:
        # Serialized rather than walked: the provider is billed for the JSON it
        # receives, whatever shape the adapter gives it.
        cost += estimate_tokens(json.dumps(calls, default=str))
    return cost


def tool_schema_tokens(tools: Sequence[Any] | None) -> int:
    """What the tool schemas cost, because they are sent on every round trip.

    Measured at 29,620 tokens across 132 tools from seven connectors -- more
    than the entire system prompt, and `budget_history` never counted a single
    one of them. The budget was therefore wrong by exactly their size, in the
    direction that overflows the context window rather than the one that wastes
    it, so the failure mode was a provider error mid-generation.

    Serialized the way the adapter sends it: the provider is billed for the JSON
    it receives, not for the dataclass this side of the wire.
    """
    if not tools:
        return 0
    payload = [
        {
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        }
        for t in tools
    ]
    return estimate_tokens(json.dumps(payload, default=str))


def _call_ids(entry: dict) -> list[str]:
    return [c.get("id") for c in (entry.get("tool_calls") or []) if c.get("id")]


def to_wire_messages(history: list[Message]) -> list[dict]:
    """Repository rows to the normalized message shape adapters consume.

    **Every tool call leaves with its answer, or it does not leave.**

    The chat-completions format requires each entry in an assistant message's
    `tool_calls` to be followed by a `tool` message carrying the same id. A turn
    that dies between the model asking for a tool and the result being written
    leaves the transcript holding one that nothing answers -- and from then on
    every later turn in that conversation ships the malformed array. Recorded
    from a real conversation on 2026-09-09: the same history produced
    `400 "Tool choice is none, but model called a tool"` from groq,
    `400 "Bad input: oneOf at '/' not met"` from cloudflare, and a 200 with an
    empty answer from nvidia. One interrupted turn, and the conversation was
    dead on every provider -- which is what "the model has lost the project"
    actually was.

    Healed on the way out rather than only prevented at the source, because a
    database already holding broken conversations has to start working again.
    The director closes its own turns (see `_close_open_tool_calls`); this is
    what rescues the ones it never got the chance to.
    """
    entries = [to_wire_message(m) for m in history]
    answered = {e.get("tool_call_id") for e in entries if e.get("role") == "tool"}
    requested = {cid for e in entries for cid in _call_ids(e)}

    out: list[dict] = []
    for entry in entries:
        if entry.get("role") == "tool":
            # The mirror image, which history trimming produces on its own by
            # cutting above the assistant message that made the call.
            if entry.get("tool_call_id") not in requested:
                continue
            out.append(entry)
            continue

        calls = entry.get("tool_calls")
        if not calls:
            out.append(entry)
            continue

        kept = [c for c in calls if c.get("id") in answered]
        if len(kept) == len(calls):
            out.append(entry)
            continue
        # A partial batch keeps what was answered: dropping the whole message
        # would throw away a result that really was computed.
        trimmed = {k: v for k, v in entry.items() if k != "tool_calls"}
        if kept:
            trimmed["tool_calls"] = kept
            out.append(trimmed)
        elif (trimmed.get("content") or "").strip():
            # It said something before it called the tool, and the sentence is
            # part of the answer.
            out.append(trimmed)
        # Otherwise the row was only ever the call, and without it there is
        # nothing left to send.
    return out


def to_wire_message(m: Message) -> dict:
    """One repository row to the normalized message shape adapters consume."""
    entry: dict = {"role": m.role, "content": m.content}
    if m.tool_calls:
        entry["tool_calls"] = m.tool_calls
    if m.tool_call_id:
        entry["tool_call_id"] = m.tool_call_id
    if m.tool_name:
        entry["tool_name"] = m.tool_name
    if m.is_error:
        entry["is_error"] = True
    return entry


#: How AMETHYST names a connector's tool in the registry (`backend.tools.registry`).
#: A name without it is a builtin.
_MCP_MARKER = "__mcp__"


#: `mcp_tool_key` percent-escapes what a model may not put in a tool name, so
#: "microsoft-todo" is carried as "microsoft_2dtodo". Undone here rather than
#: matched against, so the caller can pass the connector names it actually has.
_ESCAPED = re.compile(r"_([0-9a-f]{2})")


def _server_of(tool: Any) -> str:
    """Which connector a schema came from, or "" for a builtin.

    Read back off the name because a `ToolSchema` carries no source -- which is
    ADR-0005 working as intended: the model must not be able to tell, so the
    schema does not say. `mcp_tool_key` is the only thing that encodes it.
    """
    _, _, server = getattr(tool, "name", "").partition(_MCP_MARKER)
    return _ESCAPED.sub(lambda m: chr(int(m.group(1), 16)), server) if server else ""


def _interleave_by_server(tools: list[Any]) -> list[Any]:
    """Round-robin MCP tools across their servers, preserving per-server order.

    Grouped by server, a hard cap drops whole connectors: the servers late in
    the list lose *every* tool while the first keeps all of its, which is the
    concrete "the model won't use my connector" case. Interleaving takes one
    tool from each server in turn, so a cap that keeps N tools keeps roughly
    N/servers from *each* -- no ready connector is silently zeroed.
    """
    by_server: dict[str, list[Any]] = {}
    order: list[str] = []
    for tool in tools:
        server = _server_of(tool)
        if server not in by_server:
            by_server[server] = []
            order.append(server)
        by_server[server].append(tool)
    out: list[Any] = []
    while any(by_server[s] for s in order):
        for server in order:
            if by_server[server]:
                out.append(by_server[server].pop(0))
    return out


def cap_tools(
    tools: list[Any], limit: int | None, *, priority_servers: set[str] | None = None
) -> tuple[list[Any], list[str]]:
    """Fit the tool list into what the provider will accept.

    Groq refuses a request carrying more than 128 tool schemas -- `400 'tools' :
    maximum number of items is 128` -- and this machine offers 178 across
    thirteen connectors, so every turn failed before a token moved with an error
    naming a limit nothing in AMETHYST knew about.

    Two decisions worth stating:

    * **Builtins are kept first.** They are the tools AMETHYST itself is built on --
      files, shell, tasks, calendar, retrieval -- and a turn that has lost
      `list_files` is broken in a way a turn missing one of forty-four GitHub
      tools is not.
    * **A ready connector's tools come next.** `priority_servers` names the
      connectors that are connected and signed in right now. Their tools are the
      ones that can actually answer, and losing them to the cap while the tools
      of a connector nobody signed in to survive is the worst possible trade.
    * **The rest keep registry order,** which is `mcp.yaml`'s order, which is the
      order the user added their connectors in. Not a ranking anybody chose, but
      stable between turns: a model that saw a tool last turn and not this one
      calls it anyway, and the refusal is confusing rather than instructive.

    Returns the kept schemas and the names dropped, so the caller can say so.
    Dropping tools silently would be the same failure as the 400, one layer
    further from the person who can fix it by switching a connector off.
    """
    if not limit or len(tools) <= limit:
        return tools, []
    ready = priority_servers or set()
    builtin = [t for t in tools if _MCP_MARKER not in getattr(t, "name", "")]
    preferred = [t for t in tools if _server_of(t) in ready and _server_of(t)]
    chosen = {id(t) for t in preferred}
    rest = [
        t
        for t in tools
        if _MCP_MARKER in getattr(t, "name", "") and id(t) not in chosen
    ]
    kept = [*builtin, *_interleave_by_server(preferred), *_interleave_by_server(rest)][:limit]
    keep_names = {id(t) for t in kept}
    dropped = [getattr(t, "name", "?") for t in tools if id(t) not in keep_names]
    return kept, dropped


def compress_tool_schemas(tools: list[Any]) -> list[Any]:
    """Shorten tool descriptions while preserving decision-critical information.

    Descriptions carry a headline followed by WHEN TO USE / OUTPUT / TIPS /
    LIMITS guidance. OUTPUT, TIPS, and LIMITS are operational advice the model
    can often infer or skip. WHEN TO USE (and WHEN NOT TO USE) is what tells
    the model *which tool to pick* from a set of similar ones — stripping it
    causes wrong-tool selection. This function keeps the headline and the
    WHEN TO USE / WHEN NOT TO USE sections, dropping the rest.

    Anything without the multi-line shape is returned untouched.
    """
    _DECISION_SECTIONS = ("when to use", "when not to use")
    out = []
    for tool in tools:
        description = getattr(tool, "description", "") or ""
        lines = description.split("\n")
        if len(lines) <= 1:
            out.append(tool)
            continue
        # Keep headline (first line) + any WHEN TO USE / WHEN NOT TO USE lines
        kept = [lines[0].strip()]
        for line in lines[1:]:
            stripped = line.strip().lower()
            if any(stripped.startswith(s) for s in _DECISION_SECTIONS):
                kept.append(line.strip())
        compressed = "\n".join(kept)
        if compressed != description:
            out.append(
                ToolSchema(name=tool.name, description=compressed, parameters=tool.parameters)
            )
        else:
            out.append(tool)
    return out


def fit_tools_to_budget(
    tools: list[Any],
    *,
    system_prompt: str,
    token_budget: int,
    margin: float,
    priority_servers: set[str] | None = None,
) -> tuple[list[Any], list[str]]:
    """Keep as many tool schemas as fit under a per-request token ceiling.

    This is what lets a free tier with a tokens-per-minute cap actually answer.
    Groq's free tier is 8,000 TPM, and this machine's 178 tool schemas are
    ~29,000 tokens -- so every turn used to be *skipped* on groq and shunted to
    a flakier provider. A small client like OpenCode "just works" on the same
    tier because it sends a couple of tools; this makes AMETHYST send only as many
    as fit, in the same priority order `cap_tools` uses -- builtins first (the
    tools AMETHYST is built on), then a ready connector's tools, then the rest.

    The budget mirrors the caller's own estimate: `(system + tools) * margin <=
    ceiling`, so the tool allowance is `ceiling / margin - system`. Returns the
    kept schemas and the names dropped, so the turn can say what it withheld.
    """
    if not tools:
        return tools, []
    ready = priority_servers or set()
    builtin = [t for t in tools if _MCP_MARKER not in getattr(t, "name", "")]
    preferred = [t for t in tools if _server_of(t) and _server_of(t) in ready]
    chosen = {id(t) for t in preferred}
    rest = [t for t in tools if _MCP_MARKER in getattr(t, "name", "") and id(t) not in chosen]
    ordered = [*builtin, *_interleave_by_server(preferred), *_interleave_by_server(rest)]

    allowance = token_budget / margin - estimate_tokens(system_prompt)
    # Losing advice is cheaper than losing capability: if the rich descriptions
    # will not fit, try the headline-only form of *every* tool before dropping
    # any tool at all. Only when even that overflows does the loop below trim.
    if tool_schema_tokens(ordered) > allowance:
        compressed = compress_tool_schemas(ordered)
        if tool_schema_tokens(compressed) <= allowance:
            return compressed, []
        ordered = compressed
    kept: list[Any] = []
    used = 0.0
    for tool in ordered:
        cost = tool_schema_tokens([tool])
        if used + cost <= allowance:
            kept.append(tool)
            used += cost
    # The loop above sums each tool's cost measured alone, but a request carries
    # them as one array -- and the array is worth a little more than its parts,
    # so a set that fit by the running total could still overflow the ceiling by
    # a few dozen tokens and earn a 413. Reconciled against the real cost here:
    # the promise this function makes is that what it returns actually fits.
    while kept and tool_schema_tokens(kept) > allowance:
        kept.pop()

    # Compared by name, not by identity: compression above rebuilds the schemas,
    # so an `id()` check would report every tool as dropped when none were.
    kept_names = {getattr(t, "name", "?") for t in kept}
    dropped = [n for t in tools if (n := getattr(t, "name", "?")) not in kept_names]
    return kept, dropped


def dropped_summary(dropped: list[str]) -> str:
    """One sentence naming what was withheld and roughly where it came from."""
    servers: dict[str, int] = {}
    for name in dropped:
        _, _, server = name.partition(_MCP_MARKER)
        label = (server or "builtin").replace("_2d", "-")
        servers[label] = servers.get(label, 0) + 1
    listed = ", ".join(f"{count} from {name}" for name, count in sorted(servers.items()))
    return (
        f"this provider accepts a limited number of tools, so {len(dropped)} were withheld"
        f" this turn ({listed}) — switch connectors off in Skills & connectors to choose"
        " which the model gets"
    )


def budget_history(
    messages: list[dict],
    *,
    context_window: int,
    system_prompt: str,
    tools: Sequence[Any] | None = None,
    reserved: int = RESERVED_FOR_RESPONSE,
) -> list[dict]:
    """Drop oldest messages until the assembly fits, keeping tool pairs coherent.

    `tools` are part of the request whether or not the model calls one, so they
    come out of the same window the history is competing for.
    """

    def drop_leading_orphans(chosen: list[dict]) -> list[dict]:
        # A tool result whose originating assistant turn was dropped confuses
        # every provider, so it must never lead the history.
        while chosen and chosen[0].get("role") == "tool":
            chosen = chosen[1:]
        return chosen

    available = (
        context_window - estimate_tokens(system_prompt) - tool_schema_tokens(tools) - reserved
    )
    if available <= 0:
        return drop_leading_orphans(messages[-2:])

    total = sum(message_tokens(m) for m in messages)
    if total <= available:
        return messages

    kept: list[dict] = []
    running = 0
    for message in reversed(messages):
        cost = message_tokens(message)
        if running + cost > available and kept:
            break
        kept.append(message)
        running += cost
    kept.reverse()

    return drop_leading_orphans(kept)
