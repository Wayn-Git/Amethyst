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
