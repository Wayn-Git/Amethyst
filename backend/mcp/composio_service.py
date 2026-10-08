"""Composio service integration and session lifecycle manager.

Manages persistent Composio sessions with hosted MCP endpoints, scopes toolkits
via explicit allowlists to prevent prompt bloat, and provides connection details
to Amethyst's MCP manager.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

from backend import secrets
from backend.db.connection import get_connection

log = logging.getLogger(__name__)

SECRET_KEY_REF = "amethyst/composio"
DEFAULT_TOOLKITS = ["slack", "github", "linear", "notion", "gmail"]


def sanitize_composio_key(raw: str | None) -> str:
    """Clean and normalize a pasted Composio API key.

    Strips surrounding whitespace, quotes, shell prefixes like 'export',
    common environment variable names ('COMPOSIO_API_KEY='), and 'Bearer'.
    """
    cleaned = (raw or "").strip()
    if cleaned.startswith("export "):
        cleaned = cleaned[7:].strip()
    for prefix in (
        "COMPOSIO_API_KEY=",
        "COMPOSIO_USER_API_KEY=",
        "COMPOSIO_ORG_API_KEY=",
    ):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    return cleaned.strip("'\"").strip()


def _extract_composio_error_message(exc: Exception) -> str | None:
    """Extract a descriptive error message from a Composio SDK or HTTP error."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        if isinstance(err, str):
            return err
    msg = getattr(exc, "message", None) or str(exc)
    return str(msg) if msg else None


NON_OAUTH_TOOLKITS: list[dict[str, Any]] = [
    {
        "slug": "web_scraper",
        "name": "Web Scraper",
        "description": "Scrape and extract clean text from any webpage or article.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "calculator",
        "name": "Calculator",
        "description": "Evaluate mathematical equations and perform numeric computations.",
        "category": "Utilities",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "weather",
        "name": "Weather",
        "description": "Get real-time weather reports and forecasts for locations worldwide.",
        "category": "Utilities",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "hackernews",
        "name": "Hacker News",
        "description": "Browse frontpage stories, comments, and search Hacker News.",
        "category": "Knowledge",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "wikipedia",
        "name": "Wikipedia",
        "description": "Search and retrieve encyclopedia summaries and structured sections.",
        "category": "Knowledge",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "duckduckgo",
        "name": "DuckDuckGo Search",
        "description": "Privacy-focused web search for links, snippets, and answers.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "sql",
        "name": "SQL Tool",
        "description": "Execute queries and inspect database schemas directly.",
        "category": "Developer Tools",
        "no_auth": True,
        "auth_type": "none",
    },
]

