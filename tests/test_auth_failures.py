from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from backend.mcp.client import is_auth_failure_text, _is_auth_failure, OAuthRequired
from backend.mcp.composio_service import composio_service
from backend.mcp.guidance import (
    CONNECTORS_SCREEN,
    auth_failure_instruction,
    extract_service_name,
)
from backend.mcp.manager import MCPManager
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry, extract_composio_toolkit


def test_is_auth_failure_text():
    # Positive matches
    assert is_auth_failure_text("401 Unauthorized")
    assert is_auth_failure_text("HTTP 403 Forbidden: access denied")
    assert is_auth_failure_text("Token expired or token revoked")
    assert is_auth_failure_text("Invalid credentials provided")
    assert is_auth_failure_text("Expired credentials: please re-authenticate")
    assert is_auth_failure_text("Missing authentication header")
    assert is_auth_failure_text("OAuth rejection by user")
    assert is_auth_failure_text("OAuthRequired")
    assert is_auth_failure_text("Permission denied: insufficient scopes")

    # Negative matches (non-auth errors)
    assert not is_auth_failure_text("File not found: /path/to/doc")
    assert not is_auth_failure_text("Connection timeout after 15 seconds")
    assert not is_auth_failure_text("Division by zero in formula")
    assert not is_auth_failure_text("Unknown tool: search_something")
    assert not is_auth_failure_text("Rate limit 429: Too many requests")


def test_extract_service_name():
    # Composio fast lane slugs
    assert extract_service_name("GMAIL_FETCH_EMAILS") == "Gmail"
    assert extract_service_name("GOOGLECALENDAR_FIND_EVENT") == "Google Calendar"
    assert extract_service_name("GITHUB_CREATE_AN_ISSUE") == "GitHub"
    assert extract_service_name("SLACK_SEND_MESSAGE") == "Slack"
    assert extract_service_name("NOTION_SEARCH_NOTION_PAGE") == "Notion"
    assert extract_service_name("JIRA_CREATE_ISSUE") == "Jira"
    assert extract_service_name("ASANA_GET_TASK") == "Asana"
    assert extract_service_name("LINEAR_CREATE_ISSUE") == "Linear"
    assert extract_service_name("SPOTIFY_SEARCH") == "Spotify"

    # With MCP delimiter
    assert extract_service_name("GMAIL_FETCH_EMAILS__mcp__composio") == "Gmail"
    assert extract_service_name("GOOGLECALENDAR_CREATE_EVENT__mcp__composio") == "Google Calendar"

    # Multi-execute tool with payload
    args = {"tools": [{"tool_slug": "GOOGLECALENDAR_FIND_EVENT", "arguments": {}}]}
    assert extract_service_name("COMPOSIO_MULTI_EXECUTE_TOOL", arguments=args) == "Google Calendar"

    # Local MCP tools
    assert extract_service_name("create_event", server_name="google-workspace") == "Google Calendar"
    assert extract_service_name("send_mail", server_name="google-workspace") == "Gmail"
    assert extract_service_name("list_files", server_name="google-workspace") == "Google Workspace"
    assert extract_service_name("search_repos", server_name="github") == "GitHub"
    assert extract_service_name("post_message", server_name="slack") == "Slack"
    assert extract_service_name("get_tasks", server_name="microsoft-todo") == "Microsoft To Do"


def test_auth_failure_instruction_format():
    msg = auth_failure_instruction("Gmail")
    assert "Gmail needs re-auth:" in msg
    assert CONNECTORS_SCREEN in msg
    assert "Do not retry this tool in this turn." in msg
    assert "Continue answering the user's request using any other available information and tools rather than looping or retrying." in msg

    # With custom link
    custom_msg = auth_failure_instruction("Google Calendar", instructions="https://auth.google.com/oauth")
    assert "Google Calendar needs re-auth: https://auth.google.com/oauth." in custom_msg
    assert "Do not retry this tool in this turn." in custom_msg


