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
        from backend.mcp import live
        from backend.mcp.config import load_servers

        ready = live.ready_connectors()
        configured = load_servers()
        lines = []
        slow_lines = []
        for name, count in ready.items():
            if name == "composio":
                # Decompose Composio into individually active connected toolkits
                try:
                    from backend.mcp.composio_service import composio_service
                    from backend.mcp.provider_ownership import is_provider_overridden_by_local

                    conns = composio_service.get_connections() if composio_service.is_configured() else {}
                    from backend.mcp.composio_service import is_no_auth_toolkit

                    active_tks = set(conns.keys())
                    if composio_service.is_configured():
                        for tk in composio_service.get_enabled_toolkits():
                            if is_no_auth_toolkit(tk):
                                active_tks.add(tk)

                    for tk in sorted(active_tks):
                        if not is_provider_overridden_by_local(tk):
                            purpose = _COMPOSIO_PURPOSES.get(tk, "cloud app integration")
                            lines.append(f"  - composio:{tk} — {purpose}")
                except Exception as exc:
                    log.debug("could not list active composio toolkits: %s", exc)
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
                " questions about it that no builtin tool can.\n"
                + "\n".join(lines)
                + "\n</connectors>"
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
