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
    os.path.expanduser("~/.local/bin/opencode"),
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
    "/opt/homebrew/bin/opencode",
    os.path.expanduser("~/.npm-global/bin/opencode"),
    os.path.expandvars(r"%APPDATA%\npm\opencode.cmd") if os.name == "nt" else "",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\opencode\opencode.exe") if os.name == "nt" else "",
]

_STARTUP_TIMEOUT = 30  # seconds to wait for opencode to become healthy
_SHUTDOWN_TIMEOUT = 5  # seconds between SIGTERM and SIGKILL


def _find_binary() -> str | None:
    """Locate the ``opencode`` binary on disk across Linux, macOS, and Windows."""
    env_bin = os.environ.get("OPENCODE_BIN")
    if env_bin and os.path.isfile(env_bin) and os.access(env_bin, os.X_OK):
        return env_bin
    found = shutil.which("opencode")
    if found:
        return found
    for p in _DEFAULT_BINARY_PATHS:
        if p and os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _pick_port() -> int:
    """Find an unused TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


AMETHYST_THEME_INJECTION = """
<script id="amethyst-theme-init">
(function() {
  try {
    localStorage.setItem("opencode-color-scheme", "dark");
    document.documentElement.dataset.colorScheme = "dark";
    document.documentElement.style.backgroundColor = "#09090c";
  } catch(e) {}
})();
</script>
<style id="amethyst-theme-override">
/* ==========================================================================
   Amethyst Design System Theme Override for OpenCode
   Brings Amethyst purple accents, deep dark canvas, and typography to OpenCode
   ========================================================================== */

:root,
[data-color-scheme="dark"],
[data-theme],
body,
#root {
  /* Amethyst Dark Canvas Backgrounds */
  --v2-background-bg-deep: #09090c !important;
  --v2-background-bg-base: #0e0e12 !important;
  --v2-background-bg-layer-01: #131318 !important;
  --v2-background-bg-layer-02: #181822 !important;
  --v2-background-bg-layer-03: #1f1f2c !important;
  --v2-background-bg-layer-04: #28283a !important;
  --v2-background-bg-button-neutral: #1a1a24 !important;
  --v2-background-bg-contrast: #ffffff !important;

  /* Amethyst Purple Accents */
  --v2-background-bg-accent: #8b5cf6 !important;
  --v2-text-text-accent: #a855f7 !important;
  --v2-text-text-accent-hover: #c084fc !important;
  --v2-text-text-code-accent: #c084fc !important;
  --v2-icon-icon-accent: #a855f7 !important;
  --v2-icon-icon-accent-hover: #c084fc !important;

  /* Focus & Borders */
  --v2-border-border-base: rgba(255, 255, 255, 0.08) !important;
  --v2-border-border-muted: rgba(255, 255, 255, 0.04) !important;
  --v2-border-border-strong: rgba(255, 255, 255, 0.14) !important;
  --v2-border-border-focus: #8b5cf6 !important;

  /* Amethyst Agent Badges */
  --v2-agent-build-background: rgba(139, 92, 246, 0.14) !important;
  --v2-agent-build-border: rgba(139, 92, 246, 0.4) !important;
  --v2-agent-build-solid: #8b5cf6 !important;
  --v2-agent-plan-background: rgba(168, 85, 247, 0.14) !important;
  --v2-agent-plan-border: rgba(168, 85, 247, 0.4) !important;
  --v2-agent-plan-solid: #a855f7 !important;

  /* Amethyst Typography */
  --font-family-text: "OpenAI Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
  --v2-font-family-sans: "OpenAI Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;

  --text-mix-blend-mode: plus-lighter !important;
}

html, body, #root {
  background-color: #09090c !important;
}

/* User Text Selection */
::selection {
  background: rgba(168, 85, 247, 0.35) !important;
  color: #ffffff !important;
}

/* Override default blue buttons to Amethyst purple */
[data-color-scheme="dark"] .bg-v2-blue-600,
.bg-v2-blue-600,
.bg-blue-600 {
  background-color: #8b5cf6 !important;
}

[data-color-scheme="dark"] .bg-v2-blue-500,
.bg-v2-blue-500,
.bg-blue-500 {
  background-color: #7c3aed !important;
}

[data-color-scheme="dark"] .hover\\:bg-v2-blue-500:hover,
.hover\\:bg-blue-500:hover {
  background-color: #9333ea !important;
}

