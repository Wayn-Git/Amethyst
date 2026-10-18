"""Which tools this turn's model actually needs to see.

AMETHYST registers 178 tools across thirteen connectors. Sending all of them costs
~29,600 tokens of schema on *every* round trip, which is more than the whole
context a free Groq tier allows -- so the turn fails before a token moves -- and
a model handed 178 options picks worse than one handed twenty.

Nothing is removed here. Every tool stays registered and callable; this only
decides what is *described* to the model on a given turn. A tool left out of the
description is still dispatched correctly if the model names it.

Two rules keep this from making the agent dumber:

* **Core tools are always offered.** Reading, writing, searching, running a
  command and asking a question are how almost every task is done, so they are
  never filtered out however the request is phrased.
* **It fails open.** Anything unexpected -- an unparseable name, an empty
  selection, an exception -- returns the full list. A selector that hides a tool
  the model needed is worse than one that saves no tokens.

Selection reads the user's message *and* what the assistant has said so far this
turn, which is the escape hatch: a model that says "let me check GitHub" is
offered the GitHub connector on the next iteration.
"""

from __future__ import annotations

import re
from typing import Any

from backend.mcp.provider_ownership import (
    get_withheld_local_servers,
    get_withheld_local_tool_names,
)

#: Decoded out of the composite MCP key. See `prompt._server_of`, which this
#: mirrors deliberately -- a `ToolSchema` carries no source (ADR-0005), so the
#: name is the only place the server survives.
_MCP_MARKER = "__mcp__"
_ESCAPED = re.compile(r"_([0-9a-f]{2})")


def _server_of(name: str) -> str:
    _, _, server = name.partition(_MCP_MARKER)
    return _ESCAPED.sub(lambda m: chr(int(m.group(1), 16)), server) if server else ""


def _bare(name: str) -> str:
    """An MCP tool's own name, without the server suffix."""
    return name.split(_MCP_MARKER)[0]


from backend.mcp.composio_service import ALL_FAST_LANE_SLUGS

#: Offered on every turn, whatever the request looks like. These are the tools
#: almost every task routes through; withholding one to save schema tokens is
#: how a capable agent starts looking incapable.
CORE = (
    "view_file",
    "list_files",
    "grep_files",
    "edit_file",
    "write_file",
    "create_artifact",
    "run_shell_command",
    "ask_user",
    "dispatch_parallel_jobs",
    "collect_jobs",
    "task",
    "search_web",
    "fetch_url",
    "generate_sandboxed_ui",
    # Composio default tools for agent
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MANAGE_CONNECTIONS",
    # Composio fast-lane direct tools
    *ALL_FAST_LANE_SLUGS,
    # Bridge tools
    "tool_search",
    "tool_describe",
    "tool_call",
)

#: Builtin tools grouped by the kind of request that needs them, with the words
#: that signal that kind. Matching is generous on purpose: a category included
#: needlessly costs a few hundred tokens, while one missed costs the answer.
CATEGORIES: dict[str, dict[str, Any]] = {
    "generative_ui": {
        "tools": ("generate_sandboxed_ui",),
        "words": (
            "calculator", "calc", "splitter", "tip", "bill", "chart", "graph",
            "plot", "3d", "simulation", "simulator", "diagram", "flowchart",
            "interactive", "widget", "tool", "itinerary", "model", "visualize",
        ),
    },
    "files": {
        "tools": ("delete_file", "open_file", "convert_file"),
        "words": (
            "file", "folder", "directory", "path", "delete", "remove", "rename",
            "convert", "open", "pdf", "docx", "xlsx", "csv", "code", "repo",
            "project", "script", "config",
        ),
    },
    "shell": {
        "tools": ("run_shell_command", "open_application"),
        "words": (
            "run", "command", "shell", "terminal", "bash", "install", "build",
            "test", "lint", "typecheck", "compile", "git", "npm", "pip", "docker",
            "launch", "start", "app", "application", "process",
        ),
    },
    "search_local": {
        "tools": ("search_documents", "index_status", "search_history"),
        "words": (
            "search", "find", "look up", "where", "which file", "document",
            "history", "indexed", "notes", "pdf",
        ),
    },
    "tasks": {
        "tools": ("create_task", "create_tasks", "update_task", "list_task_lists", "list_upcoming"),
        "words": (
            "task", "todo", "to-do", "reminder", "remind", "checklist", "due",
            "backlog", "assign", "upcoming",
        ),
    },
    "calendar": {
        "tools": ("create_calendar_event", "list_calendar", "find_free_slot"),
        "words": (
            "calendar", "event", "meeting", "schedule", "appointment", "invite",
            "free slot", "availability", "tomorrow", "next week", "book",
        ),
    },
    "web": {
        "tools": ("search_web", "research_web", "web_search", "tavily_search", "extract_page", "fetch_url", "open_url"),
        "words": (
            "web", "search", "google", "tavily", "firecrawl", "internet", "online", "url", "link",
            "http", "website", "article", "news", "docs", "documentation",
            "look up", "latest", "download",
        ),
    },
    "library": {
        "tools": ("log_library_item", "search_library"),
        "words": ("library", "save", "bookmark", "read later", "collection", "log"),
    },
    "documents": {
        "tools": ("create_document", "edit_document", "search_documents"),
        "words": (
            "document", "report", "essay", "draft", "write up", "letter",
            "memo", "proposal", "docx", "pdf",
        ),
    },
    "social": {
        "tools": ("read_social", "search_social"),
        "words": ("social", "instagram", "post", "feed", "dm", "follower", "reel"),
    },
    "media": {
        "tools": ("upload_image",),
        "words": ("upload image", "upload photo"),
    },
    "jobs": {
        "tools": ("collect_jobs", "dispatch_parallel_jobs"),
        "words": ("job", "parallel", "batch", "worker", "dispatch", "collect"),
    },
    "mail": {
        "tools": (
            "search_email", "read_email", "send_email", "reply_email", "draft_email",
            "search_agentmail", "read_agentmail", "send_agentmail",
            "reply_agentmail", "draft_agentmail",
        ),
        "words": (
            "email", "mail", "inbox", "message", "send mail", "send email", "reply",
            "agentmail", "agent mail",
        ),
    },
}

