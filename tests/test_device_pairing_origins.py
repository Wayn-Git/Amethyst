import pytest
from starlette.testclient import TestClient
from backend.api.main import app


def test_start_pairing_prioritizes_secure_origin(monkeypatch):
    from backend.sync import devices as sync_devices

    monkeypatch.setattr(sync_devices, "app_url", lambda conn=None: "https://my-app.amethyst.ai")
    monkeypatch.setattr(sync_devices, "host_url", lambda: "http://192.168.1.100:8000")

    with TestClient(app) as client:
        resp = client.post("/api/devices/pair")
        assert resp.status_code == 200
        data = resp.json()
        assert data["qr"].startswith("https://my-app.amethyst.ai")
        assert "192.168.1.100" not in data["qr"]


def test_start_pairing_honors_prefer_lan_flag(monkeypatch):
    from backend.sync import devices as sync_devices

    monkeypatch.setattr(sync_devices, "app_url", lambda conn=None: "https://my-app.amethyst.ai")
    monkeypatch.setattr(sync_devices, "host_url", lambda: "http://192.168.1.100:8000")

    with TestClient(app) as client:
        resp = client.post("/api/devices/pair?prefer_lan=true")
        assert resp.status_code == 200
        data = resp.json()
        assert "192.168.1.100" in data["qr"]


def test_host_url_uses_amethyst_bind_port(monkeypatch):
    from backend.sync import devices as sync_devices

    monkeypatch.setattr(sync_devices, "lan_address", lambda: "192.168.1.50")
    monkeypatch.setenv("AMETHYST_BIND_PORT", "8002")

    assert sync_devices.host_url() == "http://192.168.1.50:8002"
