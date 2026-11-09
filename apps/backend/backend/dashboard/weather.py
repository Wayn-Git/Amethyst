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
    if widget_id == "glance.air":
        raw = await fetch(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            {**params, "current": "us_aqi,european_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone"},
            widget_id,
        )
        keys = (
            "us_aqi",
            "european_aqi",
            "pm2_5",
            "pm10",
            "carbon_monoxide",
            "nitrogen_dioxide",
            "ozone",
            "time",
        )
        result = {
            key: raw["current"].get(key)
            for key in keys
            if key in raw["current"] or key in ("european_aqi", "pm2_5", "pm10", "time")
        }
        if "timezone" in raw:
            result["timezone"] = raw["timezone"]
        if isinstance(location, dict) and location.get("name"):
            result["location_name"] = location["name"]
        return result
    if widget_id == "glance.sun":
        raw = await fetch(
            "https://api.open-meteo.com/v1/forecast",
            {**params, "daily": "sunrise,sunset", "forecast_days": 2},
            widget_id,
        )
        sunrise = raw["daily"].get("sunrise", [])
        sunset = raw["daily"].get("sunset", [])
        return {
            "sunrise": sunrise[0] if sunrise else None,
            "sunset": sunset[0] if sunset else None,
            "next_sunrise": sunrise[1] if len(sunrise) > 1 else None,
            "timezone": raw["timezone"],
        }
    params.update(
        current="temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
        hourly="temperature_2m,precipitation_probability,weather_code",
        daily="temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_sum,uv_index_max",
        forecast_hours=12,
        forecast_days=7,
    )
    raw = await fetch("https://api.open-meteo.com/v1/forecast", params, widget_id)
    hourly = raw["hourly"]
    hours = [
        {"time": t, "temperature": v, "rain": r, "weather_code": code}
        for t, v, r, code in zip(
            hourly["time"],
            hourly["temperature_2m"],
            hourly["precipitation_probability"],
            hourly.get("weather_code", [None] * len(hourly["time"])),
            strict=True,
        )
    ]
    daily = raw.get("daily", {})
    days = [
        {"date": date, "temperature_max": high, "temperature_min": low, "weather_code": code}
        for date, high, low, code in zip(
            daily.get("time", []),
            daily.get("temperature_2m_max", []),
            daily.get("temperature_2m_min", []),
            daily.get("weather_code", []),
            strict=True,
        )
    ]
    sunrise = daily.get("sunrise", [])
    sunset = daily.get("sunset", [])
    precipitation_sum = daily.get("precipitation_sum", [])
    uv_index = daily.get("uv_index_max", [])
    res = {
        "temperature": raw["current"]["temperature_2m"],
        "humidity": raw["current"].get("relative_humidity_2m"),
        "feels_like": raw["current"].get("apparent_temperature"),
        "wind_speed": raw["current"].get("wind_speed_10m"),
        "precipitation": raw["current"].get("precipitation"),
        "weather_code": raw["current"].get("weather_code"),
        "is_day": raw["current"].get("is_day"),
        "hours": hours,
        "daily": days,
        "rain_alert": any(h["rain"] is not None and h["rain"] >= 50 for h in hours),
        "timezone": raw["timezone"],
        "sunrise": sunrise[0] if sunrise else None,
        "sunset": sunset[0] if sunset else None,
        "precipitation_today": precipitation_sum[0] if precipitation_sum else None,
        "uv_index": uv_index[0] if uv_index else None,
    }
    if isinstance(location, dict) and location.get("name"):
        res["location_name"] = location["name"]
    return res
