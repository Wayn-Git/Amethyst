"""Mocked Composio fixtures, projected shared cache, no external accounts."""

import json

import pytest
import test_dashboard_agenda as agenda_tests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.agent.read_cache import read_cache
from backend.dashboard import connectors, service
from backend.dashboard.router import router
from backend.dashboard.store import cache_read
from backend.mcp.composio_service import composio_service, get_cached_pinned_schema
from backend.mcp.risk import classify
from backend.tools.base import RiskLevel, Tool, ToolResult, ToolSource

calendar = agenda_tests.calendar


@pytest.fixture
def remote(calendar, monkeypatch):
    registry = calendar[2]
    enabled = {"github", "slack"}
    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: sorted(enabled))

    async def accounts(**kwargs):
        return {tk: {"id": f"fixture-{tk}"} for tk in enabled}

    monkeypatch.setattr(composio_service, "get_connections_async", accounts)
    for toolkit in enabled:
        connectors.reconcile(toolkit, {"id": f"fixture-{toolkit}"})
    payloads = {
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER": [],
        "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY": {"workflow_runs": []},
        "GITHUB_GET_THE_AUTHENTICATED_USER": {"login": "me", "email": "secret-fixture"},
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS": {"items": [], "total_count": 0},
        "GITHUB_LIST_ISSUE_COMMENTS": [],
        "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST": [],
        "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST": [],
        "SLACK_TEST_AUTH": {"ok": True, "user_id": "U_ME", "token": "secret-fixture"},
        "SLACK_SEARCH_MESSAGES": {"messages": {"matches": []}},
        "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION": {"messages": []},
    }
    calls = []
    for toolkit in ("github", "slack"):
        for slug in connectors.READ_TOOLS[toolkit]:

            async def handler(arguments, context, slug=slug):
                assert context.read_only
                calls.append((slug, arguments))
                value = payloads[slug]
                if callable(value):
                    value = value(arguments)
                if isinstance(value, Exception):
                    raise value
                return ToolResult.ok(json.dumps(value))

            registry.register(
                Tool(
                    name=slug,
                    description="Read fixture",
                    parameters={},
                    handler=handler,
                    risk=classify(slug, get_cached_pinned_schema(slug).get("annotations")),
                    source=ToolSource.MCP,
                    server_name="composio",
                )
            )
    return payloads, calls, enabled, registry


def issue(number=1, **kwargs):
    return {
        "id": number,
        "number": number,
        "title": f"Issue fixture {number}",
        "repository_url": "https://api.github.com/repos/owner/repo",
        "html_url": f"https://github.com/owner/repo/issues/{number}",
        "created_at": "2026-10-20T09:00:00Z",
        "updated_at": "2026-10-25T09:00:00Z",
        "body": "@me please check",
        "user": {"login": "other"},
        **kwargs,
    }


def comment(body, user, at):
    return {"id": at, "body": body, "user": {"login": user}, "created_at": at, "updated_at": at}


async def test_mentions_replied_since_and_minimal_shared_cache(db, remote):
    payloads, calls, _, _ = remote
    payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"]["items"] = [issue()]
    payloads["GITHUB_LIST_ISSUE_COMMENTS"] = [
        comment("Reply fixture", "me", "2026-10-21T09:00:00Z"),
        comment("@ME again", "other", "2026-10-22T09:00:00Z"),
    ]
    payloads["SLACK_SEARCH_MESSAGES"]["messages"]["matches"] = [
        {
            "ts": "100.001",
            "user": "U_OTHER",
            "text": "<@U_ME> fixture",
            "channel": {"id": "C1"},
            "permalink": "https://example.com/message?thread_ts=99.0",
        },
    ]
    payloads["SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION"]["messages"] = [
        {"ts": "101.001", "user": "U_ME", "text": "Reply fixture"}
    ]
    await service.refresh("need.mentions")
    value = cache_read("need.mentions")
    assert value["state"] == "ok"
    assert [r["source"] for r in value["payload"]["items"]] == ["GitHub"]
    assert any(args.get("ts") == "99.0" for slug, args in calls if "THREAD" in slug)
    assert any(args.get("q") == "mentions:@me" for _, args in calls)
    first_calls = len(calls)
    await service.refresh("need.mentions")
    assert len(calls) == first_calls
    cached = json.dumps([entry.content for entry in read_cache._cache.values()])
    assert "secret-fixture" not in cached and "@ME again" not in cached
    payloads["GITHUB_LIST_ISSUE_COMMENTS"].append(
        comment("Reply fixture", "me", "2026-10-23T09:00:00Z")
    )
    read_cache.invalidate_domain("github")
    await service.refresh("need.mentions")
    assert cache_read("need.mentions")["state"] == "empty"


