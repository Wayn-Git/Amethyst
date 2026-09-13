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


# --------------------------------------------------------------- the race
#
# The engines used to be a chain, and a chain pays for every engine that fails
# before the one that works. On a network where DuckDuckGo cannot be reached at
# all that was a six-second connect timeout in front of an engine that answers
# in three hundred milliseconds. These hold the three things that stopped:
# the fastest honest answer wins, a dead engine cannot hold the race open, and
# a losing engine still gets to finish and notice it is dead.


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
async def test_the_fastest_honest_engine_wins(monkeypatch):
    monkeypatch.setattr(search_service, "_search_api", _engine("tavily", [], delay=0.4))
    monkeypatch.setattr(
        search_service, "_search_ddg_lite", _engine("ddg", _hits("otters"), delay=0.3)
    )
    monkeypatch.setattr(
        search_service, "_search_bing", _engine("bing", _hits("otters"), delay=0.01)
    )

    started = time.monotonic()
    results = await search_service._search_web_live("otters", 5)
    elapsed = time.monotonic() - started

    assert len(results) == 3
    assert elapsed < 0.25, "the race waited for a slower engine after one had answered"


@pytest.mark.asyncio
async def test_a_maze_of_unrelated_results_loses_to_an_engine_that_answers(monkeypatch):
    """Both free scrapers answer a flagged client with real-looking junk."""
    maze = [{"title": "Best Online Payment", "url": "https://x.test/a", "snippet": "unrelated",
             "domain": "x.test"}]
    monkeypatch.setattr(search_service, "_search_api", _engine("tavily", []))
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", maze, delay=0.01))
    monkeypatch.setattr(
        search_service, "_search_ddg_lite", _engine("ddg", _hits("alan turing"), delay=0.05)
    )

    results = await search_service._search_web_live("alan turing", 5)
    assert [r["domain"] for r in results] != ["x.test"]
    assert len(results) == 3


@pytest.mark.asyncio
async def test_an_unreachable_engine_cannot_hold_the_race_open(monkeypatch):
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
    results = await search_service._search_web_live("anything", 5)
    assert time.monotonic() - started < 1.0
    assert len(results) == 2, "nothing fell through to Wikipedia"


@pytest.mark.asyncio
async def test_a_losing_engine_still_finishes_so_it_can_notice_it_is_dead(monkeypatch):
    """Cancelling the loser meant it never counted its own refusals, so it
    never paused itself, so every query went on paying its connect timeout."""
    finished = asyncio.Event()

    async def slow_loser(query, limit):
        await asyncio.sleep(0.05)
        finished.set()
        return []

    monkeypatch.setattr(search_service, "_search_api", slow_loser)
    monkeypatch.setattr(search_service, "_search_ddg_lite", _engine("ddg", []))
    monkeypatch.setattr(search_service, "_search_bing", _engine("bing", _hits("q"), delay=0.001))

    await search_service._search_web_live("q", 5)
    await asyncio.wait_for(finished.wait(), timeout=2)
    assert finished.is_set()


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
