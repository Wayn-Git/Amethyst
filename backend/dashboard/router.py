"""Day 1 dashboard endpoints. No connector execution or widget actions are exposed."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import Field

from backend.dashboard.developer import DeveloperInput, follow_up
from backend.dashboard.developer import draft as developer_draft
from backend.dashboard.items import ItemInput, decide, draft
from backend.dashboard.models import ClockSettings, Layout, QuietSettings, StrictModel
from backend.dashboard.registry import MANIFEST_SCHEMA, REGISTRY
from backend.dashboard.service import read_data, schedule
from backend.dashboard.store import (
    cache_write,
    layout_read,
    layout_write,
    settings_read,
    settings_write,
)

router = APIRouter(prefix="/api", tags=["dashboard"])


def enabled(widget_id):
    if widget_id not in REGISTRY:
        raise HTTPException(404, "Unknown widget")
    if not REGISTRY[widget_id]["enabled"]:
        raise HTTPException(409, "Widget disabled: invalid manifest")


@router.get("/widgets")
def widgets():
    return {"widgets": list(REGISTRY.values()), "schema": MANIFEST_SCHEMA}


@router.get("/widgets/{widget_id}/data")
async def data(widget_id: str, background_tasks: BackgroundTasks):
    enabled(widget_id)
    schedule(widget_id, background_tasks)
    return read_data(widget_id)


@router.post("/widgets/{widget_id}/refresh")
async def refresh_widget(widget_id: str, background_tasks: BackgroundTasks):
    enabled(widget_id)
    schedule(widget_id, background_tasks, force=True)
    return read_data(widget_id)


@router.get("/layout")
def get_layout(mode: str = Query(default="default", pattern=r"^[a-z][a-z0-9-]{0,31}$")):
    return layout_read(mode)


@router.put("/layout")
def put_layout(
    body: Layout, mode: str = Query(default="default", pattern=r"^[a-z][a-z0-9-]{0,31}$")
):
    for item in body.widgets:
        enabled(item.id)
        if item.size not in REGISTRY[item.id]["manifest"]["sizes"]:
            raise HTTPException(422, "Widget size is not allowed")
    layout_write(mode, body.model_dump())
    return body.model_dump()


@router.get("/widgets/{widget_id}/settings")
def get_settings(widget_id: str):
    enabled(widget_id)
    return settings_read(widget_id)


class AgendaSettings(StrictModel):
    enabled: bool


class SearchSettings(StrictModel):
    query: str = Field(default="", max_length=500)


@router.put("/widgets/{widget_id}/settings")
def put_settings(widget_id: str, body: dict, background_tasks: BackgroundTasks):
    enabled(widget_id)
    try:
        if widget_id == "dash.quiet":
            value = QuietSettings.model_validate(body).model_dump()
            ZoneInfo(value["timezone"])
            if value["snoozed_until"]:
                date = datetime.fromisoformat(value["snoozed_until"].replace("Z", "+00:00"))
                if date.tzinfo is None:
                    raise ValueError("Snooze requires a timezone")
                value["snoozed_until"] = date.astimezone(UTC).isoformat()
        elif widget_id == "task.agenda":
            value = AgendaSettings.model_validate(body).model_dump()
        elif widget_id == "lib.search":
            value = SearchSettings.model_validate(body).model_dump()
        elif widget_id == "glance.clock":
            value = ClockSettings.model_validate(body).model_dump()
            for zone in value["zones"]:
                ZoneInfo(zone)
        else:
            raise HTTPException(405, "This widget has no editable settings")
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise HTTPException(422, str(exc)) from exc
    settings_write(widget_id, value)
    if widget_id == "task.agenda" and not value["enabled"]:
        cache_write(widget_id, None, "not-connected")
    schedule(widget_id, background_tasks, force=True)
    return value


class DraftDecision(StrictModel):
    approved: bool


@router.post("/widgets/{widget_id}/actions/{action}")
def item_action(widget_id: str, action: str, body: dict):
    enabled(widget_id)
    try:
        if widget_id.startswith("dev."):
            return developer_draft(widget_id, action, DeveloperInput.model_validate(body))
        return draft(widget_id, action, ItemInput.model_validate(body))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/widgets/dev.appeal/cases/{item_id}/follow-up")
async def generate_follow_up(item_id: int):
    enabled("dev.appeal")
    return await follow_up(item_id)


@router.post("/widgets/{widget_id}/drafts/{draft_id}")
async def item_decision(widget_id: str, draft_id: str, body: DraftDecision):
    enabled(widget_id)
    return await decide(widget_id, draft_id, body.approved)
