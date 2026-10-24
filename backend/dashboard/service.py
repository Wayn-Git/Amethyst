"""Cache-first, per-widget refresh with bounded concurrency and quiet-hour suppression."""

import asyncio
import logging
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from backend.config import paths
from backend.dashboard.connectors import ConnectorBackoff, SourceUnavailable, access_enabled
from backend.dashboard.registry import REGISTRY
from backend.dashboard.store import cache_read, cache_write, settings_read, stamp

log = logging.getLogger(__name__)
IN_FLIGHT = set()
RETRY_AFTER = {}
_GATE = asyncio.Semaphore(4)


def quiet_active(settings=None, now=None):
    settings = settings if settings is not None else settings_read("dash.quiet")
    now = now or datetime.now(UTC)
    until = settings.get("snoozed_until")
    if until and datetime.fromisoformat(until.replace("Z", "+00:00")) > now:
        return True
    if not settings.get("enabled"):
        return False
    local = now.astimezone(ZoneInfo(settings.get("timezone", "UTC"))).strftime("%H:%M")
    start, end = settings.get("start", "22:00"), settings.get("end", "07:00")
    return start <= local < end if start < end else local >= start or local < end


async def local_provider(widget_id):
    if widget_id in ("glance.weather", "glance.sun"):
        from backend.dashboard.weather import provide

        return await provide(widget_id)
    if widget_id == "need.mentions":
        from backend.dashboard.mentions import provide

        return await provide(widget_id)
    if widget_id in (
        "need.inbox",
        "need.drafts",
        "need.waiting",
        "comm.unread",
        "comm.tone",
        "comm.templates",
    ):
        from backend.dashboard.mail import provide

        return await provide(widget_id)
    if widget_id.startswith("sys."):
        from backend.dashboard.system import provide

        return await provide(widget_id)
    if widget_id.startswith("agent.") or widget_id in ("need.approvals", "need.decisions"):
        from backend.dashboard.director import provide

        return await provide(widget_id)
    if widget_id in ("dev.backup", "dev.unpushed"):
        from backend.dashboard.git import provide

        return await provide(widget_id)
    if widget_id in ("dev.prs", "dev.issues", "dev.ci"):
        from backend.dashboard.github import provide

        return await provide(widget_id)
    if widget_id.startswith("dev."):
        from backend.dashboard.developer import provide

        return await provide(widget_id)
    if widget_id == "glance.next-event":
        from backend.dashboard.agenda import next_event

        return await next_event()
    if widget_id == "task.agenda":
        from backend.dashboard.agenda import provide

        return await provide(widget_id)
    if widget_id.startswith("lib."):
        from backend.dashboard.library import provide

        return await provide(widget_id)
    if widget_id.startswith(("task.", "need.")):
        from backend.dashboard.items import provide

        return provide(widget_id)
    if widget_id == "glance.clock":
        return {"now": stamp(), "zones": settings_read(widget_id).get("zones", [])}
    if widget_id == "dash.quiet":
        return {**settings_read(widget_id), "active": quiet_active()}
    if widget_id == "dash.sync":
        return {
            "widgets": [
                {
                    "id": key,
                    "synced_at": cache_read(key)["synced_at"],
                    "state": cache_read(key)["state"],
                }
                for key, entry in REGISTRY.items()
                if entry["enabled"]
            ]
        }
    if widget_id == "dash.shortcuts":
        return {
            "shortcuts": [
                ["Alt+R", "Refresh Home"],
                ["Alt+Q", "Snooze refresh for one hour"],
                ["Alt+E", "Edit layout"],
                ["Arrow keys on move handle", "Move widget"],
                ["Escape", "Cancel drag or resize"],
            ]
        }
    return {"widgets": [entry["manifest"]["id"] for entry in REGISTRY.values() if entry["enabled"]]}


PROVIDERS = {key: local_provider for key in REGISTRY}


