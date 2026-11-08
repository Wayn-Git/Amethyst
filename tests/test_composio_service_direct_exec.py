import pytest
from unittest.mock import MagicMock, patch
from backend.mcp.composio_service import ComposioService, DEFAULT_TOOLKITS

def test_default_toolkits_include_calendar_and_drive():
    assert "googlecalendar" in DEFAULT_TOOLKITS
    assert "googledrive" in DEFAULT_TOOLKITS
    assert "gmail" in DEFAULT_TOOLKITS

def test_set_api_key_preserves_or_seeds_toolkits(db):
    service = ComposioService()
    with patch("backend.secrets.set_secret"):
        service.set_api_key("uak_test_key_12345678901234567890", mode="user")
    enabled = service.get_enabled_toolkits()
    assert len(enabled) > 0
    assert "googlecalendar" in enabled
    assert "googledrive" in enabled

@pytest.mark.asyncio
async def test_execute_tool_unwraps_data():
    service = ComposioService()
    mock_client = MagicMock()
    mock_client.tools.execute.return_value = {
        "successful": True,
        "error": None,
        "data": {"messages": [{"id": "m1", "subject": "Test"}]},
    }
    with patch.object(service, "is_configured", return_value=True), \
         patch.object(service, "_get_client", return_value=mock_client), \
         patch.object(service, "_get_stable_user_id", return_value="user_1"):
        res = await service.execute_tool("GMAIL_FETCH_EMAILS", {"max_results": 5})
        assert "messages" in res
        assert res["messages"][0]["id"] == "m1"