@pytest.mark.asyncio
async def test_composio_fast_lane_auth_failure_handling():
    composio_service.clear_reauth_required()
    composio_service._last_good_connections = {"googlecalendar": {"status": "ACTIVE"}}

    with patch.object(composio_service, "is_configured", return_value=True):
        mock_connection = MagicMock()
        mock_connection.connected = True
        raw_payload = {
            "data": {
                "results": [
                    {
                        "tool_slug": "GOOGLECALENDAR_FIND_EVENT",
                        "response": {
                            "successful": False,
                            "error": "401 Unauthorized: Access token expired or invalid",
                        },
                    }
                ]
            }
        }
        mock_connection.call = AsyncMock(return_value=json.dumps(raw_payload))

        registry = ToolRegistry()
        manager = MCPManager(registry=registry)
        manager.connections["composio"] = mock_connection

        handler = manager._make_composio_fast_lane_handler("composio", "GOOGLECALENDAR_FIND_EVENT")
        result = await handler({"query": "meeting"}, ToolContext())

        assert result.is_error
        assert "Google Calendar needs re-auth:" in result.content
        assert "Do not retry this tool in this turn." in result.content

        # Verify marked as requiring re-auth
        assert composio_service.is_reauth_required("googlecalendar")
        # Verify excluded from connections
        assert "googlecalendar" not in composio_service.get_connections()

        # Re-register tool in registry and verify dispatch blocks it directly
        tool = Tool(
            name="GOOGLECALENDAR_FIND_EVENT",
            description="Find events",
            parameters={},
            handler=handler,
            source=ToolSource.MCP,
            server_name="composio",
        )
        registry.register(tool)

        dispatch_res = await registry.dispatch("GOOGLECALENDAR_FIND_EVENT", {})
        assert dispatch_res.is_error
        assert "Google Calendar needs re-auth:" in dispatch_res.content

        # Clean up
        composio_service.clear_reauth_required()


@pytest.mark.asyncio
async def test_composio_batch_execution_auth_failure():
    composio_service.clear_reauth_required()
    composio_service._last_good_connections = {
        "gmail": {"status": "ACTIVE"},
        "googlecalendar": {"status": "ACTIVE"},
    }

    with patch.object(composio_service, "is_configured", return_value=True):
        mock_connection = MagicMock()
        mock_connection.connected = True

        # First call (gmail) succeeds, second call (calendar) fails with 401
        raw_payload = {
            "data": {
                "results": [
                    {
                        "tool_slug": "GMAIL_FETCH_EMAILS",
                        "response": {
                            "successful": True,
                            "data": {"emails": [{"subject": "Weekly Report"}]},
                        },
                    },
                    {
                        "tool_slug": "GOOGLECALENDAR_FIND_EVENT",
                        "response": {
                            "successful": False,
                            "error": "401 Client Error: Token revoked or expired",
                        },
                    },
                ]
            }
        }
        mock_connection.call = AsyncMock(return_value=json.dumps(raw_payload))

        manager = MCPManager(registry=ToolRegistry())
        manager.connections["composio"] = mock_connection

        call1 = MagicMock(name="c1")
        call1.name = "GMAIL_FETCH_EMAILS"
        call1.arguments = {"query": "report"}

        call2 = MagicMock(name="c2")
        call2.name = "GOOGLECALENDAR_FIND_EVENT"
        call2.arguments = {"query": "sync"}

        results = await manager.execute_composio_batch([call1, call2])
        assert len(results) == 2

        # Call 1 succeeds
        assert not results[0].is_error
        assert "Weekly Report" in results[0].content

        # Call 2 returns first-class auth instruction
        assert results[1].is_error
        assert "Google Calendar needs re-auth:" in results[1].content
        assert "Do not retry this tool in this turn." in results[1].content

        # Calendar toolkit marked as requiring re-auth, Gmail remains active
        assert composio_service.is_reauth_required("googlecalendar")
        assert not composio_service.is_reauth_required("gmail")
        assert "gmail" in composio_service.get_connections()
        assert "googlecalendar" not in composio_service.get_connections()

        composio_service.clear_reauth_required()


@pytest.mark.asyncio
async def test_local_mcp_server_auth_failure_disconnects_and_instructs():
    mock_connection = MagicMock()
    mock_connection.connected = True
    mock_connection.call = AsyncMock(side_effect=Exception("401 Unauthorized: bad credentials"))
    mock_connection.disconnect = AsyncMock()

    registry = ToolRegistry()
    manager = MCPManager(registry=registry)
    manager.connections["github"] = mock_connection

    handler = manager._make_handler("github", "search_repositories")
    result = await handler({"query": "amethyst"}, ToolContext())

    assert result.is_error
    assert "GitHub needs re-auth:" in result.content
    assert "Do not retry this tool in this turn." in result.content

    # Server was disconnected and error recorded
    assert "github" not in manager.connections
    assert "github" in manager.errors


