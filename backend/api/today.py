"""Independent, bounded Today sources; no LLM calls during page load."""

import asyncio
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import ValidationError

from backend.config import paths
from backend.today import TodayItem, items, now, patch_item, save_item, save_snapshot, snapshot
from backend.today_import import ConversationImport, import_conversation
from backend.today_sync import due_threads, refresh_threads

router = APIRouter(prefix="/api/today", tags=["today"])
log = logging.getLogger(__name__)
_refreshing: set[str] = set()


@router.get("/items")
async def list_items(background_tasks: BackgroundTasks):
    lock_key = str(paths().db) + ":tracked-mail"
    if lock_key not in _refreshing:
        pending = due_threads()
        if pending:
            _refreshing.add(lock_key)
            background_tasks.add_task(_refresh_tracked, lock_key, pending)
    return {"items": [dict(item, sync=snapshot(f"thread:{item['id']}")) for item in items()]}


async def _refresh_tracked(lock_key: str, pending: list[dict]):
    try:
        await refresh_threads(pending)
    finally:
        _refreshing.discard(lock_key)


@router.post("/items")
def create_item(body: TodayItem):
    return save_item(body)


@router.patch("/items/{item_id}")
def update_item(item_id: str, body: dict):
    try:
        return patch_item(item_id, body)
    except KeyError:
        raise HTTPException(404, "Tracked item not found") from None
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc


def age(value: str | None) -> float:
    return (
        (datetime.now(UTC) - datetime.fromisoformat(value)).total_seconds()
        if value
        else float("inf")
    )


async def refresh_mail(lock_key: str):
    previous = snapshot("mail")
    try:
        from backend.mail import threads

        rows = await asyncio.wait_for(
            threads("in:inbox (is:unread OR is:starred OR is:important)", limit=20), timeout=12
        )
        save_snapshot(
            "mail", {"items": rows, "updated_at": now(), "attempted_at": now(), "error": None}
        )
    except Exception:
        log.info("Today mail refresh unavailable", exc_info=True)
        save_snapshot(
            "mail",
            {
                **previous,
                "attempted_at": now(),
                "error": (
                    "Mail could not refresh. Check the Gmail connection in Skills & connectors."
                ),
            },
        )
    finally:
        _refreshing.discard(lock_key)


@router.get("/mail")
async def mail(background_tasks: BackgroundTasks, refresh: bool = False):
    cached = snapshot("mail")
    lock_key = str(paths().db) + ":mail"
    if (refresh or age(cached.get("attempted_at")) > 300) and lock_key not in _refreshing:
        _refreshing.add(lock_key)
        background_tasks.add_task(refresh_mail, lock_key)
    return {**cached, "items": cached.get("items", []), "refreshing": lock_key in _refreshing}


@router.get("/locations")
async def locations(q: str = Query(min_length=2, max_length=100)):
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q, "count": 5, "language": "en"},
            )
            res.raise_for_status()
        return {
            "items": [
                {
                    "name": ", ".join(filter(None, [r["name"], r.get("admin1"), r.get("country")])),
                    "latitude": r["latitude"],
                    "longitude": r["longitude"],
                }
                for r in res.json().get("results", [])
            ]
        }
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "Location search is unavailable. Try again shortly.") from exc


@router.get("/weather")
async def weather(
    latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)
):
    key = f"weather:{latitude:.3f}:{longitude:.3f}"
    cached = snapshot(key)
    if cached and age(cached.get("updated_at")) < 1800:
        return cached
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": "temperature_2m,weather_code",
                    "timezone": "auto",
                    "forecast_days": 1,
                },
            )
            res.raise_for_status()
        data = {"current": res.json()["current"], "updated_at": now(), "error": None}
        save_snapshot(key, data)
        return data
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        if cached:
            return {**cached, "error": "Weather is offline. Showing the last reading."}
        raise HTTPException(503, "Weather is unavailable. Try again shortly.") from exc


@router.post("/messages/import")
def import_messages(body: ConversationImport):
    try:
        return import_conversation(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
