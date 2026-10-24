import pytest
from fastapi import BackgroundTasks

from backend.dashboard import feeds, news, service
from backend.dashboard.store import cache_read, cache_write, stamp


@pytest.mark.asyncio
async def test_news_groups_only_user_feeds_without_network(db, monkeypatch):
    async def fail(*args):
        raise AssertionError("Fresh cache must not request sources")

    monkeypatch.setattr(feeds, "download", fail)
    items = [
        {"title": "One", "url": "https://example.com/one", "feed_id": 1, "tags": ["Code", "Work"]},
        {"title": "Two", "url": "https://example.com/two", "feed_id": 2, "tags": []},
    ]
    cache_write("feed.rss", {"items": items, "errors": []}, "ok", synced_at=stamp())
    value = await news.provide("feed.news")
    assert [g["tag"] for g in value["items"]] == ["Code", "Untagged", "Work"]
    assert value["items"][0]["items"] == [items[0]]


@pytest.mark.asyncio
async def test_news_empty_with_no_default_feeds(db):
    assert await news.provide("feed.news") == {"items": [], "errors": []}
    assert cache_read("feed.rss")["state"] == "empty"


@pytest.mark.asyncio
async def test_news_manual_refresh_reads_rss_source(db, monkeypatch):
    calls = []

    async def source(widget_id):
        calls.append(widget_id)
        return {"items": [], "feeds": [], "errors": [{"feed_id": 1, "error": "Unavailable"}]}

    monkeypatch.setattr(feeds, "provide", source)
    cache_write("feed.rss", {"items": [], "errors": []}, "ok", synced_at=stamp())
    background = BackgroundTasks()
    service.schedule("feed.news", background, force=True)
    await background()
    assert calls == ["feed.rss"]
    assert len(cache_read("feed.news")["payload"]["errors"]) == 1