[data-color-scheme="dark"] .hover\\:bg-v2-blue-700:hover,
.hover\\:bg-blue-700:hover {
  background-color: #6d28d9 !important;
}

/* Text and Icon Accents */
[data-color-scheme="dark"] .text-v2-blue-400,
[data-color-scheme="dark"] .text-v2-blue-500,
.text-blue-400,
.text-blue-500 {
  color: #c084fc !important;
}

/* Border & Ring Focus */
[data-color-scheme="dark"] .border-v2-blue-500,
[data-color-scheme="dark"] .border-v2-blue-600,
.border-blue-500 {
  border-color: #8b5cf6 !important;
}

[data-color-scheme="dark"] .focus-visible\\:border-v2-blue-500:focus-visible {
  border-color: #8b5cf6 !important;
}

[data-color-scheme="dark"] .focus-visible\\:ring-v2-blue-500:focus-visible,
.focus-visible\\:ring-blue-500:focus-visible {
  --tw-ring-color: rgba(139, 92, 246, 0.5) !important;
}

/* Refined Amethyst scrollbars */
::-webkit-scrollbar {
  width: 6px !important;
  height: 6px !important;
}
::-webkit-scrollbar-track {
  background: transparent !important;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12) !important;
  border-radius: 9999px !important;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(168, 85, 247, 0.4) !important;
}