#: Words that point at a connector even when its name is never said. Keys are
#: matched against the connector's own name, so this stays correct as connectors
#: are added or renamed -- it is a hint list, not a registry.
CONNECTOR_HINTS: dict[str, tuple[str, ...]] = {
    "github": ("github", "repo", "repository", "pull request", "pr ", "issue", "commit", "branch"),
    "googleworkspace": (
        "google", "gmail", "email", "mail", "inbox", "message", "reply",
        "calendar", "event", "meeting", "schedule", "appointment",
        "drive", "spreadsheet", "sheet", "docs", "document", "slides",
        "tasks", "to-do", "reminder",
    ),
    "googlegmail": ("gmail", "email", "mail", "inbox", "message", "reply", "send to"),
    "googlecalendar": ("calendar", "event", "meeting", "schedule", "appointment", "book"),
    "googledrive": ("drive", "spreadsheet", "sheet", "google doc"),
    "microsofttodo": ("todo", "task", "to-do", "reminder"),
    "playwright": ("browser", "browse", "navigate", "click", "screenshot", "scrape", "playwright"),
    "chromedevtools": ("chrome", "devtools", "performance", "network request"),
    "vercel": ("deploy", "vercel", "deployment", "hosting"),
    "linkedin": ("linkedin", "profile", "network", "connection"),
    "spotify": ("spotify", "music", "play", "playlist", "song", "album"),
    "tavily": ("tavily", "ai search"),
    "exa": ("exa", "semantic search", "neural search"),
    "firecrawl": ("firecrawl", "crawl", "web scrape"),
    "memory": ("remember", "memory", "recall", "note", "knowledge"),
    "fetch": ("fetch", "url", "webpage"),
    "composio": (
        "composio", "calendar", "event", "meeting", "schedule", "reminder", "remind",
        "email", "gmail", "mail", "inbox", "slack", "github", "notion", "linear",
        "jira", "asana", "trello", "crm", "salesforce", "hubspot", "tweet", "twitter",
        "cloud", "integration", "app", "todo", "task",
    ),
}

#: Never offer more than this many connectors' tool sets on one turn. A single
#: connector can carry forty tools; three is already a large menu, and the cap
#: is what keeps a vague request from pulling the whole catalogue back in.
MAX_MCP_SERVERS = 3

