"""Tests for Composio setup flow, key validation, and reviewed read-only scopes."""

from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.dashboard.connectors import READ_SCOPES, health


@pytest.fixture
def client():
    return TestClient(app)


def test_reviewed_scopes_contract():
    """Toolkits without reviewed read-only scopes cannot connect."""
    # Reviewed read-only scopes must include core tools
    assert "gmail" in READ_SCOPES
    assert "googlecalendar" in READ_SCOPES
    assert "slack" in READ_SCOPES
    assert "github" in READ_SCOPES

    # Notion does not have reviewed read-only scopes and must not be present
    assert "notion" not in READ_SCOPES


def test_save_composio_key_invalid(client):
    """Invalid Composio key fails validation with 400 and is not stored."""
    with patch("backend.mcp.composio_service.composio_service.validate_api_key", return_value=(False, "Invalid API Key")):
        with patch("backend.mcp.composio_service.composio_service.set_api_key") as mock_set:
            res = client.post("/api/composio/key", json={"api_key": "bad_key_12345"})
            assert res.status_code == 400
            assert "Invalid API Key" in res.json()["detail"]
            mock_set.assert_not_called()


def test_save_composio_key_valid(client):
    """Valid Composio key passes validation and stores in vault."""
    with patch("backend.mcp.composio_service.composio_service.validate_api_key", return_value=(True, None)):
        with patch("backend.mcp.composio_service.composio_service.set_api_key", return_value=True) as mock_set:
            with patch("backend.api.main._apply_connector", return_value={"ok": True}):
                res = client.post("/api/composio/key", json={"api_key": "comp_live_validkey12345678"})
                assert res.status_code == 200
                assert res.json()["ok"] is True
                mock_set.assert_called_once()
