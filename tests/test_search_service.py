import asyncio
import time

import pytest

from backend.web import search_service


@pytest.mark.asyncio
async def test_search_web_basic():
    # Test DuckDuckGo scraper
    results = await search_service.search_web("python programming", limit=3)
    assert isinstance(results, list)
    if results:
        res = results[0]
        assert "title" in res
        assert "url" in res
        assert "domain" in res


@pytest.mark.asyncio
async def test_search_images_basic():
    # Test Openverse public image search
    results = await search_service.search_images("nature", limit=3)
    assert isinstance(results, list)
    if results:
        img = results[0]
        assert "title" in img
        assert "image" in img
        assert "thumbnail" in img


@pytest.mark.asyncio
async def test_search_wikipedia_basic():
    # Test Wikipedia summary
    wiki = await search_service.search_wikipedia("Linux")
    assert wiki is not None
    assert "title" in wiki
    assert "extract" in wiki
    assert wiki["title"] == "Linux"


# ------------------------------------------------------------ the pool
#
# The engines were a chain, then a race that kept one winner. Now they are
# merged: every engine that passes the relevance gate joins one deduped, ranked
# pool, which pages serve slices of. These hold what must not regress -- the
# union is merged and deduped, a maze is gated out, a blocked engine cannot hold
# the pool open past the budget, a straggler still finishes so it can self-pause,
# and pagination slices the pool instead of searching again.


def _engine(name, results, *, delay=0.0):
    async def run(query, limit):
        if delay:
            await asyncio.sleep(delay)
        return list(results)

    run.__name__ = name
    return run


def _hits(query, n=3):
    """Results that will pass the relevance gate for `query`."""
    return [
        {"title": query, "url": f"https://{i}.example/{query}", "snippet": query,
         "domain": f"{i}.example"}
        for i in range(n)
    ]


@pytest.mark.asyncio
async def test_engines_are_merged_and_deduped(monkeypatch):
    """The pool is the union of every honest engine, not just the fastest one --
    more results, and one slot per URL however many engines linked it."""
    bing = _hits("otters", 3)  # 0,1,2.example
    ddg = [
        {"title": "otters", "url": "https://0.example/otters", "snippet": "otters",
         "domain": "0.example"},  # duplicate of bing's first
        {"title": "otters", "url": "https://9.example/otters", "snippet": "otters",
         "domain": "9.example"},  # new
    ]
    monkeypatch.setattr(search_service, "_search_api", _engine("tavily", []))
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", bing, delay=0.01))
    monkeypatch.setattr(search_service, "_search_ddg_lite", _engine("ddg", ddg, delay=0.02))

    results = await search_service._build_web_pool("otters")
    domains = [r["domain"] for r in results]
    assert sorted(domains) == ["0.example", "1.example", "2.example", "9.example"]
    assert len(domains) == len(set(domains)), "a URL two engines returned took two slots"


@pytest.mark.asyncio
async def test_a_maze_of_unrelated_results_is_kept_out_of_the_pool(monkeypatch):
    """Both free scrapers answer a flagged client with real-looking junk; an
    engine whose results miss the query's words fails the gate and never joins
    the pool, so an honest engine's results are what come back."""
    maze = [{"title": "Best Online Payment", "url": "https://x.test/a", "snippet": "unrelated",
             "domain": "x.test"}]
    monkeypatch.setattr(search_service, "_search_api", _engine("tavily", []))
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", maze, delay=0.01))
    monkeypatch.setattr(
        search_service, "_search_ddg_lite", _engine("ddg", _hits("alan turing"), delay=0.05)
    )

    results = await search_service._build_web_pool("alan turing")
    assert "x.test" not in [r["domain"] for r in results]
    assert len(results) == 3


def test_a_specific_query_is_not_thrown_away_for_one_absent_word():
    """The gate used to require *every* query term, and that is why searches
    came back as Wikipedia.

    A real page about rotating a matrix need not carry the word "efficiently"
    in the title or in the fragment that was scraped for it. Demanding all of
    them meant one ordinary absence discarded the whole engine, and the longer
    and more specific the query the likelier that was -- so the searches most
    worth doing were the ones most likely to fall through to the encyclopaedia.
    """
    results = [
        {"title": "Rotate a matrix in Python", "snippet": "transpose then reverse each row"},
        {"title": "Matrix rotation", "snippet": "in-place 90 degree turn in python"},
    ]
    # "efficiently" appears nowhere in the results. Under the old rule that was
    # a zero; the set is plainly about the query.
    assert search_service._relevance(results, "rotate a matrix efficiently python") > 0.2


