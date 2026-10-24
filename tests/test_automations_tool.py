"""The chat-native automations tool: one tool for the whole lifecycle.

The point of the tool is that there is no second code path: every operation
lines up with what the Automations page does through the same repository, so
what the agent reports and what the page shows cannot disagree.
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def tool():
    from backend.tools.builtin.automations import tools

    (built,) = tools()
    return built


@pytest.fixture()
def ctx(db):
    from backend.tools.base import ToolContext

    return ToolContext()


async def _call(tool, ctx, **args):
    return await tool.handler({"operation": "list", **args}, ctx)


def _text(result) -> str:
    return result.content


def _failed(result) -> bool:
    return result.is_error


async def test_operations_map_onto_the_same_repository(tool, ctx):
    from backend.automation import AutomationRepository

    await tool.handler(
        {"operation": "create", "name": "digest", "instructions": "write a digest"}, ctx
    )

    listing = await tool.handler({"operation": "list"}, ctx)
    assert "#1" in listing.content and "digest" in listing.content

    repo = AutomationRepository()
    automation = repo.list()[0]

    updated = await tool.handler(
        {"operation": "update", "automation_id": automation.id,
         "instructions": "write a better digest"}, ctx
    )
    assert "Updated" in updated.content
    assert repo.get(automation.id).prompt == "write a better digest"

    paused = await tool.handler({"operation": "pause", "automation_id": automation.id}, ctx)
    assert "paused" in paused.content
    assert repo.get(automation.id).enabled is False

    resumed = await tool.handler({"operation": "resume", "automation_id": automation.id}, ctx)
    assert "active" in resumed.content
    assert repo.get(automation.id).enabled is True

    deleted = await tool.handler({"operation": "delete", "automation_id": automation.id}, ctx)
    assert "Deleted" in deleted.content
    assert repo.get(automation.id) is None


async def test_create_maps_a_chat_schedule_onto_a_row(tool, ctx):
    from backend.automation import AutomationRepository

    result = await tool.handler(
        {
            "operation": "create",
            "name": "morning news",
            "instructions": "brief me",
            "schedule": {"type": "daily", "time": "07:30"},
            "remember_before": True,
            "results_to": "dedicated",
        },
        ctx,
    )
    assert not result.is_error

    automation = AutomationRepository().list()[0]
    assert automation.schedule_type == "daily_at"
    assert automation.daily_at_time == "07:30"
    assert automation.every_minutes == 1440
    assert automation.remember_before is True
    assert automation.results_to == "dedicated"
    assert "dedicated thread" in result.content


async def test_create_refuses_an_unparsable_schedule_with_the_reason(tool, ctx):
    result = await tool.handler(
        {
            "operation": "create",
            "name": "broken",
            "instructions": "run",
            "schedule": {"type": "daily", "time": "when-ever"},
        },
        ctx,
    )
    assert result.is_error
    assert "not a time of day" in result.content


async def test_unknown_operation_names_what_is_available(tool, ctx):
    result = await tool.handler({"operation": "reschedule"}, ctx)
    assert result.is_error
    assert "run_now" in result.content


async def test_writes_require_an_existing_automation(tool, ctx):
    for operation in ("update", "pause", "resume", "delete", "run_now"):
        result = await tool.handler({"operation": operation, "automation_id": 999}, ctx)
        assert result.is_error
        assert "no such automation: #999" in result.content


async def test_runs_reports_recent_history(tool, ctx):
    from backend.automation import AutomationRepository, AutomationRunRepository

    repo = AutomationRepository()
    automation = repo.create(name="hourly", prompt="tick", every_minutes=60)
    run_repo = AutomationRunRepository()
    run = run_repo.create(automation.id)
    run_repo.begin(run.id)
    run_repo.complete(run.id, status="success", result_summary="all quiet")

    result = await tool.handler({"operation": "runs", "automation_id": automation.id}, ctx)
    assert "success" in result.content and "all quiet" in result.content
