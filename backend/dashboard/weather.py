"""Explicit user location and minimal Open-Meteo projections."""

import time

import httpx
from pydantic import Field

from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read
from backend.db.repositories import ExecutionLogRepository


class LocationSettings(StrictModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


async def fetch(url, params, widget_id):
    started = time.monotonic()
    succeeded = False
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            value = response.json()
        succeeded = True
        return value
    finally:
        ExecutionLogRepository().record(
            tool_name="open_meteo_read",
            tool_source="api",
            arguments={"widget_id": widget_id},
            result_summary="Weather read" if succeeded else None,
            error=None if succeeded else "Weather unavailable",
            duration_ms=int((time.monotonic() - started) * 1000),
            risk_level="low",
            confirmation_decision="auto",
        )


async def provide(widget_id):
    location = settings_read("glance.weather")
    if not location:
        return {"set_location": True}
    params = {**LocationSettings.model_validate(location).model_dump(), "timezone": "auto"}
    params.update(
        current="temperature_2m",
        hourly="temperature_2m,precipitation_probability",
        forecast_hours=12,
    )
    raw = await fetch("https://api.open-meteo.com/v1/forecast", params, widget_id)
    hourly = raw["hourly"]
    hours = [
        {"time": t, "temperature": v, "rain": r}
        for t, v, r in zip(
            hourly["time"],
            hourly["temperature_2m"],
            hourly["precipitation_probability"],
            strict=True,
        )
    ]
    return {
        "temperature": raw["current"]["temperature_2m"],
        "hours": hours,
        "rain_alert": any(h["rain"] is not None and h["rain"] >= 50 for h in hours),
        "timezone": raw["timezone"],
    }
