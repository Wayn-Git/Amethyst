import pytest

from backend.dashboard import music
from backend.dashboard.connectors import READ_SCOPES, READ_TOOLS, SourceUnavailable


@pytest.mark.asyncio
async def test_music_projects_current_and_history(db, monkeypatch):
    calls = []
    song = {
        "name": "Test track",
        "artists": [{"name": "Test artist"}],
        "external_urls": {"spotify": "https://open.spotify.com/track/test"},
        "unused": "discard",
    }

    async def fake(widget, toolkit, slug, args):
        calls.append(slug)
        assert toolkit == "spotify"
        return (
            {"data": {"is_playing": True, "item": song}}
            if "CURRENTLY" in slug
            else {"items": [{"track": song, "played_at": "2026-10-25T12:00:00Z"}]}
        )

    monkeypatch.setattr(music, "read", fake)
    value = await music.provide("glance.music")
    assert value["items"][0]["title"] == "Test track"
    assert len(value["history"]) == 1
    assert "discard" not in str(value)
    assert set(calls) == READ_TOOLS["spotify"]
    assert "modify" not in READ_SCOPES["spotify"]
    assert music.track({**song, "external_urls": {"spotify": "javascript:alert(1)"}})["url"] is None


@pytest.mark.asyncio
async def test_music_empty_and_disconnected(db, monkeypatch):
    async def empty(*args):
        return {}

    monkeypatch.setattr(music, "read", empty)
    assert await music.provide("glance.music") == {"items": [], "history": []}

    async def disconnected(*args):
        raise SourceUnavailable

    monkeypatch.setattr(music, "read", disconnected)
    with pytest.raises(SourceUnavailable):
        await music.provide("glance.music")