#: Task-intent patterns: multi-word phrases that strongly indicate a specific
#: workflow. Matched before category words to provide higher-signal selection.
_TASK_INTENTS: list[tuple[str, tuple[str, ...]]] = [
    # Code editing workflows
    ("fix the bug", ("grep_files", "view_file", "edit_file", "run_shell_command")),
    ("fix bug", ("grep_files", "view_file", "edit_file", "run_shell_command")),
    ("fix error", ("grep_files", "view_file", "edit_file", "run_shell_command")),
    ("fix issue", ("grep_files", "view_file", "edit_file", "run_shell_command")),
    ("debug", ("grep_files", "view_file", "run_shell_command")),
    ("refactor", ("grep_files", "view_file", "edit_file")),
    ("rename", ("grep_files", "view_file", "edit_file")),
    ("move file", ("view_file", "write_file", "delete_file")),
    ("copy file", ("view_file", "write_file")),
    # Creation workflows
    ("create project", ("list_files", "write_file", "run_shell_command")),
    ("new project", ("list_files", "write_file", "run_shell_command")),
    ("scaffold", ("list_files", "write_file", "run_shell_command")),
    ("init ", ("list_files", "write_file", "run_shell_command")),
    ("create component", ("grep_files", "view_file", "write_file")),
    ("new component", ("grep_files", "view_file", "write_file")),
    ("create file", ("list_files", "write_file")),
    ("new file", ("list_files", "write_file")),
    ("write file", ("list_files", "write_file")),
    ("write script", ("list_files", "view_file", "write_file")),
    # Analysis workflows
    ("how does", ("grep_files", "view_file", "list_files")),
    ("what does", ("grep_files", "view_file", "list_files")),
    ("explain", ("grep_files", "view_file", "list_files")),
    ("find where", ("grep_files", "view_file")),
    ("search for", ("grep_files", "search_documents")),
    ("look for", ("grep_files", "search_documents")),
    # Testing workflows
    ("run test", ("run_shell_command",)),
    ("run lint", ("run_shell_command",)),
    ("run typecheck", ("run_shell_command",)),
    ("check ", ("run_shell_command", "grep_files")),
    # Document workflows
    ("create document", ("create_document",)),
    ("create report", ("create_document",)),
    ("create readme", ("create_artifact",)),
    ("write readme", ("create_artifact",)),
    ("write document", ("create_document",)),
    ("write report", ("create_document",)),
    # Web workflows
    ("search web", ("search_web", "research_web")),
    ("research ", ("research_web", "search_web", "extract_page")),
    ("google ", ("search_web",)),
    ("look up online", ("search_web", "research_web", "fetch_url")),
    ("@images", ("search_images",)),
    ("@image", ("search_images",)),
    ("/images", ("search_images",)),
    ("fetch url", ("fetch_url", "extract_page")),
    ("extract page", ("extract_page", "fetch_url")),
    ("open url", ("fetch_url", "open_url")),
    # Delegation workflows
    ("delegate", ("task",)),
    ("subagent", ("task",)),
    ("use the task", ("task",)),
    ("spawn", ("task",)),
    ("hand off", ("task",)),
    ("hand this off", ("task",)),
    ("do this in parallel", ("task",)),
    ("research this", ("task",)),
    ("explore this", ("task",)),
    # Connector-specific workflows
    ("check my email", ("dispatch_parallel_jobs",)),
    ("check email", ("dispatch_parallel_jobs",)),
    ("read my email", ("dispatch_parallel_jobs",)),
    ("send email", ("dispatch_parallel_jobs",)),
    ("check my calendar", ("dispatch_parallel_jobs",)),
    ("what's on my calendar", ("dispatch_parallel_jobs",)),
    ("create event", ("dispatch_parallel_jobs",)),
    ("schedule meeting", ("dispatch_parallel_jobs",)),
    ("check github", ("dispatch_parallel_jobs",)),
    ("github notifications", ("dispatch_parallel_jobs",)),
    ("create issue", ("dispatch_parallel_jobs",)),
    ("create pull request", ("dispatch_parallel_jobs",)),
    ("browse the web", ("dispatch_parallel_jobs",)),
    ("open a browser", ("dispatch_parallel_jobs",)),
    ("take a screenshot", ("dispatch_parallel_jobs",)),
    ("scrape a page", ("dispatch_parallel_jobs",)),
    ("deploy to vercel", ("dispatch_parallel_jobs",)),
    ("check vercel", ("dispatch_parallel_jobs",)),
    ("play music", ("dispatch_parallel_jobs",)),
    ("search spotify", ("dispatch_parallel_jobs",)),
    ("check linkedin", ("dispatch_parallel_jobs",)),
    ("search linkedin", ("dispatch_parallel_jobs",)),
    ("send agentmail", ("send_agentmail",)),
    ("via agentmail", ("send_agentmail", "search_agentmail", "read_agentmail")),
    ("agentmail", ("send_agentmail", "search_agentmail", "read_agentmail")),
]


