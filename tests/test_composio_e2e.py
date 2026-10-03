from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from backend.agent.tool_search_catalog import _classify_source, build_catalog, search_catalog
from backend.mcp.composio_service import ComposioService
from backend.security.confirmation import ConfirmationOutcome, ConfirmationRequest, ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource


@pytest.mark.asyncio
async def test_composio_e2e_flow():
    """End-to-end test verifying:
    1. Key configuration & session initialization in ComposioService
    2. Scoped toolkit configuration with mcp=True
    3. Tool discovery in BM25 with composio:<toolkit> classification
    4. Safety confirmation gate on Composio MCP write tools
    5. Tool execution dispatch
    """
    # 1. Initialize ComposioService and set API key
    service = ComposioService()
    assert service.set_api_key("comp_test_e2e_key") is True
    assert service.is_configured() is True

    mock_mcp = MagicMock()
    mock_mcp.url = "https://mcp.composio.dev/e2e_session_123"
    mock_mcp.headers = {"x-api-key": "comp_test_e2e_key"}

    mock_session = MagicMock()
    mock_session.session_id = "e2e_session_123"
    mock_session.mcp = mock_mcp

    mock_client = MagicMock()
    mock_client.sessions.create.return_value = mock_session
    mock_client.use.return_value = mock_session

    with patch.object(service, "_get_client", return_value=mock_client):
        # 2. Scoped toolkit creation
        session = service.get_or_create_session(enabled_toolkits=["slack", "linear"])
        assert session.session_id == "e2e_session_123"
        mock_client.sessions.create.assert_called_once()
        create_kwargs = mock_client.sessions.create.call_args.kwargs
        assert create_kwargs.get("mcp") is True
        assert create_kwargs.get("toolkits") == {"enable": ["slack", "linear"]}

        # Update toolkits
        assert service.update_toolkits(["slack", "linear", "github"]) is True
        mock_session.update.assert_called_once_with(toolkits={"enable": ["slack", "linear", "github"]})
        assert service.get_enabled_toolkits() == ["slack", "linear", "github"]

        # MCP config retrieval
        mcp_cfg = service.get_mcp_config()
        assert mcp_cfg is not None
        assert mcp_cfg["transport"] == "streamable-http"
        assert mcp_cfg["url"] == "https://mcp.composio.dev/e2e_session_123"

    # 3. BM25 Tool Catalog Discovery & Source Classification
    async def _slack_handler(args: dict, ctx: ToolContext) -> ToolResult:
        return ToolResult.ok("Slack message sent")

    async def _linear_handler(args: dict, ctx: ToolContext) -> ToolResult:
        return ToolResult.ok("Linear issue created")

    slack_tool = Tool(
        name="slack_chat_post_message__mcp__composio",
        description="Send a message to a channel on Slack.",
        parameters={
            "type": "object",
            "properties": {"channel": {"type": "string"}, "text": {"type": "string"}},
            "required": ["channel", "text"],
        },
        risk=RiskLevel.MEDIUM,
        source=ToolSource.MCP,
        server_name="composio",
        handler=_slack_handler,
    )
    linear_tool = Tool(
        name="linear_create_issue__mcp__composio",
        description="Create a new issue on Linear board.",
        parameters={
            "type": "object",
            "properties": {"title": {"type": "string"}, "team": {"type": "string"}},
            "required": ["title", "team"],
        },
        risk=RiskLevel.MEDIUM,
        source=ToolSource.MCP,
        server_name="composio",
        handler=_linear_handler,
    )

    catalog = build_catalog([slack_tool, linear_tool])

    # Search for slack tools
    slack_results = search_catalog(catalog, "post slack message to channel")
    assert len(slack_results) >= 1
    top_slack = slack_results[0][0]
    assert top_slack.name == "slack_chat_post_message__mcp__composio"
    assert top_slack.source_name == "composio:slack"

    # Search for linear tools
    linear_results = search_catalog(catalog, "create bug issue on linear")
    assert len(linear_results) >= 1
    top_linear = linear_results[0][0]
    assert top_linear.name == "linear_create_issue__mcp__composio"
    assert top_linear.source_name == "composio:linear"

    # 4. Safety Confirmation Gate on Write Tools
    prompted_requests: list[ConfirmationRequest] = []

    async def _confirm_cb(req: ConfirmationRequest) -> bool:
        prompted_requests.append(req)
        return True

    confirmation_svc = ConfirmationService(callback=_confirm_cb)

    # First use of composio MCP server prompts for trust
    ctx = ToolContext(conversation_id="conv_e2e_456")
    outcome = await confirmation_svc.check(
        tool=slack_tool,
        arguments={"channel": "general", "text": "Hello team!"},
        context=ctx,
    )
    assert outcome.allowed is True
    assert len(prompted_requests) >= 1

    # 5. Tool execution
    res = await slack_tool.handler({"channel": "general", "text": "Hello team!"}, ctx)
    assert res.content == "Slack message sent"
