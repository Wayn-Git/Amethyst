"""Volume control, audio device management, and MPRIS media playback."""

from __future__ import annotations

import re
import shutil
import subprocess
from typing import Any


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
                sinks.append({
                    "id": sink_id,
                    "name": name,
                    "display_name": display_name,
                    "driver": parts[2] if len(parts) > 2 else "PulseAudio",
                })
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


def _get_mpris_players() -> list[str]:
    """Find active MPRIS media players on user session DBus."""
    players = []
    try:
        out = subprocess.run(
            ["busctl", "--user", "list"],
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("org.mpris.MediaPlayer2."):
                players.append(line.split()[0])
    except Exception:
        pass
    return players


def media_control(action: str) -> dict[str, Any]:
    """Send playback command to active media players."""
    valid_actions = {
        "play-pause": "PlayPause",
        "play": "Play",
        "pause": "Pause",
        "next": "Next",
        "previous": "Previous",
        "stop": "Stop",
    }
    method = valid_actions.get(action.lower().replace("_", "-"))
    if not method:
        return {"ok": False, "error": f"Invalid action: {action}"}

    # Try playerctl first if installed
    if shutil.which("playerctl"):
        cmd_map = {
            "PlayPause": "play-pause",
            "Play": "play",
            "Pause": "pause",
            "Next": "next",
            "Previous": "previous",
            "Stop": "stop",
        }
        res = subprocess.run(
            ["playerctl", cmd_map.get(method, "play-pause")],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if res.returncode == 0:
            return {"ok": True, "action": action}

    # Fallback to direct DBus calls via busctl
    players = _get_mpris_players()
    if not players:
        return {"ok": False, "error": "No active media player found"}

    success = False
    for player in players:
        res = subprocess.run(
            [
                "busctl",
                "--user",
                "call",
                player,
                "/org/mpris/MediaPlayer2",
                "org.mpris.MediaPlayer2.Player",
                method,
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if res.returncode == 0:
            success = True

    return {"ok": success, "action": action, "players": players}


def get_media_status() -> dict[str, Any]:
    """Get current volume, mute state, sinks, and now playing metadata."""
    vol = get_volume()
    muted = get_mute()
    sinks = list_sinks()

    # Query track metadata from MPRIS if player exists
    now_playing: dict[str, Any] | None = None
    players = _get_mpris_players()
    for player in players:
        try:
            out = subprocess.run(
                [
                    "busctl",
                    "--user",
                    "get-property",
                    player,
                    "/org/mpris/MediaPlayer2",
                    "org.mpris.MediaPlayer2.Player",
                    "Metadata",
                ],
                capture_output=True,
                text=True,
                timeout=2,
            ).stdout
            title_match = re.search(r'"xesam:title"\s+s\s+"([^"]+)"', out)
            artist_match = re.search(r'"xesam:artist"\s+as\s+\d+\s+"([^"]+)"', out)
            album_match = re.search(r'"xesam:album"\s+s\s+"([^"]+)"', out)
            if title_match:
                now_playing = {
                    "player": player.replace("org.mpris.MediaPlayer2.", ""),
                    "title": title_match.group(1),
                    "artist": artist_match.group(1) if artist_match else "",
                    "album": album_match.group(1) if album_match else "",
                }
                break
        except Exception:
            continue

    return {
        "volume": vol,
        "muted": muted,
        "sinks": sinks,
        "now_playing": now_playing,
    }
