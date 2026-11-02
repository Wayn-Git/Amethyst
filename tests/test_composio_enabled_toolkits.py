from unittest.mock import patch
from backend.mcp.composio_service import composio_service

def test_active_connections_auto_included_in_enabled_toolkits():
    with patch.object(composio_service, "is_configured", return_value=True), \
         patch.object(composio_service, "get_connections", return_value={"googlecalendar": {"id": "ca_test", "status": "ACTIVE"}}):
        composio_service._enabled_toolkits_cache = None
        toolkits = composio_service.get_enabled_toolkits()
        assert "googlecalendar" in toolkits
