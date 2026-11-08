import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.dashboard import connectors, remote, agenda

def test_remote_parse_calendar_handles_event_data_wrapping():
    # Test flat event_data list
    raw1 = {"event_data": [{"id": "ev1", "summary": "Team Sync", "start": {"dateTime": "2026-11-09T10:00:00Z"}}]}
    parsed1 = remote.project("GOOGLECALENDAR_FIND_EVENT", raw1)
    assert len(parsed1["items"]) == 1
    assert parsed1["items"][0]["id"] == "ev1"
    assert parsed1["items"][0]["summary"] == "Team Sync"

    # Test nested event_data
    raw2 = {"event_data": {"event_data": [{"id": "ev2", "summary": "Standup", "start": {"dateTime": "2026-11-09T11:00:00Z"}}]}}
    parsed2 = remote.project("GOOGLECALENDAR_FIND_EVENT", raw2)
    assert len(parsed2["items"]) == 1
    assert parsed2["items"][0]["id"] == "ev2"
    assert parsed2["items"][0]["summary"] == "Standup"

@pytest.mark.asyncio
async def test_connectors_read_fallback_to_direct_sdk_when_transport_none(db):
    widget_id = "need.inbox"
    toolkit = "gmail"
    slug = "GMAIL_FETCH_EMAILS"
    arguments = {"max_results": 5}

    with patch("backend.dashboard.connectors.access_enabled", return_value=True), \
         patch("backend.dashboard.connectors.composio_service.is_configured", return_value=True), \
         patch("backend.dashboard.connectors.composio_service.get_enabled_toolkits", return_value=["gmail"]), \
         patch("backend.dashboard.connectors.is_provider_overridden_by_local", return_value=False), \
         patch("backend.dashboard.connectors.connection", return_value=None), \
         patch("backend.dashboard.connectors.accounts", return_value={"gmail": {"status": "ACTIVE"}}), \
         patch("backend.dashboard.connectors.reconcile", return_value={"needs_reconnect": False}), \
         patch("backend.dashboard.connectors.composio_service.is_reauth_required", return_value=False), \
         patch("backend.dashboard.connectors.composio_service.execute_tool", new_callable=AsyncMock) as mock_exec:
        
        mock_exec.return_value = {
            "messages": [
                {
                    "id": "msg_123",
                    "threadId": "th_123",
                    "subject": "Hello Direct SDK",
                    "from": "alice@example.com",
                    "date": "2026-11-09T10:00:00Z",
                    "snippet": "Test snippet",
                    "body": "Test body",
                }
            ]
        }

        res = await connectors._read(widget_id, toolkit, slug, arguments)
        assert "messages" in res
        assert res["messages"][0]["id"] == "msg_123"
        mock_exec.assert_awaited_once_with(slug, arguments)