@pytest.mark.parametrize("missing", ["github", "slack"])
async def test_mentions_independent_connection_and_both_disconnected(db, remote, missing):
    _, _, enabled, _ = remote
    enabled.remove(missing)
    await service.refresh("need.mentions")
    value = cache_read("need.mentions")
    assert value["state"] == "empty"
    assert value["payload"]["unavailable"] == [missing.title() if missing == "slack" else "GitHub"]
    enabled.clear()
    await service.refresh("need.mentions")
    assert cache_read("need.mentions")["state"] == "not-connected"


async def test_mentions_slack_pagination_and_review_mentions(db, remote):
    payloads, calls, _, _ = remote
    payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"]["items"] = [issue(body="", pull_request={})]
    payloads["GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST"] = [
        comment("@me review this", "other", "2026-10-22T09:00:00Z")
    ]
    payloads["SLACK_SEARCH_MESSAGES"]["messages"]["matches"] = [
        {"ts": "100.001", "user": "U_OTHER", "text": "<@U_ME> fixture", "channel": {"id": "C1"}}
    ]
    payloads["SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION"] = lambda args: (
        {"messages": [], "has_more": True, "response_metadata": {"next_cursor": "next"}}
        if not args.get("cursor")
        else {"messages": [{"ts": "101", "user": "U_ME"}]}
    )
    await service.refresh("need.mentions")
    assert [r["source"] for r in cache_read("need.mentions")["payload"]["items"]] == ["GitHub"]
    assert any(args.get("cursor") == "next" for _, args in calls)


async def test_mentions_errors_and_writes_rejected(db, remote):
    payloads, calls, enabled, registry = remote
    enabled.remove("slack")
    payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"] = RuntimeError("private-fixture")
    await service.refresh("need.mentions")
    assert cache_read("need.mentions")["state"] == "error"
    assert "private-fixture" not in json.dumps(cache_read("need.mentions"))
    calls.clear()
    registry.resolve_tool("GITHUB_GET_THE_AUTHENTICATED_USER").risk = RiskLevel.HIGH
    await service.refresh("need.mentions")
    assert calls == []
    with pytest.raises(RuntimeError, match="read-only"):
        await connectors.read("need.mentions", "github", "GITHUB_CREATE_AN_ISSUE", {})
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.post("/api/widgets/need.mentions/actions/reply", json={}).status_code == 404


def test_dashboard_reader_schemas_registered(remote):
    for toolkit in ("github", "slack"):
        for slug in connectors.READ_TOOLS[toolkit]:
            assert get_cached_pinned_schema(slug), slug


def test_real_fast_lane_readers_keep_low_risk(db, remote, monkeypatch):
    from types import SimpleNamespace

    from backend.mcp.composio_service import STATIC_PINNED_SCHEMAS
    from backend.mcp.manager import MCPManager
    from backend.tools.registry import ToolRegistry

    monkeypatch.setattr(composio_service, "get_connections", lambda: {"github": {}, "slack": {}})
    monkeypatch.setattr(
        composio_service, "get_fast_lane_tools", lambda tk: STATIC_PINNED_SCHEMAS[tk]
    )
    manager = MCPManager(registry=ToolRegistry())
    manager._register_composio_fast_lane_tools(SimpleNamespace(name="composio"), [])
    for tk in ("github", "slack"):
        for slug in connectors.READ_TOOLS[tk]:
            assert manager.registry.resolve_tool(slug).risk == RiskLevel.LOW, slug
    assert manager.registry.resolve_tool("GITHUB_CREATE_AN_ISSUE").risk != RiskLevel.LOW


async def test_prs_review_and_authored_queries_dedup_projection_and_cache(db, remote):
    payloads, calls, _, _ = remote
    payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"] = lambda args: {
        "items": [issue(1)] if "review-requested:" in args["q"] else [issue(1), issue(2)],
        "total_count": 100,
    }
    await service.refresh("dev.prs")
    value = cache_read("dev.prs")
    assert value["state"] == "ok" and value["payload"]["limited"]
    items = value["payload"]["items"]
    assert [r["id"] for r in items] == ["1", "2"]
    assert items[0]["status"] == "Awaiting your review · Your open PR"
    assert items[1]["status"] == "Your open PR"
    assert all(set(r) == {"id", "title", "url", "at", "source", "status"} for r in items)
    assert {args["q"] for _, args in calls} == {
        "is:pr is:open review-requested:@me",
        "is:pr is:open author:@me",
    }
    assert "@me please check" not in json.dumps([r.content for r in read_cache._cache.values()])
    await service.refresh("dev.prs")
    assert len(calls) == 2


