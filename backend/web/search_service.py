"""Search service for external integrations without external API keys.

Provides:
- search_web: DuckDuckGo HTML POST scraper (clean title, URL, snippet, domain)
- search_youtube: YouTube initialData parser (title, channel, duration, thumbnail, views)
- search_images: Openverse public CC image search (image URL, thumbnail, creator, title)
- search_github: GitHub public repository search
- search_wiki: Wikipedia REST API summary
"""

from __future__ import annotations

import asyncio
import contextlib
import html
import json
import logging
import re
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

#: DuckDuckGo Lite answers the Chrome UA with the same challenge maze Bing
#: does. A Firefox UA on Linux is the one it serves plainly.
_DDG_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"

#: One Lite session for the life of the process, not one per query.
#:
#: The anomaly filter watches for a client that appears, POSTs a search, and
#: vanishes, over and over -- a fresh `AsyncClient` per query is exactly that
#: shape, and the third query in a row starts drawing the challenge page.
#: A session that was warmed once and kept reads as a browser that stayed,
#: and the cookies it holds are the whole difference. Rebuilt lazily on the
#: first search after the process starts, and after any transport error that
#: may have broken it.
_ddg_session: httpx.AsyncClient | None = None
_ddg_warmed = False

#: After a refusal (challenge, TCP silence) Lite gets no traffic for this many
#: minutes. A flagged client that keeps knocking makes the flag worse, and a
#: search that waits out a connect timeout before falling through to the
#: other engine is the "why is searching so slow" of a machine whose route
#: to one engine is down. Two minutes: long enough to stop paying the tax on
#: every query, short enough that an engine that recovered is noticed on the
#: next minute's search rather than at the next process start.
_DDG_COOLDOWN = 120.0
_ddg_paused_until = 0.0

#: Consecutive challenges before Lite is paused outright. The first POST of a
#: fresh session is challenged as a matter of course -- a handshake tax, not a
#: flag -- and the session that ate one challenge is usually the one the next
#: query goes through on. Two strikes in a row means the IP or the route,
#: not the session, and Lite is paused so queries stop paying the tax.
_DDG_STRIKES = 2
_ddg_challenges = 0


# ------------------------------------------------------------------ shared
#
# One connection pool for every engine outside the Lite session. The same
# reasoning that kept Lite alive across queries applies to Bing, YouTube and
# the rest: the TLS handshake is not the search, and a client built per
# keystroke pays it on every keystroke -- a hundred-odd milliseconds of
# ceremony before a single byte of the actual page is asked for. Timeouts
# ride per-request, because Bing answers fast or not at all and the YouTube
# results page does not answer fast.

_pool: httpx.AsyncClient | None = None


async def _pool_client() -> httpx.AsyncClient:
    global _pool
    if _pool is None:
        _pool = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=3.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _pool


# ------------------------------------------------------------------- cache
#
# The palette asks the same question several times for the price of one:
# a typo corrected retypes the word that was just deleted, a palette closed
# and reopened asks the same thing again, and every keystroke of "how does
# x work" that paused already paid the scrape cost of the sentence before it.
# Nothing here is so perishable that those re-asks deserve a fresh trip to
# DuckDuckGo.
#
# A fresh entry is answered from memory outright. A stale one is answered
# from memory *now* and refilled behind the reader -- a result that is on
# screen has no reason to wait on the network to be allowed on screen. Two
# waits on the same key share one fetch rather than two, and an empty answer
# is remembered briefly too: an engine that refused is refused, and
# hammering it on every retype is how the refusal became a cooldown.

_FRESH = 240.0
_STALE = 1800.0
_EMPTY_FRESH = 90.0
_CACHE_MAX = 200

_results: dict[str, tuple[float, Any, float]] = {}
_inflight: dict[str, "asyncio.Task[Any]"] = {}
_background: set["asyncio.Task[Any]"] = set()


def _cache_put(key: str, value: Any) -> None:
    import time

    _results[key] = (time.monotonic(), value, _EMPTY_FRESH if not value else _FRESH)
    if len(_results) > _CACHE_MAX:
        oldest = min(_results.items(), key=lambda item: item[1][0])[0]
        _results.pop(oldest, None)


async def _fetch_and_store(key: str, fetch) -> Any:
    try:
        value = await fetch()
    except Exception:
        logger.warning("cached search fetch failed for %s", key)
        raise
    _cache_put(key, value)
    return value