def read_data(widget_id):
    value = cache_read(widget_id)
    manifest = REGISTRY[widget_id]["manifest"]
    interval = manifest.get("refresh", {}).get("interval_s") or 3600
    expired = bool(
        value["synced_at"]
        and (datetime.now(UTC) - datetime.fromisoformat(value["synced_at"])).total_seconds()
        >= interval
    )
    stale = value["payload"] is not None and (expired or value["state"] in ("error", "stale"))
    return {
        **value,
        "state": "stale" if stale else value["state"],
        "stale": stale,
        "refreshing": (str(paths().db), widget_id) in IN_FLIGHT,
    }


async def refresh(widget_id):
    started = time.monotonic()
    previous = cache_read(widget_id)
    try:
        async with _GATE:
            from backend.dashboard.connectors import READ_TOOLS

            if any(
                requirement.removeprefix("connector:") not in READ_TOOLS
                for requirement in REGISTRY[widget_id]["manifest"].get("requires", [])
            ):
                raise SourceUnavailable
            payload = await asyncio.wait_for(PROVIDERS[widget_id](widget_id), timeout=10)
            cache_write(
                widget_id,
                payload,
                "empty"
                if payload is None
                or payload == []
                or payload == {}
                or (
                    isinstance(payload, dict)
                    and payload.get("items") == []
                    and not payload.get("history")
                )
                else "ok",
                synced_at=stamp(),
            )
    except ConnectorBackoff as exc:
        RETRY_AFTER[(str(paths().db), widget_id)] = time.monotonic() + max(
            0, exc.retry_at - time.time()
        )
        cache_write(
            widget_id,
            previous["payload"],
            "error",
            "Connector cooling down. Retry later.",
            previous["synced_at"],
        )
    except SourceUnavailable:
        interval = REGISTRY[widget_id]["manifest"]["refresh"].get("interval_s") or 900
        RETRY_AFTER[(str(paths().db), widget_id)] = time.monotonic() + interval
        cache_write(widget_id, None, "not-connected")
    except Exception:
        if widget_id == "task.agenda" and not access_enabled():
            cache_write(widget_id, None, "not-connected")
            return
        cache_write(
            widget_id,
            previous["payload"],
            "error",
            "Refresh failed. Try again.",
            previous["synced_at"],
        )
        log.exception("widget refresh failed: %s", widget_id)
    finally:
        IN_FLIGHT.discard((str(paths().db), widget_id))
        log.info(
            "widget refresh id=%s duration_ms=%d state=%s",
            widget_id,
            (time.monotonic() - started) * 1000,
            cache_read(widget_id)["state"],
        )


def schedule(widget_id, background_tasks, force=False):
    key = (str(paths().db), widget_id)
    data = read_data(widget_id)
    if key in IN_FLIGHT:
        return
    if not force and time.monotonic() < RETRY_AFTER.get(key, 0):
        return
    # Initial local data may populate during quiet hours; scheduled refreshes pause.
    if not force and data["synced_at"] and quiet_active():
        return
    retry_source = data["state"] == "not-connected" and time.monotonic() >= RETRY_AFTER.get(key, 0)
    if force:
        from backend.agent.read_cache import read_cache

        read_cache.invalidate_domain("email")
        sources = REGISTRY[widget_id]["manifest"]["source"]
        for source in sources if isinstance(sources, list) else [sources]:
            toolkit = source.get("toolkit")
            if toolkit in ("github", "slack", "googlecalendar"):
                read_cache.invalidate_domain("calendar" if toolkit == "googlecalendar" else toolkit)
        if widget_id == "glance.next-event":
            cached = cache_read("task.agenda")
            cache_write("task.agenda", cached["payload"], "stale", synced_at=cached["synced_at"])
    if force or data["state"] == "loading" or data["stale"] or retry_source:
        IN_FLIGHT.add(key)
        background_tasks.add_task(refresh, widget_id)
