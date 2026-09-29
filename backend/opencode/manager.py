"""OpenCode process manager.

Spawns ``opencode web`` as a managed subprocess and exposes its port for
the reverse-proxy router. The process is started lazily on first request
and torn down when the Amethyst server shuts down.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import socket
from pathlib import Path

import httpx

log = logging.getLogger("amethyst.opencode")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_BINARY_PATHS = [
    os.path.expanduser("~/.opencode/bin/opencode"),
]

_STARTUP_TIMEOUT = 30  # seconds to wait for opencode to become healthy
_SHUTDOWN_TIMEOUT = 5  # seconds between SIGTERM and SIGKILL


def _find_binary() -> str | None:
    """Locate the ``opencode`` binary on disk."""
    found = shutil.which("opencode")
    if found:
        return found
    for p in _DEFAULT_BINARY_PATHS:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _pick_port() -> int:
    """Find an unused TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OpenCodeManager:
    """Manages the lifecycle of a single ``opencode web`` subprocess."""

    def __init__(
        self,
        *,
        binary: str | None = None,
        host: str = "127.0.0.1",
        port: int = 0,
        cors_origins: list[str] | None = None,
    ):
        self._binary = binary or _find_binary()
        self._host = host
        self._requested_port = port
        self._cors_origins = cors_origins or [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
        self._port: int | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._monitor_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    # -- public properties ---------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def port(self) -> int | None:
        return self._port if self.is_running else None

    # -- lifecycle -----------------------------------------------------------

    async def start(self) -> None:
        """Spawn ``opencode web`` and wait until it is healthy."""
        async with self._lock:
            if self.is_running:
                return

            if not self._binary:
                raise RuntimeError(
                    "opencode binary not found. Install it: "
                    "https://opencode.ai/docs"
                )

            port = self._requested_port or _pick_port()

            cmd = [
                self._binary,
                "web",
                "--port",
                str(port),
                "--hostname",
                self._host,
            ]
            for origin in self._cors_origins:
                cmd.extend(["--cors", origin])

            log.info("starting opencode: %s", " ".join(cmd))

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Detach from parent process group so Ctrl-C on Amethyst
                # does not also kill opencode mid-stream.
                preexec_fn=os.setpgrp,
            )
            self._port = port

            # Background task that logs stderr and detects exit.
            self._monitor_task = asyncio.create_task(
                self._monitor(), name="opencode-monitor"
            )

            # Wait for the health endpoint to respond.
            healthy = await self._wait_healthy()
            if not healthy:
                await self._kill()
                raise RuntimeError(
                    f"opencode did not become healthy within {_STARTUP_TIMEOUT}s"
                )

            log.info("opencode running on port %d (pid %d)", port, self._process.pid)

    async def stop(self) -> None:
        """Gracefully shut down the opencode process."""
        async with self._lock:
            if not self.is_running:
                return
            log.info("stopping opencode (pid %d)", self._process.pid)
            try:
                self._process.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(
                    self._process.wait(), timeout=_SHUTDOWN_TIMEOUT
                )
            except asyncio.TimeoutError:
                await self._kill()
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
                try:
                    await self._monitor_task
                except asyncio.CancelledError:
                    pass
            self._process = None
            self._port = None
            log.info("opencode stopped")

    async def ensure_running(self) -> int:
        """Start if not running; return the port."""
        if not self.is_running:
            await self.start()
        assert self._port is not None
        return self._port

    async def health_check(self) -> bool:
        """Ping the opencode health endpoint."""
        if not self._port:
            return False
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    f"http://{self._host}:{self._port}/api/health"
                )
                return r.status_code == 200
        except Exception:
            return False

    # -- internals -----------------------------------------------------------

    async def _wait_healthy(self) -> bool:
        """Poll the health endpoint until it responds or we time out."""
        deadline = asyncio.get_event_loop().time() + _STARTUP_TIMEOUT
        while asyncio.get_event_loop().time() < deadline:
            if self._process and self._process.returncode is not None:
                return False
            if await self.health_check():
                return True
            await asyncio.sleep(0.5)
        return False

    async def _kill(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.kill()
            except ProcessLookupError:
                pass
            await self._process.wait()

    async def _monitor(self) -> None:
        """Read stderr and detect unexpected exits."""
        proc = self._process
        if not proc or not proc.stderr:
            return
        try:
            async for line in proc.stderr:
                text = line.decode("utf-8", errors="replace").rstrip()
                if text:
                    log.debug("[opencode] %s", text)
        except asyncio.CancelledError:
            return
        code = proc.returncode
        if code is not None and code != 0:
            log.warning("opencode exited unexpectedly with code %d", code)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_manager: OpenCodeManager | None = None


def get_manager() -> OpenCodeManager:
    """Return (and lazily create) the global OpenCodeManager."""
    global _manager
    if _manager is None:
        _manager = OpenCodeManager()
    return _manager
