import json
import subprocess

from backend.remote import media


def properties(status, title):
    return json.dumps(
        {
            "type": "a{sv}",
            "data": [
                {
                    "PlaybackStatus": {"type": "s", "data": status},
                    "CanControl": {"type": "b", "data": True},
                    "CanPause": {"type": "b", "data": True},
                    "CanPlay": {"type": "b", "data": True},
                    "CanGoNext": {"type": "b", "data": False},
                    "Metadata": {
                        "type": "a{sv}",
                        "data": {
                            "xesam:title": {"type": "s", "data": title},
                            "xesam:artist": {"type": "as", "data": ["One", "Two"]},
                            "mpris:trackid": {"type": "o", "data": "/track/1"},
                        },
                    },
                }
            ],
        }
    )


def test_selects_playing_player_and_preserves_metadata(monkeypatch):
    players = ["org.mpris.MediaPlayer2.browser", "org.mpris.MediaPlayer2.spotify"]
    monkeypatch.setattr(media.sys, "platform", "linux")
    monkeypatch.setattr(media.shutil, "which", lambda name: "/usr/bin/busctl")
    monkeypatch.setattr(media, "_get_mpris_players", lambda: players)
    monkeypatch.setattr(
        media,
        "_busctl",
        lambda *args: properties(
            "Paused" if args[2] == players[0] else "Playing", 'A "quoted" café'
        ),
    )
    state = media.get_playback_status()
    assert state["player_id"] == players[1]
    assert state["title"] == 'A "quoted" café'
    assert state["artists"] == ["One", "Two"]
    assert state["controls"]["pause"] is True
    assert state["controls"]["next"] is False


def test_control_targets_exactly_one_player(monkeypatch):
    players = ["org.mpris.MediaPlayer2.spotify", "org.mpris.MediaPlayer2.vlc"]
    calls = []
    monkeypatch.setattr(media, "_get_mpris_players", lambda: players)
    monkeypatch.setattr(media, "get_playback_status", lambda: {"player_id": players[1]})
    monkeypatch.setattr(media, "_busctl", lambda *args: calls.append(args))
    assert media.media_control("pause")["ok"]
    assert calls == [
        ("call", players[1], "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Pause")
    ]
    assert not media.media_control("play", "org.mpris.MediaPlayer2.closed")["ok"]
    assert not media.media_control("invalid")["ok"]
    assert len(calls) == 1

    def fail(*args):
        raise subprocess.TimeoutExpired("busctl", 2)

    monkeypatch.setattr(media, "_busctl", fail)
    assert not media.media_control("next", players[0])["ok"]


def test_missing_bus_and_malformed_player_are_idle(monkeypatch):
    monkeypatch.setattr(media.sys, "platform", "linux")
    monkeypatch.setattr(media.shutil, "which", lambda name: "/usr/bin/busctl")
    monkeypatch.setattr(media, "_get_mpris_players", lambda: ["org.mpris.MediaPlayer2.fixture"])
    monkeypatch.setattr(media, "_busctl", lambda *args: "bad JSON")
    assert media.get_playback_status()["active_player"] is None
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    assert media.get_playback_status()["supported"] is False
