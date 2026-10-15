"""Aggregated system and setup status reporting for onboarding and health checks.

Provides the single source of truth for Amethyst setup status (R3, R4),
including model verification, local Ollama detection, keyring health,
installed runtimes, Composio connectivity, and setup completion in SQLite.
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.config import configured_providers, has_key, load_providers
from backend.db.connection import get_connection, transaction
from backend.runtime import availability
from backend.secrets import get_secret

log = logging.getLogger(__name__)

OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434"
SETUP_COMPLETED_KEY = "setup.completed_at"
SETUP_VERSION_KEY = "setup.version"


async def check_ollama(endpoint: str = OLLAMA_DEFAULT_URL) -> dict[str, Any]:
    """Check whether local Ollama is installed, running, and which models are pulled."""
    installed = shutil.which("ollama") is not None
    endpoint = endpoint.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{endpoint}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    m.get("name")
                    for m in data.get("models", [])
                    if isinstance(m, dict) and m.get("name")
                ]
                return {
                    "running": True,
                    "installed": True,
                    "models": models,
                    "endpoint": endpoint,
                }
    except Exception:
        pass

    return {
        "running": False,
        "installed": installed,
        "models": [],
        "endpoint": endpoint,
    }


def check_keychain() -> dict[str, Any]:
    """Probe whether the OS keychain or fallback file store is writable."""
    from backend.secrets import _FileStore, _store

    try:
        store = _store()
        if isinstance(store, _FileStore):
            return {
                "writable": True,
                "storage_type": "file",
                "path": str(store.path),
                "error": None,
                "fallback_available": True,
            }
        import keyring

        backend = keyring.get_keyring()
        priority = getattr(backend, "priority", 0)
        backend_name = backend.__class__.__name__.lower()
        backend_mod = backend.__class__.__module__.lower()

        if priority <= 0 or "fail" in backend_name or "fail" in backend_mod:
            return {
                "writable": False,
                "storage_type": "none",
                "path": None,
                "error": "No OS SecretService daemon or keyring backend available",
                "fallback_available": True,
            }

        return {
            "writable": True,
            "storage_type": "keyring",
            "path": None,
            "error": None,
            "fallback_available": False,
        }
    except Exception as exc:
        return {
            "writable": False,
            "storage_type": "none",
            "path": None,
            "error": str(exc),
            "fallback_available": True,
        }


def check_runtimes() -> dict[str, bool]:
    """Detect presence of connector and worker execution runtimes on PATH."""
    return {
        "npx": shutil.which("npx") is not None or shutil.which("node") is not None,
        "uvx": shutil.which("uvx") is not None or shutil.which("uv") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "opencode": shutil.which("opencode") is not None,
    }


def check_composio() -> dict[str, Any]:
    """Check whether Composio is configured and accessible."""
    key = os.environ.get("COMPOSIO_API_KEY", "").strip()
    if not key:
        with_secret = get_secret("amethyst/composio")
        if with_secret:
            key = with_secret.strip()

    return {
        "linked": bool(key),
    }


def check_setup_completion() -> dict[str, Any]:
    """Read onboarding completion timestamp and schema version from app_settings."""
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
            (SETUP_COMPLETED_KEY, SETUP_VERSION_KEY),
        ).fetchall()
        settings = dict(rows)
        completed_at = settings.get(SETUP_COMPLETED_KEY)
        version_str = settings.get(SETUP_VERSION_KEY, "1")
        version = int(version_str) if version_str.isdigit() else 1
        return {
            "completed": bool(completed_at),
            "completed_at": completed_at,
            "version": version,
        }
    except Exception as exc:
        log.warning("Could not read setup completion from app_settings: %s", exc)
        return {
            "completed": False,
            "completed_at": None,
            "version": 1,
        }


def mark_setup_complete(options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Record setup completion in SQLite app_settings and persist initial preferences."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    with transaction(conn):
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            (SETUP_COMPLETED_KEY, now_iso),
        )
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            (SETUP_VERSION_KEY, "1"),
        )
        if options:
            if "browser_enabled" in options:
                val = "1" if options["browser_enabled"] else "0"
                conn.execute(
                    "INSERT INTO app_settings (key, value) VALUES ('browser.enabled', ?)"
                    " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                    (val,),
                )
            if "tray_enabled" in options:
                val = "1" if options["tray_enabled"] else "0"
                conn.execute(
                    "INSERT INTO app_settings (key, value) VALUES ('tray.enabled', ?)"
                    " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                    (val,),
                )

    return {
        "completed": True,
        "completed_at": now_iso,
        "version": 1,
    }


async def get_setup_status(
    *,
    mcp_errors: dict[str, str] | None = None,
    active_tools_count: int | None = None,
) -> dict[str, Any]:
    """Aggregate full setup status for the wizard and health indicators."""
    providers = configured_providers()
    enabled_providers = {name: cfg for name, cfg in providers.items() if cfg.enabled}

    # Survey reachability
    reachable = await availability.survey(enabled_providers)

    primary_name = None
    primary_model = None
    verified = False

    for name, cfg in enabled_providers.items():
        avail = reachable.get(name)
        is_avail = avail.available if avail else True
        if is_avail and has_key(cfg):
            primary_name = name
            primary_model = cfg.default_model or name
            verified = True
            break

    # If local Ollama is running and has models, it can also count
    ollama_info = await check_ollama()
    if not verified and ollama_info["running"] and ollama_info["models"]:
        if "ollama" in enabled_providers:
            cfg = enabled_providers["ollama"]
            primary_name = "ollama"
            primary_model = cfg.default_model or ollama_info["models"][0]
            verified = True

    errors = mcp_errors or {}
    awaiting_sign_in = sorted(
        name
        for name, msg in errors.items()
        if "SignInRequired" in msg or "signed in" in msg
    )

    keychain_info = check_keychain()
    runtimes_info = check_runtimes()
    composio_info = check_composio()
    setup_info = check_setup_completion()

    return {
        "model": {
            "verified": verified,
            "provider": primary_name,
            "model": primary_model,
        },
        "keychain": keychain_info,
        "ollama": ollama_info,
        "runtimes": runtimes_info,
        "composio": composio_info,
        "connectors": {
            "awaiting_sign_in": awaiting_sign_in,
            "active_tools": active_tools_count if active_tools_count is not None else 0,
        },
        "setup": setup_info,
    }
