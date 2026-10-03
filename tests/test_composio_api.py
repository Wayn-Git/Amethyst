from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)


def test_get_composio_status():
    response = client.get("/api/composio/status")
    assert response.status_code == 200
    data = response.json()
    assert "configured" in data
    assert "active" in data
    assert "enabled_toolkits" in data


def test_post_and_delete_composio_key():
    with patch("backend.mcp.composio_service.composio_service.set_api_key") as mock_set, \
         patch("backend.mcp.composio_service.composio_service.delete_api_key") as mock_del:
        mock_set.return_value = True

        res = client.post("/api/composio/key", json={"api_key": "comp_test_secret"})
        assert res.status_code == 200
        assert res.json()["ok"] is True
        mock_set.assert_called_once_with("comp_test_secret")

        del_res = client.delete("/api/composio/key")
        assert del_res.status_code == 200
        assert del_res.json()["ok"] is True
        mock_del.assert_called_once()


def test_get_and_toggle_toolkits():
    with patch("backend.mcp.composio_service.composio_service.get_enabled_toolkits") as mock_get, \
         patch("backend.mcp.composio_service.composio_service.update_toolkits") as mock_update:
        mock_get.return_value = ["slack", "github"]
        mock_update.return_value = True

        res = client.get("/api/composio/toolkits")
        assert res.status_code == 200
        toolkits = res.json()["toolkits"]
        assert any(t["slug"] == "slack" for t in toolkits)

        toggle_res = client.post(
            "/api/composio/toolkits/toggle",
            json={"toolkit": "linear", "enabled": True},
        )
        assert toggle_res.status_code == 200
        assert toggle_res.json()["ok"] is True
        mock_update.assert_called_once_with(["slack", "github", "linear"])