def _begin_fetch(key: str, fetch, *, background: bool = False) -> "asyncio.Task[Any]":
    task = asyncio.ensure_future(_fetch_and_store(key, fetch))
    _inflight[key] = task

    def _settled(t: "asyncio.Task[Any]") -> None:
        if _inflight.get(key) is t:
            _inflight.pop(key, None)
        _background.discard(t)
        if background and not t.cancelled() and t.exception() is not None:
            # nobody is awaiting a background refresh; do not swallow it silently
            logger.warning("background refresh failed for %s", key)

    task.add_done_callback(_settled)
    if background:
        _background.add(task)
    return task


async def _cached(key: str, fetch) -> Any:
    """Read-through cache: fresh answers immediately, stale ones refresh behind."""
    import time

    now = time.monotonic()
    hit = _results.get(key)
    if hit is not None:
        at, value, fresh_for = hit
        if now - at < _STALE:
            if now - at >= fresh_for and key not in _inflight:
                _begin_fetch(key, fetch, background=True)
            return value
        _results.pop(key, None)

    task = _inflight.get(key) or _begin_fetch(key, fetch)
    return await task


async def _ddg_client() -> httpx.AsyncClient:
    """The Lite session, warmed on first use and reused after."""
    global _ddg_session, _ddg_warmed
    if _ddg_session is None:
        _ddg_session = httpx.AsyncClient(
            timeout=httpx.Timeout(6.0, connect=3.0),
            follow_redirects=True,
            headers={"User-Agent": _DDG_UA},
        )
    if not _ddg_warmed:
        # The warm GET sets the cookies the POST is judged by. It runs on the
        # session's own short clock: a network that cannot reach Lite this
        # second is a flake, not a flag, and the query falls through to the
        # other engine without a pause Lite would have to be paid out of.
        with contextlib.suppress(Exception):
            await _ddg_session.get("https://lite.duckduckgo.com/lite/")
        _ddg_warmed = True
    return _ddg_session

_TAGS = re.compile(r"<[^>]+>")


def _clean_html(fragment: str | None) -> str:
    if not fragment:
        return ""
    return html.unescape(_TAGS.sub("", fragment)).strip()


#: Words that mean nothing for relevance: every query about a thing contains
#: none of them, and every junk maze is full of them.
_STOP = {
    "the", "a", "an", "of", "in", "on", "to", "for", "and", "or", "is",
    "was", "were", "did", "does", "do", "who", "what", "when", "where",
    "why", "how", "which", "best", "new", "free", "online", "video",
    "youtube", "watch", "download", "app", "play",
}


def _relevance(results: list[dict], query: str) -> float:
    """How many meaningful query terms appear in each result, on average.

    Both engines now answer a flagged client with a challenge maze: a page of
    real-looking results about something else entirely (NEET coaching for
    "alan turing"). A search that cannot tell lies from answers would pass the
    maze through as results. Term overlap is a blunt instrument, but a maze's
    titles share almost none of the query's words and a genuine result's
    share most of them, and the gap between those two is wide.

    Every term must also appear *somewhere* in the set: a maze built from
    one stray word of the query ("alan" -> "Alan's Universe") is exactly as
    useless as one built from none of them.
    """
    terms = {t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) > 2 and t not in _STOP}
    if not terms:
        return 1.0  # nothing to check against: not junk by this test
    # Whole words only: "featuring" contains "turing", and a maze built out
    # of one word's innards passing a search for Alan Turing is the exact
    # failure this gate exists to stop.
    _word = re.compile(r"\b\w+\b")
    corpus = " ".join(
        f"{r.get('title', '')} {r.get('snippet', '')}".lower() for r in results
    )
    words = set(_word.findall(corpus))
    missing = sum(1 for t in terms if t not in words)
    if missing:
        return 0.0
    hits = 0
    for r in results:
        hay = set(_word.findall(f"{r.get('title', '')} {r.get('snippet', '')}".lower()))
        hits += sum(1 for t in terms if t in hay)
    return hits / (len(terms) * max(1, len(results)))


def _bing_real_url(href: str, cite: str) -> str:
    """Extract the actual destination URL from a Bing redirect link.

    Bing wraps every result in a tracking redirect whose ``u`` parameter holds
    the real URL base64-encoded with an ``a1`` prefix.  The ``<cite>`` text is
    the fallback — it is always the bare domain path the user sees.
    """
    import base64 as _b64

    if href and "&u=" in href:
        u_part = href.split("&u=")[1].split("&")[0]
        if u_part.startswith("a1"):
            try:
                padded = u_part[2:] + "=" * (-len(u_part[2:]) % 4)
                decoded = _b64.urlsafe_b64decode(padded).decode("utf-8")
                if decoded.startswith("http"):
                    return decoded
            except Exception:
                pass
    # Fallback: the cite text is the human-readable URL Bing shows.
    if cite:
        clean = cite.split("›")[0].strip().rstrip("/")
        return clean if clean.startswith("http") else f"https://{clean}"
    return href


