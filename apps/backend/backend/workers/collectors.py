"""What a worker actually does. Collect deterministically; reason rarely.

The rule this file exists to enforce: **the model plans, the worker executes.**

An MCP server is an excellent thing to hand an agent that is deciding what to do
next. It is a poor thing to put inside a loop that runs every hour with nobody
watching, because it turns "read the mailbox" into a model call, a tool schema
round trip, a tool call and a second model call -- for an operation that is one
authenticated GET. So MCP stays where it belongs (the interactive registry,
untouched by this file) and a worker reaches for the API client instead:
`backend/mail/gmail.py` for Gmail, `backend/web/reader.py` for pages, GitHub's
REST API for GitHub.

Every collector therefore does as much as it can with no model at all -- fetch,
filter, deduplicate, sort, count -- and hands back structure. Where judgement is
genuinely required it asks `backend/workers/llm.py` for *one* call over the
whole batch. A collector that makes a call per item is a bug, not a design.

Three collectors are declared here and not implemented, and they say so by name
rather than by failing oddly: LinkedIn and WhatsApp have no client in this
codebase and no credential to reach one with. Listing them keeps the catalogue
honest about what a person can ask for -- and `dispatch_parallel_jobs` refusing
with "there is no LinkedIn client configured" is a better answer than a task
that silently returns nothing.
"""

from __future__ import annotations

import asyncio
import logging
import time
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from backend.workers import urls as url_pipeline

log = logging.getLogger(__name__)

Runner = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class NotConfigured(RuntimeError):
    """This collector cannot run here, and another attempt will not change it."""


@dataclass(frozen=True)
class Collector:
    name: str
    run: Runner
    description: str = ""
    #: Needs the keychain, the database or the vault -- so it runs on this
    #: machine whatever the execution router would otherwise have preferred.
    #: Not a performance note: there is no arrangement in which a GitHub runner
    #: reaches a local SQLite file, and the alternative to saying so here is
    #: shipping the credentials that would make it possible.
    local_only: bool = False
    #: Whether a model may be spent at all. Most of these never need one.
    may_reason: bool = False


_COLLECTORS: dict[str, Collector] = {}


def register(collector: Collector) -> Collector:
    _COLLECTORS[collector.name] = collector
    return collector


def get(name: str) -> Collector | None:
    return _COLLECTORS.get(name)


def names() -> list[str]:
    return sorted(_COLLECTORS)


def catalogue() -> list[dict[str, Any]]:
    return [
        {
            "name": c.name,
            "description": c.description,
            "local_only": c.local_only,
            "may_reason": c.may_reason,
        }
        for c in sorted(_COLLECTORS.values(), key=lambda c: c.name)
    ]


