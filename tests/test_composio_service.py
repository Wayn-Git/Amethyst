from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
import pytest

from backend.mcp.composio_service import ComposioService


def test_composio_service_api_key_lifecycle():
    service = ComposioService()
    service.set_api_key("comp_test_123456789")
    assert service.get_api_key() == "comp_test_123456789"
    assert service.is_configured() is True

    service.delete_api_key()
    assert service.get_api_key() is None
    assert service.is_configured() is False


def test_composio_service_session_creation_and_caching():
    service = ComposioService()
    service.set_api_key("comp_test_key")

    mock_mcp = MagicMock()
    mock_mcp.url = "https://mcp.composio.dev/session_123"
    mock_mcp.headers = {"x-api-key": "comp_test_key"}

    mock_session = MagicMock()
    mock_session.session_id = "session_123"
    mock_session.mcp = mock_mcp

    mock_composio = MagicMock()
    mock_composio.sessions.create.return_value = mock_session
    mock_composio.use.return_value = mock_session

    with patch.object(service, "_get_client", return_value=mock_composio):
        session = service.get_or_create_session(enabled_toolkits=["slack", "github"])
        assert session.session_id == "session_123"
        mock_composio.sessions.create.assert_called_once()
        call_kwargs = mock_composio.sessions.create.call_args.kwargs
        assert call_kwargs.get("mcp") is True
        assert call_kwargs.get("toolkits") == {"enable": ["slack", "github"]}

        # Second call should resume cached session
        mock_composio.sessions.create.reset_mock()
        resumed = service.get_or_create_session()
        assert resumed.session_id == "session_123"
        mock_composio.use.assert_called_once_with("session_123", mcp=True)


def test_composio_service_mcp_config():
    service = ComposioService()
    service.set_api_key("comp_test_key")

    mock_mcp = MagicMock()
    mock_mcp.url = "https://mcp.composio.dev/session_123"
    mock_mcp.headers = {"x-api-key": "comp_test_key"}

    mock_session = MagicMock()
    mock_session.session_id = "session_123"
    mock_session.mcp = mock_mcp

    mock_composio = MagicMock()
    mock_composio.sessions.create.return_value = mock_session

    with patch.object(service, "_get_client", return_value=mock_composio):
        config = service.get_mcp_config()
        assert config is not None
        assert config["transport"] == "streamable-http"
        assert config["url"] == "https://mcp.composio.dev/session_123"
        assert config["headers"] == {"x-api-key": "comp_test_key"}


def test_composio_service_update_toolkits():
    service = ComposioService()
    service.set_api_key("comp_test_key")

    mock_session = MagicMock()
    mock_session.session_id = "session_123"

    mock_composio = MagicMock()
    mock_composio.use.return_value = mock_session

    with patch.object(service, "_get_client", return_value=mock_composio):
        # Seed an existing session
        from backend.db.connection import get_connection
        conn = get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url) VALUES (1, ?, ?, ?, ?)",
            ("session_123", "user_abc", json.dumps(["slack"]), "https://mcp.composio.dev/session_123"),
        )
        conn.commit()

        success = service.update_toolkits(["slack", "linear", "notion"])
        assert success is True
        mock_session.update.assert_called_once_with(toolkits={"enable": ["slack", "linear", "notion"]})
        assert service.get_enabled_toolkits() == ["slack", "linear", "notion"]


def test_get_connections_empty_when_unconfigured(monkeypatch):
    service = ComposioService()
    monkeypatch.setattr(service, "is_configured", lambda: False)
    assert service.get_connections() == {}


def test_get_connections_returns_active_accounts(monkeypatch):
    service = ComposioService()
    monkeypatch.setattr(service, "is_configured", lambda: True)

    class DummyItem:
        status = "ACTIVE"
        id = "ca_123"
        created_at = "2026-10-05T00:00:00Z"

        class toolkit:
            slug = "slack"

    class DummyResp:
        items = [DummyItem()]

    class DummyClient:
        class connected_accounts:
            @staticmethod
            def list(*args, **kwargs):
                return DummyResp()

    monkeypatch.setattr(service, "_get_client", lambda: DummyClient())
    conns = service.get_connections()
    assert "slack" in conns
    assert conns["slack"]["id"] == "ca_123"
    assert conns["slack"]["status"] == "ACTIVE"


def test_initiate_connection_returns_redirect_url(monkeypatch):
    service = ComposioService()
    monkeypatch.setattr(service, "is_configured", lambda: True)

    class DummyReq:
        redirect_url = "https://connect.composio.dev/auth/123"

    class DummyClient:
        class toolkits:
            @staticmethod
            def authorize(*args, **kwargs):
                return DummyReq()

    monkeypatch.setattr(service, "_get_client", lambda: DummyClient())
    url = service.initiate_connection("gmail")
    assert url == "https://connect.composio.dev/auth/123"


