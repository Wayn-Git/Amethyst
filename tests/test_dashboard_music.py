import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import music
from backend.dashboard.registry import REGISTRY
from backend.dashboard.router import router


@pytest.fixture
def playback(monkeypatch):
    state = {
        "supported": True,
        "active_player": "spotify",
        "player_id": "org.mpris.MediaPlayer2.spotify",
        "status": "Playing",
        "title": "Local track",
        "artists": ["Artist"],
        "track_id": "/track/1",
        "controls": {action: True for action in ("play", "pause", "previous", "next")},
    }
    monkeypatch.setattr(music.media, "get_playback_status", lambda player=None: state.copy())
    return state


@pytest.mark.asyncio
async def test_music_reads_desktop_without_connector(db, playback):
    value = await music.provide("glance.music")
    assert value["items"] == [{"title": "Local track", "artists": ["Artist"]}]
    assert value["status"] == "Playing"
    manifest = REGISTRY["glance.music"]["manifest"]
    assert manifest["source"]["type"] == "local"
    assert manifest["source"]["toolkit"] is None
    assert manifest["requires"] == []
    assert manifest["refresh"]["interval_s"] == 10
    playback.update(status="Paused")
    assert (await music.provide("glance.music"))["items"]
    playback.update(active_player=None, player_id=None)
    assert (await music.provide("glance.music"))["items"] == []


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as value:
        yield value


def propose(client, playback, action="pause"):
    return client.post(
        f"/api/widgets/glance.music/actions/{action}",
        json={
            "player": playback["player_id"],
            "track_id": playback["track_id"],
        },
    )


@pytest.mark.parametrize("action", ["play", "pause", "previous", "next"])
def test_playback_requires_gate_and_is_single_use(client, playback, monkeypatch, action):
    if action == "play":
        playback["status"] = "Paused"
    calls = []
    monkeypatch.setattr(
        music.media,
        "media_control",
        lambda action, player: calls.append((action, player)) or {"ok": True},
    )
    draft = propose(client, playback, action).json()["draft_id"]
    assert calls == []
    path = f"/api/widgets/glance.music/drafts/{draft}"
    assert client.post(path, json={"approved": False}).json()["state"] == "denied"
    assert calls == []
    draft = propose(client, playback, action).json()["draft_id"]
    path = f"/api/widgets/glance.music/drafts/{draft}"
    assert client.post(path, json={"approved": True}).json()["state"] == "applied"
    assert calls == [(action, playback["player_id"])]
    assert client.post(path, json={"approved": True}).status_code == 409
    assert len(calls) == 1


@pytest.mark.parametrize(
    "field,value",
    [("track_id", "/track/2"), ("status", "Paused"), ("player_id", "org.mpris.MediaPlayer2.vlc")],
)
def test_changed_session_is_not_controlled(client, playback, monkeypatch, field, value):
    calls = []
    monkeypatch.setattr(music.media, "media_control", lambda *args: calls.append(args))
    draft = propose(client, playback).json()["draft_id"]
    playback[field] = value
    response = client.post(f"/api/widgets/glance.music/drafts/{draft}", json={"approved": True})
    assert response.status_code == 409
    assert calls == []


def test_invalid_and_unsupported_commands(client, playback, monkeypatch):
    assert propose(client, playback, "execute").status_code == 404
    playback["controls"]["next"] = False
    assert propose(client, playback, "next").status_code == 409
    assert (
        client.post(
            "/api/widgets/glance.music/actions/play", json={"player": "--system"}
        ).status_code
        == 422
    )
    draft = propose(client, playback).json()["draft_id"]
    monkeypatch.setattr(
        music.media, "media_control", lambda *args: {"ok": False, "error": "Player closed"}
    )
    assert (
        client.post(
            f"/api/widgets/glance.music/drafts/{draft}", json={"approved": True}
        ).status_code
        == 503
    )


def test_non_dominant_player_is_reviewed_and_controlled(client, playback, monkeypatch):
    selected = {**playback, "player_id": "org.mpris.MediaPlayer2.browser", "status": "Paused"}
    calls = []
    monkeypatch.setattr(music.media, "get_playback_status", lambda player=None: selected if player == selected["player_id"] else playback)
    monkeypatch.setattr(music.media, "media_control", lambda action, player: calls.append((action, player)) or {"ok": True})
    draft = propose(client, selected, "play").json()["draft_id"]
    assert calls == []
    assert client.post(f"/api/widgets/glance.music/drafts/{draft}", json={"approved": True}).json()["state"] == "applied"
    assert calls == [("play", selected["player_id"])]
