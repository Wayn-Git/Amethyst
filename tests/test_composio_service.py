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