def test_api_composio_connections_and_toolkits(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.api.main import app
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"slack": {"id": "ca_slack", "status": "ACTIVE"}},
    )
    monkeypatch.setattr(
        composio_service,
        "initiate_connection",
        lambda tk: f"https://connect.composio.dev/{tk}",
    )

    client = TestClient(app)
    # Test GET /api/composio/connections
    resp = client.get("/api/composio/connections")
    assert resp.status_code == 200
    assert "slack" in resp.json().get("connections", {})

    # Test GET /api/composio/toolkits
    resp = client.get("/api/composio/toolkits")
    assert resp.status_code == 200
    toolkits = {t["slug"]: t for t in resp.json().get("toolkits", [])}
    assert toolkits["slack"]["connected"] is True
    assert toolkits["gmail"]["connected"] is False

    # Test POST /api/composio/toolkits/{toolkit}/connect
    resp = client.post("/api/composio/toolkits/gmail/connect")
    assert resp.status_code == 200
    assert resp.json()["redirect_url"] == "https://connect.composio.dev/gmail"


def test_sanitize_composio_key():
    from backend.mcp.composio_service import sanitize_composio_key

    assert sanitize_composio_key("  uak_abc123  ") == "uak_abc123"
    assert sanitize_composio_key('"uak_abc123"') == "uak_abc123"
    assert sanitize_composio_key("'uak_abc123'") == "uak_abc123"
    assert sanitize_composio_key('export COMPOSIO_API_KEY="uak_abc123"') == "uak_abc123"
    assert sanitize_composio_key("COMPOSIO_USER_API_KEY=uak_abc123") == "uak_abc123"
    assert sanitize_composio_key("Bearer uak_abc123") == "uak_abc123"
    assert sanitize_composio_key("") == ""
    assert sanitize_composio_key(None) == ""


def test_validate_api_key_user_key_initialization(monkeypatch):
    service = ComposioService()

    recorded_kwargs = []

    class DummyClient:
        class toolkits:
            @staticmethod
            def list():
                return []

    def mock_composio(**kwargs):
        recorded_kwargs.append(kwargs)
        return DummyClient()

    monkeypatch.setattr("composio.Composio", mock_composio)

    valid, err = service.validate_api_key(' "uak_secret_12345" ')
    assert valid is True
    assert err is None
    assert len(recorded_kwargs) == 1
    assert recorded_kwargs[0] == {"disable_api_key": True, "user_api_key": "uak_secret_12345"}


def test_validate_api_key_fallback_on_401(monkeypatch):
    service = ComposioService()

    attempts = []

    class DummyClient:
        class toolkits:
            @staticmethod
            def list():
                return []

    def mock_composio(**kwargs):
        attempts.append(kwargs)
        if "api_key" in kwargs:
            from composio_client import APIStatusError
            import httpx
            req = httpx.Request("GET", "https://backend.composio.dev/api/v3.1/toolkits")
            resp = httpx.Response(401, request=req, json={"error": {"message": "Invalid API key"}})
            raise APIStatusError("401 Unauthorized", response=resp, body={"error": {"message": "Invalid API key"}})
        return DummyClient()

    monkeypatch.setattr("composio.Composio", mock_composio)

    # Key without uak_ prefix: first attempts api_key, gets 401, then falls back to user_api_key
    valid, err = service.validate_api_key("custom_key_without_prefix")
    assert valid is True
    assert err is None
    assert len(attempts) == 2
    assert attempts[0] == {"api_key": "custom_key_without_prefix"}
    assert attempts[1] == {"disable_api_key": True, "user_api_key": "custom_key_without_prefix"}


def test_get_mcp_config_preserves_user_api_key_header():
    service = ComposioService()
    service.set_api_key("uak_test_user_key")

    mock_mcp = MagicMock()
    mock_mcp.url = "https://mcp.composio.dev/session_123"
    mock_mcp.headers = {"x-user-api-key": "uak_test_user_key"}

    mock_session = MagicMock()
    mock_session.session_id = "session_123"
    mock_session.mcp = mock_mcp

    mock_composio = MagicMock()
    mock_composio.sessions.create.return_value = mock_session

    with patch.object(service, "_get_client", return_value=mock_composio):
        config = service.get_mcp_config()
        assert config is not None
        # Does NOT add conflicting x-api-key header
        assert config["headers"] == {"x-user-api-key": "uak_test_user_key"}