@pytest.mark.asyncio
async def test_registry_dispatch_catches_unhandled_auth_error():
    registry = ToolRegistry()

    async def faulty_handler(arguments, ctx):
        return ToolResult.error("Remote server returned 403 Forbidden: User token expired")

    tool = Tool(
        name="github__search_repositories",
        description="Search GitHub repositories",
        parameters={},
        handler=faulty_handler,
        source=ToolSource.MCP,
        server_name="github",
    )
    registry.register(tool)

    res = await registry.dispatch("github__search_repositories", {"query": "amethyst"})
    assert res.is_error
    assert "GitHub needs re-auth:" in res.content
    assert "Do not retry this tool in this turn." in res.content


@pytest.mark.asyncio
async def test_director_handles_auth_failure_emits_connector_failed_and_synthesizes(monkeypatch, tmp_path):
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository
    from backend.runtime.chain import Link
    from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
    from backend.security.confirmation import ConfirmationService, auto_approve

    class MockModelClient:
        def __init__(self, responses):
            self.responses = list(responses)
            self.calls = []

        async def complete(self, messages, tools=None, **kwargs):
            self.calls.append({"messages": messages, "tools": tools})
            if self.responses:
                return self.responses.pop(0)
            return ModelResponse(text="Final answer.")

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))

    # Tool 1: Google Calendar fails with 401 auth error
    async def cal_handler(args, ctx):
        return ToolResult.error("401 Unauthorized: token expired")

    cal_tool = Tool(
        name="GOOGLECALENDAR_FIND_EVENT",
        description="Find events",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=cal_handler,
        source=ToolSource.MCP,
        server_name="google-workspace",
    )
    registry.register(cal_tool)

    # Tool 2: Gmail succeeds
    async def mail_handler(args, ctx):
        return ToolResult.ok(json.dumps([{"subject": "Meeting Notes", "sender": "alice@example.com"}]))

    mail_tool = Tool(
        name="GMAIL_FETCH_EMAILS",
        description="Fetch emails",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=mail_handler,
        source=ToolSource.MCP,
        server_name="google-workspace",
    )
    registry.register(mail_tool)

    # Round 1: Model calls both tools in parallel
    resp1 = ModelResponse(
        text="Checking calendar and email...",
        tool_calls=[
            ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "today"}),
            ToolCall(id="c2", name="GMAIL_FETCH_EMAILS", arguments={"query": "today"}),
        ],
    )
    # Round 2: Model synthesizes answer noting calendar needs re-auth and summarizing emails
    resp2 = ModelResponse(
        text="Here is your email: 'Meeting Notes' from alice@example.com. Google Calendar requires re-authentication."
    )

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr("backend.agent.director.build_chain", lambda *args, **kwargs: [Link("mock", "mock-model")])

    director = Director(registry, stream=False, memory=False)
    events = [e async for e in director.run(cid, "Check calendar and emails")]

    # Check that connector_failed event was emitted for Google Calendar
    connector_failed_events = [e for e in events if e.type == "connector_failed"]
    assert len(connector_failed_events) >= 1
    failure = connector_failed_events[0].data
    assert failure["tool"] == "GOOGLECALENDAR_FIND_EVENT"
    assert "Google Calendar needs re-auth:" in failure["reason"]
    assert "Do not retry this tool in this turn." in failure["reason"]

    # Verify tool results sent to model in round 2
    round2_call = mock_client.calls[1]
    round2_msgs = round2_call["messages"]
    tool_msgs = [m for m in round2_msgs if getattr(m, "role", "") == "tool" or m.get("role") == "tool"]
    cal_msg = next(m for m in tool_msgs if m.get("tool_call_id") == "c1" or getattr(m, "tool_call_id", None) == "c1")
    cal_content = cal_msg.get("content") if isinstance(cal_msg, dict) else cal_msg.content
    assert "Google Calendar needs re-auth:" in cal_content
    assert "Do not retry this tool in this turn." in cal_content

    mail_msg = next(m for m in tool_msgs if m.get("tool_call_id") == "c2" or getattr(m, "tool_call_id", None) == "c2")
    mail_content = mail_msg.get("content") if isinstance(mail_msg, dict) else mail_msg.content
    assert "Meeting Notes" in mail_content
