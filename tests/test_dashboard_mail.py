import pytest

from backend.dashboard import connectors, mail
from backend.dashboard.store import settings_write


async def test_inbox_fallback_and_ranking(db, monkeypatch):
    async def read(*args):
        assert args[1:3] == ("gmail", "GMAIL_FETCH_EMAILS")
        return {
            "messages": [
                {"id": "a", "subject": "Recent", "from": "a", "date": "2026-10-24", "snippet": "x"},
                {
                    "id": "b",
                    "subject": "Unread",
                    "from": "b",
                    "date": "2026-10-20",
                    "snippet": "y",
                    "unread": True,
                },
            ]
        }

    monkeypatch.setattr(connectors, "read", read)
    result = await mail.provide("need.inbox")
    assert [row["id"] for row in result["items"]] == ["b", "a"]
    assert not result["ranked"] and all("reason" not in row for row in result["items"])

    async def generate(prompt):
        return '[{"id":"a","reason":"Direct question"},{"id":"fake","reason":"Ignore"}]'

    monkeypatch.setattr(mail, "generate", generate)
    settings_write("need.inbox", {"model_enabled": True})
    assert (await mail.provide("need.inbox"))["items"][0]["reason"] == "Direct question"

    async def empty(*args):
        return {"messages": []}

    monkeypatch.setattr(connectors, "read", empty)
    assert (await mail.provide("need.inbox"))["items"] == []


async def test_shared_gmail_cache_excludes_bodies(db, monkeypatch):
    import json
    from types import SimpleNamespace

    from backend.agent.read_cache import read_cache
    from backend.mcp import live
    from backend.mcp.composio_service import composio_service
    from backend.tools.base import RiskLevel, Tool, ToolResult, ToolSource
    from backend.tools.registry import ToolRegistry

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: ["gmail"])
    monkeypatch.setattr(composio_service, "is_reauth_required", lambda _: False)
    monkeypatch.setattr(connectors, "is_provider_overridden_by_local", lambda _: False)

    async def accounts(**kw):
        return {"gmail": {}}

    monkeypatch.setattr(composio_service, "get_connections_async", accounts)
    from backend.tools import registry as tools

    monkeypatch.setattr(tools, "_connector_enabled", lambda *args: True)
    monkeypatch.setattr(tools, "_unsigned_connectors", lambda: set())
    calls = []

    async def handler(args, context):
        assert context.read_only
        calls.append(args)
        return ToolResult.ok(
            json.dumps(
                {
                    "messages": [
                        {
                            "id": "x",
                            "subject": "Subject",
                            "from": "Sender",
                            "date": "2026-10-24",
                            "snippet": "s" * 900,
                            "body": "PRIVATE_BODY",
                            "access_token": "SECRET",
                            "payload": {"body": {"data": "PRIVATE_BODY"}},
                        }
                    ]
                }
            )
        )

    registry = ToolRegistry()
    registry.confirmation.mcp_trust.trust("composio")
    registry.register(
        Tool(
            name="GMAIL_FETCH_EMAILS",
            description="Read mail",
            parameters={},
            handler=handler,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    monkeypatch.setattr(
        live,
        "_manager",
        SimpleNamespace(
            registry=registry, connections={"composio": SimpleNamespace(connected=True)}
        ),
    )
    first = await mail.messages("need.inbox", "in:inbox")
    second = await mail.messages("need.inbox", "in:inbox")
    assert first == second and len(calls) == 1
    assert len(first[0]["snippet"]) == 300
    assert "PRIVATE_BODY" not in str(read_cache._cache)
    assert "SECRET" not in str(read_cache._cache)
    with pytest.raises(RuntimeError, match="read-only"):
        await connectors.read("need.inbox", "gmail", "GMAIL_SEND_EMAIL", {})
