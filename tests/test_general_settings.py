"""Tests for general settings configuration, synced preferences, and helpers."""

import pytest
from backend.sync.registry import SYNCED_PREFERENCES
from backend.config import load_general_settings, save_general_setting


def test_synced_preferences_includes_general_keys():
    expected_keys = {
        "editorDestination",
        "confirmClose",
        "fullViewDefault",
        "restoreTabs",
        "preventSleep",
        "autoArchiveDays",
        "compressHistory",
        "speedProfile",
        "followUpBehavior",
        "plainTextComposer",
        "showContextUsage",
        "confettiEnabled",
        "defaultStandaloneChat",
    }
    assert expected_keys.issubset(set(SYNCED_PREFERENCES))


def test_save_and_load_general_settings():
    save_general_setting("editor_destination", "cursor")
    settings = load_general_settings()
    assert settings.get("editor_destination") == "cursor"


def test_sleep_inhibit_cycle():
    from backend.remote.power import acquire_sleep_inhibit, release_sleep_inhibit

    handle = acquire_sleep_inhibit("running agent turn")
    released = release_sleep_inhibit(handle)
    assert isinstance(released, bool)
    assert release_sleep_inhibit(None) is False


def test_api_settings_general_fields():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    with TestClient(app) as client:
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "editor_destination" in data
        assert "speed_profile" in data
        assert "prevent_sleep" in data


def test_api_patch_settings_general():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    with TestClient(app) as client:
        resp = client.patch(
            "/api/settings",
            json={"editor_destination": "cursor", "speed_profile": "turbo"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["editor_destination"] == "cursor"
        assert data["speed_profile"] == "turbo"


def test_api_db_compress():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    with TestClient(app) as client:
        resp = client.post("/api/db/compress")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "freed_bytes" in data


def test_api_archive_inactive_validation():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    with TestClient(app) as client:
        # days=0 should safely no-op
        resp = client.post("/api/conversations/archive-inactive", json={"days": 0})
        assert resp.status_code == 200
        assert resp.json()["archived_count"] == 0


def test_api_open_in_editor_validation():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    with TestClient(app) as client:
        # Non-existent path returns 404
        resp = client.post(
            "/api/desktop/open-in-editor",
            json={"path": "/nonexistent/path/for/sure/12345", "editor": "vscode"},
        )
        assert resp.status_code == 404
