"""Interactive PTY terminal manager and WebSocket router for Amethyst.

Provides real-time interactive terminal sessions (fish, bash, zsh) running
within the user's workspace, rendered via xterm.js over WebSockets.
"""

from __future__ import annotations

import asyncio
from collections import deque
import contextlib
import fcntl
import json
import logging
import os
from pathlib import Path
import pty
import shutil
import struct
import termios
from typing import Any
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

log = logging.getLogger("amethyst.terminal")

router = APIRouter(prefix="/api/terminal", tags=["terminal"])

# Maximum scrollback buffer stored in memory per session (in bytes)
MAX_BUFFER_BYTES = 100_000


def get_available_shells() -> list[dict[str, Any]]:
    """Detect available shells on the system, prioritizing fish if installed."""
    candidates = [
        {"id": "fish", "name": "fish (default)", "bin": "fish"},
        {"id": "bash", "name": "bash", "bin": "bash"},
        {"id": "zsh", "name": "zsh", "bin": "zsh"},
    ]
    available = []
    has_default = False

    for c in candidates:
        found_path = shutil.which(c["bin"])
        if found_path:
            is_def = not has_default
            has_default = True
            available.append({
                "id": c["id"],
                "name": f"{c['id']} (default)" if is_def else c["id"],
                "path": found_path,
                "default": is_def,
            })

    if not available:
        # Fallback to sh
        sh_path = shutil.which("sh") or "/bin/sh"
        available.append({
            "id": "sh",
            "name": "sh (default)",
            "path": sh_path,
            "default": True,
        })

    return available


def resolve_default_workspace() -> str:
    """Resolve default workspace directory for terminal sessions."""
    # Check if ~/Documents/Amethyst exists
    doc_amethyst = Path("~/Documents/Amethyst").expanduser().resolve()
    if doc_amethyst.is_dir():
        return str(doc_amethyst)
    # Check if current repo root
    cwd = Path.cwd().resolve()
    return str(cwd)


