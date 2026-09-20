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

import asyncio
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
    queries_arg = args.get("queries")
    if isinstance(queries_arg, list) and queries_arg:
        clean_queries = [str(q).strip() for q in queries_arg if str(q).strip()]
    elif isinstance(args.get("query"), list):
        clean_queries = [str(q).strip() for q in args["query"] if str(q).strip()]
    else:
        clean_queries = []

    query = (
        args.get("query")
        if isinstance(args.get("query"), str)
        else (clean_queries[0] if clean_queries else "")
        or args.get("topic")
        or args.get("search_query")
        or args.get("input")
        or args.get("q")
        or ""
    ).strip()

    if not query and not clean_queries:
        return ToolResult.error("search_web needs a query")

    if not query and clean_queries:
        query = clean_queries[0]

    limit = max(1, min(int(args.get("limit") or 6), 15))
    depth = args.get("depth")

    # 1. Route through the modern ResearchEngine (query planning, authority ranking,
    # syndication deduplication, stable reference IDs, verification matrix)
    try:
        from backend.web.research_engine import ResearchEngine

        engine = ResearchEngine()
        evidence, _, _ = await engine.execute_research(
            query,
            depth=depth,
            limit_per_query=limit,
            explicit_queries=clean_queries if len(clean_queries) > 1 else None,
        )
        if evidence and "No results found" not in evidence:
            return ToolResult.ok(evidence)
    except Exception as exc:
        log.warning("research engine failed, falling back to basic search: %s", exc)

    # 2. Fall back to search service (parallel if multiple queries)
    if clean_queries and len(clean_queries) > 1:
        tasks = [_search_via_service(q, limit) for q in clean_queries]
        results_lists = await asyncio.gather(*tasks)
        hits = []
        for rl in results_lists:
            if rl:
                hits.extend(rl)
    else:
        hits = await _search_via_service(query, limit)

    # 3. Fall back to no-key scrapers
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


async def research_web(args: dict[str, Any], _: ToolContext) -> ToolResult:
    topic = (args.get("topic") or args.get("query") or "").strip()
    if not topic:
        return ToolResult.error("research_web needs a topic")
    depth = args.get("depth") or "research"
    limit = max(2, min(int(args.get("limit") or 6), 12))

    from backend.web.research_engine import ResearchEngine

    engine = ResearchEngine()
    evidence, _, _ = await engine.execute_research(topic, depth=depth, limit_per_query=limit)
    return ToolResult.ok(evidence)


async def extract_page(args: dict[str, Any], _: ToolContext) -> ToolResult:
    url = (args.get("url") or "").strip()
    query = (
        args.get("query")
        or args.get("topic")
        or args.get("search_query")
        or args.get("input")
        or args.get("q")
        or ""
    ).strip()
    if not url:
        return ToolResult.error("extract_page needs a url")
    if not query:
        return ToolResult.error("extract_page needs a query to find relevant sections")

    try:
        page = await fetch_readable(url)
    except UnsafeURL as exc:
        return ToolResult.error(str(exc))
    except FetchError as exc:
        return ToolResult.error(str(exc))

    if not page.text:
        return ToolResult.ok(f"No readable text on {url}. [{page.note}]" if page.note else f"No readable text on {url}.")

    from backend.web.extractor import extract_relevant_passages

    passages = extract_relevant_passages(page.text, query=query, max_passages=3)
    if not passages:
        sample = page.text[:1200]
        return ToolResult.ok(
            f"Page loaded, but no passage strongly matched {query!r}. Excerpt:\n\n{sample}"
        )

    lines = [f"### Relevant passages from [{page.title or url}]({url}):\n"]
    for heading, text, score in passages:
        lines.append(f"#### {heading}\n{text}\n")
    return ToolResult.ok("\n".join(lines))


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

    # If a query is provided, perform targeted passage extraction to save tokens
    query = (
        args.get("query")
        or args.get("topic")
        or args.get("search_query")
        or args.get("input")
        or args.get("q")
        or ""
    ).strip()
    if query and page.text:
        from backend.web.extractor import extract_relevant_passages
        passages = extract_relevant_passages(page.text, query=query, max_passages=3)
        if passages:
            lines = [f"### Passages from [{page.title or url}]({url}) matching '{query}':\n"]
            for heading, text, _ in passages:
                lines.append(f"#### {heading}\n{text}\n")
            return ToolResult.ok("\n".join(lines))

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
    search_tool = Tool(
        name="search_web",
        description=(
            "Search the web with intelligent query planning, recency awareness, and"
            " source authority weighting. Supports single query or multiple queries in parallel."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for"},
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of search queries to execute concurrently in parallel",
                },
                "limit": {"type": "integer", "description": "Maximum results per query (default 6)"},
                "depth": {
                    "type": "string",
                    "enum": ["simple", "current", "research", "deep"],
                    "description": "Optional search depth strategy (auto-detected by default)",
                },
            },
        },
        handler=search_web,
        risk=RiskLevel.LOW,
    )
    tavily_tool = Tool(
        name="tavily_search",
        description="Search the web with Tavily AI search. Automatically unified with search_web.",
        parameters=search_tool.parameters,
        handler=search_web,
        risk=RiskLevel.LOW,
    )
    web_search_tool = Tool(
        name="web_search",
        description="Search the web for real-time information and news. Automatically unified with search_web.",
        parameters=search_tool.parameters,
        handler=search_web,
        risk=RiskLevel.LOW,
    )
    return [
        search_tool,
        tavily_tool,
        web_search_tool,
        Tool(
            name="research_web",
            description=(
                "Perform in-depth, multi-source web research with query decomposition,"
                " source inspection, and cross-source verification of claims."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "The research topic or question"},
                    "depth": {
                        "type": "string",
                        "enum": ["current", "research", "deep"],
                        "description": "Research depth (default: research)",
                    },
                    "limit": {"type": "integer", "description": "Maximum results per query (default 6)"},
                },
                "required": ["topic"],
            },
            handler=research_web,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="extract_page",
            description=(
                "Open a web page and extract only the relevant passages matching a query,"
                " preserving context while minimizing token consumption."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The web address to inspect"},
                    "query": {"type": "string", "description": "What topic or claim to extract from the page"},
                },
                "required": ["url", "query"],
            },
            handler=extract_page,
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
                "properties": {
                    "url": {"type": "string", "description": "The address to fetch"},
                    "query": {"type": "string", "description": "Optional search query to extract only matching passages"},
                },
                "required": ["url"],
            },
            handler=fetch_url,
            risk=RiskLevel.LOW,
        ),
    ]
