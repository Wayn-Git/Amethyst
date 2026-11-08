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
import hmac
import io
import json
import logging
import os
import secrets
import threading
import time
from typing import Any

import segno

from backend.config import configured_providers, load_drive_inbox_settings, load_tiers
from backend.db.connection import get_connection, transaction
from backend.mcp.composio_service import composio_service
from backend.pairing.cert import get_or_create_tls_cert
from backend.pairing.config import (
    get_phone_composio_config,
    get_phone_llm_config,
    get_use_separate_keys,
    has_phone_llm_key,
)
from backend.pairing.network import get_lan_ipv4_addresses
from backend.pairing.server import PairingServer
from backend.secrets import resolve_api_key

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
        self._last_code: str | None = None
        self._last_bundle: dict[str, Any] | None = None
        self._last_hosts: list[str] = []
        self._last_port: int | None = None
        self._last_qr_payload: dict[str, Any] | None = None
        self._last_qr_base64: str | None = None

    def start_pairing(self) -> dict[str, Any]:
        """Start CONTRACT v2 pairing session.

        Raises:
            ValueError: If phone-only LLM API key is missing.
        """
        # When separate phone-only keys setting is ON, block pairing if they're missing.
        # Default is OFF, where pairing auto-captures existing PC configuration.
        if get_use_separate_keys():
            if not has_phone_llm_key():
                raise ValueError(
                    "Phone-only LLM API key is required when separate keys are enabled. "
                    "Please configure a dedicated phone LLM key in Settings."
                )

            phone_composio_cfg = get_phone_composio_config()
            if not phone_composio_cfg["api_key"] or not phone_composio_cfg["user_id"]:
                if not phone_composio_cfg["api_key"] and not phone_composio_cfg["user_id"]:
                    raise ValueError(
                        "Phone-only Composio API key and User ID are required when separate keys are enabled. "
                        "Please configure dedicated phone Composio credentials in Settings."
                    )
                if not phone_composio_cfg["api_key"]:
                    raise ValueError(
                        "Phone-only Composio API key is required when separate keys are enabled. "
                        "Please configure a dedicated phone Composio API key in Settings."
                    )
                raise ValueError(
                    "Phone-only Composio User ID is required when separate keys are enabled. "
                    "Please configure a dedicated phone Composio User ID in Settings."
                )

        with self._lock:
            # Terminate any existing server
            if self._server and not self._server.is_closed:
                self._server.close()
                self._server = None

            # 1. 128-bit random token CSPRNG (16 bytes = 32 hex chars) & 6-digit numeric code
            token = secrets.token_hex(16)
            self._last_token = token
            code = f"{secrets.randbelow(900000) + 100000}"
            self._last_code = code
            self._last_bundle = None

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
                "code": code,
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
                "code": code,
                "port": server.port,
                "hosts": hosts,
                "exp": exp,
                "expires_in": 120,
            }

    def _get_shared_credentials_preview(self) -> dict[str, Any]:
        """Summarize what will be shared upon approval WITHOUT exposing any secret values."""
        if get_use_separate_keys():
            phone_cfg = get_phone_llm_config()
            phone_composio = get_phone_composio_config()
            return {
                "shared_providers": [
                    {
                        "provider": phone_cfg["provider"],
                        "model": phone_cfg["model"],
                    }
                ],
                "composio_user_id": phone_composio.get("user_id", ""),
            }

        configured = configured_providers()
        tiers = load_tiers()
        default_tier = tiers.get("default")

        providers = []
        for name, cfg in configured.items():
            model = (
                default_tier.model
                if (default_tier and default_tier.provider == name and default_tier.model)
                else (cfg.default_model or "")
            )
            providers.append({
                "provider": name,
                "model": model,
            })

        composio_uid = (
            composio_service._get_stable_user_id()
            if hasattr(composio_service, "_get_stable_user_id")
            else ""
        )
        return {
            "shared_providers": providers,
            "composio_user_id": composio_uid,
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
                preview = self._get_shared_credentials_preview()
                return {
                    "status": "pending_approval",
                    "device_label": server.pending_device_label,
                    "remaining_seconds": remaining,
                    "shared_providers": preview["shared_providers"],
                    "composio_user_id": preview["composio_user_id"],
                    "warning": "This phone will be able to use these keys. If it is lost, rotate them.",
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

            if get_use_separate_keys():
                phone_cfg = get_phone_llm_config()
                phone_composio_cfg = get_phone_composio_config()
                if not phone_cfg.get("api_key"):
                    raise ValueError("Phone-only LLM API key is missing.")
                if not phone_composio_cfg.get("api_key") or not phone_composio_cfg.get("user_id"):
                    raise ValueError(
                        "Phone-only Composio credentials (API key and User ID) are missing."
                    )

                llm_bundle = {
                    "providers": [
                        {
                            "provider": phone_cfg["provider"],
                            "model": phone_cfg["model"],
                            "api_key": phone_cfg["api_key"],
                        }
                    ],
                    "default": 0,
                    "provider": phone_cfg["provider"],
                    "model": phone_cfg["model"],
                    "api_key": phone_cfg["api_key"],
                }
                composio_bundle = {
                    "api_key": phone_composio_cfg["api_key"],
                    "user_id": phone_composio_cfg["user_id"],
                }
                shared_providers_list = [phone_cfg["provider"], "composio"]
            else:
                configured = configured_providers()
                tiers = load_tiers()
                default_tier = tiers.get("default")

                if default_tier and default_tier.provider in configured:
                    default_provider_name = default_tier.provider
                    default_model = default_tier.model
                    default_api_key = (
                        resolve_api_key(
                            ref=configured[default_tier.provider].api_key_ref,
                            env=configured[default_tier.provider].api_key_env,
                        )
                        or ""
                    )
                elif configured:
                    first_name = next(iter(configured))
                    first_cfg = configured[first_name]
                    default_provider_name = first_name
                    default_model = first_cfg.default_model or ""
                    default_api_key = (
                        resolve_api_key(
                            ref=first_cfg.api_key_ref,
                            env=first_cfg.api_key_env,
                        )
                        or ""
                    )
                else:
                    default_provider_name = ""
                    default_model = ""
                    default_api_key = ""

                default_idx = 0
                providers_list = []
                for idx, (name, cfg) in enumerate(configured.items()):
                    if name == default_provider_name:
                        default_idx = idx
                    p_key = resolve_api_key(ref=cfg.api_key_ref, env=cfg.api_key_env) or ""
                    p_model = (
                        default_tier.model
                        if (default_tier and default_tier.provider == name and default_tier.model)
                        else (cfg.default_model or "")
                    )
                    item = {
                        "provider": name,
                        "model": p_model,
                        "api_key": p_key,
                    }
                    if cfg.base_url:
                        item["base_url"] = cfg.base_url
                    providers_list.append(item)

                llm_bundle = {
                    "providers": providers_list,
                    "default": default_idx,
                    "provider": default_provider_name,
                    "model": default_model,
                    "api_key": default_api_key,
                }

                main_composio_key = composio_service.get_api_key() or ""
                main_composio_uid = (
                    composio_service._get_stable_user_id()
                    if hasattr(composio_service, "_get_stable_user_id")
                    else ""
                )
                if not main_composio_key or not main_composio_uid:
                    phone_composio = get_phone_composio_config()
                    if not main_composio_key:
                        main_composio_key = phone_composio.get("api_key") or ""
                    if not main_composio_uid:
                        main_composio_uid = phone_composio.get("user_id") or ""

                composio_bundle = {
                    "api_key": main_composio_key,
                    "user_id": main_composio_uid,
                }
                shared_providers_list = [p["provider"] for p in providers_list]
                if main_composio_key or main_composio_uid:
                    shared_providers_list.append("composio")

            from backend.sync.devices import DEFAULT_PERMISSIONS

            paired_permissions = dict(DEFAULT_PERMISSIONS)
            paired_permissions.update({
                "terminal": True,
                "screen": True,
                "system": True,
                "clipboard": True,
                "files": True,
                "audio": True,
                "power": True,
                "input": True,
                "library": True,
                "agent": True,
                "dashboard": True,
                "shared_providers": shared_providers_list,
            })
            # Record in devices table with standard companion permissions & metadata
            permissions_json = json.dumps(paired_permissions)
            conn = get_connection()
            with transaction(conn):
                conn.execute(
                    """
                    INSERT INTO devices (id, name, role, token_hash, permissions, created_at)
                    VALUES (?, ?, 'control', ?, ?, datetime('now'))
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        token_hash = excluded.token_hash,
                        permissions = excluded.permissions,
                        revoked_at = NULL,
                        last_seen_at = datetime('now')
                    """,
                    (device_id, label, token_hash, permissions_json),
                )

            drive_cfg = load_drive_inbox_settings()
            root_id = drive_cfg.root_folder_id or ""
            inbox_id = drive_cfg.inbox_folder_id or ""
            if not inbox_id and root_id:
                inbox_id = root_id

            main_port = int(os.environ.get("AMETHYST_BIND_PORT", "8000").strip() or "8000")
            bundle = {
                "device_id": device_id,
                "token": server.token,
                "hosts": self._last_hosts,
                "api_port": main_port,
                "llm": llm_bundle,
                "composio": composio_bundle,
                "drive": {
                    "root_folder_id": root_id,
                    "inbox_folder_id": inbox_id,
                },
                "prompts": {
                    "summary": DEFAULT_SUMMARY_PROMPT,
                },
            }

            from backend.auth import microsoft
            ms_status = microsoft.get_connection_status()
            if ms_status.get("connected"):
                ms_bundle = microsoft.get_token_bundle_for_handoff()
                if ms_bundle and ms_bundle.get("refresh_token"):
                    bundle["microsoft"] = ms_bundle

            self._last_bundle = bundle

            # Unblock phone response
            server.approve(bundle)

            return {
                "ok": True,
                "device_id": device_id,
                "device_label": label,
            }

    def confirm_pairing(self, device_id: str | None = None, token: str | None = None) -> dict[str, Any]:
        """Acknowledge pairing bundle receipt from phone, safely triggering one-way token handoff."""
        with self._lock:
            valid = False
            if token and self._last_token and hmac.compare_digest(token, self._last_token):
                valid = True
            elif device_id:
                conn = get_connection()
                row = conn.execute("SELECT id FROM devices WHERE id = ?", (device_id,)).fetchone()
                if row:
                    valid = True

            if not valid and (token or device_id):
                raise ValueError("Invalid pairing confirmation token or device_id")

            from backend.auth import microsoft
            microsoft.relinquish_refresh_token_after_handoff()

            if self._server and not self._server.is_closed:
                self._server.close_async()

            return {"ok": True}

    def claim_code(self, code: str, device_label: str | None = None) -> dict[str, Any]:
        """Claim a pairing session using a 6-digit numeric code."""
        with self._lock:
            server = self._server
            if not server or server.is_closed or time.time() >= server.exp:
                raise ValueError("No active pairing session or session has expired")

            clean_code = str(code).strip().replace("-", "").replace(" ", "")
            if not self._last_code or not hmac.compare_digest(clean_code, self._last_code):
                server.bad_attempts += 1
                if server.bad_attempts >= 5:
                    server.close()
                    raise ValueError("Too many failed attempts. Pairing locked out.")
                raise ValueError("Invalid pairing code. Check code on PC.")

            label = (device_label or "Mobile Companion").strip()
            server.pending_device_label = label
            return {
                "ok": True,
                "status": "waiting_approval",
                "device_label": label,
            }

    def get_code_status(self, code: str) -> dict[str, Any]:
        """Check status of a code-based claim."""
        with self._lock:
            server = self._server
            clean_code = str(code).strip().replace("-", "").replace(" ", "")
            if not self._last_code or not hmac.compare_digest(clean_code, self._last_code):
                return {"status": "invalid"}

            if self._last_bundle:
                return {
                    "status": "approved",
                    "bundle": self._last_bundle,
                }

            if not server or server.is_closed or time.time() >= server.exp:
                return {"status": "expired"}

            if server.pending_device_label:
                return {"status": "waiting_approval"}

            return {"status": "waiting_for_phone"}

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
        """Revoke a paired device locally and return checklist of shared provider keys."""
        conn = get_connection()
        row = conn.execute("SELECT permissions FROM devices WHERE id = ?", (device_id,)).fetchone()
        shared_providers: list[str] = []
        if row and row["permissions"]:
            try:
                perms = json.loads(row["permissions"])
                if isinstance(perms, dict) and "shared_providers" in perms:
                    shared_providers = perms["shared_providers"]
            except Exception:
                pass

        if not shared_providers:
            configured = configured_providers()
            shared_providers = list(configured.keys())
            if composio_service.get_api_key():
                shared_providers.append("composio")

        with transaction(conn):
            cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
            deleted = cur.rowcount > 0

        providers_str = (
            ", ".join(
                p if isinstance(p, str) else f"{p.get('provider', '')} ({p.get('model', '')})"
                for p in shared_providers
            )
            if shared_providers
            else "none"
        )

        return {
            "ok": True,
            "device_id": device_id,
            "forgotten_locally": deleted,
            "shared_providers": shared_providers,
            "checklist": [
                {
                    "provider": p if isinstance(p, str) else p.get("provider", str(p)),
                    "rotated": False,
                }
                for p in shared_providers
            ],
            "reminder": (
                "Revoking on this computer forgets the device locally, but does NOT rotate or delete any API keys. "
                f"Keys for the following services were shared: {providers_str}. "
                "Please manually rotate or delete them at your providers."
            ),
        }


pairing_service = PairingService()
