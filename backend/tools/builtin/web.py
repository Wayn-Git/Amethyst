"""Reading the open web.

AMETHYST could reach the web only through a connector before this: the model had no
way to look something up unless the user had switched one on, which made
"search for X" fail for a reason that had nothing to do with the request. These
two tools are read-only and touch nothing on the machine, so they carry the
same low risk as reading an indexed document.

Search goes through DuckDuckGo's HTML endpoint, which needs no API key. That is
a deliberate trade: no key to configure, at the cost of a result page whose
markup is not a contract. When parsing finds nothing, the tool says so plainly
rather than returning an empty list that reads like "no results".
"""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse

import httpx

from backend.mcp.ssrf import UnsafeURL
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.web.reader import USER_AGENT, FetchError, fetch_readable

SEARCH_URL = "https://html.duckduckgo.com/html/?q={query}"

_RESULT = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>'
    r'(?:.*?class="result__snippet"[^>]*>(?P<snippet>.*?)</a>)?',
    re.DOTALL,
)
_TAGS = re.compile(r"<[^>]+>")


def _clean(fragment: str | None) -> str:
    if not fragment:
        return ""
    return html.unescape(_TAGS.sub("", fragment)).strip()


def _real_url(href: str) -> str:
    """DuckDuckGo wraps results in a redirect; the destination is in `uddg`."""
    if href.startswith("//"):
        href = f"https:{href}"
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            return target[0]
    return href


SEARXNG_URL = "https://searx.be/search"

_SEARXNG_FALLBACKS = [
    "https://searx.be/search",
    "https://search.inetol.net/search",
]


async def _search_duckduckgo(query: str, limit: int) -> list[str] | None:
    """Returns a list of result strings, or None when DDG is unavailable."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
            for attempt in range(3):
                if attempt:
                    import asyncio
                    await asyncio.sleep(attempt)  # 0, 1, 2 s backoff
                response = await client.get(
                    SEARCH_URL.format(query=quote_plus(query)),
                    headers={"User-Agent": USER_AGENT},
                )
                if response.status_code == 200:
                    break
            else:
                return None  # all retries exhausted
    except httpx.HTTPError:
        return None

    hits = []
    for match in _RESULT.finditer(response.text):
        title = _clean(match.group("title"))
        url = _real_url(match.group("href"))
        snippet = _clean(match.group("snippet"))
        if not title or not url:
            continue
        hits.append(f"{title}\n{url}" + (f"\n{snippet}" if snippet else ""))
        if len(hits) >= limit:
            break
    return hits  # may be empty list; caller distinguishes from None


async def _search_searxng(query: str, limit: int) -> list[str] | None:
    """SearXNG JSON API — no key, structured output, multiple public instances."""
    params = {"q": query, "format": "json", "language": "en", "safesearch": "0"}
    for base in _SEARXNG_FALLBACKS:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                r = await client.get(base, params=params, headers={"User-Agent": USER_AGENT})
            if r.status_code != 200:
                continue
            data = r.json()
            results = data.get("results") or []
            hits = []
            for item in results[:limit]:
                title = (item.get("title") or "").strip()
                url = (item.get("url") or "").strip()
                snippet = (item.get("content") or "").strip()
                if not title or not url:
                    continue
                hits.append(f"{title}\n{url}" + (f"\n{snippet}" if snippet else ""))
            if hits:
                return hits
        except Exception:
            continue
    return None


async def search_web(args: dict[str, Any], _: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    if not query:
        return ToolResult.error("search_web needs a query")
    limit = max(1, min(int(args.get("limit") or 6), 15))

    # Try DuckDuckGo first; it needs no key and usually works.
    hits = await _search_duckduckgo(query, limit)

    # Fall back to SearXNG when DDG is rate-limiting (returns 202, 429, etc.).
    if not hits:
        hits = await _search_searxng(query, limit)

    if not hits:
        return ToolResult.ok(
            f"No results came back for {query!r}. Both DuckDuckGo and SearXNG are"
            " unavailable or returned nothing. Try fetch_url on a specific address."
        )
    return ToolResult.ok("\n\n".join(hits))


async def fetch_url(args: dict[str, Any], _: ToolContext) -> ToolResult:
    url = (args.get("url") or "").strip()
    if not url:
        return ToolResult.error("fetch_url needs a url")
    try:
        # The same guard the MCP transports use, applied at every redirect hop
        # rather than only to the address the model handed over.
        page = await fetch_readable(url)
    except UnsafeURL as exc:
        return ToolResult.error(str(exc))
    except FetchError as exc:
        return ToolResult.error(str(exc))

    if page.note:
        return ToolResult.ok(f"{page.text}\n\n[{page.note}]" if page.text else f"[{page.note}]")
    return ToolResult.ok(page.text)


def tools() -> list[Tool]:
    return [
        Tool(
            name="search_web",
            description=(
                "Search the web and return the top results with their URLs. Use this"
                " when the answer is not on the user's machine and not in their notes."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for"},
                    "limit": {"type": "integer", "description": "Maximum results (default 6)"},
                },
                "required": ["query"],
            },
            handler=search_web,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="fetch_url",
            description=(
                "Fetch a web page or file and return its text. HTML is reduced to"
                " readable text. Use after search_web, or when the user gives a URL."
            ),
            parameters={
                "type": "object",
                "properties": {"url": {"type": "string", "description": "The address to fetch"}},
                "required": ["url"],
            },
            handler=fetch_url,
            risk=RiskLevel.LOW,
        ),
    ]
