"""Day 1 dashboard endpoints. No connector execution or widget actions are exposed."""

import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import Field

from backend.dashboard.developer import DeveloperInput, follow_up
from backend.dashboard.developer import draft as developer_draft
from backend.dashboard.git import RepoSettings
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


@asynccontextmanager
async def lifespan(app):
    async def scheduled_brief():
        while True:
            if settings_read("agent.brief").get("model_enabled"):
                tasks = BackgroundTasks()
                schedule("agent.brief", tasks)
                await tasks()
            await asyncio.sleep(60)

    from backend.dashboard.jobs import Scheduler

    jobs = asyncio.create_task(Scheduler().run())
    task = asyncio.create_task(scheduled_brief())
    try:
        yield
    finally:
        jobs.cancel()
        await asyncio.gather(jobs, return_exceptions=True)
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


router = APIRouter(prefix="/api", tags=["dashboard"], lifespan=lifespan)


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


class WaitingSettings(StrictModel):
    days: int = Field(default=3, ge=1, le=90)


class MailSettings(StrictModel):
    model_enabled: bool = False


class SearchSettings(StrictModel):
    query: str = Field(default="", max_length=500)


@router.put("/widgets/{widget_id}/settings")
def put_settings(widget_id: str, body: dict, background_tasks: BackgroundTasks):
    enabled(widget_id)
    try:
        if widget_id == "glance.weather":
            from backend.dashboard.weather import LocationSettings

            value = LocationSettings.model_validate(body).model_dump()
        elif widget_id == "dash.quiet":
            value = QuietSettings.model_validate(body).model_dump()
            ZoneInfo(value["timezone"])
            if value["snoozed_until"]:
                date = datetime.fromisoformat(value["snoozed_until"].replace("Z", "+00:00"))
                if date.tzinfo is None:
                    raise ValueError("Snooze requires a timezone")
                value["snoozed_until"] = date.astimezone(UTC).isoformat()
        elif widget_id == "need.waiting":
            value = WaitingSettings.model_validate(body).model_dump()
        elif widget_id in (
            "need.inbox",
            "agent.brief",
            "agent.next",
            "comm.thread-summary",
            "comm.newsletters",
        ):
            value = MailSettings.model_validate(body).model_dump()
        elif widget_id == "task.agenda":
            value = AgendaSettings.model_validate(body).model_dump()
        elif widget_id in ("dev.backup", "dev.unpushed"):
            value = RepoSettings.model_validate(body).model_dump()
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
        cache_write("glance.next-event", None, "not-connected")
    if widget_id == "glance.weather":
        cache_write("glance.weather", None, "loading")
        cache_write("glance.sun", None, "loading")
        cache_write("glance.air", None, "loading")
    schedule(widget_id, background_tasks, force=True)
    return value


class DraftDecision(StrictModel):
    approved: bool


@router.post("/widgets/{widget_id}/actions/{action}")
def item_action(widget_id: str, action: str, body: dict):
    enabled(widget_id)
    try:
        if widget_id == "agent.delegated":
            from backend.dashboard.delegated import draft as delegated_draft
            from backend.dashboard.jobs import JobInput

            return delegated_draft(action, JobInput.model_validate(body))
        if widget_id == "agent.jobs":
            from backend.dashboard.jobs import JobInput
            from backend.dashboard.jobs import draft as job_draft

            return job_draft(action, JobInput.model_validate(body))
        if widget_id == "dash.pin":
            from backend.dashboard.pins import PinInput
            from backend.dashboard.pins import draft as pin_draft

            return pin_draft(action, PinInput.model_validate(body))
        if widget_id == "comm.reachout":
            from backend.dashboard.reachout import ReachoutInput
            from backend.dashboard.reachout import draft as reachout_draft

            return reachout_draft(action, ReachoutInput.model_validate(body))
        if widget_id == "feed.rss":
            from backend.dashboard.feeds import FeedInput
            from backend.dashboard.feeds import draft as feed_draft

            return feed_draft(action, FeedInput.model_validate(body))
        if widget_id in ("need.drafts", "need.waiting", "comm.tone", "comm.templates"):
            from backend.dashboard.mail import MailInput
            from backend.dashboard.mail import draft as mail_draft

            return mail_draft(widget_id, action, MailInput.model_validate(body))
        if widget_id == "sys.model":
            from backend.dashboard.system import ModelInput, model_draft

            return model_draft(action, ModelInput.model_validate(body))
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


@router.get("/connectors/health")
async def connector_health():
    from backend.dashboard.connectors import health

    return await health()


@router.post("/connectors/{toolkit}/connect")
async def connector_connect(toolkit: str):
    from backend.dashboard.connectors import SourceUnavailable, connect

    try:
        return await connect(toolkit)
    except SourceUnavailable as exc:
        raise HTTPException(422, "Read-only connection is not available for this toolkit") from exc
    except Exception as exc:
        raise HTTPException(503, "Could not create Connect Link. Check Composio settings.") from exc


@router.get("/widgets/need.drafts/mail/{item_id}")
def review_mail(item_id: int):
    from backend.dashboard.mail import draft_row

    return draft_row(item_id)


@router.post("/widgets/comm.tone/rewrite")
async def rewrite_mail(body: dict):
    from backend.dashboard.mail import ToneInput, rewrite

    try:
        return await rewrite(ToneInput.model_validate(body))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/widgets/comm.templates/templates/{item_id}")
def review_template(item_id: int):
    from backend.dashboard.mail import template_row

    return template_row(item_id)


@router.get("/widgets/{widget_id}/items/{item_id}")
def source_item(widget_id: str, item_id: str):
    enabled(widget_id)
    from backend.dashboard.insights import source_items

    for item in source_items():
        if item["widget_id"] == widget_id and item["item_id"] == item_id:
            return item
    raise HTTPException(404, "Source item is no longer in the widget cache")


@router.get("/dashboard/search")
async def global_search(q: str = Query(default="", max_length=500)):
    from backend.dashboard.search import search

    return await search(q)


@router.get("/dashboard/search/{source}/{item_id}")
def search_item(source: str, item_id: int):
    from backend.dashboard.search import item

    return item(source, item_id)


@router.get("/widgets/agent.delegated/runs/{run_id}/trace")
def delegated_trace(run_id: int):
    import json

    from backend.db.connection import get_connection

    row = get_connection().execute(
        "SELECT trace_json FROM dashboard_job_traces WHERE run_id=?", (run_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Trace not available yet")
    return json.loads(row["trace_json"])