@pytest.mark.parametrize("widget_id", ["dev.prs", "dev.issues", "dev.ci"])
async def test_developer_empty_disconnected_stale_and_rejected_writes(db, remote, widget_id):
    from backend.dashboard.store import cache_write

    payloads, _, enabled, _ = remote
    await service.refresh(widget_id)
    assert cache_read(widget_id)["state"] == "empty"
    enabled.remove("github")
    await service.refresh(widget_id)
    assert cache_read(widget_id)["state"] == "not-connected"
    enabled.add("github")
    cache_write(widget_id, {"items": [{"id": "saved"}]}, "ok", synced_at="2020-01-01T00:00:00Z")
    read_cache.invalidate_domain("github")
    if widget_id == "dev.ci":
        payloads["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"] = RuntimeError("offline")
    else:
        payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"] = RuntimeError("offline fixture")
    await service.refresh(widget_id)
    assert service.read_data(widget_id)["state"] == "stale"
    assert cache_read(widget_id)["payload"]["items"][0]["id"] == "saved"
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.post(f"/api/widgets/{widget_id}/actions/merge", json={}).status_code == 404


async def test_assigned_issues_query_projection_persistence(db, remote):
    payloads, calls, _, _ = remote
    payloads["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"] = {"items": [issue(2)], "total_count": 1}
    await service.refresh("dev.issues")
    value = cache_read("dev.issues")
    assert value["state"] == "ok"
    assert value["payload"]["items"][0]["status"] == "Assigned to you"
    assert value["payload"]["items"][0]["title"] == "Issue fixture 2"
    assert calls[0][1]["q"] == "is:issue is:open assignee:@me"
    persisted = db.execute(
        "SELECT payload_json FROM widget_cache WHERE widget_id='dev.issues'"
    ).fetchone()
    assert json.loads(persisted[0]) == value["payload"]
    assert "body" not in persisted[0] and "mentions" not in persisted[0]


async def test_ci_latest_status_per_repo_minimal_fields_and_shared_reads(db, remote):
    payloads, calls, _, _ = remote
    payloads["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"] = [
        {"full_name": "owner/first", "description": "private-fixture"},
        {"full_name": "owner/empty"},
        {"full_name": "owner/running"},
    ]

    def runs(args):
        if args["repo"] == "empty":
            return {"workflow_runs": []}
        return {
            "workflow_runs": [
                {
                    "id": 1,
                    "name": "Old fixture",
                    "status": "completed",
                    "conclusion": "failure",
                    "created_at": "2026-10-20T10:00:00Z",
                },
                {
                    "id": 2,
                    "name": "Latest fixture",
                    "status": "in_progress" if args["repo"] == "running" else "completed",
                    "conclusion": "success",
                    "created_at": "2026-10-21T10:00:00Z",
                    "html_url": "https://github.com/owner/first/actions/runs/2",
                    "logs": "private-fixture",
                },
            ]
        }

    payloads["GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY"] = runs
    await service.refresh("dev.ci")
    value = cache_read("dev.ci")
    assert value["state"] == "ok"
    items = value["payload"]["items"]
    assert [r["status"] for r in items] == ["success", "No workflow runs", "in_progress"]
    assert len({r["id"] for r in items}) == 3
    assert all(args["per_page"] == 1 for slug, args in calls if "WORKFLOW" in slug)
    assert "private-fixture" not in json.dumps([r.content for r in read_cache._cache.values()])
    await service.refresh("dev.ci")
    assert len(calls) == 4


async def test_ci_limited_repositories_and_manual_refresh(db, remote):
    from fastapi import BackgroundTasks

    payloads, calls, _, _ = remote
    payloads["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"] = [
        {"full_name": f"owner/repo{i}"} for i in range(50)
    ]
    await service.refresh("dev.ci")
    assert cache_read("dev.ci")["payload"]["limited"]
    assert len(cache_read("dev.ci")["payload"]["items"]) == 50
    tasks = BackgroundTasks()
    service.schedule("dev.ci", tasks, force=True)
    await tasks()
    assert len(calls) == 102
