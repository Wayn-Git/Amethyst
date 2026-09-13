"""The media layer: what gets attached to a widget, and what never does.

Two things are worth protecting here. One is that nothing reaches an `<img>` or
an `<iframe>` without going through the same SSRF check as the rest of the
system. The other is that media is a garnish: every failure -- no hint, a dead
backend, a slow one, junk in a result -- has to end in an empty list rather than
in a lost widget.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.agent import media
from backend.agent.media import MediaHint, embed_url, fetch, is_playable, youtube_id

pytestmark = pytest.mark.anyio


# --- YouTube detection ------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ",
        "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
        # Extra query parameters are normal on a shared link.
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLabc",
        "https://youtu.be/dQw4w9WgXcQ?t=42",
    ],
)
def test_a_youtube_video_url_yields_its_id(url):
    assert youtube_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        "",
        "not a url",
        "https://vimeo.com/123456",
        "https://example.com/watch?v=dQw4w9WgXcQ",
        # A lookalike host. `youtube.com.evil.test` must not read as YouTube.
        "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
        "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
        # Real YouTube, but not a video.
        "https://www.youtube.com/results?search_query=carbonara",
        "https://www.youtube.com/channel/UCabc",
        "https://www.youtube.com/playlist?list=PLabc",
        # Ids are exactly eleven characters of a known alphabet.
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=waaaaaaytoolongforanid",
        "https://www.youtube.com/watch?v=bad!chars!!",
        # Schemes that are not a page.
        "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
        "data:text/html,<iframe src=x>",
        "file:///etc/passwd",
    ],
)
def test_anything_that_is_not_a_youtube_video_yields_nothing(url):
    """The id is what an iframe src is built from, so this is a security check.

    Mutation check: loosen `_YOUTUBE_ID`, or match the host with `in` rather
    than against the allow-list.
    """
    assert youtube_id(url) is None


def test_the_embed_url_is_built_not_borrowed():
    """Never a URL from a search result -- an id this module has validated.

    Mutation check: have `_videos` pass a result's own URL through as the embed.
    """
    assert embed_url("dQw4w9WgXcQ") == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"


# --- direct playability -----------------------------------------------------


@pytest.mark.parametrize(
    "url,playable",
    [
        ("https://example.com/clip.mp4", True),
        ("https://example.com/clip.webm", True),
        ("https://example.com/a/b/clip.MP4", True),
        ("https://example.com/clip.mp4?token=abc", True),
        ("https://example.com/page.html", False),
        ("https://example.com/video", False),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", False),
        ("", False),
    ],
)
def test_only_a_file_a_browser_can_play_gets_a_player(url, playable):
    assert is_playable(url) is playable


# --- retrieval --------------------------------------------------------------


def _allow_everything(monkeypatch):
    async def ok(url, **kw):
        return None

    monkeypatch.setattr(media, "check_url_async", ok)


async def test_no_hint_means_no_lookup(monkeypatch):
    called = False

    async def search(*a, **kw):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr("backend.web.search_service.search_youtube", search)

    assert await fetch(None) == []
    assert await fetch(MediaHint(kind="none", query="")) == []
    # `none` with a query is still none.
    assert await fetch(MediaHint(kind="none", query="carbonara")) == []
    # An empty query is not a search worth making.
    assert await fetch(MediaHint(kind="video", query="   ")) == []
    assert not called


async def test_a_video_hint_becomes_an_embeddable_card(monkeypatch):
    _allow_everything(monkeypatch)

    async def search(query, limit=8):
        return [{
            "id": "dQw4w9WgXcQ",
            "title": "Carbonara in 10 minutes",
            "channel": "Some Cook",
            "duration": "10:02",
            "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }]

    monkeypatch.setattr("backend.web.search_service.search_youtube", search)

    [item] = await fetch(MediaHint(kind="video", query="carbonara"))

    assert item["kind"] == "youtube"
    assert item["title"] == "Carbonara in 10 minutes"
    assert item["embed_url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    # Provenance is kept: who made it, and where it actually lives.
    assert item["source"] == "Some Cook"
    assert item["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


async def test_a_video_result_with_an_unusable_id_is_dropped(monkeypatch):
    _allow_everything(monkeypatch)

    async def search(query, limit=8):
        return [{"id": "../../evil", "title": "nope", "url": "https://www.youtube.com/watch?v=x"}]

    monkeypatch.setattr("backend.web.search_service.search_youtube", search)

    assert await fetch(MediaHint(kind="video", query="carbonara")) == []


async def test_an_image_hint_keeps_its_attribution(monkeypatch):
    _allow_everything(monkeypatch)

    async def search(query, limit=12):
        return [{
            "id": "1",
            "title": "Carbonara",
            "thumbnail": "https://example.com/thumb.jpg",
            "image": "https://example.com/full.jpg",
            "source_url": "https://example.com/page",
            "creator": "A Photographer",
            "license": "cc-by",
        }]

    monkeypatch.setattr("backend.web.search_service.search_images", search)

    [item] = await fetch(MediaHint(kind="image", query="carbonara"))

    assert item["kind"] == "image"
    assert item["direct_url"] == "https://example.com/full.jpg"
    # The landing page, not the file: that is where the licence is readable.
    assert item["url"] == "https://example.com/page"
    assert item["source"] == "A Photographer"
    assert item["license"] == "cc-by"


async def test_a_web_hint_becomes_link_cards(monkeypatch):
    _allow_everything(monkeypatch)

    async def search(query, limit=8):
        return [{
            "title": "Carbonara, properly",
            "url": "https://example.com/carbonara",
            "snippet": "Four ingredients.",
            "domain": "example.com",
        }]

    monkeypatch.setattr("backend.web.search_service.search_web", search)

    [item] = await fetch(MediaHint(kind="web", query="carbonara"))

    assert item["kind"] == "link"
    assert item["source"] == "example.com"
    assert item["thumbnail"] is None


# --- safety and failure -----------------------------------------------------


async def test_an_unsafe_url_never_reaches_the_interface(monkeypatch):
    """The browser is the one that fetches these, so a private address here is
    a probe run from the user's own machine.

    Mutation check: delete the `_keep` call in `fetch`.
    """
    from backend.mcp.ssrf import UnsafeURL

    async def check(url, **kw):
        if "169.254.169.254" in url or "localhost" in url:
            raise UnsafeURL(url)

    monkeypatch.setattr(media, "check_url_async", check)

    async def search(query, limit=8):
        return [
            {"title": "metadata", "url": "http://169.254.169.254/latest/", "domain": "x"},
            {"title": "fine", "url": "https://example.com/ok", "domain": "example.com"},
        ]

    monkeypatch.setattr("backend.web.search_service.search_web", search)

    items = await fetch(MediaHint(kind="web", query="anything"))

    assert [i["url"] for i in items] == ["https://example.com/ok"]


async def test_a_bad_thumbnail_costs_the_thumbnail_not_the_card(monkeypatch):
    from backend.mcp.ssrf import UnsafeURL

    async def check(url, **kw):
        if "localhost" in url:
            raise UnsafeURL(url)

    monkeypatch.setattr(media, "check_url_async", check)

    async def search(query, limit=12):
        return [{
            "title": "Carbonara", "image": "https://example.com/full.jpg",
            "source_url": "https://example.com/page",
            "thumbnail": "http://localhost:8000/steal", "creator": "Someone",
        }]

    monkeypatch.setattr("backend.web.search_service.search_images", search)

    [item] = await fetch(MediaHint(kind="image", query="carbonara"))

    assert item["thumbnail"] is None
    assert item["url"] == "https://example.com/page"


async def test_a_search_that_raises_costs_the_media_and_nothing_else(monkeypatch):
    async def boom(query, limit=8):
        raise RuntimeError("duckduckgo is down")

    monkeypatch.setattr("backend.web.search_service.search_web", boom)

    assert await fetch(MediaHint(kind="web", query="anything")) == []


async def test_a_slow_search_is_abandoned(monkeypatch):
    """A widget must not wait on a garnish.

    Mutation check: remove the `wait_for` in `fetch`.
    """
    async def slow(query, limit=8):
        await asyncio.sleep(10)
        return []

    monkeypatch.setattr(media, "MEDIA_TIMEOUT", 0.01)
    monkeypatch.setattr("backend.web.search_service.search_youtube", slow)

    assert await fetch(MediaHint(kind="video", query="carbonara")) == []


def test_the_hint_schema_refuses_what_it_did_not_ask_for():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        MediaHint.model_validate({"kind": "hologram", "query": "x"})
    with pytest.raises(ValidationError):
        MediaHint.model_validate({"kind": "video", "query": "x", "url": "https://evil.test"})
