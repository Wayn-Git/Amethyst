"""What the model is told when a connector cannot do the job.

This is the fix for the bug that started the whole connector audit. A Google
connector that had never completed OAuth still put fifteen Gmail tools in front
of the model. The model called one, got `Connection closed` back, concluded
there was a service outage, and handed the work back to the user -- who could
see Gmail working perfectly in their browser.

Two separate mistakes, so two separate fixes:

* **A tool that cannot work is not offered.** `connected` is not `signed in`: a
  stdio server starts, registers its tools and answers `initialize` long before
  anybody has attached an account to it. Withholding those schemas is what stops
  the model spending a turn on them, and `BASE_PROMPT` saying "errors are
  information" cannot help once the call has already been made.
* **When something does fail, the message is an instruction.** The model used to
  see a raw exception string, which names no connector, no screen and no button,
  and so cannot be acted on or relayed. Every message here says what broke, what
  to do about it, and -- crucially -- *not to retry*, because retrying is what
  turned one dead connector into a turn that spent its whole iteration budget.

The wording lives in one module so the tool result, the dispatch guard and the
prompt cannot drift into describing three different user interfaces.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from backend.mcp import live
from backend.mcp.config import load_servers
from backend.mcp.composio_service import composio_service, is_no_auth_toolkit
from backend.mcp.provider_ownership import (
    get_withheld_local_servers,
    is_provider_overridden_by_local,
)

log = logging.getLogger(__name__)

#: Where a person fixes any of this. One string, because an instruction that
#: names the wrong screen is worse than one that names none.
CONNECTORS_SCREEN = "Skills & connectors (Cmd/Ctrl+4), Connectors tab"

#: `is_signed_in` globs a credentials directory and parses JSON, and dispatch
#: asks once per tool call. Short enough that pressing Connect is noticed within
#: a turn, long enough that a fifteen-call turn does not stat the disk fifteen
#: times per connector.
CACHE_TTL_SECONDS = 5.0

_cache: tuple[float, frozenset[str]] | None = None


def forget() -> None:
    """Drop the caches, so a sign-in that just landed is believed at once."""
    global _cache, _connectors_cache
    _cache = None
    _connectors_cache = None


def unsigned_connectors() -> frozenset[str]:
    """Configured connectors that are running but have no account attached.

    `is_signed_in` returns `None` for a connector with nothing to sign in to,
    which is not the same as `False` and must not hide anything -- the fetch
    connector needs no account and works fine without one.
    """
    global _cache
    now = time.monotonic()
    if _cache is not None and now < _cache[0]:
        return _cache[1]

    try:
        from backend.mcp import commands as mcp
        from backend.mcp.config import load_servers

        names = frozenset(
            name
            for name, config in load_servers().items()
            if config.enabled and mcp.is_signed_in(config) is False
        )
    except Exception as exc:
        # Failing open matches `_connector_enabled`: this is a usefulness
        # judgement, not a security boundary. The permission gate is the
        # boundary and it runs regardless.
        log.debug("could not read connector sign-in state, advertising all: %s", exc)
        names = frozenset()

    _cache = (now + CACHE_TTL_SECONDS, names)
    return names


#: What a connector is *for*, in one line, when its own config does not say.
#: Only the connectors whose purpose is not obvious from the name -- a list that
#: restated every catalogue entry would be a second catalogue to keep in step.
_PURPOSES: dict[str, str] = {
    "playwright": "drive a real browser: navigate, click, fill forms, screenshot",
    "chrome-devtools": "drive Chrome and read its devtools traces",
    "github": "repositories, issues, pull requests, code search, actions",
    "google-workspace": "the signed-in Google account: mail, calendar, drive, docs, sheets",
    "fetch": "fetch a URL and return it as markdown",
    "memory": "a persistent entity-relation knowledge graph",
    "vercel": "projects, deployments and their logs",
    "microsoft-todo": "the signed-in To Do account: lists, tasks, checklists",
    "spotify": "search, playback and playlists",
    "tavily": "web search tuned for language models",
    "exa": "semantic web search, by meaning rather than keyword",
    "firecrawl": "crawl a site and return clean markdown",
    "linkedin": "profiles, jobs and the feed — browser-based, ~25s per lookup",
}

#: Connectors where each tool call involves a real browser session and takes
#: 15-30 seconds. The model must warn the user before making multiple calls.
_SLOW_CONNECTORS: frozenset[str] = frozenset({"linkedin", "playwright", "chrome-devtools"})

_connectors_cache: tuple[float, str | None] | None = None


def ready_connectors_block() -> str | None:
    """The connectors the model may actually reach this turn, named for it.

    The model had no way to know a connector existed short of reading 44 tool
    names and inferring it, so it reached for `fetch_url` and `search_web` --
    which work everywhere and answer worse -- while an authenticated GitHub
    connection sat unused beside them. Tool schemas are a menu; this is the
    sentence that says which half of the menu is hot.

    `None` when nothing is ready, so a machine with no connectors pays no tokens
    for a heading over an empty list. Cached on the same short clock as
    `unsigned_connectors`: it is rebuilt on every round trip of every turn.
    """
    global _connectors_cache
    now = time.monotonic()
    if _connectors_cache is not None and now < _connectors_cache[0]:
        return _connectors_cache[1]

    try:
        ready = live.ready_connectors()
        configured = load_servers()
        lines = []
        slow_lines = []
        composio_active = []

        # Composio toolkits
        try:
            if composio_service.is_configured():
                conns = composio_service.get_connections()
                active_tks = set(conns.keys())
                for tk in composio_service.get_enabled_toolkits():
                    if is_no_auth_toolkit(tk):
                        active_tks.add(tk)

                for tk in sorted(active_tks):
                    if not is_provider_overridden_by_local(tk):
                        purpose = _COMPOSIO_PURPOSES.get(tk, "cloud app integration")
                        lines.append(f"  - composio:{tk} — {purpose}")
                        composio_active.append(tk)
        except Exception as exc:
            log.debug("could not list active composio toolkits: %s", exc)

        withheld_servers: set[str] = set()
        try:
            withheld_servers = get_withheld_local_servers()
        except Exception:
            pass

        for name, count in ready.items():
            if name == "composio" or name in withheld_servers:
                continue

            config = configured.get(name)
            purpose = (config.description if config else None) or _PURPOSES.get(name) or ""
            suffix = f" — {purpose}" if purpose else ""
            lines.append(f"  - {name} ({count} tool{'' if count == 1 else 's'}){suffix}")
            if name in _SLOW_CONNECTORS:
                slow_lines.append(name)
        block_parts = []
        if lines:
            block_parts.append(
                "<connectors>\n"
                "These connectors are connected and signed in right now. Their tools are"
                " already authenticated and reach the live service, so they answer"
                " questions about it that no builtin tool can. Always prefer the MCP tool if the connector is ready.\n"
                + "\n".join(lines)
                + "\n</connectors>"
            )
        if composio_active:
            block_parts.append(
                "<composio_instructions>\n"
                "Composio is active and is your DEFAULT tool suite for: " + ", ".join(composio_active) + ".\n"
                "The most common actions for connected toolkits are available as direct tools in your active tools array "
                "(e.g. `GOOGLECALENDAR_FIND_EVENT`, `GOOGLECALENDAR_CREATE_EVENT`, `GMAIL_FETCH_EMAILS`, `GMAIL_SEND_EMAIL`, "
                "`GITHUB_CREATE_AN_ISSUE`, `SLACK_SEND_MESSAGE`, `NOTION_SEARCH_NOTION_PAGE`).\n"
                "The Composio meta-tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, "
                "COMPOSIO_GET_TOOL_SCHEMAS, COMPOSIO_MANAGE_CONNECTIONS) are also directly available in your tool list.\n"
                "Rules for calling Composio:\n"
                "1. Use a direct tool if one fits (preferred). For example, to check the calendar or list events, call `GOOGLECALENDAR_FIND_EVENT` directly. "
                "To read recent emails, call `GMAIL_FETCH_EMAILS` directly.\n"
                "2. If no direct tool fits what you need, fall back to searching: call `COMPOSIO_SEARCH_TOOLS` to find the action schema, "
                "then execute via `COMPOSIO_MULTI_EXECUTE_TOOL`.\n"
                "3. Standard requests (calendar, email, etc.) MUST finish in at most 2 LLM calls:\n"
                "   - Call 1: Call the direct tool (e.g. `GOOGLECALENDAR_FIND_EVENT` or `GMAIL_FETCH_EMAILS`).\n"
                "   - Call 2: Synthesize and return the final user-facing answer from the tool response.\n"
                "   Result: queries like 'what\\'s on my calendar' should be exactly one direct tool call plus the answer.\n"
                "4. NEVER use local mock/dummy tools (e.g. create_calendar_event) when Composio has active connections for the requested service.\n"
                "5. Sub-Toolkit Connection Gating & Actionable Setup:\n"
                "   - Note the difference between user accounts and bots: Discord user OAuth is `discord` (guilds list only), while reading messages, channels, and threads requires `discordbot`. Slack user is `slack`, bot actions require `slackbot`.\n"
                "   - Connection First, Schema Second: NEVER call `COMPOSIO_GET_TOOL_SCHEMAS` or repeatedly rephrase searches for tools on a toolkit that is not active in `<connectors>`. If an action requires an unconnected toolkit (e.g. `discordbot`), do NOT loop or repeat searches.\n"
                "   - Actionable Connection Setup: When an unconnected toolkit is needed, call `COMPOSIO_MANAGE_CONNECTIONS(action='initiate', toolkit=...)` immediately in that same turn to provide the authorization URL, rather than asking a passive text question asking if the user wants you to connect.\n"
                "</composio_instructions>"
            )
        if slow_lines:
            block_parts.append(
                "<slow_connectors>\n"
                "These connectors use a real browser session and take ~15-30 seconds per"
                " tool call. When the user asks for multiple lookups (e.g. several people's"
                " profiles), warn them about the total time before calling any tool. If"
                " possible, batch all names into a single search query.\n"
                "Slow connectors: " + ", ".join(slow_lines) + "\n"
                "</slow_connectors>"
            )
        block = "\n\n".join(block_parts) if block_parts else None
    except Exception as exc:
        # A hint, not a gate. The permission gate is the boundary and it runs
        # regardless; failing to describe a connector must not fail the turn.
        log.debug("could not describe ready connectors: %s", exc)
        block = None

    _connectors_cache = (now + CACHE_TTL_SECONDS, block)
    return block


_COMPOSIO_PURPOSES: dict[str, str] = {
    "slack": "send messages, manage channels, and search Slack",
    "linear": "track issues, sprints, and project milestones",
    "notion": "search workspace, read pages, and update databases",
    "github": "repositories, issues, pull requests, and actions",
    "gmail": "send emails, search inbox, and manage threads",
    "googlecalendar": "schedule events and check availability",
    "jira": "create and update issues in Atlassian Jira",
    "asana": "manage tasks, projects, and team workflows",
    "spotify": "control playback, search music, and manage playlists",
    "discord": "user profile, guilds/servers list, and basic permissions",
    "discordbot": "read guild channel messages, list channels, threads, and send bot messages",
    "telegram": "user profile, dialogs, and contacts",
    "telegrambot": "post bot messages, handle commands, and webhook updates",
    "web_scraper": "scrape webpage content and clean text",
    "calculator": "evaluate mathematical expressions and numeric calculations",
    "weather": "current weather forecasts and conditions",
    "hackernews": "stories, comments, and top items on Hacker News",
    "wikipedia": "encyclopedic summaries and Wikipedia articles",
    "duckduckgo": "privacy-first web search and links",
    "sql": "query structured databases and inspect tables",
}


def composio_sign_in_instruction(toolkit: str) -> str:
    """Told to the model when it names a tool of a Composio toolkit with no connected account."""
    name = toolkit.lower()
    return (
        f"'composio:{name}' is available but no account is connected to it, so none of its"
        " tools can work yet. This is not an outage and not a bug: it is a setup step"
        " only the user can complete."
        f" Tell them to open {CONNECTORS_SCREEN}, find '{name.capitalize()}' under Cloud Connectors and press"
        " Connect. Do not retry this tool. Finish everything else the request needs and"
        " say plainly which part is waiting on that connection."
    )


def composio_fallback_instruction(
    toolkit: str, failure_type: str, local_server: str | None = None
) -> str:
    """Told to the model when a Composio tool fails and a direct local alternative is available."""
    name = toolkit.lower()
    reason_map = {
        "credits_exhausted": "Composio credits or API quota have run out",
        "plan_expired": "the Composio plan or subscription has expired",
        "service_unavailable": "the Composio cloud gateway is currently unavailable or returned a server error",
    }
    reason_text = reason_map.get(failure_type, "Composio service encountered a fatal failure")

    if local_server:
        return (
            f"The Composio '{name}' integration failed because {reason_text}."
            f" Amethyst supports a direct local integration ('{local_server}') as a fallback."
            f" Tell the user that Composio failed ({reason_text}), and that they can switch to direct local integration in {CONNECTORS_SCREEN}."
            f" If '{local_server}' is not yet configured or signed in, explain that they can configure it there without needing Composio."
            " Do not retry this tool in this turn."
        )

    return (
        f"The Composio '{name}' integration failed because {reason_text}."
        f" Tell the user that Composio failed ({reason_text}) and to verify their Composio account settings."
        " Do not retry this tool in this turn."
    )


def sign_in_instruction(server_name: str) -> str:
    """Told to the model when it names a tool of a connector nobody signed in to.

    It should reach the model rarely -- the schemas are withheld -- but a model
    can name a tool it saw in an earlier turn, and the connection is shared with
    every other conversation.
    """
    return (
        f"'{server_name}' is running but no account is signed in to it, so none of its"
        " tools can work yet. This is not an outage and not a bug: it is a setup step"
        " only the user can complete."
        f" Tell them to open {CONNECTORS_SCREEN}, open the '{server_name}' row and press"
        " Connect. Do not retry this tool. Finish everything else the request needs and"
        " say plainly which part is waiting on that sign-in."
    )


def not_connected_instruction(server_name: str) -> str:
    """Told to the model when the server is configured but not running."""
    return (
        f"'{server_name}' is not running, so its tools are unavailable."
        f" Tell the user to open {CONNECTORS_SCREEN}, open the '{server_name}' row and"
        " press Connect. Do not retry this tool. Do the rest of the task without it and"
        " say what you could not do."
    )


def dropped_instruction(server_name: str, detail: str) -> str:
    """Told to the model when a live connection died and would not come back."""
    return (
        f"'{server_name}' lost its connection during this call and could not be"
        f" restarted ({detail})."
        f" Tell the user to open {CONNECTORS_SCREEN}, open the '{server_name}' row and"
        " press Reconnect — or Connect, if it asks them to sign in again."
        " Do not retry this tool. Do the rest of the task without it and say what you"
        " could not do."
    )


SERVICE_DISPLAY_NAMES: dict[str, str] = {
    "gmail": "Gmail",
    "googlecalendar": "Google Calendar",
    "google_calendar": "Google Calendar",
    "google-calendar": "Google Calendar",
    "google-workspace": "Google Workspace",
    "google_workspace": "Google Workspace",
    "github": "GitHub",
    "slack": "Slack",
    "notion": "Notion",
    "jira": "Jira",
    "asana": "Asana",
    "linear": "Linear",
    "spotify": "Spotify",
    "microsoft-todo": "Microsoft To Do",
    "microsoft_todo": "Microsoft To Do",
    "microsofttodo": "Microsoft To Do",
    "vercel": "Vercel",
    "tavily": "Tavily",
    "firecrawl": "Firecrawl",
    "exa": "Exa",
    "linkedin": "LinkedIn",
    "composio": "Composio",
}


def extract_service_name(
    tool_or_name: Any,
    server_name: str | None = None,
    arguments: dict[str, Any] | None = None,
) -> str:
    """Extract a human-friendly service name (e.g. 'Gmail', 'Google Calendar', 'GitHub') from a tool or call."""
    name = getattr(tool_or_name, "name", tool_or_name) if tool_or_name else ""
    if not isinstance(name, str):
        name = str(name or "")
    server = server_name or getattr(tool_or_name, "server_name", None)

    # If it's a Composio multi-execute tool, inspect inner tool slugs in arguments
    if ("MULTI_EXECUTE" in name or name == "COMPOSIO_MULTI_EXECUTE_TOOL") and arguments and isinstance(arguments, dict):
        inner_tools = arguments.get("tools")
        if isinstance(inner_tools, list) and inner_tools:
            first_tool = inner_tools[0]
            if isinstance(first_tool, dict) and first_tool.get("tool_slug"):
                return extract_service_name(first_tool["tool_slug"])

    # If server is google-workspace or name contains google-workspace, specialize based on tool action
    if (server and ("google-workspace" in server or "google_workspace" in server)) or "google-workspace" in name:
        lowered_name = name.lower()
        if any(k in lowered_name for k in ("calendar", "event")):
            return "Google Calendar"
        if any(k in lowered_name for k in ("mail", "message", "draft", "thread", "inbox")):
            return "Gmail"
        if "drive" in lowered_name:
            return "Google Drive"
        if "doc" in lowered_name:
            return "Google Docs"
        if "sheet" in lowered_name:
            return "Google Sheets"
        return "Google Workspace"

    bare = name.split("__mcp__")[0] if "__mcp__" in name else name

    # Check for Composio / upper snake case pattern e.g. GMAIL_FETCH_EMAILS, GOOGLECALENDAR_FIND_EVENT
    if "_" in bare:
        prefix = bare.split("_")[0].lower()
        if prefix in SERVICE_DISPLAY_NAMES:
            return SERVICE_DISPLAY_NAMES[prefix]

    # Check if bare name matches a known service
    bare_clean = bare.replace("-", "").replace("_", "").lower()
    for key, display in SERVICE_DISPLAY_NAMES.items():
        if bare_clean == key.replace("-", "").replace("_", ""):
            return display

    # If server is known
    if server:
        server_clean = server.lower().replace("-", "").replace("_", "")
        for key, display in SERVICE_DISPLAY_NAMES.items():
            if server_clean == key.replace("-", "").replace("_", ""):
                return display
        return server.replace("-", " ").replace("_", " ").title()

    if "_" in bare:
        prefix = bare.split("_")[0]
        return prefix.replace("-", " ").title()
    return bare.replace("-", " ").title() if bare else "External Service"


def auth_failure_instruction(
    service_name: str,
    instructions: str | None = None,
) -> str:
    """Told to the model when an MCP tool or Composio toolkit fails due to an authentication failure.

    Format: "<service> needs re-auth: <link/instructions>. Do not retry this tool in this turn."
    Instructs the model explicitly to continue answering with other available information rather than looping or retrying.
    """
    link = instructions or f"open {CONNECTORS_SCREEN} and reconnect {service_name}"
    return (
        f"{service_name} needs re-auth: {link}. Do not retry this tool in this turn. "
        "Continue answering the user's request using any other available information and tools rather than looping or retrying."
    )