#: How many results each engine is asked for when building the pool. Larger
#: than any one page so merge/dedup/rank has something to work with and a reader
#: can scroll several pages deep without a second network round trip.
_WEB_POOL_FETCH = 25


def _norm_url(url: str) -> str:
    """A URL reduced to what makes two links the same result.

    Scheme, a leading www., a trailing slash and the fragment are noise for
    dedup -- http vs https and with/without www are the same page, and two
    engines linking it must not both take a slot.
    """
    u = (url or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.split("#")[0].rstrip("/")


def _score_result(result: dict, terms: set[str]) -> float:
    """How well one result answers the query. Title matches count double."""
    if not terms:
        return 0.0
    _word = re.compile(r"\b\w+\b")
    title = set(_word.findall((result.get("title") or "").lower()))
    snippet = set(_word.findall((result.get("snippet") or "").lower()))
    return sum((2 if t in title else 0) + (1 if t in snippet else 0) for t in terms) / len(terms)


def _merge_rank_dedup(
    groups: list[list[dict[str, Any]]], query: str
) -> list[dict[str, Any]]:
    """Fold several engines' results into one ranked, de-duplicated list.

    The race used to show a single engine's results; merging three and ranking
    by query overlap is both more results and better ones. First link to a URL
    wins its slot (engines are passed best-first), and the whole set is then
    ordered by relevance so the strongest answers lead regardless of which
    engine found them.
    """
    terms = {t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) > 2 and t not in _STOP}
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for group in groups:
        for result in group:
            key = _norm_url(result.get("url", ""))
            if not key or key in seen:
                continue
            seen.add(key)
            result["_score"] = _score_result(result, terms)
            merged.append(result)
    merged.sort(key=lambda r: r.get("_score", 0.0), reverse=True)
    for result in merged:
        result.pop("_score", None)
    return merged


async def search_web(query: str, limit: int = 8, offset: int = 0) -> list[dict[str, Any]]:
    """One page of a ranked, cached pool. `offset` pages without re-fetching.

    The pool is cached by query alone (not by limit/offset), so scrolling is
    free: every page after the first is a slice of results already in memory.
    """
    pool = await _cached(f"webpool:{query.strip().lower()}", lambda: _build_web_pool(query))
    return pool[offset : offset + limit] if offset < len(pool) else []


