from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.mcp.composio_service import (
    NON_OAUTH_TOOLKITS,
    OAUTH_TOOLKITS,
    ComposioService,
    get_toolkits_catalog,
    is_no_auth_toolkit,
)
from backend.mcp.provider_ownership import (
    PROVIDER_MAPPING,
    detect_fallback_trigger,
    forget as forget_ownership,
    get_active_target,
    get_all_fallbacks,
    get_provider_fallback_status,
    is_provider_overridden_by_local,
    reset_target,
    switch_target,
)
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


@pytest.fixture(autouse=True)
def clean_test_state():
    forget_ownership()
    from backend.db.connection import get_connection

    conn = get_connection()
    conn.execute("DELETE FROM provider_fallbacks")
    conn.execute("DELETE FROM composio_state WHERE id = 1")
    conn.commit()
    yield
    forget_ownership()
    conn = get_connection()
    conn.execute("DELETE FROM provider_fallbacks")
    conn.execute("DELETE FROM composio_state WHERE id = 1")
    conn.commit()


# ---------------------------------------------------------------------------
# 1. API Key Validation & Mode Persistence Tests
# ---------------------------------------------------------------------------


def test_consumer_key_validation_success(monkeypatch):
    service = ComposioService()

    def mock_post(url, headers, json, timeout):
        assert url == "https://connect.composio.dev/mcp"
        assert headers.get("x-consumer-api-key") == "ck_live_valid_consumer_key"
        assert json.get("method") == "initialize"
        req = httpx.Request("POST", url)
        return httpx.Response(200, request=req, json={"jsonrpc": "2.0", "result": {"capabilities": {}}})

    monkeypatch.setattr("httpx.post", mock_post)

    valid, err = service.validate_api_key("ck_live_valid_consumer_key")
    assert valid is True
    assert err is None
    assert service.get_key_mode() == "consumer"

    # Set key and verify persistence
    service.set_api_key("ck_live_valid_consumer_key")
    assert service.get_key_mode() == "consumer"

    config = service.get_mcp_config()
    assert config is not None
    assert config["url"] == "https://connect.composio.dev/mcp"
    assert config["headers"] == {"x-consumer-api-key": "ck_live_valid_consumer_key"}

    status = service.get_status()
    assert status["configured"] is True
    assert status["active"] is True
    assert status["key_mode"] == "consumer"


def test_consumer_key_validation_failure_surfaces_header_reason(monkeypatch):
    service = ComposioService()

    def mock_post(url, headers, json, timeout):
        req = httpx.Request("POST", url)
        return httpx.Response(
            401,
            request=req,
            headers={"x-mcp-auth-failure-reason": "invalid or revoked user API key"},
            json={"error": "unauthorized"},
        )

    monkeypatch.setattr("httpx.post", mock_post)

    valid, err = service.validate_api_key("ck_bad_consumer_key")
    assert valid is False
    assert "invalid or revoked user API key" in err
    assert "Invalid Composio Consumer Key" in err


def test_user_key_validation_and_mode_persistence(monkeypatch):
    service = ComposioService()

    class DummyClient:
        class toolkits:
            @staticmethod
            def list():
                return []

    mock_constructor = MagicMock(return_value=DummyClient())
    monkeypatch.setattr("composio.Composio", mock_constructor)

    valid, err = service.validate_api_key("uak_valid_user_key")
    assert valid is True
    assert err is None
    assert service.get_key_mode() == "user"

    service.set_api_key("uak_valid_user_key")
    assert service.get_key_mode() == "user"


# ---------------------------------------------------------------------------
# 2. Tool Categorization by Auth Requirements Tests
# ---------------------------------------------------------------------------


def test_toolkit_catalog_auth_categorization():
    catalog = get_toolkits_catalog()
    assert len(catalog) >= 15

    direct_slugs = {t["slug"] for t in catalog if t["no_auth"]}
    oauth_slugs = {t["slug"] for t in catalog if not t["no_auth"]}

    assert "web_scraper" in direct_slugs
    assert "calculator" in direct_slugs
    assert "weather" in direct_slugs
    assert "sql" in direct_slugs

    assert "slack" in oauth_slugs
    assert "github" in oauth_slugs
    assert "gmail" in oauth_slugs
    assert "googlecalendar" in oauth_slugs

    assert is_no_auth_toolkit("web_scraper") is True
    assert is_no_auth_toolkit("calculator") is True
    assert is_no_auth_toolkit("slack") is False
    assert is_no_auth_toolkit("gmail") is False


