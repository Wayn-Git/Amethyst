import json

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.dashboard import feeds, service
from backend.dashboard.items import decide
from backend.dashboard.router import router
from backend.dashboard.store import cache_read, cache_write
from backend.db.connection import get_connection, reset_connection


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client
    service.IN_FLIGHT.clear()


def test_feed_changes_are_reviewed_and_persisted(client):
    value = client.post(
        "/api/widgets/feed.rss/actions/add",
        json={"url": "https://example.com/rss", "tags": ["Code", "Code"]},
    ).json()
    assert feeds.rows() == []
    response = client.post(
        f"/api/widgets/feed.rss/drafts/{value['draft_id']}", json={"approved": False}
    )
    assert response.json()["state"] == "denied"
    assert feeds.rows() == []
    value = client.post(
        "/api/widgets/feed.rss/actions/add",
        json={"url": "https://example.com/rss", "tags": ["Code"]},
    ).json()
    assert (
        client.post(
            f"/api/widgets/feed.rss/drafts/{value['draft_id']}", json={"approved": True}
        ).json()["state"]
        == "applied"
    )
    assert (
        client.post(
            f"/api/widgets/feed.rss/drafts/{value['draft_id']}", json={"approved": True}
        ).status_code
        == 409
    )
    reset_connection()
    row = feeds.rows()[0]
    cache_write("feed.rss", {"items": []}, "ok")
    value = client.post(
        "/api/widgets/feed.rss/actions/edit",
        json={"id": row["id"], "url": row["url"], "tags": ["News"]},
    ).json()
    assert (
        client.post(
            f"/api/widgets/feed.rss/drafts/{value['draft_id']}", json={"approved": True}
        ).status_code
        == 200
    )
    assert json.loads(feeds.rows()[0]["tags_json"]) == ["News"]
    assert cache_read("feed.rss")["state"] == "loading"
    value = client.post("/api/widgets/feed.rss/actions/delete", json={"id": row["id"]}).json()
    assert (
        client.post(
            f"/api/widgets/feed.rss/drafts/{value['draft_id']}", json={"approved": True}
        ).status_code
        == 200
    )
    assert feeds.rows() == []


def test_invalid_urls_rejected(client):
    for url in ("file:///etc/passwd", "https://user:password@example.com/feed"):
        assert (
            client.post("/api/widgets/feed.rss/actions/add", json={"url": url}).status_code == 422
        )


@pytest.mark.asyncio
async def test_feed_changed_since_review(db):
    first = feeds.draft("add", feeds.FeedInput(url="https://example.com/rss"))
    await decide("feed.rss", first["draft_id"], True)
    row = feeds.rows()[0]
    change = feeds.draft("delete", feeds.FeedInput(id=row["id"]))
    get_connection().execute("UPDATE dashboard_feeds SET tags_json='[\"new\"]'")
    with pytest.raises(HTTPException) as exc:
        await decide("feed.rss", change["draft_id"], True)
    assert exc.value.status_code == 409


def test_rss_atom_and_hostile_xml():
    feed = {"id": 1, "tags": ["Code"]}
    value = feeds.parse(
        b"<rss><channel><item><title>Fixture</title><link>/post</link><description>discard</description></item></channel></rss>",
        "https://example.com/rss",
        feed,
    )
    assert value == [
        {
            "title": "Fixture",
            "url": "https://example.com/post",
            "feed_id": 1,
            "tags": ["Code"],
            "published_at": "",
        }
    ]
    assert (
        feeds.parse(
            b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/atom"/></entry></feed>',
            "https://example.com/rss",
            feed,
        )[0]["title"]
        == "Atom"
    )
    assert (
        feeds.parse(
            b"<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>",
            "https://example.com/rss",
            feed,
        )
        == []
    )
    with pytest.raises(ValueError):
        feeds.parse(b'<!DOCTYPE rss [<!ENTITY a "attack">]><rss/>', "", feed)


@pytest.mark.asyncio
async def test_no_defaults_and_failed_feed_keeps_saved_items(db, monkeypatch):
    async def fail(*args):
        raise RuntimeError("offline")

    monkeypatch.setattr(feeds, "download", fail)
    assert await feeds.provide("feed.rss") == {"items": [], "feeds": [], "errors": []}
    first = feeds.draft("add", feeds.FeedInput(url="https://example.com/rss"))
    await decide("feed.rss", first["draft_id"], True)
    item = {"feed_id": feeds.rows()[0]["id"], "title": "Saved"}
    cache_write("feed.rss", {"items": [item]}, "ok")
    value = await feeds.provide("feed.rss")
    assert value["items"] == [item]
    assert len(value["errors"]) == 1


@pytest.mark.asyncio
async def test_download_audits_redirects_and_blocks_private_destination(db, monkeypatch):
    checked, logs = [], []

    async def check(url):
        checked.append(url)
        if "127.0.0.1" in url:
            raise ValueError("Private")

    def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(feeds, "check_url_async", check)
    monkeypatch.setattr(
        feeds.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(feeds.ExecutionLogRepository, "record", lambda self, **kw: logs.append(kw))
    with pytest.raises(ValueError):
        await feeds.download("https://example.com/rss", 1)
    assert len(checked) == 2
    assert len(logs) == 1
    assert logs[0]["tool_name"] == "rss_read"


@pytest.mark.asyncio
async def test_download_size_limit_and_success_are_audited(db, monkeypatch):
    logs = []

    async def check(url):
        pass

    def handler(request):
        return httpx.Response(200, content=b"x" * (1_000_001 if "big" in str(request.url) else 10))

    real_client = httpx.AsyncClient
    monkeypatch.setattr(feeds, "check_url_async", check)
    monkeypatch.setattr(
        feeds.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(feeds.ExecutionLogRepository, "record", lambda self, **kw: logs.append(kw))
    assert (await feeds.download("https://example.com/rss", 1))[0] == b"x" * 10
    with pytest.raises(ValueError):
        await feeds.download("https://example.com/big", 1)
    assert len(logs) == 2
    assert logs[0]["error"] is None
    assert logs[1]["error"] is not None


@pytest.mark.asyncio
async def test_removal_during_refresh_does_not_restore_removed_data(db, monkeypatch):
    first = feeds.draft("add", feeds.FeedInput(url="https://example.com/rss"))
    await decide("feed.rss", first["draft_id"], True)

    async def download(*args):
        get_connection().execute("DELETE FROM dashboard_feeds")
        return (
            b"<rss><channel><item><title>Removed</title><link>https://example.com/post</link></item></channel></rss>",
            "https://example.com/rss",
        )

    monkeypatch.setattr(feeds, "download", download)
    assert await feeds.provide("feed.rss") == {"feeds": [], "items": [], "errors": []}