class TerminalSession:
    def __init__(
        self,
        session_id: str,
        shell_id: str,
        shell_path: str,
        cwd: str,
        index: int,
    ):
        self.session_id = session_id
        self.shell_id = shell_id
        self.shell_path = shell_path
        self.cwd = cwd
        self.index = index
        self.name = f"{index} {shell_id}"
        self.master_fd: int | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.buffer: deque[bytes] = deque()
        self.buffer_size = 0
        self.subscribers: dict[WebSocket, asyncio.Queue[bytes | str]] = {}
        self.alive = False
        self.loop: asyncio.AbstractEventLoop | None = None
        self._monitor_task: asyncio.Task | None = None

    def append_buffer(self, data: bytes) -> None:
        self.buffer.append(data)
        self.buffer_size += len(data)
        while self.buffer_size > MAX_BUFFER_BYTES and self.buffer:
            removed = self.buffer.popleft()
            self.buffer_size -= len(removed)

    def get_full_buffer(self) -> bytes:
        return b"".join(self.buffer)

    def add_subscriber(self, ws: WebSocket) -> asyncio.Queue[bytes | str]:
        q: asyncio.Queue[bytes | str] = asyncio.Queue()
        self.subscribers[ws] = q
        return q

    def remove_subscriber(self, ws: WebSocket) -> None:
        self.subscribers.pop(ws, None)

    def broadcast(self, item: bytes | str) -> None:
        for q in list(self.subscribers.values()):
            try:
                q.put_nowait(item)
            except Exception:
                pass

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        master_fd, slave_fd = pty.openpty()
        self.master_fd = master_fd

        # Set master_fd to non-blocking
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        # Initial window size: 80 cols, 24 rows
        winsize = struct.pack("HHHH", 24, 80, 0, 0)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["AMETHYST_TERMINAL"] = "1"
        if "LANG" not in env:
            env["LANG"] = "en_US.UTF-8"

        def _preexec():
            os.setsid()
            with contextlib.suppress(Exception):
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        try:
            self.proc = await asyncio.create_subprocess_exec(
                self.shell_path,
                "-l",
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=self.cwd,
                env=env,
                preexec_fn=_preexec,
                close_fds=True,
            )
        except Exception:
            # Try without -l if login shell flag isn't supported
            self.proc = await asyncio.create_subprocess_exec(
                self.shell_path,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=self.cwd,
                env=env,
                preexec_fn=_preexec,
                close_fds=True,
            )
        finally:
            with contextlib.suppress(OSError):
                os.close(slave_fd)

        self.alive = True
        self.loop.add_reader(self.master_fd, self._on_pty_readable)
        self._monitor_task = asyncio.create_task(self._monitor_cwd_loop())

    def check_cwd(self) -> str | None:
        """Check process working directory via foreground PGRP and proc PID."""
        target_pids = []
        if self.master_fd is not None:
            try:
                buf = struct.pack("i", 0)
                res = fcntl.ioctl(self.master_fd, termios.TIOCGPGRP, buf)
                pgrp = struct.unpack("i", res)[0]
                if pgrp > 0:
                    target_pids.append(pgrp)
            except Exception:
                pass

        if self.proc and self.proc.pid:
            if self.proc.pid not in target_pids:
                target_pids.append(self.proc.pid)

        for pid in target_pids:
            try:
                curr = os.readlink(f"/proc/{pid}/cwd")
                if curr and os.path.isdir(curr):
                    if curr != self.cwd:
                        self.cwd = curr
                        return curr
                    return None
            except Exception:
                continue

        return None

    def _broadcast_cwd_if_changed(self) -> None:
        new_cwd = self.check_cwd()
        if new_cwd and self.subscribers:
            msg = json.dumps({"type": "cwd", "cwd": new_cwd})
            self.broadcast(msg)

    async def _monitor_cwd_loop(self) -> None:
        """Continuous background monitor for CWD updates every 250ms."""
        while self.alive:
            try:
                if self.subscribers:
                    self._broadcast_cwd_if_changed()
            except Exception:
                pass
            await asyncio.sleep(0.25)

    def _on_pty_readable(self) -> None:
        if self.master_fd is None:
            return
        try:
            data = os.read(self.master_fd, 8192)
            if not data:
                self._handle_exit()
                return
            self.append_buffer(data)
            # Broadcast bytes to all subscribers sequentially via queue
            self.broadcast(data)
            self._broadcast_cwd_if_changed()
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            # EIO on EOF
            self._handle_exit()

    def _handle_exit(self) -> None:
        self.alive = False
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            self._monitor_task = None

        if self.master_fd is not None and self.loop is not None:
            try:
                self.loop.remove_reader(self.master_fd)
            except Exception:
                pass
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = None

        # Notify websockets
        exit_msg = b"\r\n\x1b[33m[Process completed]\x1b[0m\r\n"
        self.broadcast(exit_msg)

    def resize(self, cols: int, rows: int) -> None:
        if self.master_fd is not None and self.alive:
            try:
                winsize = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except Exception as exc:
                log.debug("Failed to resize PTY: %s", exc)

    def write(self, data: bytes | str) -> None:
        if self.master_fd is not None and self.alive:
            try:
                raw = data.encode("utf-8") if isinstance(data, str) else data
                os.write(self.master_fd, raw)
                if self.loop is not None and (b"\r" in raw or b"\n" in raw):
                    # Multi-stage check for shell prompt and directory change
                    for delay in (0.02, 0.08, 0.18, 0.35, 0.6, 1.0):
                        self.loop.call_later(delay, self._broadcast_cwd_if_changed)
            except Exception as exc:
                log.debug("Failed to write to PTY: %s", exc)

    async def close(self) -> None:
        self.alive = False
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            self._monitor_task = None

        if self.master_fd is not None and self.loop is not None:
            try:
                self.loop.remove_reader(self.master_fd)
            except Exception:
                pass
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = None

        if self.proc is not None:
            try:
                self.proc.terminate()
                await asyncio.wait_for(self.proc.wait(), timeout=1.0)
            except Exception:
                with contextlib.suppress(Exception):
                    self.proc.kill()
            self.proc = None

        for ws in list(self.subscribers.keys()):
            with contextlib.suppress(Exception):
                await ws.close()
        self.subscribers.clear()

    def to_dict(self) -> dict[str, Any]:
        self.check_cwd()
        return {
            "id": self.session_id,
            "name": self.name,
            "shell": self.shell_id,
            "cwd": self.cwd,
            "alive": self.alive,
        }


