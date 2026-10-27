import pytest
from unittest.mock import MagicMock, patch
from backend.mcp.composio_service import composio_service

def test_get_connected_services_state_unauthorized_error():
    with patch.object(composio_service, "is_configured", return_value=True):
        with patch.object(composio_service, "_auth_headers", return_value={"x-api-key": "bad_key"}):
            with patch("httpx.get") as mock_get:
                mock_res = MagicMock()
                mock_res.status_code = 401
                mock_res.text = "Unauthorized: Invalid API key"
                mock_get.return_value = mock_res
                
                state = composio_service.get_connected_services_state(force=True)
                assert state["credentialStore"] in ("unauthorized", "error")
                assert "error_detail" in state

def test_list_connector_tools_returns_real_schemas():
    tools = composio_service.list_connector_tools()
    assert "googlecalendar" in tools
    # Verify real tools are returned rather than placeholder {SLUG}_ACTION
    cal_tools = [t["name"] for t in tools["googlecalendar"]]
    assert "GOOGLECALENDAR_FIND_EVENT" in cal_tools


def test_integrations_updates_shared_account_cache(monkeypatch):
    from backend.mcp.composio_service import ComposioService
    instance = ComposioService()
    monkeypatch.setattr(instance, "is_configured", lambda: True)
    monkeypatch.setattr(instance, "_auth_headers", lambda: {"x-api-key": "fixture"})
    monkeypatch.setattr(instance, "_get_stable_user_id", lambda: "fixture-user")
    response = MagicMock(status_code=200)
    response.json.return_value = {"items": [{"id": "gmail-fixture", "toolkit": {"slug": "gmail"}, "status": "ACTIVE"}]}
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: response)
    assert instance.get_connected_services_state()["services"]["gmail"]["connected"]
    assert instance.get_connections()["gmail"]["id"] == "gmail-fixture"
    monkeypatch.setattr("httpx.delete", lambda *args, **kwargs: MagicMock(status_code=204))
    assert instance.remove_connected_account("gmail-fixture")
    assert not instance._last_good_connections


def test_authorization_enables_the_toolkit(monkeypatch):
    from backend.mcp.composio_service import ComposioService
    instance = ComposioService()
    enabled = []
    monkeypatch.setattr(instance, "initiate_connection", lambda *args, **kwargs: "https://connect.composio.dev/fixture")
    monkeypatch.setattr(instance, "get_enabled_toolkits", lambda: ["github"])
    monkeypatch.setattr(instance, "update_toolkits", lambda values: enabled.extend(values))
    assert instance.authorize_service("gmail")["url"].startswith("https://")
    assert enabled == ["github", "gmail"]
