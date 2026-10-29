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
