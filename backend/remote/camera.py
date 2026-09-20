"""Webcam discovery, frame capture, live streaming, and privacy indicators."""

from __future__ import annotations

import asyncio
import glob
import logging
import os
import subprocess
from typing import Any, AsyncGenerator

log = logging.getLogger(__name__)

_camera_active: bool = False
_active_camera_proc: asyncio.subprocess.Process | None = None
_camera_listeners: list[Any] = []


def add_camera_listener(listener: Any) -> None:
    if listener not in _camera_listeners:
        _camera_listeners.append(listener)


def is_camera_active() -> bool:
    return _camera_active


def _notify_camera_state(active: bool, device: str = "") -> None:
    global _camera_active
    _camera_active = active
    event = {"type": "camera_state", "active": active, "device": device}
    for l in list(_camera_listeners):
        try:
            l(event)
        except Exception:
            pass


def list_cameras() -> list[dict[str, Any]]:
    """Enumerate connected video capture devices."""
    devices = []
    dev_paths = sorted(glob.glob("/dev/video*"))
    for p in dev_paths:
        name = os.path.basename(p)
        # Try v4l2 device name
        sys_name_path = f"/sys/class/video4linux/{name}/name"
        card_name = ""
        if os.path.exists(sys_name_path):
            try:
                with open(sys_name_path, "r") as f:
                    card_name = f.read().strip()
            except Exception:
                pass
        devices.append({
            "device": p,
            "name": card_name or f"Camera {p}",
        })
    return devices


def capture_camera_frame(device: str = "/dev/video0", quality: int = 4) -> bytes | None:
    """Capture a single frame from webcam."""
    if not os.path.exists(device):
        return None
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "v4l2",
        "-i", device,
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
        log.error("Webcam capture failed on %s: %s", device, e)
    return None


async def camera_stream_generator(device: str = "/dev/video0", fps: int = 15, quality: int = 5) -> AsyncGenerator[bytes, None]:
    """Continuous low-latency MJPEG multipart stream from webcam."""
    global _active_camera_proc
    if not os.path.exists(device):
        return

    _notify_camera_state(True, device)

    cmd = [
        "ffmpeg",
        "-f", "v4l2",
        "-r", str(fps),
        "-i", device,
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
    _active_camera_proc = proc

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
                    if soi_idx > 0:
                        del buffer[:soi_idx]
                    break

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
        _active_camera_proc = None
        _notify_camera_state(False, device)


def stop_camera() -> dict[str, Any]:
    """Terminate any currently active camera streaming process."""
    global _active_camera_proc
    if _active_camera_proc:
        try:
            _active_camera_proc.terminate()
        except Exception:
            pass
        _active_camera_proc = None
    _notify_camera_state(False)
    return {"ok": True, "active": False}
