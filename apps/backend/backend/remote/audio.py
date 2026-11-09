"""Two-way audio streaming: phone microphone to PC speakers and PC intercom audio to phone."""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from typing import Any

log = logging.getLogger(__name__)

_mic_active: bool = False
_mic_listeners: list[Any] = []


def add_mic_listener(listener: Any) -> None:
    if listener not in _mic_listeners:
        _mic_listeners.append(listener)


def is_mic_active() -> bool:
    return _mic_active


def set_mic_active(active: bool) -> None:
    global _mic_active
    _mic_active = active
    event = {"type": "mic_state", "active": active}
    for l in list(_mic_listeners):
        try:
            l(event)
        except Exception:
            pass


def get_audio_state() -> dict[str, Any]:
    return {
        "mic_active": _mic_active,
    }


class SpeakerPlayer:
    """Streams incoming audio chunks from phone mic directly to PC speakers via pw-play or ffplay."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None

    async def start(self):
        set_mic_active(True)
        # Prefer pw-play, then paplay, then ffplay
        if shutil.which("pw-play"):
            cmd = ["pw-play", "-"]
        elif shutil.which("ffplay"):
            cmd = ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-i", "-"]
        else:
            cmd = ["paplay"]

        self.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

    async def write(self, data: bytes):
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.write(data)
                await self.proc.stdin.drain()
            except Exception:
                pass

    async def close(self):
        set_mic_active(False)
        if self.proc:
            try:
                if self.proc.stdin:
                    self.proc.stdin.close()
                await self.proc.wait()
            except Exception:
                pass
            self.proc = None


class IntercomRecorder:
    """Streams PC monitor/speaker audio back to phone for intercom functionality."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None

    async def start(self):
        # Prefer pw-record, then parecord, then ffmpeg pulse monitor
        if shutil.which("pw-record"):
            cmd = ["pw-record", "--format=s16", "--rate=16000", "--channels=1", "-"]
        elif shutil.which("parecord"):
            cmd = ["parecord", "--format=s16le", "--rate=16000", "--channels=1"]
        else:
            cmd = ["ffmpeg", "-f", "pulse", "-i", "default", "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"]

        self.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

    async def read(self, n: int = 4096) -> bytes:
        if self.proc and self.proc.stdout:
            try:
                return await self.proc.stdout.read(n)
            except Exception:
                pass
        return b""

    async def close(self):
        if self.proc:
            try:
                self.proc.terminate()
                await self.proc.wait()
            except Exception:
                pass
            self.proc = None