/* Subtle glow for the submit/arrow button when ready */
button[type="submit"]:not(:disabled) {
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.35) !important;
}
</style>
"""


async def _pipe_stream(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def _handle_proxy_client(
    c_reader: asyncio.StreamReader,
    c_writer: asyncio.StreamWriter,
    target_port: int,
) -> None:
    try:
        s_reader, s_writer = await asyncio.open_connection("127.0.0.1", target_port)
    except Exception:
        try:
            c_writer.close()
        except Exception:
            pass
        return

    try:
        initial_data = await c_reader.read(4096)
        if not initial_data:
            c_writer.close()
            s_writer.close()
            return

        first_line = initial_data.split(b"\r\n", 1)[0]
        tokens = first_line.split(b" ")
        is_get = len(tokens) >= 2 and tokens[0] == b"GET"
        raw_path = tokens[1].decode("utf-8", errors="ignore").split("?")[0] if len(tokens) >= 2 else ""

        # Static assets, events, and API endpoints should be streamed directly
        is_static_or_api = (
            raw_path.startswith("/api/")
            or raw_path.startswith("/assets/")
            or raw_path.startswith("/event")
            or any(raw_path.endswith(ext) for ext in (".js", ".css", ".png", ".svg", ".ico", ".woff", ".woff2", ".json", ".map", ".webmanifest"))
        )
        is_index = is_get and not is_static_or_api

        if not is_index:
            s_writer.write(initial_data)
            await s_writer.drain()
            await asyncio.gather(
                _pipe_stream(c_reader, s_writer),
                _pipe_stream(s_reader, c_writer),
                return_exceptions=True,
            )
            return

        # For index.html: forward request with identity encoding
        req_lines = initial_data.split(b"\r\n")
        new_req_lines = []
        for line in req_lines:
            if line.lower().startswith(b"accept-encoding:"):
                new_req_lines.append(b"Accept-Encoding: identity")
            else:
                new_req_lines.append(line)
        s_writer.write(b"\r\n".join(new_req_lines))
        await s_writer.drain()

        # Read the full HTTP response from server
        response_data = b""
        while True:
            chunk = await s_reader.read(65536)
            if not chunk:
                break
            response_data += chunk
            if b"</html>" in response_data:
                break

        s_writer.close()

        parts = response_data.split(b"\r\n\r\n", 1)
        if len(parts) == 2:
            header_bytes, body_bytes = parts
            theme_bytes = AMETHYST_THEME_INJECTION.encode("utf-8")
            if b"</head>" in body_bytes:
                body_bytes = body_bytes.replace(b"</head>", theme_bytes + b"</head>")

            headers_str = header_bytes.decode("utf-8", errors="replace")
            new_headers = []
            for line in headers_str.split("\r\n"):
                lower = line.lower()
                if lower.startswith("content-length:"):
                    new_headers.append(f"Content-Length: {len(body_bytes)}")
                elif lower.startswith("content-security-policy:"):
                    continue
                else:
                    new_headers.append(line)

            c_writer.write("\r\n".join(new_headers).encode("utf-8") + b"\r\n\r\n" + body_bytes)
            await c_writer.drain()
        else:
            c_writer.write(response_data)
            await c_writer.drain()
    except Exception:
        pass
    finally:
        try:
            c_writer.close()
        except Exception:
            pass


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
        self._raw_port: int | None = None
        self._proxy_port: int | None = None
        self._proxy_server: asyncio.Server | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._monitor_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    # -- public properties ---------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def port(self) -> int | None:
        """Returns the public (themed proxy) port when running."""
        return self._port if self.is_running else None

    @property
    def raw_port(self) -> int | None:
        """Returns the direct OpenCode server port."""
        return self._raw_port if self.is_running else None

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

            raw_port = _pick_port()

            cmd = [
                self._binary,
                "serve",
                "--port",
                str(raw_port),
                "--hostname",
                self._host,
            ]
            for origin in self._cors_origins:
                cmd.extend(["--cors", origin])

            log.info("starting opencode on raw port %d: %s", raw_port, " ".join(cmd))

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Detach from parent process group so Ctrl-C on Amethyst
                # does not also kill opencode mid-stream.
                preexec_fn=os.setpgrp,
            )
            self._raw_port = raw_port

            # Background task that logs stderr and detects exit.
            self._monitor_task = asyncio.create_task(
                self._monitor(), name="opencode-monitor"
            )

            # Wait for the health endpoint to respond on raw port.
            healthy = await self._wait_healthy()
            if not healthy:
                await self._kill()
                raise RuntimeError(
                    f"opencode did not become healthy within {_STARTUP_TIMEOUT}s"
                )

            # Start the Amethyst-themed TCP proxy
            proxy_port = self._requested_port or _pick_port()
            self._proxy_server = await asyncio.start_server(
                lambda r, w: _handle_proxy_client(r, w, raw_port),
                self._host,
                proxy_port,
            )
            self._proxy_port = proxy_port
            self._port = proxy_port

            log.info(
                "opencode running on raw port %d, themed proxy on %d (pid %d)",
                raw_port,
                proxy_port,
                self._process.pid,
            )
            asyncio.create_task(self._sync_amethyst_keys(raw_port), name="opencode-sync-keys")

    async def _sync_amethyst_keys(self, port: int) -> None:
        """Push any Amethyst configured provider keys into OpenCode."""
        try:
            import yaml
            from backend.secrets import resolve_api_key

            cfg_path = Path.home() / ".amethyst" / "config" / "providers.yaml"
            if not cfg_path.exists():
                return

            with open(cfg_path) as f:
                data = yaml.safe_load(f) or {}

            async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", timeout=5.0) as c:
                for p in data.get("providers", []):
                    name = p.get("name")
                    ref = p.get("api_key_ref")
                    env = p.get("api_key_env")
                    key = resolve_api_key(ref=ref, env=env)
                    if key and name:
                        try:
                            await c.put(f"/auth/{name}", json={"type": "api", "key": key})
                            log.info("synced Amethyst key for provider '%s' to OpenCode", name)
                        except Exception as ex:
                            log.warning("could not sync key for '%s': %s", name, ex)
        except Exception as exc:
            log.warning("failed to sync Amethyst keys to OpenCode: %s", exc)

    async def stop(self) -> None:
        """Gracefully shut down the opencode process and proxy."""
        async with self._lock:
            if self._proxy_server:
                self._proxy_server.close()
                try:
                    await self._proxy_server.wait_closed()
                except Exception:
                    pass
                self._proxy_server = None

            if not self.is_running:
                self._port = None
                self._raw_port = None
                self._proxy_port = None
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
            self._raw_port = None
            self._proxy_port = None
            log.info("opencode stopped")

    async def ensure_running(self) -> int:
        """Start if not running; return the port."""
        if not self.is_running:
            await self.start()
        assert self._port is not None
        return self._port

    async def health_check(self) -> bool:
        """Ping the opencode health endpoint."""
        target_port = self._raw_port or self._port
        if not target_port:
            return False
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    f"http://{self._host}:{target_port}/api/health"
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
        if code is not None and code != 0 and code not in (-signal.SIGTERM, -signal.SIGKILL):
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