def test_a_maze_sharing_one_stray_word_still_fails_the_gate():
    """The relaxation must not cost the thing the gate exists for."""
    maze = [
        {"title": "Alan's Universe - Drama Shorts", "snippet": "subscribe for more"},
        {"title": "Alan Walker Faded", "snippet": "official music video"},
    ]
    assert search_service._relevance(maze, "alan turing enigma codebreaker") == 0.0


@pytest.mark.asyncio
async def test_an_unreachable_engine_cannot_hold_the_pool_open(monkeypatch):
    """A search box that sits for six seconds should have answered at two."""
    async def never(query, limit):
        await asyncio.sleep(30)
        return []  # pragma: no cover

    async def wiki(query, limit):
        return _hits(query, 2)

    monkeypatch.setattr(search_service, "_RACE_BUDGET", 0.2)
    monkeypatch.setattr(search_service, "_search_api", never)
    monkeypatch.setattr(search_service, "_search_ddg_lite", never)
    monkeypatch.setattr(search_service, "_search_bing", never)
    monkeypatch.setattr(search_service, "_search_wikipedia_articles", wiki)

    started = time.monotonic()
    results = await search_service._build_web_pool("anything")
    assert time.monotonic() - started < 1.0
    assert len(results) == 2, "nothing fell through to Wikipedia"


@pytest.mark.asyncio
async def test_a_losing_engine_still_finishes_so_it_can_notice_it_is_dead(monkeypatch):
    """Cancelling a straggler meant it never counted its own refusals, so it
    never paused itself, so every query went on paying its connect timeout."""
    finished = asyncio.Event()

    async def slow_loser(query, limit):
        await asyncio.sleep(0.05)
        finished.set()
        return []

    monkeypatch.setattr(search_service, "_RACE_BUDGET", 0.02)
    monkeypatch.setattr(search_service, "_search_api", slow_loser)
    monkeypatch.setattr(search_service, "_search_ddg_lite", _engine("ddg", []))
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", _hits("q"), delay=0.001))

    await search_service._build_web_pool("q")
    await asyncio.wait_for(finished.wait(), timeout=2)
    assert finished.is_set()


@pytest.mark.asyncio
async def test_pagination_slices_a_cached_pool_without_refetching(monkeypatch):
    """`offset` pages a pool built once; a second page is not a second search."""
    calls = {"n": 0}

    async def engine(query, limit):
        calls["n"] += 1
        return _hits(query, 10)

    monkeypatch.setattr(search_service, "_search_api", engine)
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", []))
    monkeypatch.setattr(search_service, "_search_ddg_lite", _engine("ddg", []))
    search_service._results.clear()

    page1 = await search_service.search_web("otters", limit=4, offset=0)
    page2 = await search_service.search_web("otters", limit=4, offset=4)
    assert len(page1) == 4 and len(page2) == 4
    assert {r["url"] for r in page1}.isdisjoint({r["url"] for r in page2}), "pages overlap"
    assert calls["n"] == 1, "the second page refetched instead of slicing the pool"


@pytest.mark.asyncio
async def test_no_tavily_key_is_not_an_error(monkeypatch):
    """It loses the race in the time it takes to read the keychain, and the
    keyless engines carry the search. Patched on `backend.secrets` rather than
    on this module: the import is inside the function, so the name here is not
    the one that gets looked up."""
    import backend.secrets

    monkeypatch.setattr(backend.secrets, "get_secret", lambda ref: None)
    assert await search_service._search_api("anything", 5) == []


@pytest.mark.asyncio
async def test_a_key_is_used_and_never_leaves_the_header(monkeypatch):
    import backend.secrets

    sent = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"results": [
                {"title": "Otters", "url": "https://e.test/otters", "content": "about otters"}
            ]}

    class FakeClient:
        async def post(self, url, **kwargs):
            sent.update(url=url, **kwargs)
            return FakeResponse()

    monkeypatch.setattr(
        backend.secrets, "get_secret",
        lambda ref: "tvly-secret" if "tavily" in ref else None,
    )
    monkeypatch.setattr(search_service, "_pool_client", lambda: _resolved(FakeClient()))

    results = await search_service._search_api("otters", 5)
    assert results == [{
        "title": "Otters", "url": "https://e.test/otters",
        "snippet": "about otters", "domain": "e.test",
    }]
    assert sent["headers"]["Authorization"] == "Bearer tvly-secret"
    assert "tvly-secret" not in str(sent["json"]), "the key reached the request body"


