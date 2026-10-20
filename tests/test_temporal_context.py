import re
from datetime import datetime
import pytest

from backend.agent.config import agent_config
from backend.agent.prompt import (
    build_system_prompt,
    build_system_prompt_parts,
    environment_block,
    get_user_timezone,
    temporal_block,
)


def test_temporal_block_contains_all_temporal_fields():
    block = temporal_block()
    assert "<temporal_context>" in block
    assert "</temporal_context>" in block
    assert "current_date:" in block
    assert "current_time:" in block
    assert "weekday:" in block
    assert "timezone:" in block
    assert "default_windows:" in block
    assert f"upcoming_calendar: next {agent_config.default_date_window_days} days from current_date" in block
    assert f"recent_emails: past {agent_config.default_date_window_days} days from current_date" in block


def test_temporal_block_respects_client_timezone():
    client_ny = {"client_tz": "America/New_York"}
    block_ny = temporal_block(client_ny)
    assert "America/New_York" in block_ny or "EDT" in block_ny or "EST" in block_ny

    client_tokyo = {"client_tz": "Asia/Tokyo"}
    block_tokyo = temporal_block(client_tokyo)
    assert "Asia/Tokyo" in block_tokyo or "JST" in block_tokyo


def test_environment_block_includes_weekday_and_timezone():
    client = {"client_tz": "Europe/London"}
    env = environment_block(None, client=client)
    assert "<environment>" in env
    assert "weekday:" in env
    assert "timezone:" in env
    assert "Europe/London" in env or "BST" in env or "GMT" in env


def test_build_system_prompt_injects_temporal_context():
    client = {"client_tz": "America/Los_Angeles"}
    prompt = build_system_prompt(client_context=client)
    assert "<temporal_context>" in prompt
    assert "upcoming_calendar: next 7 days from current_date" in prompt
    assert "America/Los_Angeles" in prompt or "PDT" in prompt or "PST" in prompt


def test_build_system_prompt_parts_places_temporal_in_volatile():
    client = {"client_tz": "America/Chicago"}
    static, volatile = build_system_prompt_parts(client_context=client)
    assert "<temporal_context>" in volatile
    assert "America/Chicago" in volatile or "CDT" in volatile or "CST" in volatile


def test_temporal_block_custom_window_days(monkeypatch):
    monkeypatch.setattr(agent_config, "default_date_window_days", 14)
    block = temporal_block()
    assert "upcoming_calendar: next 14 days from current_date" in block
    assert "recent_emails: past 14 days from current_date" in block
