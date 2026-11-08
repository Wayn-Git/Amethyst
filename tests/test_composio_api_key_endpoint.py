import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from backend.api.main import app, _apply_connector
from backend.mcp.composio_service import ComposioService

def test_composio_status_shape(db):
    service = ComposioService()
    # Unconfigured
    with patch.object(service, "is_configured", return_value=False):
        status = service.get_status()
        assert status["configured"] is False
        assert status["connected"] is False
        assert status["active"] is False
        assert status["has_key"] is False

    # Configured
    with patch.object(service, "is_configured", return_value=True), \
         patch.object(service, "get_key_mode", return_value="user"), \
         patch.object(service, "get_enabled_toolkits", return_value=["gmail"]):
        status = service.get_status()
        assert status["configured"] is True
        assert status["connected"] is True
        assert status["active"] is True
        assert status["has_key"] is True

@pytest.mark.asyncio
async def test_apply_connector_for_composio():
    with patch("backend.mcp.composio_service.composio_service.is_configured", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.get_enabled_toolkits", return_value=["gmail", "googledrive"]):
        res = await _apply_connector("composio", True)
        assert res["connected"] is True
        assert res["error"] is None
        assert res["tools"] >= 1

def test_save_composio_key_endpoint_success(monkeypatch, db):
    client = TestClient(app)
    with patch("backend.mcp.composio_service.composio_service.validate_api_key", return_value=(True, None)), \
         patch("backend.mcp.composio_service.composio_service.set_api_key", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.is_configured", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.get_status", return_value={"configured": True, "connected": True, "active": True, "has_key": True, "error": None}), \
         patch("backend.api.main._apply_connector", new_callable=AsyncMock) as mock_apply:
        mock_apply.return_value = {"connected": True, "tools": 5, "error": None}
        response = client.post("/api/composio/key", json={"api_key": "uak_test12345678901234567890"})
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["status"]["active"] is True
        assert data["status"]["connected"] is True
        assert data["live"]["connected"] is True
