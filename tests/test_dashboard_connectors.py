"""Mocked connector contracts; never use live accounts or credentials."""

import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
import test_dashboard_agenda as agenda_tests
from fastapi import BackgroundTasks

from backend.dashboard import connectors, service
from backend.dashboard.registry import REGISTRY
from backend.dashboard.store import cache_read, cache_write
from backend.mcp.composio_service import ComposioService, composio_service
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource

calendar = agenda_tests.calendar


@pytest.fixture
def account_state(calendar, monkeypatch):
    accounts = {"googlecalendar": {"id": "old-account"}}
    reauth = set()

    async def connections(**kwargs):
        return (
            dict(accounts)
            if kwargs.get("include_reauth")
            else {k: v for k, v in accounts.items() if k not in reauth}
        )

    monkeypatch.setattr(composio_service, "get_connections_async", connections)
    monkeypatch.setattr(composio_service, "is_reauth_required", lambda tk: tk in reauth)
    monkeypatch.setattr(composio_service, "mark_reauth_required", lambda tk, **kw: reauth.add(tk))
    monkeypatch.setattr(composio_service, "clear_reauth_required", reauth.discard)
    yield accounts, reauth
    connectors._LOCKS.clear()


async def test_health_success_minimal_cache_and_audit(db, calendar, account_state):
    payload, calls, _ = calendar
    payload.update(access_token="secret-fixture", raw_payload={"private": "source"})
    await service.refresh("task.agenda")
    health = await connectors.health()
    row = next(r for r in health["items"] if r["id"] == "googlecalendar")
    assert row["status"] == "connected" and row["last_success"]
    assert row["can_connect"] and not row["circuit_open"]
    cached = json.dumps(cache_read("task.agenda"))
    assert "secret-fixture" not in cached and "raw_payload" not in cached
    assert cache_read("task.agenda")["payload"]["items"] == []
    logs = db.execute("SELECT * FROM execution_logs WHERE tool_source='mcp'").fetchall()
    assert len(logs) == 3 and all(r["confirmation_decision"] for r in logs)
    assert "secret-fixture" not in json.dumps([dict(r) for r in logs])
    assert len(calls) == 1


async def test_auth_expired_requires_proven_reconnect(db, calendar, account_state, monkeypatch):
    accounts, reauth = account_state
    tool = calendar[2].resolve_tool("GOOGLECALENDAR_FIND_EVENT")

    async def expired(*args):
        return ToolResult.error("401 Unauthorized: token expired")

    tool.handler = expired
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "not-connected"
    assert "googlecalendar" in reauth
    before = await connectors.health()
    assert (
        next(r for r in before["items"] if r["id"] == "googlecalendar")["status"]
        == "needs reconnect"
    )
    requested = []

    def link(toolkit, *, scopes):
        requested.append((toolkit, scopes))
        return "https://connect.composio.dev/link/fixture"

    monkeypatch.setattr(composio_service, "initiate_connection", link)
    value = await connectors.connect("googlecalendar")
    assert value["redirect_url"].startswith("https://connect.composio.dev/")
    assert requested == [("googlecalendar", connectors.READ_SCOPES["googlecalendar"])]
    assert (
        next(r for r in (await connectors.health())["items"] if r["id"] == "googlecalendar")[
            "status"
        ]
        == "needs reconnect"
    )
    accounts["googlecalendar"] = {"id": "new-account", "access_token": "never-cache"}
    assert (
        next(r for r in (await connectors.health())["items"] if r["id"] == "googlecalendar")[
            "status"
        ]
        == "connected"
    )
    assert "googlecalendar" not in reauth
    assert not connectors.state("googlecalendar")["needs_reconnect"]
    assert "never-cache" not in json.dumps(await connectors.health())
    assert (
        db.execute(
            "SELECT COUNT(*) FROM execution_logs WHERE tool_name='composio_connect_link'"
        ).fetchone()[0]
        == 1
    )


async def test_rate_limit_backoff_shared_and_stale_cache(db, calendar, account_state):
    calls = []
    tool = calendar[2].resolve_tool("GOOGLECALENDAR_FIND_EVENT")

    async def limited(*args):
        calls.append(1)
        return ToolResult.error("429 rate limited; private raw source")

    tool.handler = limited
    cache_write(
        "task.agenda", {"items": [{"id": "saved"}]}, "ok", synced_at="2020-01-01T00:00:00+00:00"
    )
    await asyncio.gather(service.refresh("task.agenda"), service.refresh("task.agenda"))
    assert calls == [1]
    assert connectors.state("googlecalendar")["retry_at"] > time.time()
    saved = service.read_data("task.agenda")
    assert saved["stale"] and saved["payload"]["items"][0]["id"] == "saved"
    assert "private raw source" not in json.dumps(saved)
    tasks = BackgroundTasks()
    service.schedule("task.agenda", tasks)
    assert not tasks.tasks
    await service.refresh("task.agenda")  # Manual refresh cannot evade source backoff.
    assert calls == [1]
    db.execute("UPDATE dashboard_connector_health SET retry_at=0")
    db.commit()
    await service.refresh("task.agenda")
    assert len(calls) == 2
    assert connectors.state("googlecalendar")["retry_at"] >= time.time() + 59


