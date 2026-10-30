import pytest

from backend.dashboard import weather
from backend.dashboard.store import settings_write


@pytest.mark.asyncio
async def test_unset_location_never_calls_api(db, monkeypatch):
    async def fail(*args):
        raise AssertionError("No request without location")

    monkeypatch.setattr(weather, "fetch", fail)
    assert await weather.provide("glance.weather") == {"set_location": True}


@pytest.mark.asyncio
async def test_weather_projects_only_needed_fields(db, monkeypatch):
    settings_write("glance.weather", {"latitude": 0, "longitude": 0})

    async def fake(url, params, widget_id):
        assert params["latitude"] == 0
        return {
            "current": {"temperature_2m": 20, "secret": "discard"},
            "timezone": "UTC",
            "hourly": {
                "time": ["2026-10-25T12:00"],
                "temperature_2m": [21],
                "precipitation_probability": [80],
            },
        }

    monkeypatch.setattr(weather, "fetch", fake)
    result = await weather.provide("glance.weather")
    assert result["rain_alert"] is True
    assert "secret" not in str(result)


@pytest.mark.asyncio
async def test_all_weather_design_readings_use_provider_data(db, monkeypatch):
    settings_write("glance.weather", {"latitude": 0, "longitude": 0})

    async def fake(url, params, widget_id):
        assert "relative_humidity_2m" in params["current"]
        assert "wind_speed_10m" in params["current"]
        assert params["forecast_days"] == 7
        assert params["forecast_hours"] == 12
        return {
            "current": {"temperature_2m": 0, "relative_humidity_2m": 0,
                        "apparent_temperature": -2, "precipitation": 0,
                        "weather_code": 0, "wind_speed_10m": 0, "is_day": 0},
            "timezone": "UTC",
            "hourly": {"time": ["2026-10-30T12:00"], "temperature_2m": [1],
                       "precipitation_probability": [0], "weather_code": [2]},
            "daily": {"time": ["2026-10-30"], "temperature_2m_max": [5],
                      "temperature_2m_min": [-3], "weather_code": [3]},
            "unused": "discard",
        }

    monkeypatch.setattr(weather, "fetch", fake)
    result = await weather.provide("glance.weather")
    assert result["humidity"] == result["wind_speed"] == result["precipitation"] == 0
    assert result["feels_like"] == -2
    assert result["weather_code"] == result["is_day"] == 0
    assert result["hours"][0]["weather_code"] == 2
    assert result["daily"] == [{"date": "2026-10-30", "temperature_max": 5,
                                "temperature_min": -3, "weather_code": 3}]
    assert result["rain_alert"] is False
    assert "unused" not in result


def test_location_validation():
    for location in ({"latitude": 91, "longitude": 0}, {"latitude": 0, "longitude": float("nan")}):
        with pytest.raises(ValueError):
            weather.LocationSettings.model_validate(location)


@pytest.mark.asyncio
@pytest.mark.parametrize("fails", [False, True])
async def test_outbound_calls_are_audited(db, monkeypatch, fails):
    records = []

    class Response:
        def raise_for_status(self):
            if fails:
                raise RuntimeError("Unavailable")

        def json(self):
            return {"ok": True}

    async def get(self, url, **kwargs):
        return Response()

    monkeypatch.setattr(weather.httpx.AsyncClient, "get", get)
    monkeypatch.setattr(
        weather.ExecutionLogRepository, "record", lambda self, **kw: records.append(kw)
    )
    if fails:
        with pytest.raises(RuntimeError):
            await weather.fetch("https://api.open-meteo.com/v1/forecast", {}, "glance.weather")
    else:
        await weather.fetch("https://api.open-meteo.com/v1/forecast", {}, "glance.weather")
    assert len(records) == 1
    assert bool(records[0]["error"]) == fails


@pytest.mark.asyncio
async def test_sun_uses_explicit_location_and_projects_daily(db, monkeypatch):
    assert await weather.provide("glance.sun") == {"set_location": True}
    settings_write("glance.weather", {"latitude": 12, "longitude": 77})

    async def fake(url, params, widget_id):
        assert params["daily"] == "sunrise,sunset"
        assert params["latitude"] == 12
        return {"daily": {"sunrise": [None], "sunset": [None]}, "timezone": "UTC"}

    monkeypatch.setattr(weather, "fetch", fake)
    assert await weather.provide("glance.sun") == {
        "sunrise": None,
        "sunset": None,
        "timezone": "UTC",
    }


@pytest.mark.asyncio
async def test_air_minimal_fields_and_zero_values(db, monkeypatch):
    assert await weather.provide("glance.air") == {"set_location": True}
    settings_write("glance.weather", {"latitude": 0, "longitude": 0})

    async def fake(url, params, widget_id):
        assert url.startswith("https://air-quality-api.open-meteo.com/")
        return {
            "current": {"european_aqi": 0, "pm2_5": None, "pm10": 2, "time": "now", "unused": 3}
        }

    monkeypatch.setattr(weather, "fetch", fake)
    assert await weather.provide("glance.air") == {
        "european_aqi": 0,
        "pm2_5": None,
        "pm10": 2,
        "time": "now",
    }
