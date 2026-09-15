"""Audio music recognition and text extraction for captured media.

Uses Shazam audio fingerprinting via `shazamio` when available to identify
songs playing in video audio tracks (e.g. Instagram Reels, videos), with a
regex fallback for creator music credits in captions.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Patterns creators commonly use in captions to credit background music
_CAPTION_MUSIC_PATTERNS = [
    re.compile(
        r"(?:song|track|music|audio|bgm)\s*(?:credit[s]?|name|title)?\s*[:\-–—]\s*([^\n\r#|]+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:🎵|🎶|🎧)\s*[:\-–—]?\s*([^\n\r#|]+)",
    ),
]


def _parse_music_credit(raw: str) -> tuple[str, str]:
    cleaned = raw.strip(' .-,;:\"\'#')
    parts = re.split(r"\s+(?:by|-|–|—)\s+", cleaned, maxsplit=1, flags=re.I)
    if len(parts) == 2:
        return parts[0].strip(' .-,;:\"\''), parts[1].strip(' .-,;:\"\'')
    return cleaned, ""


def extract_music_from_text(text: str | None) -> dict[str, Any] | None:
    """Extract credited song and artist from caption or post text."""
    if not text:
        return None

    for pattern in _CAPTION_MUSIC_PATTERNS:
        match = pattern.search(text)
        if match:
            raw_target = match.group(1).strip()
            song, artist = _parse_music_credit(raw_target)
            if song and len(song) >= 2:
                return {
                    "type": "music",
                    "name": song,
                    "detail": artist,
                    "url": "",
                    "source": "caption",
                }

    return None


async def recognize_audio(
    audio_path: str | Path | None,
    *,
    timeout: float = 12.0,
) -> dict[str, Any] | None:
    """Identify a song from an audio file using acoustic fingerprinting.

    Returns a dict with `name` (title), `detail` (artist), `url`, `coverart`,
    and `genre`, or None if no match was found or the service is unreachable.
    Never raises an exception — failure is treated as a silent miss.
    """
    if not audio_path:
        return None

    path = Path(audio_path)
    if not path.is_file() or path.stat().st_size < 1000:
        return None

    try:
        from shazamio import Shazam
    except ImportError:
        log.debug("shazamio is not installed, skipping audio recognition")
        return None

    try:
        shazam = Shazam()
        data = await asyncio.wait_for(shazam.recognize(str(path)), timeout=timeout)
    except asyncio.TimeoutError:
        log.debug("audio music recognition timed out after %.1fs", timeout)
        return None
    except Exception as exc:
        log.debug("audio music recognition failed: %s", exc)
        return None

    if not isinstance(data, dict) or not data.get("track"):
        return None

    track = data["track"]
    title = (track.get("title") or "").strip()
    artist = (track.get("subtitle") or "").strip()

    if not title:
        return None

    # Cover art
    coverart = (track.get("images") or {}).get("coverart") or ""

    # Primary genre
    genre = (track.get("genres") or {}).get("primary") or ""

    # Web URL
    url = track.get("url") or (track.get("share") or {}).get("href") or ""

    return {
        "type": "music",
        "name": title,
        "detail": artist,
        "url": url,
        "coverart": coverart,
        "genre": genre,
        "source": "shazam",
    }


async def detect_music(
    audio_path: str | Path | None,
    text: str | None = None,
    *,
    timeout: float = 12.0,
) -> dict[str, Any] | None:
    """Detect music from audio fingerprinting first, then text as fallback."""
    found = await recognize_audio(audio_path, timeout=timeout)
    if found:
        return found
    return extract_music_from_text(text)
