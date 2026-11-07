"""Pairing service coordinator for CONTRACT v2.

Manages the lifecycle of pairing sessions:
- Validation of phone-only LLM key
- Generating token, cert, fingerprint, and QR code (base64url JSON)
- Lifecycle of the ephemeral PairingServer
- Approval / Denial flow with bundle generation
- Local revocation of devices
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import secrets
import threading
import time
from typing import Any

import segno

from backend.config import load_drive_inbox_settings
from backend.db.connection import get_connection, transaction
from backend.mcp.composio_service import composio_service
from backend.pairing.cert import get_or_create_tls_cert
from backend.pairing.config import get_phone_llm_config, has_phone_llm_key
from backend.pairing.network import get_lan_ipv4_addresses
from backend.pairing.server import PairingServer

log = logging.getLogger(__name__)

DEFAULT_SUMMARY_PROMPT = (
    "You are a helpful assistant. Summarize content or conversations concisely, "
    "preserving key context, user requests, decisions, and actionable tasks."
)


class PairingService:
    """Singleton coordinator for PC-side CONTRACT v2 pairing."""

    def __init__(self) -> None:
        self._server: PairingServer | None = None
        self._lock = threading.Lock()
        self._last_token: str | None = None
        self._last_hosts: list[str] = []
        self._last_port: int | None = None
        self._last_qr_payload: dict[str, Any] | None = None
        self._last_qr_base64: str | None = None

    def start_pairing(self) -> dict[str, Any]:
        """Start CONTRACT v2 pairing session.

        Raises:
            ValueError: If phone-only LLM API key is missing.
        """
        # Requirement 4: Separate phone-only LLM key in settings.
        # If missing, block pairing and explain why.
        if not has_phone_llm_key():
            raise ValueError(
                "Phone-only LLM API key is required before pairing. "
                "Please configure a dedicated phone LLM key in Settings."
            )

        with self._lock:
            # Terminate any existing server
            if self._server and not self._server.is_closed:
                self._server.close()
                self._server = None

            # 1. 128-bit random token CSPRNG (16 bytes = 32 hex chars)
            token = secrets.token_hex(16)
            self._last_token = token

            # 2. LAN IPv4 detection
            hosts = get_lan_ipv4_addresses()
            if not hosts:
                hosts = ["127.0.0.1"]
            self._last_hosts = hosts

            # 3. TLS Cert & Fingerprint
            cert_path, key_path, fp = get_or_create_tls_cert(hosts=hosts)

            # 4. Expiry (2 minutes)
            exp = int(time.time()) + 120

            # 5. Start pairing server on random free port
            server = PairingServer(
                token=token,
                cert_path=cert_path,
                key_path=key_path,
                exp=exp,
                bind_host="0.0.0.0",
            )
            server.start()
            self._server = server
            self._last_port = server.port

            # 6. QR payload (JSON base64url, NO keys)
            payload = {
                "v": 2,
                "hosts": hosts,
                "port": server.port,
                "token": token,
                "fp": fp,
                "exp": exp,
            }
            self._last_qr_payload = payload

            json_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            qr_base64url = base64.urlsafe_b64encode(json_bytes).decode("ascii").rstrip("=")
            self._last_qr_base64 = qr_base64url

            # Render SVG QR
            qr_svg = ""
            try:
                buf = io.BytesIO()
                segno.make(qr_base64url, error="m").save(
                    buf, kind="svg", xmldecl=False, svgns=True, border=2, unit="", omitsize=True
                )
                qr_svg = buf.getvalue().decode("utf-8")
            except Exception as exc:
                log.warning("Could not render pairing QR SVG: %s", exc)

            return {
                "ok": True,
                "payload": payload,
                "qr": qr_base64url,
                "qr_svg": qr_svg,
                "port": server.port,
                "hosts": hosts,
                "exp": exp,
                "expires_in": 120,
            }

    def get_status(self) -> dict[str, Any]:
        """Poll the status of the active pairing server."""
        with self._lock:
            server = self._server
            if not server:
                return {"status": "idle"}

            now = time.time()
            if server.is_closed or now >= server.exp:
                return {
                    "status": "expired",
                    "remaining_seconds": 0,
                    "bad_attempts": server.bad_attempts,
                }

            remaining = max(0, int(server.exp - now))
            if server.pending_device_label:
                return {
                    "status": "pending_approval",
                    "device_label": server.pending_device_label,
                    "remaining_seconds": remaining,
                }

            return {
                "status": "waiting_for_phone",
                "remaining_seconds": remaining,
                "port": server.port,
                "hosts": self._last_hosts,
            }

    def approve_pairing(self, device_label: str | None = None) -> dict[str, Any]:
        """Approve pending pairing and deliver the bundle to the phone."""
        with self._lock:
            server = self._server
            if not server or server.is_closed or time.time() >= server.exp:
                raise ValueError("No active pairing session or session has expired")

            label = (
                device_label
                or server.pending_device_label
                or "Paired Phone"
            ).strip()

            # Generate unique device_id
            device_id = f"phone_{secrets.token_hex(8)}"
            token_hash = hashlib.sha256(server.token.encode("utf-8")).hexdigest()

            # Record in devices table
            conn = get_connection()
            with transaction(conn):
                conn.execute(
                    """
                    INSERT INTO devices (id, name, role, token_hash, permissions, created_at)
                    VALUES (?, ?, 'control', ?, '{}', datetime('now'))
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        token_hash = excluded.token_hash,
                        revoked_at = NULL,
                        last_seen_at = datetime('now')
                    """,
                    (device_id, label, token_hash),
                )

            # Build bundle according to CONTRACT v2:
            # {"device_id":"...", "llm":{provider,model,api_key}, "composio":{api_key,user_id},
            #  "drive":{root_folder_id,inbox_folder_id}, "prompts":{summary}}
            phone_cfg = get_phone_llm_config()
            drive_cfg = load_drive_inbox_settings()

            composio_key = composio_service.get_api_key() or ""
            composio_uid = (
                composio_service._get_stable_user_id()
                if hasattr(composio_service, "_get_stable_user_id")
                else ""
            )

            bundle = {
                "device_id": device_id,
                "llm": {
                    "provider": phone_cfg["provider"],
                    "model": phone_cfg["model"],
                    "api_key": phone_cfg["api_key"],
                },
                "composio": {
                    "api_key": composio_key,
                    "user_id": composio_uid,
                },
                "drive": {
                    "root_folder_id": drive_cfg.root_folder_id or "",
                    "inbox_folder_id": drive_cfg.inbox_folder_id or "",
                },
                "prompts": {
                    "summary": DEFAULT_SUMMARY_PROMPT,
                },
            }

            # Unblock phone response and trigger server shutdown
            server.approve(bundle)

            return {
                "ok": True,
                "device_id": device_id,
                "device_label": label,
            }

    def deny_pairing(self) -> dict[str, Any]:
        """Deny pending pairing and close the server."""
        with self._lock:
            server = self._server
            if not server:
                return {"ok": True, "status": "idle"}

            server.deny()
            return {"ok": True, "status": "denied"}

    def cancel_pairing(self) -> dict[str, Any]:
        """Close active pairing server."""
        with self._lock:
            if self._server:
                self._server.close()
                self._server = None
            return {"ok": True, "status": "cancelled"}

    def revoke_device(self, device_id: str) -> dict[str, Any]:
        """Revoke a paired device locally and return provider key reminder.

        Requirement 5: Revoke forgets the device locally and shows a reminder
        to delete the phone-only key at the provider. Say plainly in the UI
        that it does not rotate keys.
        """
        conn = get_connection()
        with transaction(conn):
            cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
            deleted = cur.rowcount > 0

        return {
            "ok": True,
            "device_id": device_id,
            "forgotten_locally": deleted,
            "reminder": (
                "Please remember to delete or rotate your phone-only API key in your LLM provider's console. "
                "Revoking on the PC forgets the device locally but does NOT rotate or delete keys at your provider."
            ),
        }


pairing_service = PairingService()
