from __future__ import annotations

import pytest

from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


@pytest.fixture(autouse=True)
def reset_caches():
    from backend.mcp import guidance, provider_ownership

    guidance.forget()
    provider_ownership.forget()
    yield
    guidance.forget()
    provider_ownership.forget()


@pytest.mark.asyncio
async def test_composio_unconnected_tool_withheld_from_schemas(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service, "get_connections", lambda: {"slack": {"status": "ACTIVE"}}
    )

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="slack_send__mcp__composio",
            description="send slack message",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    registry.register(
        Tool(
            name="gmail_send__mcp__composio",
            description="send gmail message",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    schemas = registry.schemas()
    schema_names = [s.name for s in schemas]
    assert "slack_send__mcp__composio" in schema_names
    assert "gmail_send__mcp__composio" not in schema_names


@pytest.mark.asyncio
async def test_composio_overridden_tool_withheld_from_schemas(monkeypatch):
    from backend.mcp.composio_service import composio_service
    from backend.mcp.config import ServerConfig, Source, Transport

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"gmail": {"status": "ACTIVE"}, "slack": {"status": "ACTIVE"}},
    )

    dummy_servers = {
        "google-workspace": ServerConfig(
            name="google-workspace",
            enabled=True,
            transport=Transport.STDIO,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr("backend.mcp.commands.is_signed_in", lambda cfg: True)

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="slack_send__mcp__composio",
            description="send slack message",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    registry.register(
        Tool(
            name="gmail_send__mcp__composio",
            description="send gmail message",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    schemas = registry.schemas()
    schema_names = [s.name for s in schemas]
    assert "slack_send__mcp__composio" in schema_names
    assert "gmail_send__mcp__composio" not in schema_names


@pytest.mark.asyncio
async def test_composio_unconnected_dispatch_returns_instruction(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {})

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="gmail_send__mcp__composio",
            description="send gmail message",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    ctx = ToolContext(conversation_id="conv_1")
    result = await registry.dispatch("gmail_send__mcp__composio", {}, ctx)
    assert result.is_error is True
    assert "composio:gmail" in result.content
    assert "Do not retry" in result.content


def test_ready_connectors_block_decomposes_composio(monkeypatch):
    from backend.mcp import guidance
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"slack": {"status": "ACTIVE"}, "notion": {"status": "ACTIVE"}},
    )

    class DummyLive:
        @staticmethod
        def ready_connectors():
            return {"composio": 14}

    monkeypatch.setattr("backend.mcp.live.ready_connectors", DummyLive.ready_connectors)
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: {})

    block = guidance.ready_connectors_block()
    assert block is not None
    assert "- composio:notion" in block
    assert "- composio:slack" in block
    assert "composio (14 tools)" not in block