async def _resolved(value):
    return value


@pytest.mark.asyncio
async def test_youtube_pool_grows_by_continuation_as_it_is_scrolled(monkeypatch):
    """Scrolling past the first batch follows the continuation token instead of
    stopping at a cap; offset then slices the grown pool."""
    def _vids(a, b):
        return [
            {"id": str(i), "url": f"https://youtu.be/{i}", "title": f"v{i}"} for i in range(a, b)
        ]

    async def first(query, sort="relevance"):
        return {"videos": _vids(0, 10), "token": "T1", "ctx": {"key": "k", "ver": "1"},
                "seen": {str(i) for i in range(10)}}

    async def nxt(pool):
        start = len(pool["videos"])
        pool["videos"].extend(_vids(start, start + 10))
        pool["seen"].update(str(i) for i in range(start, start + 10))
        pool["token"] = "T2" if start < 20 else None  # dries up after two pages

    monkeypatch.setattr(search_service, "_yt_first_page", first)
    monkeypatch.setattr(search_service, "_yt_next_page", nxt)
    search_service._yt_pools.clear()

    page1 = await search_service.search_youtube("cats", limit=8, offset=0)
    page3 = await search_service.search_youtube("cats", limit=8, offset=16)
    assert [v["id"] for v in page1] == [str(i) for i in range(8)]
    assert [v["id"] for v in page3] == [str(i) for i in range(16, 24)], "pool did not grow"
    # Past the end of an exhausted pool, an empty page stops infinite scroll.
    assert await search_service.search_youtube("cats", limit=8, offset=100) == []


def test_published_age_reads_youtubes_relative_phrases():
    """There is no timestamp on a search result -- only "3 hours ago" -- so this
    parse is the only thing "newest first" can be built on."""
    age = search_service._published_age
    assert age("47 minutes ago") < age("3 hours ago") < age("1 day ago") < age("2 years ago")
    # A livestream says so before the phrase; the number is still in there.
    assert age("Streamed 8 hours ago") == age("8 hours ago")
    # Unknown sorts last rather than first, which is where a 0 would put it.
    assert age(None) == age("") == float("inf")


@pytest.mark.asyncio
async def test_latest_orders_newest_first(monkeypatch):
    """YouTube's own upload-date filter biases towards recent without ordering
    by it -- a 47-minute-old video arrives below a 23-hour-old one. "Latest" has
    to mean newest first to be worth asking for."""
    jumbled = [
        {"id": "a", "url": "u/a", "title": "a", "published": "23 hours ago"},
        {"id": "b", "url": "u/b", "title": "b", "published": "47 minutes ago"},
        {"id": "c", "url": "u/c", "title": "c", "published": "2 years ago"},
        {"id": "d", "url": "u/d", "title": "d", "published": "Streamed 3 hours ago"},
    ]

    async def first(query, sort="relevance"):
        return {"videos": list(jumbled), "token": None, "ctx": None, "seen": set()}

    monkeypatch.setattr(search_service, "_yt_first_page", first)
    search_service._yt_pools.clear()

    latest = await search_service.search_youtube("q", limit=4, sort="date")
    assert [v["id"] for v in latest] == ["b", "d", "a", "c"]

    # Relevance keeps whatever order YouTube ranked them in.
    search_service._yt_pools.clear()
    top = await search_service.search_youtube("q", limit=4, sort="relevance")
    assert [v["id"] for v in top] == ["a", "b", "c", "d"]


@pytest.mark.asyncio
async def test_the_two_sorts_do_not_share_a_pool(monkeypatch):
    """Switching to Latest must not show whatever relevance had already cached."""
    asked: list[str] = []

    async def first(query, sort="relevance"):
        asked.append(sort)
        return {"videos": [{"id": sort, "url": f"u/{sort}", "title": sort, "published": "1 hour ago"}],
                "token": None, "ctx": None, "seen": set()}

    monkeypatch.setattr(search_service, "_yt_first_page", first)
    search_service._yt_pools.clear()

    await search_service.search_youtube("same query", limit=1, sort="relevance")
    await search_service.search_youtube("same query", limit=1, sort="date")
    assert asked == ["relevance", "date"], "the second sort reused the first one's pool"