async def run(name: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run one collector and stamp what produced the answer.

    Provenance is added here rather than in each collector so it cannot be
    forgotten in one of them: every result says which collector, at what time,
    and -- once the batch has stamped it -- on which lane.
    """
    collector = get(name)
    if collector is None:
        raise NotConfigured(f"there is no '{name}' collector; try one of: {', '.join(names())}")
    started = time.time()
    result = await collector.run(params or {})
    if not isinstance(result, dict):
        result = {"value": result}
    result["provenance"] = {
        "collector": name,
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seconds": round(time.time() - started, 2),
        **(result.get("provenance") or {}),
    }
    return result


# ----------------------------------------------------------------- the pages


async def _urls(params: dict[str, Any]) -> dict[str, Any]:
    given = params.get("urls") or []
    if isinstance(given, str):
        given = [given]
    if not given:
        raise NotConfigured("no urls were given")
    batch = await url_pipeline.run_batch(
        [str(u) for u in given],
        query=str(params.get("query") or ""),
        limit=int(params.get("limit") or url_pipeline.LLM_BATCH),
        concurrency=int(params.get("concurrency") or url_pipeline.CONCURRENCY),
        timeout=float(params.get("timeout") or url_pipeline.DEFAULT_TIMEOUT),
        summarize=bool(params.get("summarize")),
        with_text=bool(params.get("with_text")),
        paid_ok=params.get("paid_ok"),
    )
    return batch.as_json(with_text=bool(params.get("with_text")))


register(
    Collector(
        name="urls",
        run=_urls,
        description=(
            "Read a batch of web pages: fetch, extract, canonicalize, deduplicate,"
            " hash, score for relevance, and optionally summarise them in one call."
        ),
        may_reason=True,
    )
)


# ------------------------------------------------------------------ the news

#: Both feed dialects, in the two element names that differ. Parsed with the
#: standard library rather than a dependency: a feed is a list of links and
#: dates, and `feedparser` would be a package to keep current for thirty lines.
_FEED_ITEM = ("{http://www.w3.org/2005/Atom}entry", "item")


def _feed_text(entry: ET.Element, *names_: str) -> str:
    for name in names_:
        found = entry.find(name)
        if found is None:
            found = entry.find(f"{{http://www.w3.org/2005/Atom}}{name}")
        if found is not None:
            if name == "link" and found.get("href"):
                return found.get("href") or ""
            if (found.text or "").strip():
                return (found.text or "").strip()
    return ""


def parse_feed(xml: str) -> list[dict[str, str]]:
    """Entries from an RSS or Atom document. Malformed input is no entries."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        log.debug("a feed did not parse: %s", exc)
        return []
    entries: list[dict[str, str]] = []
    for tag in _FEED_ITEM:
        for node in root.iter(tag):
            link = _feed_text(node, "link")
            title = _feed_text(node, "title")
            if not link:
                continue
            entries.append(
                {
                    "url": link,
                    "title": title,
                    "published": _feed_text(node, "pubDate", "published", "updated"),
                }
            )
    return entries


async def _rss(params: dict[str, Any]) -> dict[str, Any]:
    """Feeds in, deduplicated links out. The reading is the `urls` collector's job.

    Split that way on purpose: a feed is an index, and running the whole extract
    pipeline over every entry of every feed is how a news collector turns into a
    crawler. This returns what is *new*, and the caller decides what to read.
    """
    feeds = params.get("feeds") or params.get("urls") or []
    if isinstance(feeds, str):
        feeds = [feeds]
    if not feeds:
        raise NotConfigured("no feeds were given")

    from backend.runtime.http import _client

    seen = {str(u) for u in (params.get("seen") or [])}
    limit = int(params.get("limit") or 40)
    entries: list[dict[str, str]] = []
    errors: dict[str, str] = {}

    async def one(feed: str) -> None:
        address = url_pipeline.canonicalize(feed)
        if not address:
            errors[str(feed)] = "not a usable address"
            return
        try:
            response = await _client(20.0).get(address, follow_redirects=True)
            response.raise_for_status()
        except Exception as exc:
            errors[address] = f"{type(exc).__name__}: {exc}"
            return
        for entry in parse_feed(response.text):
            entry["feed"] = address
            entries.append(entry)

    await asyncio.gather(*(one(str(feed)) for feed in feeds[:50]))

    fresh: list[dict[str, str]] = []
    known: set[str] = set()
    for entry in entries:
        canonical = url_pipeline.canonicalize(entry["url"])
        if not canonical or canonical in known or canonical in seen:
            continue
        known.add(canonical)
        entry["url"] = canonical
        fresh.append(entry)

    return {
        "items": fresh[:limit],
        "counts": {"feeds": len(feeds), "entries": len(entries), "new": len(fresh)},
        "errors": errors,
    }


register(
    Collector(
        name="rss",
        run=_rss,
        description="Read RSS/Atom feeds and return the entries not already seen.",
    )
)


# ------------------------------------------------------------- the watched pages


async def _monitor(params: dict[str, Any]) -> dict[str, Any]:
    """Has this page changed since last time?

    Answered by hashing the extracted *text*, not the bytes: almost every page
    on the web changes its bytes on every request -- a CSRF token, a timestamp,
    an ad slot -- and a monitor keyed on those is a monitor that cries every
    five minutes. `known` comes from the caller, because a worker running on a
    GitHub runner has no memory between runs and should not pretend to.
    """
    watched = params.get("urls") or []
    if isinstance(watched, str):
        watched = [watched]
    if not watched:
        raise NotConfigured("no urls were given to watch")
    known = params.get("known") or {}

    batch = await url_pipeline.run_batch(
        [str(u) for u in watched],
        concurrency=int(params.get("concurrency") or 4),
        timeout=float(params.get("timeout") or url_pipeline.DEFAULT_TIMEOUT),
    )
    changes: list[dict[str, Any]] = []
    hashes: dict[str, str] = {}
    for page in batch.pages:
        if page.status != "fetched" or not page.hash:
            continue
        hashes[page.canonical] = page.hash
        before = known.get(page.canonical)
        changes.append(
            {
                "url": page.canonical,
                "title": page.title,
                "hash": page.hash[:16],
                "state": "new" if not before else ("changed" if before != page.hash else "same"),
                "words": page.word_count,
            }
        )
    return {
        "items": [c for c in changes if c["state"] != "same"],
        "hashes": hashes,
        "counts": {
            "watched": len(watched),
            "changed": sum(1 for c in changes if c["state"] == "changed"),
            "unreachable": batch.counts.get("failed", 0),
        },
    }


register(
    Collector(
        name="monitor",
        run=_monitor,
        description="Check watched pages for changes by hashing their readable text.",
    )
)


# ---------------------------------------------------------------- the GitHub


async def _github(params: dict[str, Any]) -> dict[str, Any]:
    """Recent activity, straight from the REST API.

    Not through the GitHub MCP connector, deliberately -- see this module's
    docstring. The connector stays available to the interactive agent, which is
    where a tool the model chooses between belongs; a scheduled collector that
    always makes the same three calls should just make them.

    The token is optional: unauthenticated GitHub answers public activity at
    sixty requests an hour, which is more than an hourly collector needs. With
    one it also answers notifications, which is the half a person actually wants.
    """
    from backend.runtime.http import _client
    from backend.secrets import SERVICE, resolve_api_key

    user = str(params.get("user") or "").strip()
    limit = int(params.get("limit") or 30)
    try:
        # Keychain on this machine, `GITHUB_TOKEN` in the environment on a
        # runner -- `resolve_api_key` is the same order every other credential
        # in AMETHYST resolves in, so there is nothing special about this one.
        token = resolve_api_key(ref=f"{SERVICE}/github-token", env="GITHUB_TOKEN")
    except Exception:
        token = None
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "amethyst-worker"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    client = _client(20.0)
    out: dict[str, Any] = {"items": [], "counts": {}, "errors": {}}

    async def fetch(label: str, path: str) -> None:
        try:
            response = await client.get(f"https://api.github.com{path}", headers=headers)
            if response.status_code == 401:
                out["errors"][label] = "the GitHub token was refused"
                return
            if response.status_code == 403:
                out["errors"][label] = "rate limited by GitHub"
                return
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            out["errors"][label] = f"{type(exc).__name__}: {exc}"
            return
        rows = payload if isinstance(payload, list) else []
        out["counts"][label] = len(rows)
        for row in rows[:limit]:
            out["items"].append(_github_row(label, row))

    wanted = []
    if user:
        wanted.append(fetch("events", f"/users/{user}/events?per_page={min(limit, 100)}"))
    if token:
        wanted.append(fetch("notifications", f"/notifications?per_page={min(limit, 50)}"))
    if not wanted:
        raise NotConfigured(
            "give a `user` to read public activity, or set amethyst/github-token"
            " for notifications"
        )
    await asyncio.gather(*wanted)
    return out


def _github_row(label: str, row: dict[str, Any]) -> dict[str, Any]:
    if label == "notifications":
        subject = row.get("subject") or {}
        return {
            "kind": "notification",
            "title": subject.get("title"),
            "type": subject.get("type"),
            "repo": (row.get("repository") or {}).get("full_name"),
            "reason": row.get("reason"),
            "at": row.get("updated_at"),
            "url": (row.get("subject") or {}).get("url"),
        }
    return {
        "kind": "event",
        "type": row.get("type"),
        "repo": (row.get("repo") or {}).get("name"),
        "at": row.get("created_at"),
        "actor": (row.get("actor") or {}).get("login"),
    }


register(
    Collector(
        name="github_activity",
        run=_github,
        description="Recent GitHub events and notifications, via the REST API.",
    )
)


# ------------------------------------------------------- what only this machine has


async def _gmail(params: dict[str, Any]) -> dict[str, Any]:
    """The inbox, deduplicated by thread, with no model involved.

    Local-only because the credential is: `backend/mail/gmail.py` resolves an
    access token through the OS keychain, and the alternative -- a refresh token
    in a GitHub Actions secret -- is a copy of a mailbox key on somebody else's
    infrastructure to save a round trip on a laptop that is usually awake.
    """
    from backend.mail.gmail import MailUnavailable, threads

    try:
        rows = await threads(
            str(params.get("query") or "in:inbox"), limit=int(params.get("limit") or 25)
        )
    except MailUnavailable as exc:
        raise NotConfigured(f"Gmail is not connected: {exc}") from exc

    seen: set[str] = set()
    items = []
    for row in rows:
        key = str(row.get("thread_id") or row.get("id") or "")
        if key and key in seen:
            continue
        seen.add(key)
        items.append(row)
    return {"items": items, "counts": {"threads": len(items), "messages": len(rows)}}


register(
    Collector(
        name="gmail",
        run=_gmail,
        description="Recent mail, summarised per thread.",
        local_only=True,
    )
)


async def _briefing(params: dict[str, Any]) -> dict[str, Any]:
    """The morning briefing's inputs, already deterministic.

    `backend/journal/signals.py` gathers tasks, calendar, mail and library from
    the database and renders them; this is a thin wrapper so a scheduled worker
    can ask for the same thing the journal runner asks for, rather than a second
    implementation drifting away from it.
    """
    from datetime import date

    from backend.journal.signals import gather, render

    day = params.get("date")
    signals = await gather(
        date.fromisoformat(day) if isinstance(day, str) and day else None,
        span=str(params.get("span") or "day"),
    )
    return {"signals": signals.to_json(), "text": render(signals)}


register(
    Collector(
        name="briefing",
        run=_briefing,
        description="Tasks, calendar, mail and library for a day or a week.",
        local_only=True,
    )
)


async def _todo(params: dict[str, Any]) -> dict[str, Any]:
    """Microsoft To Do, through the connection the interactive side already holds.

    The one collector that legitimately goes via MCP: Graph is reached through a
    connector whose OAuth token this process refreshes, and standing up a second
    Graph client beside it would be a second thing to keep signed in.
    """
    from backend.mcp.live import get_manager
    from backend.sync.microsoft_todo import SyncUnavailable, sync

    manager = get_manager()
    if manager is None:
        raise NotConfigured("no connector manager is running")
    try:
        report = await sync(manager)
    except SyncUnavailable as exc:
        raise NotConfigured(f"Microsoft To Do is not connected: {exc}") from exc
    return {"report": report.as_json() if hasattr(report, "as_json") else str(report)}


register(
    Collector(
        name="todo",
        run=_todo,
        description="Reconcile tasks with Microsoft To Do.",
        local_only=True,
    )
)


# ---------------------------------------------------- new collectors for parallel jobs


async def _web_search(params: dict[str, Any]) -> dict[str, Any]:
    """Search the web via the optimized multi-engine search service."""
    import logging

    query = params.get("query") or ""
    if not query:
        raise NotConfigured("no query provided")

    max_results = int(params.get("max_results") or 5)

    # Route through the optimized search service — races Tavily/Brave/Serper/Bing/DDG
    # with a 2.5s budget, caches results, handles rate limiting.
    from backend.web.search_service import search_web as optimized_search

    results = await optimized_search(query, limit=max_results)
    if not results:
        # Return empty results without error — a legitimate "no results" case
        return {"query": query, "results": []}
    return {"query": query, "results": results}


register(
    Collector(
        name="web_search",
        run=_web_search,
        description="Search the web and return results with titles, URLs, and snippets.",
        may_reason=True,
    )
)


async def _file_info(params: dict[str, Any]) -> dict[str, Any]:
    """Get information about files without reading their contents."""
    paths = params.get("paths") or []
    if isinstance(paths, str):
        paths = [paths]
    
    from pathlib import Path
    
    results = []
    for path_str in paths[:50]:  # Limit to 50 files
        path = Path(path_str)
        if path.exists():
            stat = path.stat()
            results.append({
                "path": str(path),
                "exists": True,
                "is_file": path.is_file(),
                "is_dir": path.is_dir(),
                "size_bytes": stat.st_size,
                "modified": stat.st_mtime,
                "extension": path.suffix,
            })
        else:
            results.append({
                "path": str(path),
                "exists": False,
            })
    
    return {"files": results, "count": len(results)}


register(
    Collector(
        name="file_info",
        run=_file_info,
        description="Get file metadata (size, type, modified) without reading contents.",
        local_only=True,
    )
)


async def _system_info(params: dict[str, Any]) -> dict[str, Any]:
    """Get system information for debugging or monitoring."""
    import os
    import platform
    import shutil
    from pathlib import Path
    
    info = {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "cwd": str(Path.cwd()),
        "home": str(Path.home()),
        "disk_usage": {},
    }
    
    # Disk usage for key directories
    for dir_path in [Path.cwd(), Path.home()]:
        try:
            stat = shutil.disk_usage(str(dir_path))
            info["disk_usage"][str(dir_path)] = {
                "total_gb": round(stat.total / (1024**3), 2),
                "used_gb": round(stat.used / (1024**3), 2),
                "free_gb": round(stat.free / (1024**3), 2),
            }
        except Exception:
            pass
    
    return info


register(
    Collector(
        name="system_info",
        run=_system_info,
        description="Get system info: platform, CPU, disk usage, Python version.",
        local_only=True,
    )
)


async def _git_status(params: dict[str, Any]) -> dict[str, Any]:
    """Get git status for a repository."""
    import asyncio
    
    repo_path = params.get("path") or "."
    
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "status", "--porcelain",
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            return {"error": stderr.decode(), "path": repo_path}
        
        lines = stdout.decode().strip().split("\n") if stdout.decode().strip() else []
        return {
            "path": repo_path,
            "changed_files": len(lines),
            "files": lines[:50],  # Limit output
            "clean": len(lines) == 0,
        }
    except Exception as exc:
        return {"error": str(exc), "path": repo_path}


register(
    Collector(
        name="git_status",
        run=_git_status,
        description="Get git status: changed files, branch, dirty state.",
        local_only=True,
    )
)


# ---------------------------------------------------- declared, not yet possible


def _unavailable(name: str, why: str) -> Runner:
    async def run(_params: dict[str, Any]) -> dict[str, Any]:
        raise NotConfigured(f"the {name} collector {why}")

    return run


for _name, _why in (
    (
        "linkedin",
        "has no client in this codebase yet. Authorized access needs a LinkedIn"
        " application and its credential before there is anything to call.",
    ),
    (
        "whatsapp",
        "has no client in this codebase yet. It needs an Evolution API instance"
        " and its URL and key before there is anything to call.",
    ),
):
    register(
        Collector(
            name=_name,
            run=_unavailable(_name, _why),
            description=f"Declared, not yet implemented ({_name}).",
        )
    )


# ----------------------------------------------------------- subagent runner


async def _subagent(params: dict[str, Any]) -> dict[str, Any]:
    """Run a subagent as a batch node for background execution.

    This collector wraps the SubagentRunner so that subagents can be executed
    as part of the batch job system, with idempotency, retry, and cancellation.
    """
    from backend.agent.agents import get_agent
    from backend.agent.runner import SubagentRunner

    session_id = params.get("session_id")
    agent_type_name = params.get("agent_type", "general")
    prompt = params.get("prompt", "")
    permissions = params.get("permissions", {})
    conversation_id = params.get("conversation_id")

    if not session_id:
        raise NotConfigured("subagent collector requires 'session_id'")
    if not prompt:
        raise NotConfigured("subagent collector requires 'prompt'")

    agent_type = get_agent(agent_type_name)
    if agent_type is None:
        raise NotConfigured(f"unknown agent type: {agent_type_name}")

    runner = SubagentRunner()
    result_parts: list[str] = []
    events: list[dict[str, Any]] = []

    async for event in runner.run(
        session_id=session_id,
        agent_type=agent_type,
        prompt=prompt,
        permissions=permissions,
        conversation_id=conversation_id,
    ):
        events.append(event)
        if event["type"] == "delta":
            result_parts.append(event.get("text", ""))
        elif event["type"] == "error":
            return {
                "result": "".join(result_parts),
                "error": event.get("message", "Unknown error"),
                "events": events,
            }

    return {
        "result": "".join(result_parts),
        "events": events,
    }


register(
    Collector(
        name="subagent",
        run=_subagent,
        description=(
            "Run a subagent instance for autonomous task execution. "
            "Requires session_id, agent_type, prompt, and optional permissions."
        ),
        local_only=True,
        may_reason=True,
    )
)
