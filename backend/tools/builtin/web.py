"""Reading the open web.

AMETHYST could reach the web only through a connector before this: the model had no
way to look something up unless the user had switched one on, which made
"search for X" fail for a reason that had nothing to do with the request. These
two tools are read-only and touch nothing on the machine, so they carry the
same low risk as reading an indexed document.

Search routes through the optimized search service (multi-engine racing with
Tavily/Brave/Serper/Bing/DDG + caching) when available, falling back to
DuckDuckGo HTML scraping when the service is unreachable.
"""

from __future__ import annotations

import html
import logging
import re
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse

import httpx

from backend.mcp.ssrf import UnsafeURL
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.web.reader import USER_AGENT, FetchError, fetch_readable

log = logging.getLogger(__name__)

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

    # Route through the optimized search service when available — it races
    # Tavily/Brave/Serper/Bing/DDG in parallel with a 2.5s budget, caches
    # results, and handles rate limiting gracefully.
    hits = await _search_via_service(query, limit)

    # Fall back to the no-key scrapers when the service is unreachable.
    if not hits:
        hits = await _search_duckduckgo(query, limit)
    if not hits:
        hits = await _search_searxng(query, limit)

    if not hits:
        return ToolResult.ok(
            f"No results came back for {query!r}. All search engines are"
            " unavailable or returned nothing. Try fetch_url on a specific address."
        )
    return ToolResult.ok("\n\n".join(hits))


async def _search_via_service(query: str, limit: int) -> list[str] | None:
    """Try the optimized search service. Returns None on any failure."""
    try:
        from backend.web.search_service import search_web as optimized_search

        results = await optimized_search(query, limit=limit)
        if not results:
            return None
        hits = []
        for r in results:
            title = (r.get("title") or "").strip()
            url = (r.get("url") or "").strip()
            snippet = (r.get("snippet") or "").strip()
            if not title or not url:
                continue
            hits.append(f"{title}\n{url}" + (f"\n{snippet}" if snippet else ""))
        return hits if hits else None
    except Exception as exc:
        log.debug("search service unavailable, falling back to DDG: %s", exc)
        return None


async def fetch_url(args: dict[str, Any], _: ToolContext) -> ToolResult:
    url = (args.get("url") or "").strip()
    if not url:
        return ToolResult.error("fetch_url needs a url")

    # Try Firecrawl first when the MCP connector is connected — it produces
    # cleaner markdown than raw HTML stripping.
    firecrawl_result = await _fetch_via_firecrawl(url)
    if firecrawl_result is not None:
        return firecrawl_result

    # Fall back to the built-in reader with SSRF checking at every redirect hop.
    try:
        page = await fetch_readable(url)
    except UnsafeURL as exc:
        return ToolResult.error(str(exc))
    except FetchError as exc:
        return ToolResult.error(str(exc))

    if page.note:
        return ToolResult.ok(f"{page.text}\n\n[{page.note}]" if page.text else f"[{page.note}]")
    return ToolResult.ok(page.text)


async def _fetch_via_firecrawl(url: str) -> ToolResult | None:
    """Try Firecrawl MCP scrape for cleaner markdown. Returns None if unavailable."""
    try:
        from backend.mcp.live import connection

        conn = connection("firecrawl")
        if conn is None:
            return None

        result = await conn.call("scrape", {"url": url})
        # Firecrawl returns a dict with 'markdown' or 'content' key
        if isinstance(result, dict):
            markdown = result.get("markdown") or result.get("content") or ""
            if markdown:
                return ToolResult.ok(markdown)
        return None
    except Exception as exc:
        log.debug("firecrawl scrape failed for %s: %s", url, exc)
        return None


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
