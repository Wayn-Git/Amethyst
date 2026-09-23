from unittest.mock import patch
import pytest

from backend.db.connection import get_connection, transaction
from backend.runtime import autostart
from backend.config import load_browser, save_browser
from backend.setup_status import check_browser_status


def test_browser_watcher_refuses_without_consent(monkeypatch):
    """Verify that auto_setup does NOT enable browser capture when browser.enabled is absent from app_settings."""
    save_browser({"enabled": False})
    
    # Remove browser.enabled from app_settings (fresh machine)
    conn = get_connection()
    with transaction(conn):
        conn.execute("DELETE FROM app_settings WHERE key = 'browser.enabled'")
    
    monkeypatch.setattr("backend.browser.places.find_profile", lambda path=None: "/fake/profile")
    
    note = autostart._browser_watcher()
    assert note is None
    assert load_browser().enabled is False


def test_browser_watcher_honors_explicit_rejection(monkeypatch):
    """Verify that auto_setup does NOT enable browser capture when browser.enabled == '0'."""
    save_browser({"enabled": False})
    conn = get_connection()
    with transaction(conn):
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('browser.enabled', '0')"
            " ON CONFLICT(key) DO UPDATE SET value = '0'"
        )
    
    monkeypatch.setattr("backend.browser.places.find_profile", lambda path=None: "/fake/profile")
    
    note = autostart._browser_watcher()
    assert note is None
    assert load_browser().enabled is False


def test_browser_watcher_with_consent(monkeypatch):
    """Verify that auto_setup is idempotent and preserves browser enabled status when consented."""
    save_browser({"enabled": True})
    monkeypatch.setattr("backend.browser.places.find_profile", lambda path=None: "/fake/profile")

    note = autostart._browser_watcher()
    assert note is None
    assert load_browser().enabled is True


def test_check_browser_status(monkeypatch):
    """Verify setup_status reports availability and enablement accurately."""
    monkeypatch.setattr("backend.browser.places.find_profile", lambda path=None: "/fake/profile")
    save_browser({"enabled": True})
    
    status = check_browser_status()
    assert status["available"] is True
    assert status["enabled"] is True
