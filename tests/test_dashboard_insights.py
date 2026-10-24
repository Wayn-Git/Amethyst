"""Grounding, cached schedule and optional local-compatible model execution."""

import json
from datetime import UTC, datetime

import pytest
from fastapi import BackgroundTasks

from backend.dashboard import insights, service
from backend.dashboard.store import cache_read, cache_write, settings_write


async def test_brief_empty_disabled_and_grounded(db, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Must not ask a model")

    from backend.workers import llm

    monkeypatch.setattr(llm, "ask", forbidden)
    assert (await insights.provide("agent.brief"))["disabled"]
    settings_write("agent.brief", {"model_enabled": True})
    assert (await insights.provide("agent.brief"))["items"] == []
    cache_write("task.today", {"items": [{"id": 7, "title": "Real task"}]}, "ok")

    async def ask(prompt, **kwargs):
        assert json.loads(prompt)[0]["title"] == "Real task"
        assert kwargs["paid_ok"] is False
        return {"text": "[0]"}

    monkeypatch.setattr(llm, "ask", ask)
    value = await insights.provide("agent.brief")
    assert value["items"][0]["title"] == "Real task"
    assert value["items"][0]["href"] == "/today?source=task.today&item=7"
    cache_write("agent.brief", value, "ok", synced_at=datetime.now(UTC).isoformat())
    assert cache_read("agent.brief")["payload"] == value


@pytest.mark.parametrize("text", ["[100]", "[-1]", "[true]", "[0,0]", '["invented"]', "{}"])
async def test_model_cannot_invent_source_items(db, monkeypatch, text):
    from backend.workers import llm

    async def ask(*args, **kwargs):
        return {"text": text}

    monkeypatch.setattr(llm, "ask", ask)
    with pytest.raises(ValueError):
        await insights.select([{"title": "Known task"}], 5)


def test_fixed_morning_evening_slots_and_no_load_regeneration(db, monkeypatch):
    assert (
        insights.slot(datetime(2026, 10, 25, 7, tzinfo=UTC)).isoformat()
        == "2026-10-24T18:00:00+00:00"
    )
    assert insights.slot(datetime(2026, 10, 25, 10, tzinfo=UTC)).hour == 8
    assert insights.slot(datetime(2026, 10, 25, 21, tzinfo=UTC)).hour == 18
    monkeypatch.setattr(insights, "slot", lambda: datetime(2026, 10, 25, 8, tzinfo=UTC))
    cache_write("agent.brief", {"items": []}, "empty", synced_at="2026-10-25T09:00:00+00:00")
    tasks = BackgroundTasks()
    service.schedule("agent.brief", tasks)
    assert not tasks.tasks
    service.schedule("agent.brief", tasks, force=True)
    assert len(tasks.tasks) == 1
    service.IN_FLIGHT.clear()
    cache_write("agent.brief", {"items": []}, "empty", synced_at="2026-10-24T18:00:00+00:00")
    tasks = BackgroundTasks()
    service.schedule("agent.brief", tasks)
    assert len(tasks.tasks) == 1
    service.IN_FLIGHT.clear()


async def test_refresh_failure_preserves_brief_and_other_widgets(db, monkeypatch):
    async def fail(_):
        raise ValueError("Invalid selection")

    monkeypatch.setitem(service.PROVIDERS, "agent.brief", fail)
    cache_write(
        "agent.brief", {"items": [{"title": "Saved"}]}, "ok", synced_at="2026-10-24T08:00:00+00:00"
    )
    await service.refresh("agent.brief")
    assert service.read_data("agent.brief")["payload"]["items"][0]["title"] == "Saved"
    await service.refresh("glance.clock")
    assert cache_read("glance.clock")["state"] == "ok"


async def test_next_exactly_one_action_with_grounded_reason(db, monkeypatch):
    from backend.workers import llm

    async def ask(*args, **kwargs):
        return {"text": "[0]"}

    monkeypatch.setattr(llm, "ask", ask)
    settings_write("agent.next", {"model_enabled": True})
    cache_write("lib.recent", {"items": [{"id": 1, "title": "Not a task"}]}, "ok")
    assert (await insights.provide("agent.next"))["items"] == []
    cache_write(
        "task.today",
        {"items": [{"id": 7, "title": "Existing task"}, {"id": 8, "title": "Other task"}]},
        "ok",
    )
    value = await insights.provide("agent.next")
    assert len(value["items"]) == 1
    assert value["items"][0]["title"] == "Existing task"
    assert value["items"][0]["reason"] == "This task is in your Today list."
    assert value["items"][0]["href"].endswith("item=7")


async def test_next_rejects_multiple_or_empty_selection(db, monkeypatch):
    from backend.workers import llm

    settings_write("agent.next", {"model_enabled": True})
    cache_write("task.today", {"items": [{"id": 7, "title": "Existing task"}]}, "ok")
    for text in ("[0,0]", "[]"):

        async def ask(*args, selected=text, **kwargs):
            return {"text": selected}

        monkeypatch.setattr(llm, "ask", ask)
        with pytest.raises(ValueError):
            await insights.provide("agent.next")