async def test_circuit_half_open_recovery_is_per_connector(db, calendar, account_state):
    tool = calendar[2].resolve_tool("GOOGLECALENDAR_FIND_EVENT")
    calls = []

    async def offline(*args):
        calls.append(1)
        raise OSError("offline private payload")

    tool.handler = offline
    for _ in range(3):
        with pytest.raises((RuntimeError, connectors.ConnectorBackoff)):
            await connectors.read("task.agenda", "googlecalendar", tool.name, {})
    assert len(calls) == 3
    assert next(r for r in (await connectors.health())["items"] if r["id"] == "googlecalendar")[
        "circuit_open"
    ]
    with pytest.raises(connectors.ConnectorBackoff):
        await connectors.read("task.agenda", "googlecalendar", tool.name, {})
    assert len(calls) == 3
    assert connectors.state("gmail")["retry_at"] == 0
    db.execute("UPDATE dashboard_connector_health SET retry_at=0 WHERE toolkit='googlecalendar'")
    db.commit()

    async def recovered(*args):
        return ToolResult.ok('{"items":[]}')

    tool.handler = recovered
    await connectors.read("task.agenda", "googlecalendar", tool.name, {})
    state = connectors.state("googlecalendar")
    assert state["failures"] == state["retry_at"] == 0 and state["last_success"]


async def test_http_rate_limit_honors_retry_after(db, calendar, account_state):
    tool = calendar[2].resolve_tool("GOOGLECALENDAR_FIND_EVENT")

    async def limited(*args):
        raise httpx.HTTPStatusError(
            "429",
            request=httpx.Request("GET", "https://example.invalid"),
            response=httpx.Response(429, headers={"Retry-After": "120"}),
        )

    tool.handler = limited
    with pytest.raises(connectors.ConnectorBackoff) as exc:
        await connectors.read("task.agenda", "googlecalendar", tool.name, {})
    assert exc.value.retry_at >= time.time() + 119