def test_registry_schemas_offers_direct_tools_without_oauth(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    # No connected OAuth accounts in get_connections()
    monkeypatch.setattr(composio_service, "get_connections", lambda: {})

    registry = ToolRegistry()
    # Register a direct tool (calculator)
    registry.register(
        Tool(
            name="calculator_evaluate__mcp__composio",
            description="evaluate math",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("42"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    # Register an OAuth connected tool (gmail)
    registry.register(
        Tool(
            name="gmail_send__mcp__composio",
            description="send email",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("sent"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    schemas = registry.schemas()
    schema_names = [s.name for s in schemas]

    # Direct tool is immediately offered without requiring OAuth connection!
    assert "calculator_evaluate__mcp__composio" in schema_names
    # OAuth tool is withheld because no account is connected
    assert "gmail_send__mcp__composio" not in schema_names


@pytest.mark.asyncio
async def test_registry_dispatch_allows_direct_tool_execution(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {})

    async def calc_handler(args, ctx):
        return ToolResult.ok("result: 100")

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="calculator_evaluate__mcp__composio",
            description="evaluate math",
            parameters={},
            handler=calc_handler,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    ctx = ToolContext(conversation_id="conv_calc")
    res = await registry.dispatch("calculator_evaluate__mcp__composio", {"expr": "50*2"}, ctx)
    assert res.is_error is False
    assert "result: 100" in res.content


# ---------------------------------------------------------------------------
# 3. Provider Fallback Tests
# ---------------------------------------------------------------------------


def test_detect_fallback_trigger():
    assert detect_fallback_trigger("Error 402: Insufficient credits on Composio account") == "credits_exhausted"
    assert detect_fallback_trigger("Rate limit reached, quota exceeded") == "credits_exhausted"
    assert detect_fallback_trigger("Error 403: Plan expired, please upgrade subscription") == "plan_expired"
    assert detect_fallback_trigger("502 Bad Gateway from connect.composio.dev") == "service_unavailable"
    assert detect_fallback_trigger("Service Unavailable: connection refused") == "service_unavailable"
    assert detect_fallback_trigger("Normal user parameter error: invalid email format") is None


def test_fallback_switch_and_override_lifecycle():
    assert get_active_target("gmail") == "composio"
    assert is_provider_overridden_by_local("gmail") is False

    # Switch to local fallback
    switched = switch_target("gmail", "local", reason="credits_exhausted")
    assert switched is True
    assert get_active_target("gmail") == "local"
    assert is_provider_overridden_by_local("gmail") is True

    status = get_provider_fallback_status("gmail")
    assert status["active_target"] == "local"
    assert status["failure_reason"] == "credits_exhausted"
    assert status["has_local_alternative"] is True

    # Switch back to composio
    switch_target("gmail", "composio")
    assert get_active_target("gmail") == "composio"
    assert is_provider_overridden_by_local("gmail") is False

    # Reset
    reset_target("gmail")
    assert get_active_target("gmail") == "composio"


@pytest.mark.asyncio
async def test_registry_dispatch_surfaces_fallback_instruction_on_failure(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service, "get_connections", lambda: {"gmail": {"status": "ACTIVE"}}
    )

    async def failing_gmail_handler(args, ctx):
        return ToolResult.error("Composio API error 402: Quota exceeded, insufficient credits")

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="gmail_send__mcp__composio",
            description="send email",
            parameters={},
            handler=failing_gmail_handler,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    ctx = ToolContext(conversation_id="conv_fb")
    res = await registry.dispatch("gmail_send__mcp__composio", {"to": "test@example.com"}, ctx)
    assert res.is_error is True
    # Verify fallback instruction is attached
    assert "credits or API quota have run out" in res.content
    assert "direct local integration" in res.content
    assert "google-workspace" in res.content or "google-gmail" in res.content
    assert "Do not retry" in res.content


# ---------------------------------------------------------------------------
# 4. FastAPI Endpoint Integration Tests
# ---------------------------------------------------------------------------


def test_api_composio_toolkits_separation():
    client = TestClient(app)
    res = client.get("/api/composio/toolkits")
    assert res.status_code == 200
    data = res.json()

    assert "no_auth_toolkits" in data
    assert "auth_required_toolkits" in data
    assert any(t["slug"] == "web_scraper" for t in data["no_auth_toolkits"])
    assert any(t["slug"] == "slack" for t in data["auth_required_toolkits"])


def test_api_fallback_endpoints():
    client = TestClient(app)

    # 1. GET fallback status
    res = client.get("/api/composio/fallback/status")
    assert res.status_code == 200
    fallbacks = res.json()["fallbacks"]
    assert any(f["provider"] == "gmail" for f in fallbacks)

    # 2. POST switch fallback
    switch_res = client.post(
        "/api/composio/fallback/switch",
        json={"provider": "gmail", "target": "local", "reason": "credits_exhausted"},
    )
    assert switch_res.status_code == 200
    assert switch_res.json()["ok"] is True
    assert switch_res.json()["active_target"] == "local"

    # Verify status reflects switch
    status_res = client.get("/api/composio/fallback/status")
    gmail_fb = next(f for f in status_res.json()["fallbacks"] if f["provider"] == "gmail")
    assert gmail_fb["active_target"] == "local"
    assert gmail_fb["failure_reason"] == "credits_exhausted"

    # 3. POST reset fallback
    reset_res = client.post("/api/composio/fallback/reset", json={"provider": "gmail"})
    assert reset_res.status_code == 200
    assert reset_res.json()["ok"] is True