OAUTH_TOOLKITS: list[dict[str, Any]] = [
    {
        "slug": "slack",
        "name": "Slack",
        "description": "Send messages, manage channels, and search workspace history.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "github",
        "name": "GitHub",
        "description": "Manage repositories, issues, pull requests, and git workflows.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "linear",
        "name": "Linear",
        "description": "Track issues, cycles, projects, and roadmaps.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "notion",
        "name": "Notion",
        "description": "Search workspace pages, read databases, and update documents.",
        "category": "Knowledge",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "gmail",
        "name": "Gmail",
        "description": "Send emails, search inbox, and manage threads.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "googlecalendar",
        "name": "Google Calendar",
        "description": "Schedule events, check availability, and manage calendars.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "jira",
        "name": "Jira",
        "description": "Create and update issues in Atlassian Jira.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "asana",
        "name": "Asana",
        "description": "Manage tasks, projects, and team workflows.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "spotify",
        "name": "Spotify",
        "description": "Control playback, search music, and manage playlists.",
        "category": "Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
]


def is_no_auth_toolkit(toolkit_slug: str) -> bool:
    """Return True if the toolkit is a Direct Tool requiring no user OAuth setup."""
    slug = toolkit_slug.strip().lower()
    return any(item["slug"] == slug for item in NON_OAUTH_TOOLKITS)


def get_toolkits_catalog() -> list[dict[str, Any]]:
    """Return unified catalog of all supported Composio toolkits."""
    return [dict(t) for t in (NON_OAUTH_TOOLKITS + OAUTH_TOOLKITS)]


def _validate_consumer_key(key: str) -> tuple[bool, str | None]:
    """Validate a consumer key against Composio Connect MCP gateway."""
    try:
        import httpx

        url = "https://connect.composio.dev/mcp"
        headers = {
            "x-consumer-api-key": key,
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        }
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "amethyst-validator", "version": "1.0.0"},
            },
        }
        resp = httpx.post(url, headers=headers, json=body, timeout=10.0)
        if resp.status_code == 200:
            return True, None

        if resp.status_code in (401, 403):
            reason = resp.headers.get("x-mcp-auth-failure-reason")
            if not reason:
                try:
                    data = resp.json()
                    reason = data.get("error", {}).get("message") or data.get("message")
                except Exception:
                    pass
            msg = (
                f"Invalid Composio Consumer Key: {reason}"
                if reason
                else "Invalid Composio Consumer Key. Key was rejected by Composio Connect."
            )
            return False, msg

        return False, f"Composio Connect returned status {resp.status_code}: {resp.text[:200]}"
    except Exception as exc:
        log.warning("Composio consumer key probe failed: %s", exc)
        return False, f"Could not reach Composio Connect MCP gateway: {exc}"


