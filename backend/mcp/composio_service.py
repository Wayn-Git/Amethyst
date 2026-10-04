"""Composio service integration and session lifecycle manager.

Manages persistent Composio sessions with hosted MCP endpoints, scopes toolkits
via explicit allowlists to prevent prompt bloat, and provides connection details
to Amethyst's MCP manager.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

from backend import secrets
from backend.db.connection import get_connection

log = logging.getLogger(__name__)

SECRET_KEY_REF = "amethyst/composio"
DEFAULT_TOOLKITS = ["slack", "github", "linear", "notion", "gmail"]


class ComposioService:
    """Manages credentials, sessions, and hosted MCP configuration for Composio."""

    def __init__(self) -> None:
        self._cached_client: Any = None

    def get_api_key(self) -> str | None:
        """Retrieve the configured Composio API key from environment or keychain."""
        from_env = os.environ.get("COMPOSIO_API_KEY", "").strip()
        if from_env:
            return from_env
        return secrets.get_secret(SECRET_KEY_REF)

    def set_api_key(self, key: str) -> bool:
        """Store the Composio API key in the OS keychain and clear stale session state."""
        cleaned = key.strip()
        if not cleaned:
            return False
        secrets.set_secret(SECRET_KEY_REF, cleaned)
        self._cached_client = None
        conn = get_connection()
        conn.execute("DELETE FROM composio_state WHERE id = 1")
        conn.commit()
        return True

    def validate_api_key(self, key: str) -> tuple[bool, str | None]:
        """Verify that the API key is accepted by the Composio API."""
        cleaned = key.strip()
        if not cleaned:
            return False, "API key cannot be empty"
        try:
            from composio import Composio

            client = Composio(api_key=cleaned)
            # Lightweight API call to verify key credentials
            client.toolkits.list()
            return True, None
        except Exception as exc:
            msg = str(exc)
            if "AuthenticationError" in type(exc).__name__ or "401" in msg:
                return False, "Invalid Composio API key. Please check your credentials."
            log.warning("Composio API key validation check failed: %s", msg)
            return False, f"Composio validation error: {msg}"

    def delete_api_key(self) -> None:
        """Remove the Composio API key and clear local session state."""
        secrets.delete_secret(SECRET_KEY_REF)
        self._cached_client = None
        conn = get_connection()
        conn.execute("DELETE FROM composio_state WHERE id = 1")
        conn.commit()

    def is_configured(self) -> bool:
        """Check whether an API key is available."""
        return bool(self.get_api_key())

    def _get_client(self) -> Any:
        """Instantiate the Composio client using the modern SDK."""
        key = self.get_api_key()
        if not key:
            raise RuntimeError("Composio API key is not configured.")
        try:
            from composio import Composio

            return Composio(api_key=key)
        except ImportError as exc:
            raise RuntimeError(
                "Composio package is not installed. Please install 'composio>=0.22.0'."
            ) from exc

    def get_enabled_toolkits(self) -> list[str]:
        """Fetch list of enabled toolkit slugs from database or defaults."""
        conn = get_connection()
        row = conn.execute("SELECT enabled_toolkits FROM composio_state WHERE id = 1").fetchone()
        if row and row["enabled_toolkits"]:
            try:
                parsed = json.loads(row["enabled_toolkits"])
                if isinstance(parsed, list):
                    return parsed
            except (ValueError, TypeError):
                pass
        return list(DEFAULT_TOOLKITS)

    def _get_stable_user_id(self) -> str:
        """Generate a persistent, stable identifier for this Amethyst instance."""
        node = os.environ.get("AMETHYST_USER_ID")
        if node:
            return node
        conn = get_connection()
        row = conn.execute("SELECT user_id FROM composio_state WHERE id = 1").fetchone()
        if row and row["user_id"]:
            return row["user_id"]
        return f"amethyst_{uuid.uuid4().hex[:12]}"

    def get_or_create_session(self, enabled_toolkits: list[str] | None = None) -> Any:
        """Get the active Composio session or create a new one with mcp=True."""
        client = self._get_client()
        conn = get_connection()
        row = conn.execute("SELECT session_id, user_id, mcp_url FROM composio_state WHERE id = 1").fetchone()

        if row and row["session_id"]:
            try:
                # Resume existing session
                session = client.use(row["session_id"], mcp=True)
                return session
            except Exception as exc:
                log.warning("Could not resume Composio session %s: %s; recreating.", row["session_id"], exc)

        # Create fresh session
        user_id = row["user_id"] if row and row["user_id"] else self._get_stable_user_id()
        toolkits = enabled_toolkits if enabled_toolkits is not None else self.get_enabled_toolkits()

        session = client.sessions.create(
            user_id=user_id,
            toolkits={"enable": toolkits},
            mcp=True,
        )

        mcp_url = getattr(getattr(session, "mcp", None), "url", "")
        conn.execute(
            """
            INSERT OR REPLACE INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, updated_at)
            VALUES (1, ?, ?, ?, ?, datetime('now'))
            """,
            (session.session_id, user_id, json.dumps(toolkits), mcp_url),
        )
        conn.commit()
        return session

    def update_toolkits(self, toolkits: list[str]) -> bool:
        """Update active toolkits on the current session and persist to database."""
        client = self._get_client()
        conn = get_connection()
        row = conn.execute("SELECT session_id, user_id FROM composio_state WHERE id = 1").fetchone()

        if row and row["session_id"]:
            try:
                session = client.use(row["session_id"])
                session.update(toolkits={"enable": toolkits})
            except Exception as exc:
                log.warning("Failed to update toolkits on session %s: %s; refreshing session.", row["session_id"], exc)
                self.get_or_create_session(enabled_toolkits=toolkits)
                return True
        else:
            self.get_or_create_session(enabled_toolkits=toolkits)

        conn.execute(
            "UPDATE composio_state SET enabled_toolkits = ?, updated_at = datetime('now') WHERE id = 1",
            (json.dumps(toolkits),),
        )
        conn.commit()
        return True

    def get_mcp_config(self) -> dict[str, Any] | None:
        """Return MCP server configuration dict for Amethyst's MCP manager."""
        if not self.is_configured():
            return None
        try:
            session = self.get_or_create_session()
            mcp_info = getattr(session, "mcp", None)
            if not mcp_info or not getattr(mcp_info, "url", None):
                return None
            headers = getattr(mcp_info, "headers", {}) or {}
            if "x-api-key" not in headers:
                api_key = self.get_api_key()
                if api_key:
                    headers["x-api-key"] = api_key
            return {
                "transport": "streamable-http",
                "url": mcp_info.url,
                "headers": headers,
            }
        except Exception as exc:
            log.error("Failed to resolve Composio MCP config: %s", exc)
            return None

    def get_status(self) -> dict[str, Any]:
        """Return high-level connection and configuration status."""
        configured = self.is_configured()
        if not configured:
            return {
                "configured": False,
                "active": False,
                "session_id": None,
                "enabled_toolkits": [],
                "error": None,
            }
        try:
            session = self.get_or_create_session()
            mcp_info = getattr(session, "mcp", None)
            mcp_url = getattr(mcp_info, "url", None)
            return {
                "configured": True,
                "active": bool(mcp_url),
                "session_id": getattr(session, "session_id", None),
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": None,
            }
        except Exception as exc:
            return {
                "configured": True,
                "active": False,
                "session_id": None,
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": str(exc),
            }


composio_service = ComposioService()
