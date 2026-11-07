"""Ephemeral HTTPS pairing server for CONTRACT v2.

Runs strictly while the pairing QR code is active on the PC.
- Bound to LAN interfaces on a random free port.
- HTTPS with self-signed certificate.
- Handles POST /pair.
- Enforces constant-time token comparison.
- Burns token on first valid use.
- Shuts down on success, after 5 bad attempts, or upon 2-minute expiration.
"""

from __future__ import annotations

import hmac
import http.server
import json
import logging
import ssl
import threading
import time
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)


class PairingRequestHandler(http.server.BaseHTTPRequestHandler):
    """Handles POST /pair requests from the phone companion."""

    server: PairingServer

    # Suppress default request logging to avoid leaking request noise
    def log_message(self, format: str, *args: Any) -> None:
        log.debug("PairingServer: " + format, *args)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/pair":
            self._send_json(404, {"error": "not_found"})
            return

        now = time.time()
        if now >= self.server.exp:
            self._send_json(408, {"error": "expired"})
            self.server.close_async()
            return

        with self.server.lock:
            if self.server.bad_attempts >= 5:
                self._send_json(429, {"error": "max_attempts_exceeded"})
                self.server.close_async()
                return

        # Read JSON body
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        received_token = str(payload.get("token", "")).strip()
        device_label = str(payload.get("device_label", "Phone")).strip() or "Phone"

        # Constant-time token verification
        is_valid = hmac.compare_digest(received_token, self.server.token)
        if not is_valid:
            with self.server.lock:
                self.server.bad_attempts += 1
                locked_out = self.server.bad_attempts >= 5

            if locked_out:
                self._send_json(429, {"error": "max_attempts_exceeded"})
                self.server.close_async()
            else:
                self._send_json(401, {"error": "invalid_token"})
            return

        # Token matches. Check and enforce single use.
        with self.server.lock:
            if self.server.token_burned:
                self._send_json(403, {"error": "token_already_used"})
                return

            self.server.token_burned = True
            self.server.pending_device_label = device_label
            self.server.approval_event.clear()
            self.server.approval_decision = None
            self.server.approval_bundle = None

        if self.server.on_status_change:
            self.server.on_status_change()

        # Wait for user approval in PC UI
        remaining = max(0.5, self.server.exp - time.time())
        approved = self.server.approval_event.wait(timeout=remaining)

        if not approved:
            self._send_json(408, {"error": "approval_timeout"})
            self.server.close_async()
            return

        decision = self.server.approval_decision
        if decision == "approve":
            self._send_json(200, self.server.approval_bundle or {})
            # Server closes on success per CONTRACT v2
            self.server.close_async()
        else:
            self._send_json(403, {"error": "pairing_denied"})
            self.server.close_async()


class PairingServer(http.server.ThreadingHTTPServer):
    """HTTPS pairing server for CONTRACT v2."""

    def __init__(
        self,
        token: str,
        cert_path: Path,
        key_path: Path,
        exp: int,
        bind_host: str = "0.0.0.0",
        on_status_change: Callable[[], None] | None = None,
    ) -> None:
        super().__init__((bind_host, 0), PairingRequestHandler)
        self.token = token
        self.exp = exp
        self.bad_attempts = 0
        self.token_burned = False
        self.is_closed = False
        self.lock = threading.Lock()
        self.approval_event = threading.Event()
        self.pending_device_label: str | None = None
        self.approval_decision: str | None = None
        self.approval_bundle: dict[str, Any] | None = None
        self.on_status_change = on_status_change

        # Wrap socket in TLS
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        self.socket = context.wrap_socket(self.socket, server_side=True)

        self.port = self.server_address[1]
        self._thread: threading.Thread | None = None
        self._timer: threading.Timer | None = None

    def start(self) -> None:
        """Start listening in background thread and set expiry timer."""
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()

        remaining = max(0.0, self.exp - time.time())
        self._timer = threading.Timer(remaining, self._on_expiry)
        self._timer.daemon = True
        self._timer.start()

    def _on_expiry(self) -> None:
        with self.lock:
            if self.is_closed:
                return
        log.info("PairingServer: 2-minute window expired, closing")
        self.approval_event.set()
        self.close_async()
        if self.on_status_change:
            self.on_status_change()

    def approve(self, bundle: dict[str, Any]) -> None:
        """User on PC approved the pairing request."""
        with self.lock:
            self.approval_decision = "approve"
            self.approval_bundle = bundle
            self.approval_event.set()

    def deny(self) -> None:
        """User on PC denied the pairing request."""
        with self.lock:
            self.approval_decision = "deny"
            self.approval_bundle = None
            self.approval_event.set()

    def close_async(self) -> None:
        """Shut down the server asynchronously to prevent handler deadlock."""
        threading.Thread(target=self.close, daemon=True).start()

    def close(self) -> None:
        """Shut down the server and close socket."""
        with self.lock:
            if self.is_closed:
                return
            self.is_closed = True

        if self._timer:
            self._timer.cancel()
            self._timer = None

        try:
            self.shutdown()
        except Exception:
            pass

        try:
            self.server_close()
        except Exception:
            pass

        log.info("PairingServer: closed")
