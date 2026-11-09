"""Travel estimate using the registered, read-only Composio Google Maps tool."""

import math
from zoneinfo import ZoneInfo

from pydantic import Field

from backend.dashboard import agenda, connectors, planning
from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read
from backend.mcp.live import get_manager

TOOLKIT = "google_maps"
TOOL = "GOOGLE_MAPS_GET_ROUTE"


class TravelSettings(StrictModel):
    home: str = Field(default="", max_length=500)
    direction: str = Field(default="minimal", max_length=20)
    enabled: bool = True


async def provide(widget_id):
    settings = TravelSettings.model_validate(settings_read(widget_id))
    if not settings.enabled or not connectors.access_enabled("task.agenda"):
        raise connectors.SourceUnavailable
    if not settings.home.strip():
        return {"items": [{"id": "setup", "title": "set location"}], "set_location": True}
    manager = get_manager()
    if not manager or not manager.registry.resolve_tool(TOOL):
        return {"items": [{"id": "unavailable", "title": "not available"}]}
    zone = ZoneInfo(
        settings_read("task.free").get(
            "timezone", settings_read("dash.quiet").get("timezone", "UTC")
        )
    )
    now = planning.clock(zone)
    calendar = await agenda.provide(widget_id, now=now, future=True)
    upcoming = [
        event
        for event in calendar["items"]
        if event.get("location") and planning.date_time(event["start"], zone) >= now
    ]
    if not upcoming:
        if calendar["limited"]:
            return {"items": [{"id": "unavailable", "title": "not available"}]}
        return {"items": [], "message": "No upcoming event with a location."}
    event = upcoming[0]
    try:
        value = await connectors.read(
            widget_id,
            TOOLKIT,
            TOOL,
            {
                "origin_address": settings.home.strip(),
                "destination_address": event["location"],
                "travel_mode": "DRIVE",
                "field_mask": "routes.duration",
            },
        )
    except connectors.SourceUnavailable:
        return {"items": [{"id": "unavailable", "title": "not available"}]}
    seconds = value.get("duration_seconds")
    if seconds is None:
        return {"items": [{"id": "unavailable", "title": "not available"}]}
    return {
        "timezone": str(zone),
        "direction": settings.direction,
        "home": settings.home.strip(),
        "origin": settings.home.strip(),
        "destination": event.get("location") or event["title"],
        "event_title": event["title"],
        "start": event["start"],
        "duration_seconds": seconds,
        "items": [
            {
                "id": event["id"],
                "title": event["title"],
                "start": event["start"],
                "location": event.get("location"),
                "detail": f"{math.ceil(seconds / 60)} minutes driving from home",
            }
        ],
    }