class TerminalManager:
    _instance: TerminalManager | None = None

    def __init__(self):
        self.sessions: dict[str, TerminalSession] = {}
        self._next_index = 1

    @classmethod
    def get(cls) -> TerminalManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def create_session(
        self,
        shell_id: str | None = None,
        cwd: str | None = None,
    ) -> TerminalSession:
        shells = get_available_shells()
        selected_shell = None

        if shell_id:
            for s in shells:
                if s["id"] == shell_id:
                    selected_shell = s
                    break

        if not selected_shell:
            # Fall back to default
            for s in shells:
                if s.get("default"):
                    selected_shell = s
                    break
            if not selected_shell and shells:
                selected_shell = shells[0]

        if not selected_shell:
            raise RuntimeError("No usable shell found on the system")

        session_id = uuid.uuid4().hex[:8]
        target_cwd = cwd or resolve_default_workspace()
        if not Path(target_cwd).is_dir():
            target_cwd = str(Path.home())

        index = self._next_index
        self._next_index += 1

        session = TerminalSession(
            session_id=session_id,
            shell_id=selected_shell["id"],
            shell_path=selected_shell["path"],
            cwd=target_cwd,
            index=index,
        )
        await session.start()
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> TerminalSession | None:
        return self.sessions.get(session_id)

    async def close_session(self, session_id: str) -> bool:
        session = self.sessions.pop(session_id, None)
        if session:
            await session.close()
            return True
        return False

    async def shutdown(self) -> None:
        for session in list(self.sessions.values()):
            await session.close()
        self.sessions.clear()

    def list_sessions(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.sessions.values()]


class CreateSessionRequest(BaseModel):
    shell: str | None = None
    cwd: str | None = None


@router.get("/shells")
async def list_shells() -> dict[str, Any]:
    """Return installed shells and workspace path."""
    return {
        "shells": get_available_shells(),
        "default_cwd": resolve_default_workspace(),
    }


@router.get("/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    """Return all active terminal sessions."""
    return TerminalManager.get().list_sessions()


@router.post("/sessions")
async def create_session(req: CreateSessionRequest) -> dict[str, Any]:
    """Create a new terminal session."""
    session = await TerminalManager.get().create_session(shell_id=req.shell, cwd=req.cwd)
    return session.to_dict()


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, Any]:
    """Terminate and remove a terminal session."""
    closed = await TerminalManager.get().close_session(session_id)
    if not closed:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "closed", "id": session_id}


@router.websocket("/ws")
async def terminal_websocket(websocket: WebSocket, session_id: str | None = None, shell: str | None = None):
    """WebSocket endpoint for duplex terminal communication."""
    await websocket.accept()
    manager = TerminalManager.get()

    session: TerminalSession | None = None
    if session_id:
        session = manager.get_session(session_id)

    if session is None:
        # Create a new session on the fly if none specified or found
        try:
            session = await manager.create_session(shell_id=shell)
        except Exception as exc:
            await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
            await websocket.close()
            return

    # Register subscriber queue
    queue = session.add_subscriber(websocket)

    async def _sender():
        try:
            while True:
                item = await queue.get()
                if isinstance(item, bytes):
                    await websocket.send_bytes(item)
                elif isinstance(item, str):
                    await websocket.send_text(item)
                queue.task_done()
        except Exception:
            pass

    sender_task = asyncio.create_task(_sender())

    # Send initial session metadata
    session.check_cwd()
    await queue.put(json.dumps({
        "type": "session_init",
        "id": session.session_id,
        "name": session.name,
        "shell": session.shell_id,
        "cwd": session.cwd,
    }))

    # Replay buffer history
    buf = session.get_full_buffer()
    if buf:
        await queue.put(buf)

    try:
        while True:
            # Handle text or bytes
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"]:
                session.write(msg["bytes"])
            elif "text" in msg and msg["text"]:
                text = msg["text"]
                if text.startswith("{"):
                    try:
                        parsed = json.loads(text)
                        msg_type = parsed.get("type")
                        if msg_type == "resize":
                            cols = int(parsed.get("cols", 80))
                            rows = int(parsed.get("rows", 24))
                            session.resize(cols, rows)
                            continue
                        elif msg_type == "ping":
                            await queue.put(json.dumps({"type": "pong"}))
                            continue
                        elif msg_type == "get_cwd":
                            session.check_cwd()
                            await queue.put(json.dumps({"type": "cwd", "cwd": session.cwd}))
                            continue
                    except (json.JSONDecodeError, ValueError):
                        pass
                session.write(text.encode("utf-8"))
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
        pass
    finally:
        session.remove_subscriber(websocket)
        sender_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sender_task
