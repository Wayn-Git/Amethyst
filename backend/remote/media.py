"""Volume control, audio device management, and MPRIS media playback."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit


def get_volume() -> int:
    """Get default sink volume percentage (0-100)."""
    try:
        out = subprocess.run(
            ["pactl", "get-sink-volume", "@DEFAULT_SINK@"],
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
        match = re.search(r"(\d+)%", out)
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return 50


def set_volume(level: int) -> dict[str, Any]:
    """Set default sink volume (0-100)."""
    clamped = max(0, min(100, int(level)))
    try:
        res = subprocess.run(
            ["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{clamped}%"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        return {"ok": res.returncode == 0, "volume": clamped}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_mute() -> bool:
    """Check if default sink is muted."""
    try:
        out = subprocess.run(
            ["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
        return "yes" in out.lower()
    except Exception:
        return False


def set_mute(mute: bool | None = None) -> dict[str, Any]:
    """Set or toggle mute on default sink."""
    try:
        arg = "toggle" if mute is None else ("1" if mute else "0")
        res = subprocess.run(
            ["pactl", "set-sink-mute", "@DEFAULT_SINK@", arg],
            capture_output=True,
            text=True,
            timeout=2,
        )
        new_mute = get_mute()
        return {"ok": res.returncode == 0, "muted": new_mute}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def list_sinks() -> list[dict[str, Any]]:
    """List available audio output sinks."""
    sinks = []
    try:
        out = subprocess.run(
            ["pactl", "list", "sinks", "short"],
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
        for line in out.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 2:
                sink_id = parts[0]
                name = parts[1]
                # Human readable display name
                display_name = name
                if "Speaker" in name:
                    display_name = "Laptop Speakers"
                elif "HDMI" in name:
                    display_name = f"HDMI Output ({name.split('__')[-1].replace('__sink', '')})"
                elif "Headphone" in name:
                    display_name = "Headphones"
                sinks.append(
                    {
                        "id": sink_id,
                        "name": name,
                        "display_name": display_name,
                        "driver": parts[2] if len(parts) > 2 else "PulseAudio",
                    }
                )
    except Exception:
        pass
    return sinks


def set_default_sink(sink_name: str) -> dict[str, Any]:
    """Set the default audio output sink."""
    try:
        res = subprocess.run(
            ["pactl", "set-default-sink", sink_name],
            capture_output=True,
            text=True,
            timeout=2,
        )
        return {"ok": res.returncode == 0, "sink": sink_name}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _busctl(*arguments):
    env = os.environ.copy()
    if not env.get("DBUS_SESSION_BUS_ADDRESS") and sys.platform.startswith("linux"):
        bus = Path(f"/run/user/{os.getuid()}/bus")
        if bus.exists():
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus}"
    return subprocess.run(
        ["busctl", "--user", *arguments],
        capture_output=True,
        text=True,
        timeout=2,
        check=True,
        env=env,
    ).stdout


def _get_mpris_players() -> list[str]:
    """Find named media players on the current user's session bus."""
    try:
        return sorted(
            line.split()[0]
            for line in _busctl("list").splitlines()
            if line.startswith("org.mpris.MediaPlayer2.")
        )
    except (OSError, subprocess.SubprocessError):
        return []


def _dbus_value(value):
    if isinstance(value, dict):
        if set(value) == {"type", "data"}:
            return _dbus_value(value["data"])
        return {key: _dbus_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_dbus_value(item) for item in value]
    return value


def artwork_url(value) -> str | None:
    if not isinstance(value, str) or len(value) > 8192:
        return None
    try:
        url = urlsplit(value)
        if url.scheme == "https" and url.hostname and not url.username and not url.password:
            return value
        if url.scheme == "file" and url.netloc in ("", "localhost"):
            path = unquote(url.path)
            if Path(path).is_absolute() and Path(path).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                return "/api/media/local?path=" + quote(path, safe="")
    except ValueError:
        pass
    return None


