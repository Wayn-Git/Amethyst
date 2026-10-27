"""FastAPI router and WebSocket handler for Amethyst Remote Control."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from backend.remote.audio import SpeakerPlayer, get_audio_state, set_mic_active
from backend.remote.camera import (
    capture_camera_frame,
    camera_stream_generator,
    is_camera_active,
    list_cameras,
    stop_camera,
)
from backend.remote.clipboard import get_clipboard, set_clipboard
from backend.remote.files import (
    delete_transfer_file,
    get_transfer_path,
    list_transfer_files,
    save_transfer_file,
)
from backend.remote.input import (
    keyboard_combo,
    keyboard_press,
    keyboard_type,
    mouse_click,
    mouse_move,
    mouse_scroll,
)
from backend.remote.media import (
    get_media_status,
    media_control,
    set_default_sink,
    set_mute,
    set_volume,
)
from backend.remote.power import (
    get_wake_info,
    lock_screen,
    poweroff_pc,
    reboot_pc,
    suspend_pc,
)
from backend.remote.screen import capture_screenshot, screen_stream_generator
from backend.remote.system import (
    get_system_status,
    kill_process,
    launch_application,
    list_applications,
    list_processes,
    run_terminal_command,
)

log = logging.getLogger("amethyst.remote")

router = APIRouter(prefix="/api/remote", tags=["remote"])


# -- System telemetry & Processes --

@router.get("/status")
def remote_status() -> dict[str, Any]:
    return get_system_status()


@router.get("/processes")
def remote_processes(limit: int = Query(30, ge=1, le=100)) -> dict[str, Any]:
    return {"processes": list_processes(limit=limit)}


class KillProcessRequest(BaseModel):
    pid: int
    signal: str = "SIGTERM"


@router.post("/processes/kill")
def remote_kill_process(req: KillProcessRequest) -> dict[str, Any]:
    res = kill_process(req.pid, signal_type=req.signal)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Failed to kill process"))
    return res


@router.get("/applications")
def remote_applications() -> dict[str, Any]:
    return {"applications": list_applications()}


class LaunchAppRequest(BaseModel):
    target: str


@router.post("/applications/launch")
def remote_launch_application(req: LaunchAppRequest) -> dict[str, Any]:
    res = launch_application(req.target)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Failed to launch application"))
    return res


class RunCommandRequest(BaseModel):
    command: str
    elevated: bool = False
    timeout: float = 30.0


@router.post("/command")
def remote_command(req: RunCommandRequest) -> dict[str, Any]:
    return run_terminal_command(req.command, elevated=req.elevated, timeout=req.timeout)


# -- Media controls --

@router.get("/media")
def remote_media_status() -> dict[str, Any]:
    return get_media_status()


class VolumeRequest(BaseModel):
    volume: int


@router.post("/media/volume")
def remote_volume(req: VolumeRequest) -> dict[str, Any]:
    return set_volume(req.volume)


class MuteRequest(BaseModel):
    muted: bool | None = None


@router.post("/media/mute")
def remote_mute(req: MuteRequest) -> dict[str, Any]:
    return set_mute(req.muted)


class MediaActionRequest(BaseModel):
    action: str


@router.post("/media/action")
def remote_media_action(req: MediaActionRequest) -> dict[str, Any]:
    return media_control(req.action)


class SetSinkRequest(BaseModel):
    sink: str


@router.post("/media/sink")
def remote_sink(req: SetSinkRequest) -> dict[str, Any]:
    return set_default_sink(req.sink)


# -- Power & Wake --

@router.post("/power/{action}")
def remote_power(action: str) -> dict[str, Any]:
    action_lower = action.lower()
    if action_lower == "lock":
        return lock_screen()
    elif action_lower in ("sleep", "suspend"):
        return suspend_pc()
    elif action_lower == "reboot":
        return reboot_pc()
    elif action_lower in ("shutdown", "poweroff"):
        return poweroff_pc()
    raise HTTPException(400, f"Unknown power action: {action}")


@router.get("/power/wake")
def remote_wake_info() -> dict[str, Any]:
    return get_wake_info()


# -- Input controls --

class MouseInputRequest(BaseModel):
    action: str  # "move", "click", "scroll"
    dx: float = 0.0
    dy: float = 0.0
    x: float | None = None
    y: float | None = None
    absolute: bool = False
    button: str = "left"
    double: bool = False
    screen_width: int = 1920
    screen_height: int = 1080


@router.post("/input/mouse")
def remote_mouse(req: MouseInputRequest) -> dict[str, Any]:
    if req.action == "move":
        return mouse_move(
            dx=req.dx,
            dy=req.dy,
            absolute=req.absolute,
            x=req.x,
            y=req.y,
            screen_width=req.screen_width,
            screen_height=req.screen_height,
        )
    elif req.action == "click":
        return mouse_click(button=req.button, double=req.double)
    elif req.action == "scroll":
        return mouse_scroll(dx=int(req.dx), dy=int(req.dy))
    raise HTTPException(400, f"Unknown mouse action: {req.action}")


class KeyboardInputRequest(BaseModel):
    action: str  # "type", "press", "combo"
    text: str = ""
    key: str = ""
    keys: list[str] = []


@router.post("/input/keyboard")
def remote_keyboard(req: KeyboardInputRequest) -> dict[str, Any]:
    if req.action == "type":
        return keyboard_type(req.text)
    elif req.action == "press":
        return keyboard_press(req.key)
    elif req.action == "combo":
        return keyboard_combo(req.keys)
    raise HTTPException(400, f"Unknown keyboard action: {req.action}")


# -- Clipboard --

@router.get("/clipboard")
def remote_clipboard_get() -> dict[str, Any]:
    return get_clipboard()


class ClipboardSetRequest(BaseModel):
    text: str


@router.post("/clipboard")
def remote_clipboard_set(req: ClipboardSetRequest) -> dict[str, Any]:
    return set_clipboard(req.text)


# -- Screen capture & Live Stream --

@router.get("/screenshot")
def remote_screenshot(
    quality: int = Query(4, ge=1, le=31),
    format: str = Query("json"),  # "json" or "binary"
) -> Any:
    data = capture_screenshot(quality=quality)
    if not data:
        raise HTTPException(500, "Screenshot capture failed")
    if format == "binary":
        return Response(content=data, media_type="image/jpeg")
    b64 = base64.b64encode(data).decode("utf-8")
    return {"image": f"data:image/jpeg;base64,{b64}", "size_bytes": len(data)}


@router.get("/screen/stream")
def remote_screen_stream(
    fps: int = Query(15, ge=1, le=30),
    size: str = Query("1280x720"),
    quality: int = Query(5, ge=1, le=31),
) -> StreamingResponse:
    return StreamingResponse(
        screen_stream_generator(fps=fps, video_size=size, quality=quality),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# -- Webcam --

@router.get("/camera/list")
def remote_camera_list() -> dict[str, Any]:
    return {"cameras": list_cameras(), "active": is_camera_active()}


@router.get("/camera/snapshot")
@router.get("/camera/frame")
def remote_camera_frame(
    device: str = Query("/dev/video0"),
    quality: int = Query(4, ge=1, le=31),
    format: str = Query("json"),
) -> Any:
    data = capture_camera_frame(device=device, quality=quality)
    if not data:
        raise HTTPException(500, "Camera frame capture failed")
    if format == "binary":
        return Response(content=data, media_type="image/jpeg")
    b64 = base64.b64encode(data).decode("utf-8")
    return {"image": f"data:image/jpeg;base64,{b64}", "size_bytes": len(data)}


@router.get("/camera/stream")
def remote_camera_stream(
    device: str = Query("/dev/video0"),
    fps: int = Query(15, ge=1, le=30),
    quality: int = Query(5, ge=1, le=31),
) -> StreamingResponse:
    return StreamingResponse(
        camera_stream_generator(device=device, fps=fps, quality=quality),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.post("/camera/stop")
def remote_camera_stop() -> dict[str, Any]:
    return stop_camera()


# -- Files Transfer --

@router.get("/files")
def remote_files_list() -> dict[str, Any]:
    return {"files": list_transfer_files()}


@router.post("/files/upload")
async def remote_files_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    return save_transfer_file(file.filename or "upload.bin", content)


@router.get("/files/download/{filename}")
def remote_files_download(filename: str) -> FileResponse:
    path = get_transfer_path(filename)
    if not path or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=path.name)


@router.delete("/files/{filename}")
def remote_files_delete(filename: str) -> dict[str, Any]:
    ok = delete_transfer_file(filename)
    if not ok:
        raise HTTPException(404, "File not found")
    return {"ok": True, "deleted": filename}


# -- WebSocket for Real-Time Multiplexing --

@router.websocket("/ws")
async def remote_websocket(websocket: WebSocket, token: str | None = None):
    """Multiplexed real-time WebSocket for trackpad, virtual keys, audio, and live status."""
    await websocket.accept()

    speaker = SpeakerPlayer()
    speaker_started = False

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            # Handle binary audio from phone mic to PC speaker
            if "bytes" in msg and msg["bytes"]:
                if not speaker_started:
                    await speaker.start()
                    speaker_started = True
                await speaker.write(msg["bytes"])
                continue

            # Handle JSON commands
            if "text" in msg and msg["text"]:
                try:
                    payload = json.loads(msg["text"])
                    cmd_type = payload.get("type")

                    if cmd_type == "ping":
                        await websocket.send_text(json.dumps({"type": "pong", "time": payload.get("time")}))
                    elif cmd_type == "mouse_move":
                        mouse_move(
                            dx=payload.get("dx", 0),
                            dy=payload.get("dy", 0),
                            absolute=payload.get("absolute", False),
                            x=payload.get("x"),
                            y=payload.get("y"),
                        )
                    elif cmd_type == "mouse_click":
                        mouse_click(button=payload.get("button", "left"), double=payload.get("double", False))
                    elif cmd_type == "mouse_scroll":
                        mouse_scroll(dx=payload.get("dx", 0), dy=payload.get("dy", 0))
                    elif cmd_type == "keyboard_type":
                        keyboard_type(payload.get("text", ""))
                    elif cmd_type == "keyboard_press":
                        keyboard_press(payload.get("key", ""))
                    elif cmd_type == "keyboard_combo":
                        keyboard_combo(payload.get("keys", []))
                    elif cmd_type == "mic_stop":
                        if speaker_started:
                            await speaker.close()
                            speaker_started = False
                    elif cmd_type == "get_status":
                        status = get_system_status()
                        await websocket.send_text(json.dumps({"type": "status", "data": status}))
                except Exception as e:
                    await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        if speaker_started:
            await speaker.close()
