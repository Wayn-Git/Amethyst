"""The flat tool registry and the single dispatch path (ADR-0005).

No tool call reaches the filesystem, the shell or an external service by any
other route: every one passes the permission gate, gets normalized, gets
truncated, and gets an audit row.
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import time
from typing import Any

log = logging.getLogger(__name__)

from backend.agent.config import agent_config
from backend.db.repositories import ExecutionLogRepository
from backend.mcp.client import is_auth_failure_text
from backend.runtime.types import ToolSchema
from backend.security.confirmation import ConfirmationOutcome, ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource

MAX_RESULT_CHARS = 8_000  # ~2,000 tokens at ~4 chars/token
MCP_DELIMITER = "__mcp__"

#: How long one tool call may run before the registry stops it.
#:
#: Sized to the turn's own `Guards.max_seconds` deliberately: a call that hangs
#: longer than the whole turn is allowed to last cannot be stopped by any guard,
#: because every guard is evaluated between iterations and a hung call never
#: reaches the end of its own. The timeout is what turns an indefinite hang into
#: an error result the model can reason about and the reader can see.
#:
#: A tool may override it with `Tool.timeout`; there is no way to opt out
#: entirely, because "wait forever" is not a thing a tool gets to decide.
TOOL_TIMEOUT_SECONDS = agent_config.tool_timeout_seconds

#: Canonical capability routing table.
#: Decouples the model's high-level intent from the physical tool name.
CAPABILITY_MAP: dict[str, str] = {
    # Web search capabilities
    "web_search": "search_web",
    "search": "search_web",
    "google": "search_web",
    "google_search": "search_web",
    "bing_search": "search_web",
    "tavily": "search_web",
    "tavily_search": "search_web",
    "tavily__tavily_search": "search_web",
    "web_search__mcp__tavily": "search_web",
    "research": "research_web",
    "deep_search": "research_web",
    "images": "search_images",
    "image_search": "search_images",
    "find_images": "search_images",

    # Web fetch / scrape capabilities
    "fetch": "fetch_url",
    "fetch_page": "fetch_url",
    "fetch_webpage": "fetch_url",
    "scrape": "fetch_url",
    "scrape_url": "fetch_url",
    "read_url": "fetch_url",
    "open_url": "fetch_url",
    "firecrawl": "fetch_url",
    "firecrawl_scrape": "fetch_url",
    "scrape__mcp__firecrawl": "fetch_url",

    # Calendar capabilities
    "google_calendar": "GOOGLECALENDAR_FIND_EVENT",
    "googlecalendar": "GOOGLECALENDAR_FIND_EVENT",
    "calendar": "GOOGLECALENDAR_FIND_EVENT",
    "calendar_find": "GOOGLECALENDAR_FIND_EVENT",
    "calendar_search": "GOOGLECALENDAR_FIND_EVENT",
    "find_event": "GOOGLECALENDAR_FIND_EVENT",
    "find_events": "GOOGLECALENDAR_FIND_EVENT",
    "list_events": "GOOGLECALENDAR_FIND_EVENT",

    # Email / Gmail capabilities
    "gmail": "GMAIL_FETCH_EMAILS",
    "email": "GMAIL_FETCH_EMAILS",
    "emails": "GMAIL_FETCH_EMAILS",
    "search_emails": "GMAIL_FETCH_EMAILS",
    "fetch_emails": "GMAIL_FETCH_EMAILS",
    "fetch_email": "GMAIL_FETCH_EMAILS",
    "read_emails": "GMAIL_FETCH_EMAILS",

    # GitHub capabilities
    "github": "GITHUB_GET_A_REPOSITORY",

    # Slack capabilities
    "slack": "SLACK_SEARCH_MESSAGES",

    # Notion capabilities
    "notion": "NOTION_SEARCH_NOTION_PAGE",
    "notion_search": "NOTION_SEARCH_NOTION_PAGE",

    # Shell execution capabilities
    "bash": "run_shell_command",
    "terminal": "run_shell_command",
    "shell": "run_shell_command",
    "sh": "run_shell_command",
    "exec": "run_shell_command",
    "cmd": "run_shell_command",

    # File capabilities
    "read": "view_file",
    "read_file": "view_file",
    "cat": "view_file",
    "show_file": "view_file",
    "edit": "edit_file",
    "modify_file": "edit_file",
    "write": "write_file",
    "create_file": "write_file",
    "make_file": "write_file",
    "glob": "list_files",
    "find_file": "list_files",
    "search_files": "grep_files",
    "grep": "grep_files",
    "ls": "list_files",
    "dir": "list_files",
}

#: How long a repeated read may be answered from the last one. Deliberately
#: short. A longer window saves more calls, but a file the user edits in their
#: own editor is changed by something this process never sees -- and an agent
#: that edits from a stale read corrupts work rather than merely wasting time.
#: Long enough to collapse the re-reads one turn makes, short enough that the
#: world cannot move far underneath it.
RESULT_CACHE_TTL_SECONDS = 60.0
RESULT_CACHE_MAX = 128

#: `RiskLevel.LOW` means "changes nothing", which is *almost* the same as "safe
#: to answer twice from one run". These are the exceptions, where running the
#: tool is the point rather than the value it returns:
#:
#: * `ask_user` puts a question to the person. Answering the second one from the
#:   first would skip asking them at all -- the worst possible cache hit.
#: * the job tools report a lifecycle that moves on its own, so a repeat call is
#:   asking precisely because the answer may have changed.
NEVER_CACHE = frozenset({
    "ask_user",
    "collect_jobs",
    "dispatch_parallel_jobs",
    "index_status",
    "task",
})


def truncate(
    text: str,
    limit: int | None = None,
    tool_name: str = "",
    arguments: dict[str, Any] | None = None,
) -> str:
    if not text:
        return text
    from backend.agent.config import agent_config
    eff_limit = limit if limit is not None else agent_config.max_payload_chars
    from backend.agent.projection import project_tool_result_content
    projected = project_tool_result_content(text, tool_name=tool_name, arguments=arguments)
    from backend.agent.scratch_store import scratch_store
    compacted, _ = scratch_store.compact_payload(projected, tool_name=tool_name, max_chars=eff_limit)
    return compacted


WRITE_ACTION_KEYWORDS: frozenset[str] = frozenset({
    "send",
    "delete",
    "create",
    "update",
    "write",
    "post",
    "remove",
    "patch",
    "modify",
    "drop",
    "destroy",
    "insert",
    "edit",
})


def is_write_action(name: str, tool: Tool | None = None) -> bool:
    """Whether a tool or tool name represents a mutating/write operation."""
    tokens = set(name.lower().replace("-", "_").split("_"))
    if tokens & WRITE_ACTION_KEYWORDS:
        return True
    if tool is not None:
        if tool.risk is RiskLevel.HIGH:
            return True
        t_tokens = set(tool.name.lower().replace("-", "_").split("_"))
        if t_tokens & WRITE_ACTION_KEYWORDS:
            return True
        if tool.risk is not RiskLevel.LOW:
            return getattr(tool, "touches_paths", False)
    return False


class ToolRegistry:
    def __init__(
        self,
        confirmation: ConfirmationService | None = None,
        logs: ExecutionLogRepository | None = None,
    ):
        self._tools: dict[str, Tool] = {}
        self.confirmation = confirmation or ConfirmationService()
        self._logs = logs
        # Repeated reads within a turn, answered once. See RESULT_CACHE_TTL_SECONDS.
        self._result_cache: dict[str, tuple[float, ToolResult]] = {}
        self.mcp_manager: Any = None

    @property
    def logs(self) -> ExecutionLogRepository:
        if self._logs is None:
            self._logs = ExecutionLogRepository()
        return self._logs

    def with_confirmation(self, confirmation: ConfirmationService) -> ToolRegistry:
        """The same tools, gated differently.

        An unattended turn needs a permission callback that refuses rather than
        one that waits for a person, and it needs the connected MCP tools that
        the shared registry holds. Swapping the callback on the shared registry
        would change the rules for every interactive turn running at the same
        time, so this shares the tool dict -- deliberately by reference, so a
        connector that reconnects stays visible here too -- and nothing else.
        """
        view = ToolRegistry(confirmation=confirmation, logs=self._logs)
        view._tools = self._tools
        # Shared by reference for the same reason as the tools: a write made
        # through one view has to invalidate the reads cached in the other, or
        # an unattended turn's edit leaves an interactive turn reading the file
        # as it used to be.
        view._result_cache = self._result_cache
        view.mcp_manager = getattr(self, "mcp_manager", None)
        return view

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool '{tool.name}' is already registered")
        self._tools[tool.name] = tool

    def register_all(self, tools: list[Tool]) -> None:
        for tool in tools:
            self.register(tool)

    def unregister_server(self, server_name: str) -> None:
        for name in [n for n, t in self._tools.items() if t.server_name == server_name]:
            del self._tools[name]

    def get(self, name: str) -> Tool | None:
        return self.resolve_tool(name)

    def resolve_tool(self, name: str) -> Tool | None:
        if not name:
            return None
        # 1. Exact match (allowed for both read and write tools when explicitly called by exact name)
        if name in self._tools:
            return self._tools[name]

        clean_name = name.strip()
        if clean_name in self._tools:
            return self._tools[clean_name]

        # Explicit capability aliases (e.g. OpenCode CLI core tools: read, edit, write, bash)
        target = CAPABILITY_MAP.get(clean_name.lower())
        if target and target in self._tools:
            return self._tools[target]

        # Auto-repair and fuzzy matching applies ONLY to read-only tools (Task 5).
        # Write tools (send/delete/create/update) must never be fuzzy-matched.
        if is_write_action(clean_name):
            return None

        def _check_readonly(cand: Tool | None) -> Tool | None:
            if cand is None:
                return None
            if is_write_action(cand.name, cand):
                return None
            return cand

        # 2. Check normalized name (case, spaces, hyphens)
        normalized = clean_name.lower().replace(" ", "_").replace("-", "_")
        if normalized in self._tools:
            return _check_readonly(self._tools[normalized])

        # 3. Check MCP delimiter and prefix/suffix variations
        # e.g. tavily__tavily_search -> tavily_search__mcp__tavily
        # e.g. firecrawl__scrape -> scrape__mcp__firecrawl
        if "__" in clean_name:
            parts = clean_name.split("__")
            s, t = parts[0], parts[-1]
            cand1 = f"{t}__mcp__{s}"
            if cand1 in self._tools:
                return _check_readonly(self._tools[cand1])
            cand2 = f"{s}__mcp__{t}"
            if cand2 in self._tools:
                return _check_readonly(self._tools[cand2])

        # 4. Check if any MCP tool has matching base name or server prefix
        for tool_name, tool in self._tools.items():
            if MCP_DELIMITER in tool_name:
                t_base, s_name = tool_name.split(MCP_DELIMITER, 1)
                if clean_name in (t_base, f"{s_name}_{t_base}", f"{s_name}__{t_base}"):
                    return _check_readonly(tool)
                if normalized in (t_base.lower(), f"{s_name.lower()}_{t_base.lower()}"):
                    return _check_readonly(tool)

        # 5. Capability alias map
        for cand in (clean_name.lower(), normalized):
            target = CAPABILITY_MAP.get(cand)
            if target:
                if target in self._tools:
                    return _check_readonly(self._tools[target])
                for t_name, tool in self._tools.items():
                    if MCP_DELIMITER in t_name and t_name.split(MCP_DELIMITER)[0] == target:
                        return _check_readonly(tool)
                if target == "GOOGLECALENDAR_FIND_EVENT" and "list_calendar" in self._tools:
                    return _check_readonly(self._tools["list_calendar"])
                if target == "GMAIL_FETCH_EMAILS" and "search_email" in self._tools:
                    return _check_readonly(self._tools["search_email"])

        # 6. Case-insensitive match against all registered tools
        for tool_name, tool in self._tools.items():
            if tool_name.lower() in (clean_name.lower(), normalized):
                return _check_readonly(tool)

        return None

    @staticmethod
    def coerce_property_value(prop_schema: dict[str, Any], val: Any) -> Any:
        """Coerce a value to match the expected JSON schema property type."""
        if not isinstance(prop_schema, dict) or val is None:
            return val
        expected_type = prop_schema.get("type")
        if isinstance(expected_type, list):
            types = [t for t in expected_type if t != "null"]
            expected_type = types[0] if types else None
        if not expected_type:
            return val

        if expected_type in ("integer", "int"):
            if isinstance(val, bool):
                return 1 if val else 0
            if isinstance(val, (int, float)):
                return int(val)
            if isinstance(val, str):
                s = val.strip()
                try:
                    return int(s)
                except ValueError:
                    try:
                        return int(float(s))
                    except ValueError:
                        return val

        elif expected_type in ("number", "float"):
            if isinstance(val, bool):
                return 1.0 if val else 0.0
            if isinstance(val, (int, float)):
                return float(val)
            if isinstance(val, str):
                try:
                    return float(val.strip())
                except ValueError:
                    return val

        elif expected_type in ("boolean", "bool"):
            if isinstance(val, bool):
                return val
            if isinstance(val, str):
                s = val.strip().lower()
                if s in ("true", "1", "yes", "t", "y"):
                    return True
                if s in ("false", "0", "no", "f", "n"):
                    return False
            if isinstance(val, (int, float)):
                return bool(val)

        elif expected_type in ("array", "list"):
            if isinstance(val, list):
                return val
            if isinstance(val, str):
                s = val.strip()
                if (s.startswith("[") and s.endswith("]")) or (s.startswith("(") and s.endswith(")")):
                    try:
                        parsed = json.loads(s)
                        if isinstance(parsed, list):
                            return parsed
                    except Exception:
                        pass
                if "," in s:
                    return [part.strip() for part in s.split(",") if part.strip()]
                return [s] if s else []
            if isinstance(val, (dict, int, float, bool)):
                return [val]

        elif expected_type in ("object", "dict"):
            if isinstance(val, dict):
                return val
            if isinstance(val, str):
                s = val.strip()
                if s.startswith("{") and s.endswith("}"):
                    try:
                        parsed = json.loads(s)
                        if isinstance(parsed, dict):
                            return parsed
                    except Exception:
                        pass

        elif expected_type in ("string", "str"):
            if isinstance(val, (int, float, bool)):
                return str(val)
            if isinstance(val, (dict, list)):
                try:
                    return json.dumps(val)
                except Exception:
                    return str(val)

        return val

    @staticmethod
    def normalize_arguments(tool: Tool, arguments: dict[str, Any]) -> dict[str, Any]:
        if isinstance(arguments, str) or (isinstance(arguments, dict) and "_raw" in arguments):
            try:
                from backend.agent.tool_repair import parse_and_repair_json

                parsed, _ = parse_and_repair_json(arguments)
                if isinstance(parsed, dict):
                    arguments = parsed
            except Exception:
                pass
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except Exception:
                return {}
        if not isinstance(arguments, dict):
            return {}
        args = dict(arguments)
        props = tool.parameters.get("properties", {}) if isinstance(tool.parameters, dict) else {}

        # Search / topic normalization
        if "query" in props and "query" not in args:
            for syn in ("q", "topic", "search_query", "search", "input", "prompt", "question"):
                if syn in args:
                    args["query"] = args[syn]
                    break
        elif "topic" in props and "topic" not in args:
            for syn in ("query", "q", "search_query", "search", "input", "prompt"):
                if syn in args:
                    args["topic"] = args[syn]
                    break

        # URL normalization
        if "url" in props and "url" not in args:
            for syn in ("link", "href", "address", "target_url", "uri"):
                if syn in args:
                    args["url"] = args[syn]
                    break

        # File path normalization
        if "path" in props and "path" not in args:
            for syn in ("file_path", "filePath", "filename", "file"):
                if syn in args:
                    args["path"] = args[syn]
                    break
        elif "filePath" in props and "filePath" not in args and "path" in args:
            args["filePath"] = args["path"]
        elif "file_path" in props and "file_path" not in args and "path" in args:
            args["file_path"] = args["path"]

        # Command normalization
        if "command" in props and "command" not in args:
            for syn in ("cmd", "bash", "shell", "script"):
                if syn in args:
                    args["command"] = args[syn]
                    break

        # Edit string normalization
        if "old_string" in props and "old_string" not in args and "oldString" in args:
            args["old_string"] = args["oldString"]
        if "new_string" in props and "new_string" not in args and "newString" in args:
            args["new_string"] = args["newString"]
        if "replace_all" in props and "replace_all" not in args and "replaceAll" in args:
            args["replace_all"] = args["replaceAll"]

        # Schema-aware type coercion
        for prop_name, prop_def in props.items():
            if prop_name in args and isinstance(prop_def, dict):
                args[prop_name] = ToolRegistry.coerce_property_value(prop_def, args[prop_name])

        return args

    def list(self) -> list[Tool]:
        return list(self._tools.values())

    def schemas(
        self,
        *,
        hidden_servers: set[str] | None = None,
        read_only: bool = False,
        priority_servers: set[str] | None = None,
    ) -> list[ToolSchema]:
        """What the model sees. Source is deliberately invisible here.

        `hidden_servers` withholds the tools of connectors switched off for the
        current conversation, and of connectors nobody has signed in to. The
        connection itself is process-wide -- one manager serves every
        conversation -- so what a conversation can reach is decided here rather
        than by connecting a different set of servers.

        `read_only` withholds every tool that can change anything, which is what
        plan mode is. `RiskLevel.LOW` already means "changes nothing, runs
        without asking" -- the permission gate has trusted that judgement since
        it shipped -- so gating on it covers a connector's tools on the day it
        is added rather than on the day someone remembers to update a list.

        `priority_servers` names the connectors that are connected and signed in
        right now, and moves their tools up the list: after the builtins AMETHYST is
        built on, ahead of the tools of connectors that are merely configured. A
        soft signal only -- nothing is withheld and nothing is renamed, so the
        model still cannot tell a builtin from an MCP tool (ADR-0005) -- but
        position is read, and it decides which tools survive `cap_tools` on a
        provider with a ceiling.
        """
        hidden = hidden_servers or set()
        ready = priority_servers or set()

        # Resolve active Composio connections and local overrides
        composio_conns: dict[str, Any] = {}
        try:
            from backend.mcp.composio_service import composio_service

            if composio_service.is_configured():
                composio_conns = composio_service.get_connections()
        except Exception:
            pass

        try:
            from backend.mcp.provider_ownership import (
                get_withheld_local_servers,
                get_withheld_local_tool_names,
                is_provider_overridden_by_local,
                is_provider_owned_by_composio,
            )
            withheld_local_tools = get_withheld_local_tool_names()
            withheld_local_servers = get_withheld_local_servers()
        except Exception:
            def is_provider_overridden_by_local(_tk: str) -> bool:
                return False
            def is_provider_owned_by_composio(_p: str) -> bool:
                return False
            withheld_local_tools = set()
            withheld_local_servers = set()

        offered = []
        for t in self._tools.values():
            if t.server_name and t.server_name in hidden:
                continue
            if read_only and t.risk is not RiskLevel.LOW:
                continue

            # Cloud Connectors (Composio) filtering: withhold if overridden by active
            # local server or if account has not been connected.
            tk = extract_composio_toolkit(t)
            if tk:
                if is_provider_overridden_by_local(tk):
                    continue
                from backend.mcp.composio_service import is_no_auth_toolkit

                if tk == "composio":
                    try:
                        from backend.mcp.composio_service import composio_service

                        if not composio_service.is_configured():
                            continue
                    except Exception:
                        continue
                elif is_no_auth_toolkit(tk):
                    try:
                        from backend.mcp.composio_service import composio_service

                        if not composio_service.is_configured():
                            continue
                    except Exception:
                        continue
                elif tk not in composio_conns:
                    continue
            else:
                # Local tool: withhold if Composio actively owns this provider
                bare_name = t.name.split(MCP_DELIMITER)[0]
                if bare_name in withheld_local_tools:
                    continue
                if t.server_name and t.server_name in withheld_local_servers:
                    continue
                if t.server_name == "google-workspace":
                    if "gmail" in bare_name.lower() and is_provider_owned_by_composio("gmail"):
                        continue
                    if "calendar" in bare_name.lower() and is_provider_owned_by_composio("googlecalendar"):
                        continue

            offered.append(t)

        if ready:
            offered.sort(
                key=lambda t: 0 if not t.server_name else (1 if t.server_name in ready else 2)
            )
        return [
            ToolSchema(name=t.name, description=t.description, parameters=t.parameters)
            for t in offered
        ]

    def _cache_key(
        self, tool: Tool, arguments: dict[str, Any], ctx: ToolContext
    ) -> str | None:
        """A key for a repeatable read, or None if this call must really run.

        Only `RiskLevel.LOW` tools qualify -- LOW already means "changes
        nothing" -- minus `NEVER_CACHE`, where the call *is* the point rather
        than the answer. Keyed by conversation as well as arguments, so one
        chat can never be served a read taken in another.
        """
        if tool.risk is not RiskLevel.LOW or tool.name in NEVER_CACHE:
            return None
        try:
            payload = json.dumps(arguments, sort_keys=True, default=str)
        except (TypeError, ValueError):
            return None
        return f"{ctx.conversation_id}:{tool.name}:{payload}"

    async def dispatch(
        self,
        name: str,
        arguments: dict[str, Any],
        context: ToolContext | None = None,
        *,
        _connection_retry: bool = False,
    ) -> ToolResult:
        ctx = context or ToolContext()
        tool = self.resolve_tool(name)
        if tool is not None:
            arguments = self.normalize_arguments(tool, arguments)
        if tool is None:
            all_known = sorted(self._tools.keys())
            sample_valid = ", ".join(all_known[:15]) or "none"
            lower_map = {k.lower(): k for k in all_known}
            bare_map: dict[str, str] = {}
            for k in all_known:
                bare = k.split(MCP_DELIMITER)[0].lower()
                bare_map[bare] = k
                if "_" in bare:
                    for part_idx in range(1, bare.count("_") + 1):
                        sub = "_".join(bare.split("_")[part_idx:])
                        if sub not in bare_map:
                            bare_map[sub] = k

            name_lower = name.lower().strip()
            if name_lower in lower_map:
                closest = lower_map[name_lower]
            elif name_lower in bare_map:
                closest = bare_map[name_lower]
            else:
                matches = difflib.get_close_matches(name_lower, list(lower_map.keys()), n=1, cutoff=0.25)
                if matches:
                    closest = lower_map[matches[0]]
                else:
                    closest = "none"
            return ToolResult.error(f"Unknown tool '{name}' (unknown tool). Valid tools: [{sample_valid}]. Closest match: '{closest}'.")

        # A capability switched off for this conversation is not advertised and
        # not dispatchable. Withholding the schema is not enough on its own: the
        # model can name a tool it saw in an earlier turn, and the connection is
        # shared with every other conversation.
        if tool.server_name and not _connector_enabled(tool.server_name, ctx.conversation_id):
            return ToolResult.error(
                f"the '{tool.server_name}' connector is switched off for this conversation."
                " Ask the user to turn it back on if they want it used."
            )

        # Plan mode. Withholding the schema is a request; this is the answer to
        # "what if it asks anyway". Refused before the permission gate, because
        # a plan turn must not be able to raise a confirmation prompt either --
        # an approval dialog for a write the user did not ask for yet is worse
        # than the write being declined.
        if ctx.read_only and tool.risk is not RiskLevel.LOW:
            return ToolResult.error(
                f"'{name}' changes things, and this turn is planning rather than acting."
                " It is not available until the user approves the plan. Finish the plan"
                " and call submit_plan; do not try this tool again."
            )

        # Withholding the schema is not enough here either: a model can name a
        # tool it saw in an earlier turn, before the account was removed or
        # before the sign-in was found to be missing.
        if tool.server_name and tool.server_name in _unsigned_connectors():
            from backend.mcp.guidance import sign_in_instruction

            return ToolResult.error(sign_in_instruction(tool.server_name))

        # Check Composio toolkit authentication and local overrides
        tk = extract_composio_toolkit(tool)
        if tk:
            from backend.mcp.guidance import (
                auth_failure_instruction,
                composio_sign_in_instruction,
                extract_service_name,
            )

            try:
                from backend.mcp.provider_ownership import is_provider_overridden_by_local

                if is_provider_overridden_by_local(tk):
                    return ToolResult.error(
                        f"'composio:{tk}' is disabled because a local MCP server has active ownership of this provider."
                        " Use the local connector instead. Do not retry this tool."
                    )
            except Exception:
                pass

            try:
                from backend.mcp.composio_service import composio_service, is_no_auth_toolkit

                if composio_service.is_reauth_required(tk):
                    service = extract_service_name(tool)
                    return await self._suspend_for_connection(
                        name, arguments, context,
                        ToolResult.error(auth_failure_instruction(service)),
                        tk, service, _connection_retry,
                    )

                if not composio_service.is_configured():
                    return ToolResult.error(
                        f"Composio API key is not configured. Please configure your Composio key in settings to use '{tk}'."
                    )
                if (
                    tk != "composio"
                    and not is_no_auth_toolkit(tk)
                    and tk not in composio_service.get_connections()
                ):
                    service = extract_service_name(tool)
                    return await self._suspend_for_connection(
                        name, arguments, context,
                        ToolResult.error(composio_sign_in_instruction(tk)),
                        tk, service, _connection_retry,
                    )
            except Exception:
                return ToolResult.error(composio_sign_in_instruction(tk))
        else:
            # Check if local tool is called while Composio owns the provider
            try:
                from backend.mcp.provider_ownership import is_local_tool_owned_by_composio

                owned_by_comp, prov = is_local_tool_owned_by_composio(tool.name)
                if owned_by_comp:
                    return ToolResult.error(
                        f"'{tool.name}' is disabled because the user has '{prov}' connected via Composio. "
                        f"Do NOT use this local offline tool. "
                        f"Please use COMPOSIO_SEARCH_TOOLS (use_case='...') and COMPOSIO_MULTI_EXECUTE_TOOL instead."
                    )
            except Exception:
                pass

        # The gate gets its own `try`, and that is the whole point: an
        # exception raised *here* used to leave the dispatch function entirely,
        # up into the turn's own error handling, where it became one failure per
        # tool call for the rest of the turn rather than the single call it
        # actually was. Errors are data at this layer, including the errors of
        # deciding whether to run at all.
        try:
            outcome = await self.confirmation.check(tool, arguments, ctx)
        except Exception as exc:  # noqa: BLE001 - see above
            reason = f"the permission check failed: {type(exc).__name__}: {exc}"
            self.logs.record(
                tool_name=name,
                tool_source=tool.source.value,
                conversation_id=ctx.conversation_id,
                arguments=arguments,
                error=reason,
                risk_level=None,
                confirmation_decision="gate_error",
            )
            return ToolResult.error(f"'{name}' was not run: {reason}")

        if not outcome.allowed:
            reason = _refusal_reason(outcome)
            self.logs.record(
                tool_name=name,
                tool_source=tool.source.value,
                conversation_id=ctx.conversation_id,
                arguments=arguments,
                error=reason,
                risk_level=outcome.risk.value,
                confirmation_decision=outcome.decision,
            )
            return ToolResult.error(f"'{name}' was not run: {reason}")

        cache_key = self._cache_key(tool, arguments, ctx)
        if cache_key is not None:
            hit = self._result_cache.get(cache_key)
            if hit is not None and time.monotonic() - hit[0] < RESULT_CACHE_TTL_SECONDS:
                return hit[1]

        timeout = tool.timeout if tool.timeout is not None else TOOL_TIMEOUT_SECONDS
        if timeout is not None and timeout <= 0:
            timeout = None
        started = time.monotonic()
        try:
            if timeout is not None:
                result = await asyncio.wait_for(tool.handler(arguments, ctx), timeout=timeout)
            else:
                result = await tool.handler(arguments, ctx)
        except TimeoutError:
            result = ToolResult.error(
                f"{name} did not finish within {int(timeout)}s and was stopped."
                " It may still be doing work in the background. Report this to the"
                " user rather than retrying the same call unchanged."
            )
        except Exception as exc:  # errors are data, never exceptions (see ai-runtime.md)
            if is_auth_failure_text(str(exc)):
                from backend.mcp.guidance import auth_failure_instruction, extract_service_name

                service = extract_service_name(tool, server_name=tool.server_name, arguments=arguments)
                if tk:
                    try:
                        from backend.mcp.composio_service import composio_service

                        composio_service.mark_reauth_required(tk, reason=str(exc))
                    except Exception:
                        pass
                result = ToolResult.error(auth_failure_instruction(service))
            else:
                result = ToolResult.error(f"{name} failed: {type(exc).__name__}: {exc}")

        if result.is_error and is_auth_failure_text(result.content):
            if "needs re-auth:" not in result.content:
                from backend.mcp.guidance import auth_failure_instruction, extract_service_name

                service = extract_service_name(tool, server_name=tool.server_name, arguments=arguments)
                if tk:
                    try:
                        from backend.mcp.composio_service import composio_service

                        composio_service.mark_reauth_required(tk, reason=result.content)
                    except Exception:
                        pass
                result.content = auth_failure_instruction(service)
            elif tk:
                # The call ran and its credentials died inside it. Same offer as
                # the pre-call branch above: an interactive turn can wire the app
                # up and get the whole call run again, because nothing harmful
                # happened on the way out -- the auth wall hit first.
                result = await self._suspend_for_connection(
                    name, arguments, context, result, tk,
                    None, _connection_retry,
                )

        if tk and result.is_error:
            try:
                from backend.mcp.provider_ownership import detect_fallback_trigger, PROVIDER_MAPPING

                trigger = detect_fallback_trigger(result.content)
                if trigger:
                    from backend.mcp.guidance import composio_fallback_instruction

                    local_servers = sorted(list(PROVIDER_MAPPING.get(tk.lower(), set())))
                    primary_local = local_servers[0] if local_servers else None
                    fallback_msg = composio_fallback_instruction(tk, trigger, primary_local)
                    result.content = f"{result.content}\n\n{fallback_msg}"
            except Exception as exc:
                log.debug("Failed to append fallback instruction: %s", exc)

        result.content = truncate(result.content, tool_name=name, arguments=arguments)
        # Anything that can change the machine invalidates every cached read:
        # a file written, a task updated or a document edited is exactly the
        # event that makes an earlier `view_file` or `list_files` a lie.
        if tool.risk is not RiskLevel.LOW:
            self._result_cache.clear()
        elif cache_key is not None and not result.is_error:
            if len(self._result_cache) >= RESULT_CACHE_MAX:
                oldest = min(self._result_cache.items(), key=lambda kv: kv[1][0])[0]
                self._result_cache.pop(oldest, None)
            self._result_cache[cache_key] = (time.monotonic(), result)
        self.logs.record(
            tool_name=name,
            tool_source=tool.source.value,
            conversation_id=ctx.conversation_id,
            arguments=arguments,
            result_summary=None if result.is_error else result.content[:2000],
            error=result.content[:2000] if result.is_error else None,
            risk_level=outcome.risk.value,
            confirmation_decision=outcome.decision,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return result

    async def _suspend_for_connection(
        self,
        name: str,
        arguments: dict[str, Any],
        context: ToolContext | None,
        original: ToolResult,
        toolkit: str,
        service: str | None,
        retried: bool,
    ) -> ToolResult:
        """Park an interactive call on the app connection it is missing.

        The permission gate answers a card with yes or no; this is its
        connection counterpart. The call is a setup gap away from working: name
        the app, publish the wait for the interface to render, suspend until the
        toolkit is connected -- and then run the whole call again, check and all,
        since a resume means the conditions changed. One offer per call, and the
        contract is the same one the suspension model already honours: if the
        interface does not answer, the turn times out, the original error lands
        in the transcript and the model relays it as it always has.

        An unattended run, a subagent or a context without a conversation gets
        the original result untouched; nothing here is allowed to wait on a
        person who is not part of the call.
        """
        interactive = (
            context is not None
            and context.events is not None
            and bool(context.conversation_id)
            and (context.extra or {}).get("interactive") is True
        )
        if not interactive or retried:
            return original
        if service is None:
            from backend.mcp.guidance import extract_service_name

            service = extract_service_name(toolkit)
        from backend.mcp.connection_gate import wait_for_connection
        from backend.tools.base import clear_gate_suspension, mark_gate_suspension

        # Composio's wait id is minted inside `wait_for_connection`, but the
        # marker must be live before the await begins: the window re-arm in
        # `_execute` has to see a suspended call as suspended from the first
        # instant its timeout expires. A stable id of our own is enough -
        # one gate per call.
        suspension_id = f"connection:{toolkit}"
        mark_gate_suspension(context, suspension_id, "connection")
        try:
            outcome = await wait_for_connection(
                toolkit=toolkit,
                service=service,
                conversation_id=context.conversation_id,
                events=context.events,
            )
        finally:
            clear_gate_suspension(context, suspension_id)
        if outcome != "resume":
            return original
        # The failure marked the toolkit expired. The user just wired it back up
        # via the card, and the mark would fail-fast the recheck before the call
        # ever ran -- so retire it and let the result speak for itself.
        try:
            from backend.mcp.composio_service import composio_service

            composio_service.clear_reauth_required(toolkit)
        except Exception:
            pass
        return await self.dispatch(name, arguments, context, _connection_retry=True)


def _refusal_reason(outcome: ConfirmationOutcome) -> str:
    """Why a call did not run, in the terms that are actually true.

    This text is the tool result the model reads, and the model acts on what it
    says. "The user declined" is true only when a person was asked and said no.
    In a permission *mode* nobody was asked: telling the model otherwise sends
    it looking for a prompt that does not exist, and it answers the user with
    a refusal the user never gave.
    """
    if outcome.decision == "blocked_by_mode":
        where = f" ({outcome.detail})" if outcome.detail else ""
        return (
            f"the conversation's permission mode does not allow it{where}."
            " Nobody was asked and nobody refused -- the mode was chosen before"
            " this turn. Do not retry the call, and say plainly which mode the"
            " conversation is in and what that mode permits."
        )
    if outcome.decision == "denied_by_pref":
        return (
            "the user has a standing refusal for this operation, saved under"
            " Permissions. It can be revoked there."
        )
    if outcome.decision == "denied":
        return f"the user declined to approve this {outcome.risk.value}-risk operation."
    return f"the permission gate refused it ({outcome.decision})."


def _unsigned_connectors() -> frozenset[str]:
    """Connectors running with no account attached, cached briefly.

    Imported lazily and guarded for the same reason `_connector_enabled` is: the
    tool registry serves builtin tools on a machine with no connectors at all,
    and a failure to read MCP state must not stop a file being written.
    """
    try:
        from backend.mcp.guidance import unsigned_connectors

        return unsigned_connectors()
    except Exception:
        return frozenset()


def _connector_enabled(server_name: str, conversation_id: str | None) -> bool:
    """Capability state for one MCP server, failing open if it cannot be read.

    Failing open matches how the prompt treats an unreadable capability table:
    the state is a user preference, not a security boundary -- the permission
    gate is, and it runs regardless.
    """
    try:
        from backend.capabilities import CapabilityService, Kind

        return not CapabilityService().switched_off(Kind.CONNECTOR, server_name, conversation_id)
    except Exception:
        return True


def mcp_tool_key(tool_name: str, server_name: str) -> str:
    """Composite key so two servers offering the same tool name never collide.

    Characters models cannot use in a tool name are percent-escaped rather than
    replaced, because collapsing '-' and '_' to the same character made
    'my-server' and 'my_server' produce one key -- the exact collision this
    function exists to prevent.
    """
    safe_server = "".join(c if (c.isalnum() or c == "_") else f"_{ord(c):02x}" for c in server_name)
    return f"{tool_name}{MCP_DELIMITER}{safe_server}"


def extract_composio_toolkit(tool_or_name: Tool | str) -> str | None:
    """Extract Composio toolkit slug from a Tool object or tool name."""
    if isinstance(tool_or_name, str):
        name = tool_or_name
        server_name = None
        source = None
    else:
        name = tool_or_name.name
        server_name = tool_or_name.server_name
        source = getattr(tool_or_name, "source", None)
    if server_name is not None and server_name != "composio":
        return None
    if not isinstance(tool_or_name, str) and server_name is None and source == ToolSource.BUILTIN:
        return None
    bare = name.split(MCP_DELIMITER)[0]
    if server_name == "composio" or name.endswith(f"{MCP_DELIMITER}composio"):
        return bare.split("_")[0].lower() if "_" in bare else "app"
    prefix = bare.split("_")[0].lower() if "_" in bare else bare.lower()
    from backend.mcp.composio_service import FAST_LANE_CONFIG

    if prefix in FAST_LANE_CONFIG:
        return prefix
    return None


def build_default_registry(
    confirmation: ConfirmationService | None = None,
    *,
    workspace_root: str | None = None,
) -> ToolRegistry:
    from backend.tools.builtin import (
        ask,
        authoring,
        browser,
        conversations,
        convert,
        desktop,
        documents,
        filesystem,
        generative_ui,
        image_search,
        library,
        mail,
        memory,
        sharing,
        shell,
        social,
        task,
        tasks,
        web,
        workers,
    )

    registry = ToolRegistry(confirmation=confirmation)
    registry.register_all(filesystem.tools(workspace_root))
    registry.register_all(shell.tools())
    registry.register_all(desktop.tools())
    registry.register_all(tasks.tools())
    registry.register_all(mail.tools())
    registry.register_all(memory.tools())
    registry.register_all(conversations.tools())
    registry.register_all(documents.tools())
    registry.register_all(library.tools())
    registry.register_all(web.tools())
    registry.register_all(image_search.tools())
    registry.register_all(convert.tools())

    registry.register_all(authoring.tools())
    registry.register_all(browser.tools())
    registry.register_all(social.tools())
    registry.register_all(ask.tools())
    registry.register_all(sharing.tools())
    registry.register_all(workers.tools())
    registry.register_all(task.tools())
    registry.register_all(generative_ui.tools())
    from backend.agent.scratch_store import scratch_tool
    registry.register(scratch_tool())
    return registry


__all__ = [
    "ToolRegistry",
    "ToolSource",
    "build_default_registry",
    "mcp_tool_key",
    "truncate",
]
