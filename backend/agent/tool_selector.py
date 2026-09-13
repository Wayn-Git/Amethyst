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
)

#: Builtin tools grouped by the kind of request that needs them, with the words
#: that signal that kind. Matching is generous on purpose: a category included
#: needlessly costs a few hundred tokens, while one missed costs the answer.
CATEGORIES: dict[str, dict[str, Any]] = {
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
        "tools": ("create_task", "create_tasks", "update_task", "list_task_lists"),
        "words": (
            "task", "todo", "to-do", "reminder", "remind", "checklist", "due",
            "backlog", "assign",
        ),
    },
    "calendar": {
        "tools": ("create_calendar_event", "list_calendar", "list_upcoming", "find_free_slot"),
        "words": (
            "calendar", "event", "meeting", "schedule", "appointment", "invite",
            "free slot", "availability", "tomorrow", "next week", "book",
        ),
    },
    "web": {
        "tools": ("search_web", "fetch_url", "open_url"),
        "words": (
            "web", "search", "google", "internet", "online", "url", "link",
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
        "words": ("image", "photo", "picture", "screenshot", "upload", "thumbnail"),
    },
    "jobs": {
        "tools": ("collect_jobs", "dispatch_parallel_jobs"),
        "words": ("job", "parallel", "batch", "worker", "dispatch", "collect"),
    },
}

#: Words that point at a connector even when its name is never said. Keys are
#: matched against the connector's own name, so this stays correct as connectors
#: are added or renamed -- it is a hint list, not a registry.
CONNECTOR_HINTS: dict[str, tuple[str, ...]] = {
    "github": ("github", "repo", "repository", "pull request", "pr ", "issue", "commit", "branch"),
    "gmail": ("mail", "email", "inbox", "message", "reply", "send to"),
    "mail": ("mail", "email", "inbox", "message", "reply"),
    "todo": ("todo", "task", "to-do", "reminder"),
    "calendar": ("calendar", "event", "meeting", "schedule"),
    "drive": ("drive", "spreadsheet", "sheet", "doc", "google doc"),
    "memory": ("remember", "memory", "recall", "note"),
    "slack": ("slack", "channel", "dm"),
    "notion": ("notion", "page", "database"),
    "linear": ("linear", "ticket", "issue"),
}

#: Never offer more than this many connectors' tool sets on one turn. A single
#: connector can carry forty tools; three is already a large menu, and the cap
#: is what keeps a vague request from pulling the whole catalogue back in.
MAX_MCP_SERVERS = 3


def _matches(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def select_tools(
    schemas: list[Any],
    text: str,
    *,
    max_mcp_servers: int = MAX_MCP_SERVERS,
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
        for spec in CATEGORIES.values():
            if _matches(haystack, spec["words"]):
                wanted.update(spec["tools"])

        # Which connectors this request points at. A connector is offered when
        # its name is said, when one of its own tool names is said, or when a
        # hint word for it appears.
        by_server: dict[str, list[Any]] = {}
        for schema in schemas:
            server = _server_of(getattr(schema, "name", ""))
            if server:
                by_server.setdefault(server, []).append(schema)

        chosen_servers: list[str] = []
        for server, tools in by_server.items():
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

        chosen_servers = chosen_servers[:max_mcp_servers]
        for server in chosen_servers:
            wanted.update(getattr(t, "name", "") for t in by_server[server])

        kept = [s for s in schemas if getattr(s, "name", "") in wanted]
        # Nothing matched at all: the request is too vague to narrow safely, so
        # do not narrow. Better to spend tokens than to answer without the tool.
        if not kept:
            return schemas, 0
        return kept, len(schemas) - len(kept)
    except Exception:  # noqa: BLE001 - selection must never take the turn down
        return schemas, 0