def get_playback_status(player: str | None = None) -> dict[str, Any]:
    """Expose all sessions; an explicit selection never falls back to another player."""
    supported = sys.platform.startswith("linux") and bool(shutil.which("busctl"))
    idle = {
        "supported": supported,
        "active_player": None,
        "player_id": None,
        "status": "Stopped",
        "controls": {},
        "players": [],
        "duration": None,
        "position": 0,
        "volume": None,
        "shuffle": None,
        "loop_status": None,
    }
    if not supported:
        return idle
    sessions = []
    for player_id in _get_mpris_players():
        try:
            values = _dbus_value(
                json.loads(
                    _busctl(
                        "--json=short",
                        "call",
                        player_id,
                        "/org/mpris/MediaPlayer2",
                        "org.freedesktop.DBus.Properties",
                        "GetAll",
                        "s",
                        "org.mpris.MediaPlayer2.Player",
                    )
                )
            )[0]
            metadata = values.get("Metadata", {})
            status = values.get("PlaybackStatus", "Stopped")
            artists = metadata.get("xesam:artist", [])
            if not isinstance(artists, list):
                artists = [artists]
            artists = [artist for artist in artists if isinstance(artist, str)]
            if status not in ("Playing", "Paused", "Stopped"):
                continue
            if not all(
                isinstance(metadata.get(key, ""), str)
                for key in ("xesam:title", "xesam:album", "mpris:trackid")
            ):
                continue
            controllable = values.get("CanControl", False) is True
            length_us = metadata.get("mpris:length")
            duration_sec = int(length_us // 1_000_000) if isinstance(length_us, (int, float)) and length_us > 0 else None
            pos_us = values.get("Position")
            position_sec = int(pos_us // 1_000_000) if isinstance(pos_us, (int, float)) and pos_us >= 0 else 0
            volume_val = values.get("Volume")
            volume_pct = int(round(volume_val * 100)) if isinstance(volume_val, (int, float)) else None
            shuffle_val = values.get("Shuffle") if isinstance(values.get("Shuffle"), bool) else None
            loop_val = values.get("LoopStatus") if isinstance(values.get("LoopStatus"), str) else None
            sessions.append(
                {
                    "supported": True,
                    "active_player": player_id.removeprefix("org.mpris.MediaPlayer2."),
                    "player_id": player_id,
                    "status": status,
                    "title": metadata.get("xesam:title", ""),
                    "artists": artists,
                    "album": metadata.get("xesam:album", ""),
                    "artwork_url": artwork_url(metadata.get("mpris:artUrl")),
                    "track_id": metadata.get("mpris:trackid", ""),
                    "duration": duration_sec,
                    "position": position_sec,
                    "volume": volume_pct,
                    "shuffle": shuffle_val,
                    "loop_status": loop_val,
                    "controls": {
                        action: controllable and values.get(prop, False) is True
                        for action, prop in (
                            ("previous", "CanGoPrevious"),
                            ("next", "CanGoNext"),
                            ("play", "CanPlay"),
                            ("pause", "CanPause"),
                        )
                    },
                }
            )
        except (
            OSError,
            subprocess.SubprocessError,
            ValueError,
            KeyError,
            IndexError,
            TypeError,
            AttributeError,
        ):
            continue
    selected = next((session for session in sessions if session["player_id"] == player), None) if player else (
        min(sessions, key=lambda item: {"Playing": 0, "Paused": 1}.get(item["status"], 2)) if sessions else None
    )
    return {**(selected or idle), "players": sessions}



def media_control(action: str, player: str | None = None) -> dict[str, Any]:
    """Control exactly one session; never broadcast across desktop players."""
    methods = {
        "play-pause": "PlayPause",
        "play": "Play",
        "pause": "Pause",
        "next": "Next",
        "previous": "Previous",
        "stop": "Stop",
    }
    method = methods.get(action.lower().replace("_", "-"))
    if not method:
        return {"ok": False, "error": f"Invalid action: {action}"}
    player = player or get_playback_status().get("player_id")
    if not player or player not in _get_mpris_players():
        return {"ok": False, "error": "No active media player found"}
    try:
        _busctl("call", player, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", method)
        return {"ok": True, "action": action, "players": [player]}
    except (OSError, subprocess.SubprocessError):
        return {"ok": False, "error": "The desktop player could not accept this command"}


def get_media_status() -> dict[str, Any]:
    """Keep the remote audio contract while sharing the selected playback session."""
    playback = get_playback_status()
    return {
        "volume": get_volume(),
        "muted": get_mute(),
        "sinks": list_sinks(),
        **playback,
        "artist": ", ".join(playback.get("artists", [])),
        "now_playing": {
            "player": playback["active_player"],
            "title": playback.get("title", ""),
            "artist": ", ".join(playback.get("artists", [])),
            "album": playback.get("album", ""),
        }
        if playback["active_player"]
        else None,
    }