@pytest.mark.parametrize(
    "slug",
    [
        "GMAIL_SEND_EMAIL",
        "GOOGLECALENDAR_CREATE_EVENT",
        "COMPOSIO_MULTI_EXECUTE_TOOL",
        "COMPOSIO_REMOTE_WORKBENCH",
        "COMPOSIO_PROXY_EXECUTE",
    ],
)
@pytest.mark.parametrize("risk", [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH])
async def test_no_write_or_meta_tool_reachable_without_approval(
    db, calendar, account_state, slug, risk
):
    calls = []

    async def write(*args):
        calls.append(1)
        return ToolResult.ok("written")

    registry = calendar[2]
    registry.register(
        Tool(
            name=slug,
            description="fixture",
            parameters={"type": "object"},
            handler=write,
            risk=risk,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    with pytest.raises(RuntimeError, match="read-only"):
        await connectors.read(
            "task.agenda", "googlecalendar", slug, {"tools": [{"tool_slug": "GMAIL_SEND_EMAIL"}]}
        )
    assert calls == []
    assert (
        db.execute("SELECT confirmation_decision FROM execution_logs ORDER BY id DESC").fetchone()[
            0
        ]
        == "blocked"
    )


async def test_registry_write_requires_approval(db, calendar, account_state):
    called = []

    async def write(*args):
        called.append(True)
        return ToolResult.ok("written")

    async def deny(*args):
        return False

    registry = calendar[2]
    registry.confirmation = ConfirmationService(callback=deny)
    registry.register(
        Tool(
            name="GOOGLECALENDAR_CREATE_EVENT",
            description="write fixture",
            parameters={"type": "object"},
            handler=write,
            risk=RiskLevel.HIGH,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    result = await registry.dispatch("GOOGLECALENDAR_CREATE_EVENT", {}, ToolContext())
    assert result.is_error and called == []


async def test_cache_swr_manifest_interval_and_single_flight(db, monkeypatch):
    interval = REGISTRY["task.agenda"]["manifest"]["refresh"]["interval_s"]
    assert interval == 900
    cache_write(
        "task.agenda", {"items": [{"id": "cached"}]}, "ok", synced_at="2020-01-01T00:00:00+00:00"
    )
    tasks = BackgroundTasks()
    service.schedule("task.agenda", tasks)
    service.schedule("task.agenda", tasks)
    assert len(tasks.tasks) == 1
    value = service.read_data("task.agenda")
    assert value["stale"] and value["refreshing"] and value["payload"]["items"]
    service.IN_FLIGHT.clear()
    service.RETRY_AFTER.clear()


@pytest.mark.parametrize("fail", [False, True])
def test_scoped_connect_link_uses_managed_auth_no_broad_fallback(db, monkeypatch, fail):
    service = ComposioService()
    monkeypatch.setattr(service, "is_configured", lambda: True)
    monkeypatch.setattr(service, "_auth_headers", lambda **kwargs: {})
    create = Mock(return_value=SimpleNamespace(id="read-config"))
    link = Mock(return_value=SimpleNamespace(redirect_url="https://connect.composio.dev/link/test"))
    if fail:
        link.side_effect = RuntimeError("scoped auth failed")
    configs = SimpleNamespace(list=Mock(return_value=SimpleNamespace(items=[])), create=create)
    client = SimpleNamespace(
        auth_configs=configs, client=SimpleNamespace(link=SimpleNamespace(create=link))
    )
    monkeypatch.setattr(service, "_get_client", lambda: client)
    scopes = connectors.READ_SCOPES["gmail"]
    if fail:
        with pytest.raises(RuntimeError, match="scoped auth failed"):
            service.initiate_connection("gmail", scopes=scopes)
    else:
        assert service.initiate_connection("gmail", scopes=scopes).startswith(
            "https://connect.composio.dev/"
        )
    options = create.call_args.kwargs["options"]
    assert options["credentials"] == {"scopes": scopes}
    assert options["type"] == "use_composio_managed_auth"
    assert link.call_args.kwargs["auth_config_id"] == "read-config"


async def test_account_health_cache_backoff_and_reauth_visibility(db, monkeypatch):
    instance = ComposioService()
    monkeypatch.setattr(instance, "is_configured", lambda: True)
    fetched = []

    async def fetch():
        fetched.append(True)
        return {"gmail": {"id": "replacement"}}

    monkeypatch.setattr(instance, "fetch_connections_async", fetch)
    instance._connections_backoff_until = time.monotonic() + 60
    assert await instance.get_connections_async() == {}
    assert not fetched
    instance._last_good_connections = {"gmail": {"id": "old"}}
    instance._reauth_required = {"gmail": "expired"}
    assert await instance.get_connections_async() == {}
    assert await instance.get_connections_async(include_reauth=True) == {"gmail": {"id": "old"}}
    assert await instance.get_connections_async(force=True, include_reauth=True) == {
        "gmail": {"id": "replacement"}
    }
    assert fetched == [True]


def test_scoped_connect_link_reuses_matching_auth_config(db, monkeypatch):
    instance = ComposioService()
    monkeypatch.setattr(instance, "is_configured", lambda: True)
    monkeypatch.setattr(instance, "_auth_headers", lambda **kwargs: {})
    config = SimpleNamespace(
        id="existing",
        name="Amethyst read-only gmail",
        status="ENABLED",
        credentials={"scopes": connectors.READ_SCOPES["gmail"]},
    )
    create = Mock(side_effect=AssertionError("must reuse the scoped config"))
    link = Mock(return_value=SimpleNamespace(redirect_url="https://connect.composio.dev/link/test"))
    client = SimpleNamespace(
        auth_configs=SimpleNamespace(
            list=lambda **kw: SimpleNamespace(items=[config]), create=create
        ),
        client=SimpleNamespace(link=SimpleNamespace(create=link)),
    )
    monkeypatch.setattr(instance, "_get_client", lambda: client)
    instance.initiate_connection("gmail", scopes=connectors.READ_SCOPES["gmail"])
    assert link.call_args.kwargs["auth_config_id"] == "existing"


async def test_connect_enables_declared_calendar_toolkit(db, calendar, account_state, monkeypatch):
    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: ["gmail"])
    update = Mock(return_value=True)
    monkeypatch.setattr(composio_service, "update_toolkits", update)
    monkeypatch.setattr(
        composio_service,
        "initiate_connection",
        lambda *a, **kw: "https://connect.composio.dev/link/test",
    )
    assert "googlecalendar" in connectors.toolkits()
    await connectors.connect("googlecalendar")
    update.assert_called_once_with(["gmail", "googlecalendar"])
