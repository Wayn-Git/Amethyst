"""Screen capture and low-latency live screen streaming using ffmpeg."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from typing import AsyncGenerator

log = logging.getLogger(__name__)


def capture_screenshot(quality: int = 4, video_size: str = "1280x720") -> bytes | None:
    """Capture a single PC screenshot and return JPEG bytes."""
    display = os.environ.get("DISPLAY", ":0")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "x11grab",
        "-video_size", video_size,
        "-i", display,
        "-vframes", "1",
        "-f", "image2",
        "-c:v", "mjpeg",
        "-q:v", str(quality),
        "pipe:1",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=5)
        if res.returncode == 0 and res.stdout:
            return res.stdout
    except Exception as e:
        log.error("Screenshot capture failed: %s", e)
    return None


async def screen_stream_generator(fps: int = 15, video_size: str = "1280x720", quality: int = 5) -> AsyncGenerator[bytes, None]:
    """Continuous low-latency MJPEG multipart stream from PC display."""
    display = os.environ.get("DISPLAY", ":0")
    cmd = [
        "ffmpeg",
        "-f", "x11grab",
        "-r", str(fps),
        "-video_size", video_size,
        "-i", display,
        "-f", "mjpeg",
        "-c:v", "mjpeg",
        "-q:v", str(quality),
        "-an",
        "pipe:1",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    buffer = bytearray()
    SOI = b"\xff\xd8"
    EOI = b"\xff\xd9"

    try:
        while True:
            chunk = await proc.stdout.read(16384)
            if not chunk:
                break
            buffer.extend(chunk)

            while True:
                soi_idx = buffer.find(SOI)
                if soi_idx == -1:
                    buffer.clear()
                    break
                eoi_idx = buffer.find(EOI, soi_idx + 2)
                if eoi_idx == -1:
                    # Waiting for complete frame
                    if soi_idx > 0:
                        del buffer[:soi_idx]
                    break

                # Extract complete frame
                frame = bytes(buffer[soi_idx : eoi_idx + 2])
                del buffer[: eoi_idx + 2]

                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                    + frame + b"\r\n"
                )
    except (asyncio.CancelledError, GeneratorExit):
        pass
    finally:
        try:
            proc.terminate()
            await proc.wait()
        except Exception:
            pass