def _matches(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def select_tools(
    schemas: list[Any],
    text: str,
    *,
    max_mcp_servers: int = MAX_MCP_SERVERS,
    lane: str | None = None,
) -> tuple[list[Any], int]:
    """Narrow `schemas` to what this request plausibly needs.

    `text` is the user's message plus whatever the assistant has said so far
    this turn. Returns the kept schemas and how many were withheld.

    Fails open: on anything unexpected the full list comes back unchanged.
    """
    try:
        if not schemas:
            return schemas, 0
        haystack = (text or "").lower()

        wanted: set[str] = set(CORE)

        # Lane-specific tuning
        if lane == "widget":
            wanted.add("generate_sandboxed_ui")
        elif lane == "chat":
            # Pure chat turns do not need heavy code-editing or local terminal execution
            if not any(k in haystack for k in ("edit", "file", "run", "command", "shell", "bash")):
                wanted.difference_update({
                    "edit_file", "write_file", "delete_file", "run_shell_command",
                    "patch_file_with_search", "apply_file_diff",
                })
        elif lane == "connector":
            # Connector turns focus on MCP / external integrations
            if not any(k in haystack for k in ("edit", "file", "run", "command", "shell", "bash")):
                wanted.difference_update({
                    "edit_file", "write_file", "delete_file", "run_shell_command",
                    "patch_file_with_search", "apply_file_diff",
                })
            for s in schemas:
                s_name = getattr(s, "name", "")
                if s_name.startswith("COMPOSIO_") or s_name.startswith("composio_") or _server_of(s_name):
                    wanted.add(s_name)

        # Phase 1: Task-intent matching. Multi-word phrases are higher-signal
        # than single keywords — "fix the bug" means grep+view+edit+shell, not
        # just "shell" from matching "fix".
        for phrase, tools in _TASK_INTENTS:
            if phrase in haystack:
                wanted.update(tools)

        # Phase 2: Category keyword matching (existing logic, lower priority)
        for spec in CATEGORIES.values():
            if _matches(haystack, spec["words"]):
                wanted.update(spec["tools"])

        # Phase 3: Connector matching. A connector is offered when its name is
        # said, when one of its own tool names is said, or when a hint word for
        # it appears.
        by_server: dict[str, list[Any]] = {}
        for schema in schemas:
            server = _server_of(getattr(schema, "name", ""))
            if server:
                by_server.setdefault(server, []).append(schema)

        chosen_servers: list[str] = []
        # Composio is the default cloud connector: always prioritize it when available
        if "composio" in by_server:
            chosen_servers.append("composio")

        try:
            withheld_servers = get_withheld_local_servers()
            withheld_local_tools = get_withheld_local_tool_names()
        except Exception:
            withheld_servers = set()
            withheld_local_tools = set()

        for server, tools in by_server.items():
            if server in chosen_servers or server in withheld_servers:
                continue
            key = server.lower().replace("-", "").replace("_", "")
            hit = key in haystack.replace("-", "").replace("_", "")
            if not hit:
                for hint_key, words in CONNECTOR_HINTS.items():
                    if hint_key in key and _matches(haystack, words):
                        hit = True
                        break
            if not hit:
                hit = any(_bare(getattr(t, "name", "")).lower() in haystack for t in tools)
            if hit:
                chosen_servers.append(server)

        # Allow max_mcp_servers with composio included
        composio_offset = 1 if "composio" in chosen_servers else 0
        chosen_servers = chosen_servers[:max_mcp_servers + composio_offset]
        for server in chosen_servers:
            wanted.update(getattr(t, "name", "") for t in by_server[server])

        # search_images is strictly opt-in: only offered when @images, @image, or /images is requested
        has_images_tag = any(tag in haystack for tag in ("@images", "@image", "/images", "/image"))
        if has_images_tag:
            wanted.add("search_images")
        else:
            wanted.discard("search_images")

        # Withhold offline local tools when equivalent cloud service is active on Composio
        if withheld_local_tools:
            wanted.difference_update(withheld_local_tools)

        kept = [
            s
            for s in schemas
            if getattr(s, "name", "") in wanted or _bare(getattr(s, "name", "")) in wanted
        ]
        # Nothing matched at all: the request is too vague to narrow safely, so
        # do not narrow. Better to spend tokens than to answer without the tool.
        if not kept:
            return schemas, 0

        return kept, len(schemas) - len(kept)
    except Exception:  # noqa: BLE001 - selection must never take the turn down
        return schemas, 0