class ComposioService:
    """Manages credentials, sessions, and hosted MCP configuration for Composio."""

    def __init__(self) -> None:
        self._cached_client: Any = None
        self._connections_cache: tuple[float, dict[str, Any]] | None = None
        self._key_mode: str | None = None

    def _detect_key_mode(self, key: str) -> str:
        k = key.strip()
        if k.startswith(("ck_", "ck-")):
            return "consumer"
        if k.startswith(("uak_", "uak-")):
            return "user"
        if k.startswith(("oak_", "oak-")):
            return "org"
        return "project"

    def get_key_mode(self) -> str:
        """Get the active key mode ('consumer', 'user', 'org', or 'project')."""
        if getattr(self, "_key_mode", None):
            return self._key_mode
        try:
            conn = get_connection()
            row = conn.execute("SELECT key_mode FROM composio_state WHERE id = 1").fetchone()
            if row and row["key_mode"]:
                self._key_mode = str(row["key_mode"])
                return self._key_mode
        except Exception:
            pass

        key = self.get_api_key()
        if key:
            mode = self._detect_key_mode(key)
            self._key_mode = mode
            return mode
        return "project"

    def _client_kwargs_for_key(self, key: str) -> dict[str, Any]:
        """Produce the appropriate Composio constructor kwargs for a key."""
        cleaned = sanitize_composio_key(key)
        mode = self.get_key_mode()
        if mode == "user" or (mode is None and cleaned.startswith(("uak_", "uak-"))):
            return {"disable_api_key": True, "user_api_key": cleaned}
        if mode == "org" or (mode is None and cleaned.startswith(("oak_", "oak-"))):
            return {"disable_api_key": True, "user_api_key": cleaned, "org_api_key": cleaned}
        return {"api_key": cleaned}

    def get_api_key(self) -> str | None:
        """Retrieve the configured Composio API key from environment or keychain."""
        from_env = (
            os.environ.get("COMPOSIO_API_KEY", "").strip()
            or os.environ.get("COMPOSIO_USER_API_KEY", "").strip()
            or os.environ.get("COMPOSIO_CONSUMER_API_KEY", "").strip()
        )
        if from_env:
            return sanitize_composio_key(from_env)
        secret = secrets.get_secret(SECRET_KEY_REF)
        return sanitize_composio_key(secret) if secret else None

    def set_api_key(self, key: str, mode: str | None = None) -> bool:
        """Store the Composio API key in the OS keychain and persist key_mode to database."""
        cleaned = sanitize_composio_key(key)
        if not cleaned:
            return False
        secrets.set_secret(SECRET_KEY_REF, cleaned)
        self._cached_client = None
        self._connections_cache = None

        target_mode = mode or getattr(self, "_key_mode", None) or self._detect_key_mode(cleaned)
        self._key_mode = target_mode

        conn = get_connection()
        conn.execute(
            """
            INSERT INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, key_mode, updated_at)
            VALUES (1, '', '', '[]', '', ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                key_mode = excluded.key_mode,
                session_id = '',
                mcp_url = '',
                updated_at = excluded.updated_at
            """,
            (target_mode,),
        )
        conn.commit()
        return True

    def validate_api_key(self, key: str) -> tuple[bool, str | None]:
        """Verify that the API key is accepted by the appropriate Composio API."""
        cleaned = sanitize_composio_key(key)
        if not cleaned:
            return False, "API key cannot be empty"

        # Consumer keys (ck_*) target the Composio Connect MCP gateway directly
        if cleaned.startswith(("ck_", "ck-")):
            valid, err = _validate_consumer_key(cleaned)
            if valid:
                self._key_mode = "consumer"
                return True, None
            return False, err

        try:
            from composio import Composio
        except ImportError:
            return False, "Composio package is not installed. Please install 'composio>=0.22.0'."

        # Candidate client initializations to try in order of likelihood
        if cleaned.startswith(("uak_", "uak-")):
            candidates = [
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("project", lambda k: Composio(api_key=k)),
            ]
        elif cleaned.startswith(("oak_", "oak-")):
            candidates = [
                ("org", lambda k: Composio(disable_api_key=True, user_api_key=k, org_api_key=k)),
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("project", lambda k: Composio(api_key=k)),
            ]
        else:
            candidates = [
                ("project", lambda k: Composio(api_key=k)),
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("consumer", None),
            ]

        last_exc: Exception | None = None
        for mode, factory in candidates:
            if mode == "consumer":
                valid, _ = _validate_consumer_key(cleaned)
                if valid:
                    self._key_mode = "consumer"
                    return True, None
                continue

            try:
                client = factory(cleaned)
                # Lightweight API call to verify key credentials
                client.toolkits.list()
                self._key_mode = mode
                return True, None
            except Exception as exc:
                last_exc = exc
                exc_name = type(exc).__name__
                exc_str = str(exc)
                if "AuthenticationError" not in exc_name and "401" not in exc_str:
                    break

        if last_exc is not None:
            detail = _extract_composio_error_message(last_exc)
            if "AuthenticationError" in type(last_exc).__name__ or "401" in str(last_exc):
                if detail:
                    return False, f"Invalid Composio API key: {detail}"
                return False, "Invalid Composio API key. Please check your credentials."
            log.warning("Composio API key validation check failed: %s", detail or last_exc)
            return False, f"Composio validation error: {detail or last_exc}"

        return False, "Invalid Composio API key. Please check your credentials."

    def delete_api_key(self) -> None:
        """Remove the Composio API key and clear local session state."""
        secrets.delete_secret(SECRET_KEY_REF)
        self._cached_client = None
        self._connections_cache = None
        self._key_mode = None
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
        if self._cached_client is not None:
            return self._cached_client
        try:
            from composio import Composio

            kwargs = self._client_kwargs_for_key(key)
            client = Composio(**kwargs)
            self._cached_client = client
            return client
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
            INSERT INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, updated_at)
            VALUES (1, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                user_id = excluded.user_id,
                enabled_toolkits = excluded.enabled_toolkits,
                mcp_url = excluded.mcp_url,
                updated_at = excluded.updated_at
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
        key = self.get_api_key()
        if not key:
            return None

        mode = self.get_key_mode()
        if mode == "consumer" or key.startswith(("ck_", "ck-")):
            return {
                "transport": "streamable-http",
                "url": "https://connect.composio.dev/mcp",
                "headers": {
                    "x-consumer-api-key": key,
                },
            }

        try:
            session = self.get_or_create_session()
            mcp_info = getattr(session, "mcp", None)
            if not mcp_info or not getattr(mcp_info, "url", None):
                return None
            headers = dict(getattr(mcp_info, "headers", {}) or {})
            has_auth = any(
                k.lower() in ("x-api-key", "x-user-api-key", "x-org-api-key", "authorization", "x-consumer-api-key")
                for k in headers
            )
            if not has_auth:
                if key.startswith(("uak_", "uak-")):
                    headers["x-user-api-key"] = key
                elif key.startswith(("oak_", "oak-")):
                    headers["x-org-api-key"] = key
                else:
                    headers["x-api-key"] = key
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
                "key_mode": "project",
                "session_id": None,
                "enabled_toolkits": [],
                "error": None,
            }
        mode = self.get_key_mode()
        if mode == "consumer":
            return {
                "configured": True,
                "active": True,
                "key_mode": "consumer",
                "session_id": "connect-gateway",
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": None,
            }
        try:
            session = self.get_or_create_session()
            mcp_info = getattr(session, "mcp", None)
            mcp_url = getattr(mcp_info, "url", None)
            return {
                "configured": True,
                "active": bool(mcp_url),
                "key_mode": mode,
                "session_id": getattr(session, "session_id", None),
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": None,
            }
        except Exception as exc:
            return {
                "configured": True,
                "active": False,
                "key_mode": mode,
                "session_id": None,
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": str(exc),
            }

    def get_connections(self, force: bool = False) -> dict[str, dict[str, Any]]:
        """Return dict of {toolkit_slug: connection_details} for ACTIVE accounts only."""
        if not self.is_configured():
            return {}
        now = time.monotonic()
        if not force and self._connections_cache is not None and now < self._connections_cache[0]:
            return self._connections_cache[1]

        mode = self.get_key_mode()
        active: dict[str, dict[str, Any]] = {}

        if mode != "consumer":
            try:
                client = self._get_client()
                user_id = self._get_stable_user_id()
                try:
                    accounts = client.connected_accounts.list(user_ids=[user_id], statuses=["ACTIVE"])
                except Exception as exc:
                    log.debug("User-scoped connection list failed, querying project connections: %s", exc)
                    accounts = client.connected_accounts.list(statuses=["ACTIVE"])
                for item in getattr(accounts, "items", []):
                    toolkit = getattr(item, "toolkit", None)
                    slug = getattr(toolkit, "slug", None) if toolkit else None
                    if not slug and isinstance(toolkit, str):
                        slug = toolkit
                    status = getattr(item, "status", "")
                    if slug and (status == "ACTIVE" or not status):
                        active[str(slug).lower()] = {
                            "id": getattr(item, "id", ""),
                            "status": status or "ACTIVE",
                            "created_at": getattr(item, "created_at", None),
                        }
            except Exception as exc:
                log.warning("Failed to fetch Composio connected accounts: %s", exc)

        self._connections_cache = (now + 5.0, active)
        return active

    def initiate_connection(self, toolkit: str) -> str:
        """Initiate hosted OAuth authorization with Composio and return redirect URL."""
        if not self.is_configured():
            raise RuntimeError("Composio API key is not configured.")
        client = self._get_client()
        user_id = self._get_stable_user_id()
        req = client.toolkits.authorize(user_id=user_id, toolkit=toolkit.lower())
        redirect_url = getattr(req, "redirect_url", None)
        if not redirect_url and hasattr(req, "connection_data"):
            val = getattr(req.connection_data, "val", None)
            if val:
                redirect_url = getattr(val, "redirect_url", None)
        if not redirect_url:
            raise RuntimeError(f"Could not retrieve redirect authorization URL for '{toolkit}'.")
        return str(redirect_url)


composio_service = ComposioService()