async def _build_web_pool(query: str) -> list[dict[str, Any]]:
    """Ask every engine at once, then merge, dedup and rank what answers.

    This used to be a chain, then a race that kept the *first* honest answer and
    threw the rest away. Merging is strictly better: three engines deduped is
    more results than one, and ranking the union by query overlap puts the
    strongest answers first regardless of which engine found them. The race's
    two hard-won properties are kept -- a budget so one blocked engine cannot
    hold the pool hostage, and orphaning (not cancelling) the stragglers so the
    DuckDuckGo scraper still finishes and self-pauses.

    The relevance gate is still the quality bar: both free scrapers answer a
    flagged client with a maze of real-looking results about something else, so
    an engine's results join the pool only after passing the gate for the
    query's own words.

    Wikipedia stays the fallback, outside the race: it always answers and always
    passes, so merging it in would drown genuine results under encyclopaedia
    articles. It is used only when nothing else cleared the gate.
    """
    engines = {"api": _search_api, "bing": _search_bing, "duckduckgo": _search_ddg_lite}
    tasks = {
        asyncio.create_task(engine(query, _WEB_POOL_FETCH)): name
        for name, engine in engines.items()
    }
    passed: dict[str, list[dict[str, Any]]] = {}
    deadline = asyncio.get_running_loop().time() + _RACE_BUDGET
    try:
        pending = set(tasks)
        while pending:
            left = deadline - asyncio.get_running_loop().time()
            if left <= 0:
                break
            done, pending = await asyncio.wait(
                pending, timeout=left, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                break
            for task in done:
                try:
                    results = task.result() or []
                except Exception:
                    # An engine that raised did not answer. Each catches its own
                    # failures; this guards a new one that forgets to.
                    continue
                if results and _relevance(results, query) >= 0.2:
                    passed[tasks[task]] = results
    finally:
        # Stragglers are let go, not cancelled -- see the long note this used to
        # carry: the DDG scraper only learns it is blocked by *finishing*, and
        # cancelling it meant it never counted its refusals and never paused.
        for task in tasks:
            if not task.done():
                _ORPHANS.add(task)
                task.add_done_callback(_ORPHANS.discard)
            else:  # already settled: read the result so it is not reported unretrieved
                with contextlib.suppress(Exception):
                    task.result()

    # Best-first for dedup: keyed API, then Bing, then DDG. Whoever links a URL
    # first keeps the slot; ranking then reorders the union by relevance.
    ordered = [passed[name] for name in ("api", "bing", "duckduckgo") if name in passed]
    if ordered:
        pool = _merge_rank_dedup(ordered, query)
        source = "mixed" if len(ordered) > 1 else next(iter(passed))
    else:
        pool = await _search_wikipedia_articles(query, _WEB_POOL_FETCH)
        source = "wikipedia"
    # Where each result came from, carried on the result itself, so the palette
    # can explain a thin answer ("every engine here is blocked") rather than
    # letting it read as a bad search.
    for result in pool:
        result.setdefault("source", source)
    return pool


#: Engines still running after the race was decided. Held only so the event
#: loop does not garbage-collect a live task mid-request; the callback drops
#: each one as it finishes. Bounded by the number of engines per query.
_ORPHANS: set[asyncio.Task] = set()

#: How long the race may run before Wikipedia is the answer.
#:
#: Not a timeout on any engine -- each has its own, and they are generous
#: because a slow answer still beats none when nobody is waiting. This is the
#: *interactive* ceiling, and it exists because an engine that cannot be
#: reached at all fails by timing out, not by refusing: a search box that sits
#: for six seconds and then shows Wikipedia should have shown Wikipedia at two.
#: A healthy engine answers in well under half of this.
_RACE_BUDGET = 2.5

#: The keyed search APIs, and how to ask each one.
#:
#: Three rather than one because the point is to work with the key a person
#: *already has*, not to send them to a particular vendor. All three have a
#: no-card free tier. Tavily's ref is the one `backend/mcp/catalogue.py`
#: already uses, so signing into Tavily as a connector configures this too and
#: there is nothing else to set up.
#:
#: `rows` pulls the result list out of whatever shape the vendor answers in;
#: everything else about them is the same, which is why this is a table and not
#: three functions.
_SEARCH_APIS = (
    {
        "name": "tavily",
        "ref": "amethyst-mcp/tavily.api_key",
        "url": "https://api.tavily.com/search",
        "headers": lambda key: {"Authorization": f"Bearer {key}"},
        "body": lambda q, n: {"query": q, "max_results": n, "include_answer": False,
                              "search_depth": "basic"},
        "rows": lambda d: d.get("results") or [],
        "fields": ("title", "url", "content"),
    },
    {
        "name": "brave",
        "ref": "amethyst/brave-search",
        "url": "https://api.search.brave.com/res/v1/web/search",
        "headers": lambda key: {"X-Subscription-Token": key, "Accept": "application/json"},
        "query": lambda q, n: {"q": q, "count": n},
        "rows": lambda d: ((d.get("web") or {}).get("results")) or [],
        "fields": ("title", "url", "description"),
    },
    {
        "name": "serper",
        "ref": "amethyst/serper",
        "url": "https://google.serper.dev/search",
        "headers": lambda key: {"X-API-KEY": key, "Content-Type": "application/json"},
        "body": lambda q, n: {"q": q, "num": n},
        "rows": lambda d: d.get("organic") or [],
        "fields": ("title", "link", "snippet"),
    },
)


def configured_search_api() -> str | None:
    """The name of the keyed API this machine can use, if any.

    Read rather than cached: a key set through the settings screen should work
    on the next query, not after a restart. `get_secret` is a keychain lookup,
    which is microseconds and happens once per search.
    """
    from backend.secrets import get_secret

    for api in _SEARCH_APIS:
        try:
            if get_secret(api["ref"]):
                return str(api["name"])
        except Exception:
            continue
    return None


async def _search_api(query: str, limit: int) -> list[dict[str, Any]]:
    """A real search API, when there is a key for one.

    The free scrapers below are a good answer to "no key, no account, no cost"
    and a bad answer to "this network is blocked" -- which, increasingly, is
    every network. On the machine this was written for, DuckDuckGo resolves to
    an ISP holding page with 443 closed and Bing answers every query with
    results for its first word only. Neither is a bug anything here can fix,
    and an engine that is *allowed* to answer beats two that are not.

    Called over REST rather than through an MCP server on purpose: this is a
    fixed query against a fixed endpoint with no decision in it, and standing
    up an MCP session with a tool schema and a model to make it would be the
    expensive way to send one POST.

    No key is not an error. It loses the race in the time a keychain read takes.
    """
    from backend.secrets import get_secret

    q = query.strip()
    if not q:
        return []
    limit = max(1, min(limit, 20))

    for api in _SEARCH_APIS:
        try:
            key = get_secret(api["ref"])
        except Exception:
            key = None
        if not key:
            continue
        try:
            client = await _pool_client()
            if "body" in api:
                resp = await client.post(
                    api["url"], json=api["body"](q, limit),
                    headers=api["headers"](key), timeout=8.0,
                )
            else:
                resp = await client.get(
                    api["url"], params=api["query"](q, limit),
                    headers=api["headers"](key), timeout=8.0,
                )
            if resp.status_code != 200:
                logger.warning("%s search returned %s", api["name"], resp.status_code)
                continue
            payload = resp.json()
        except Exception as exc:
            logger.warning("%s search failed for %s: %s", api["name"], query, exc)
            continue

        title_key, url_key, snippet_key = api["fields"]
        results: list[dict[str, Any]] = []
        for row in api["rows"](payload)[:limit]:
            url = str(row.get(url_key) or "")
            title = _clean_html(row.get(title_key))
            if not url or not title:
                continue
            results.append({
                "title": title,
                "url": url,
                "snippet": _clean_html(row.get(snippet_key))[:400],
                "domain": urlparse(url).netloc.replace("www.", ""),
            })
        if results:
            return results
    return []


async def _search_ddg_lite(query: str, limit: int) -> list[dict[str, Any]]:
    global _ddg_session, _ddg_warmed, _ddg_paused_until
    q = query.strip()
    if not q:
        return []
    limit = max(1, min(limit, 20))

    # A paused engine is not tried: the pause was earned by a refusal and the
    # query goes straight to the other one. `time.monotonic` is imported at
    # call time like the rest of this module's late imports.
    import time

    if time.monotonic() < _ddg_paused_until:
        return []

    async def _reset_session() -> None:
        with contextlib.suppress(Exception):
            if _ddg_session is not None:
                await _ddg_session.aclose()
        globals()["_ddg_session"] = None
        globals()["_ddg_warmed"] = False

    async def _pause_and_reset() -> None:
        await _reset_session()
        globals()["_ddg_paused_until"] = time.monotonic() + _DDG_COOLDOWN

    for attempt in (1, 2):
        try:
            client = await _ddg_client()
            resp = await client.post(
                "https://lite.duckduckgo.com/lite/",
                data={"q": q},
                headers={
                    "User-Agent": _DDG_UA,
                    "Accept": "text/html,application/xhtml+xml",
                    "Referer": "https://lite.duckduckgo.com/lite/",
                },
            )
            # A challenge page answers 200 with a form and no results, and a
            # 202 arrives on the first POST of a fresh session often enough
            # that neither can be fatal. One rebuild-and-retry inside this
            # call; the in-call retry is free, and a strike is counted only
            # when a whole call ended in a challenge. Two challenged calls in
            # a row mean the IP, not the session, and Lite is paused so
            # queries stop paying the tax one at a time.
            if resp.status_code == 202 or "nofollow" not in resp.text:
                if attempt == 1:
                    await _reset_session()
                    await asyncio.sleep(1.0)
                    continue
                globals()["_ddg_challenges"] += 1
                if _ddg_challenges >= _DDG_STRIKES:
                    logger.warning("duckduckgo lite challenged repeatedly; pausing it")
                    await _pause_and_reset()
                return []

            # Every result row is `<a rel="nofollow" href="…">title</a>`
            # followed by a snippet `<td>`; one pass with the link pattern
            # and one with the snippet pattern, zipped by order. The
            # snippet cell is single-quoted in Lite's markup.
            links = re.findall(
                r'<a rel="nofollow" href="([^"]+)"[^>]*>(.*?)</a>', resp.text
            )
            raw_snippets = re.findall(
                r"<td class=['\"]result-snippet['\"]>(.*?)</td>", resp.text, re.DOTALL
            )
            results = []
            seen_urls: set[str] = set()
            for i, (url, title_html) in enumerate(links[:limit * 2]):
                title = _clean_html(title_html)
                # Lite pads some result groups with a "More at …" link and
                # repeats the domain's own page twice; neither is a result
                # and both were crowding the list out.
                if not title or not url or title.startswith("More at"):
                    continue
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                snippet = _clean_html(raw_snippets[i]) if i < len(raw_snippets) else ""
                domain = urlparse(url).netloc.replace("www.", "")
                results.append({
                    "title": title,
                    "url": url,
                    "snippet": snippet,
                    "domain": domain,
                })
                if len(results) >= limit:
                    break
            globals()["_ddg_challenges"] = 0
            return results
        except Exception as exc:
            logger.error(f"ddg lite failed for {query}: {exc}")
            # A transport error is the network, not Lite's verdict on this
            # client: no session reset. But a network that cannot reach
            # Lite at all is not a per-query flake either, and paying the
            # connect timeout on every keystroke is the "searching is slow"
            # of a machine whose route to that engine is down. Transport
            # failures count toward the same pause a challenge does.
            globals()["_ddg_challenges"] += 1
            if _ddg_challenges >= _DDG_STRIKES:
                await _pause_and_reset()
            return []
    return []


async def _search_bing(query: str, limit: int) -> list[dict[str, Any]]:
    """Parse Bing's ``b_algo`` blocks. Fallback, not primary.

    Bing serves a challenge maze to anything it decides is a bot, and the
    results it returns in that maze look like results -- domains, titles,
    snippets -- while having nothing to do with the query. That is worse
    than no results, which is why this is only reached when Lite had
    nothing to say.
    """
    q = query.strip()
    if not q:
        return []
    limit = max(1, min(limit, 20))

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        client = await _pool_client()
        resp = await client.get(
            f"https://www.bing.com/search?q={quote(q)}",
            headers=headers,
            timeout=6.0,
        )
        if resp.status_code != 200:
            logger.warning(f"Bing returned status {resp.status_code}")
            return []

        results = []
        blocks = resp.text.split('<li class="b_algo"')
        for block in blocks[1:]:
            cite_m = re.search(r"<cite>(.*?)</cite>", block)
            cite = _clean_html(cite_m.group(1)) if cite_m else ""
            h2_m = re.search(
                r'<h2[^>]*><a[^>]+href="(?P<href>[^"]+)"[^>]*>'
                r"(?P<title>.*?)</a></h2>",
                block,
                re.DOTALL,
            )
            if not h2_m:
                continue
            raw_href = html.unescape(h2_m.group("href"))
            title = _clean_html(h2_m.group("title"))
            snippet_m = re.search(
                r'<div class="b_caption">.*?<p[^>]*>(.*?)</p>',
                block,
                re.DOTALL,
            )
            snippet = _clean_html(snippet_m.group(1)) if snippet_m else ""
            url = _bing_real_url(raw_href, cite)
            domain = urlparse(url).netloc.replace("www.", "")
            if not title or not url:
                continue
            results.append({
                "title": title,
                "url": url,
                "snippet": snippet,
                "domain": domain,
            })
            if len(results) >= limit:
                break
        return results
    except Exception as exc:
        logger.error(f"search_web failed for {query}: {exc}")
        return []


#: One growing pool of videos per query, plus the continuation token that
#: fetches the next batch and the innertube context to fetch it with. A pool is
#: extended lazily as a reader scrolls past what it already holds, so the arbi-
#: trary cap is gone without fetching pages nobody looks at.
_yt_pools: dict[str, dict[str, Any]] = {}
_yt_lock = asyncio.Lock()  # ponytail: one global lock; per-query if YT ever gets hot
_YT_POOL_TTL = 900.0


def _parse_video_renderer(v: dict[str, Any]) -> dict[str, Any] | None:
    vid = v.get("videoId")
    if not vid:
        return None
    title_runs = v.get("title", {}).get("runs", [])
    owner_runs = v.get("ownerText", {}).get("runs", [])
    thumbs = v.get("thumbnail", {}).get("thumbnails", [])
    return {
        "id": vid,
        "title": title_runs[0].get("text", "") if title_runs else "",
        "channel": owner_runs[0].get("text", "") if owner_runs else "",
        "duration": v.get("lengthText", {}).get("simpleText", ""),
        "thumbnail": thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "views": v.get("viewCountText", {}).get("simpleText", ""),
        "published": v.get("publishedTimeText", {}).get("simpleText", ""),
        "url": f"https://www.youtube.com/watch?v={vid}",
    }


def _collect_videos(items: list[dict], seen: set[str], out: list[dict]) -> str | None:
    """Pull video cards out of a list of renderers; return a continuation token."""
    token = None
    for item in items:
        if v := item.get("videoRenderer"):
            parsed = _parse_video_renderer(v)
            if parsed and parsed["id"] not in seen:
                seen.add(parsed["id"])
                out.append(parsed)
        elif cont := item.get("continuationItemRenderer"):
            token = (
                cont.get("continuationEndpoint", {})
                .get("continuationCommand", {})
                .get("token")
            )
    return token


async def _yt_first_page(query: str) -> dict[str, Any]:
    """Fetch page one: videos, a continuation token, and the innertube context."""
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    client = await _pool_client()
    resp = await client.get(
        f"https://www.youtube.com/results?search_query={quote(query)}", headers=headers
    )
    if resp.status_code != 200:
        return {"videos": [], "token": None, "ctx": None, "seen": set()}
    match = re.search(r"var ytInitialData = ({.*?});</script>", resp.text)
    if not match:
        return {"videos": [], "token": None, "ctx": None, "seen": set()}
    data = json.loads(match.group(1))
    sections = (
        data.get("contents", {})
        .get("twoColumnSearchResultsRenderer", {})
        .get("primaryContents", {})
        .get("sectionListRenderer", {})
        .get("contents", [])
    )
    seen: set[str] = set()
    videos: list[dict] = []
    token = None
    for sec in sections:
        items = sec.get("itemSectionRenderer", {}).get("contents", [])
        token = _collect_videos(items, seen, videos) or token
    key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', resp.text)
    ver = re.search(r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"', resp.text)
    ctx = {"key": key.group(1), "ver": ver.group(1)} if key and ver else None
    return {"videos": videos, "token": token, "ctx": ctx, "seen": seen}


async def _yt_next_page(pool: dict[str, Any]) -> None:
    """Grow a pool in place by one continuation batch, best-effort."""
    token, ctx = pool.get("token"), pool.get("ctx")
    if not token or not ctx:
        pool["token"] = None
        return
    try:
        client = await _pool_client()
        resp = await client.post(
            f"https://www.youtube.com/youtubei/v1/search?key={ctx['key']}",
            json={
                "context": {
                    "client": {"clientName": "WEB", "clientVersion": ctx["ver"], "hl": "en"}
                },
                "continuation": token,
            },
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
        )
        if resp.status_code != 200:
            pool["token"] = None
            return
        data = resp.json()
        items: list[dict] = []
        for cmd in data.get("onResponseReceivedCommands", []):
            action = cmd.get("appendContinuationItemsAction", {})
            for entry in action.get("continuationItems", []):
                if section := entry.get("itemSectionRenderer"):
                    items.extend(section.get("contents", []))
                elif "continuationItemRenderer" in entry:
                    items.append(entry)
        pool["token"] = _collect_videos(items, pool["seen"], pool["videos"])
    except Exception as exc:
        logger.warning("youtube continuation failed: %s", exc)
        pool["token"] = None


async def search_youtube(query: str, limit: int = 8, offset: int = 0) -> list[dict[str, Any]]:
    """One page of YouTube results from a pool that grows as it is scrolled.

    Page one parses the results HTML; deeper pages follow the continuation token
    through YouTube's innertube API, so scrolling keeps yielding results instead
    of stopping at an arbitrary cap. Failures to continue just stop the pool
    growing -- the reader keeps what was already found.
    """
    import time

    q = query.strip()
    if not q:
        return []
    key = q.lower()
    async with _yt_lock:
        pool = _yt_pools.get(key)
        if pool is None or time.monotonic() - pool.get("at", 0) > _YT_POOL_TTL:
            pool = await _yt_first_page(q)
            pool["at"] = time.monotonic()
            _yt_pools[key] = pool
            if len(_yt_pools) > _CACHE_MAX:
                _yt_pools.pop(min(_yt_pools, key=lambda k: _yt_pools[k].get("at", 0)), None)
        # Grow until this page can be served or YouTube stops handing out tokens.
        guard = 0
        while len(pool["videos"]) < offset + limit and pool.get("token") and guard < 10:
            await _yt_next_page(pool)
            guard += 1
    videos = pool["videos"]
    return videos[offset : offset + limit] if offset < len(videos) else []


async def search_images(query: str, limit: int = 12) -> list[dict[str, Any]]:
    return await _cached(
        f"img:{query.strip().lower()}:{limit}",
        lambda: _search_images_live(query, limit),
    )


async def _search_images_live(query: str, limit: int) -> list[dict[str, Any]]:
    """Search high-relevance images via Bing Images with Openverse fallback.

    Applies query cleanup, relevance prioritization, and duplicate filtering.
    """
    # Clean query: strip image keywords/prefixes
    q = query.strip()
    q = re.sub(r"^(?:>\s*images?|images?|img)\s+", "", q, flags=re.IGNORECASE).strip()
    if not q:
        return []
    limit = max(1, min(limit, 30))

    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    }

    # 1. Primary: High-Relevance Bing Image Search
    try:
        client = await _pool_client()
        resp = await client.get(
            f"https://www.bing.com/images/search?q={quote(q)}&form=HDRSC2&first=1",
            headers=headers,
            timeout=10.0,
        )
        if resp.status_code == 200:
            matches = re.findall(r'class="iusc"[^>]+m="([^"]+)"', resp.text)
            results = []
            seen_urls = set()

            for raw_m in matches:
                try:
                    data = json.loads(html.unescape(raw_m))
                    img_url = data.get("murl")
                    thumb_url = data.get("turl")
                    page_url = data.get("purl") or img_url
                    title = data.get("t") or data.get("desc") or "Image"

                    if not img_url or not thumb_url or img_url in seen_urls:
                        continue
                    seen_urls.add(img_url)

                    domain = urlparse(page_url).netloc.replace("www.", "")

                    results.append({
                        "id": f"bing_{len(results)}",
                        "title": title,
                        "thumbnail": thumb_url,
                        "image": img_url,
                        "source_url": page_url,
                        "creator": domain or "Web",
                        "width": data.get("width"),
                        "height": data.get("height"),
                    })

                    if len(results) >= limit:
                        break
                except Exception:
                    continue

            if results:
                return results
    except Exception as exc:
        logger.warning(f"Bing image search failed for {q}: {exc}")

    # 2. Fallback: Openverse CC Image Search
    try:
        client = await _pool_client()
        resp = await client.get(
            f"https://api.openverse.org/v1/images/?q={quote(q)}&page_size={limit}",
            headers={"User-Agent": "Amethyst/1.0 (https://github.com/amethyst)"},
            timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = []
            for item in data.get("results", []):
                results.append({
                    "id": item.get("id"),
                    "title": item.get("title") or "Untitled Image",
                    "thumbnail": item.get("thumbnail"),
                    "image": item.get("url"),
                    "source_url": item.get("foreign_landing_url") or item.get("url"),
                    "creator": item.get("creator") or "Unknown Creator",
                    "license": item.get("license"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                })
            return results
    except Exception as exc:
        logger.error(f"search_images fallback failed for {q}: {exc}")
        return []

    return []


async def search_github(query: str, limit: int = 6) -> list[dict[str, Any]]:
    return await _cached(
        f"gh:{query.strip().lower()}:{limit}", lambda: _search_github_live(query, limit)
    )


async def _search_github_live(query: str, limit: int) -> list[dict[str, Any]]:
    """Search public GitHub repositories."""
    q = query.strip()
    if not q:
        return []
    limit = max(1, min(limit, 10))

    headers = {
        "User-Agent": "Amethyst/1.0",
        "Accept": "application/vnd.github.v3+json",
    }

    try:
        client = await _pool_client()
        resp = await client.get(
            f"https://api.github.com/search/repositories?q={quote(q)}&per_page={limit}",
            headers=headers,
            timeout=10.0,
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        results = []
        for repo in data.get("items", []):
            results.append({
                "name": repo.get("full_name"),
                "description": repo.get("description") or "",
                "url": repo.get("html_url"),
                "stars": repo.get("stargazers_count", 0),
                "forks": repo.get("forks_count", 0),
                "language": repo.get("language") or "Code",
                "updated_at": repo.get("updated_at"),
            })
        return results
    except Exception as exc:
        logger.error(f"search_github failed for {query}: {exc}")
        return []


async def _search_wikipedia_articles(query: str, limit: int) -> list[dict[str, Any]]:
    """Wikipedia's own full-text search, as result rows.

    The last rung, not a peer of the engines: reached only when both Lite
    and Bing had nothing honest to say, which is a network that cannot
    reach them or an IP they are both throttling. Wikipedia's API has no
    bot wall, answers in a few hundred milliseconds, and for most of what
    gets typed into a palette -- people, places, events, concepts -- the
    articles are the results worth having anyway.
    """
    q = query.strip()
    if not q:
        return []
    limit = max(1, min(limit, 20))
    try:
        client = await _pool_client()
        resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": q,
                "srlimit": limit,
                "format": "json",
            },
            headers={"User-Agent": _DDG_UA},
            timeout=5.0,
        )
        if resp.status_code != 200:
            return []
        rows = resp.json().get("query", {}).get("search", [])
        results = []
        for row in rows[:limit]:
            title = (row.get("title") or "").strip()
            if not title:
                continue
            snippet = _clean_html(row.get("snippet") or "")
            results.append({
                "title": title,
                "url": f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
                "snippet": snippet,
                "domain": "en.wikipedia.org",
            })
        return results
    except Exception as exc:
        logger.error(f"wikipedia article search failed for {query}: {exc}")
        return []


async def search_wikipedia(query: str) -> dict[str, Any] | None:
    """Fetch Wikipedia summary card for query."""
    return await _cached(f"wiki:{query.strip().lower()}", lambda: _search_wiki_summary(query))


async def _search_wiki_summary(query: str) -> dict[str, Any] | None:
    q = query.strip()
    if not q:
        return None

    headers = {"User-Agent": "Amethyst/1.0 (https://github.com/amethyst)"}

    try:
        client = await _pool_client()
        resp = await client.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(q)}",
            headers=headers,
            timeout=8.0,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("type") == "disambiguation":
            return None
        return {
            "title": data.get("title"),
            "extract": data.get("extract"),
            "thumbnail": data.get("thumbnail", {}).get("source"),
            "url": data.get("content_urls", {}).get("desktop", {}).get("page"),
        }
    except Exception as exc:
        logger.error(f"search_wikipedia failed for {query}: {exc}")
        return None
