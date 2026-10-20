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
