from __future__ import annotations

import pytest

from backend.mcp.config import ServerConfig, Source, Transport
from backend.mcp.provider_ownership import (
    PROVIDER_MAPPING,
    forget,
    get_active_local_servers,
    is_provider_overridden_by_local,
)


@pytest.fixture(autouse=True)
def reset_ownership_cache():
    forget()
    yield
    forget()



def test_local_google_workspace_overrides_composio_gmail(monkeypatch):
    dummy_servers = {
        "google-workspace": ServerConfig(
            name="google-workspace",
            enabled=True,
            transport=Transport.STDIO,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr(
        "backend.mcp.commands.is_signed_in",
        lambda cfg: True if cfg.name == "google-workspace" else False,
    )

    assert is_provider_overridden_by_local("gmail") is True
    assert is_provider_overridden_by_local("googlecalendar") is True
    assert is_provider_overridden_by_local("slack") is False


def test_unauthenticated_local_does_not_override_composio(monkeypatch):
    dummy_servers = {
        "google-workspace": ServerConfig(
            name="google-workspace",
            enabled=True,
            transport=Transport.STDIO,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr("backend.mcp.commands.is_signed_in", lambda cfg: False)

    assert is_provider_overridden_by_local("gmail") is False
    assert is_provider_overridden_by_local("googlecalendar") is False


def test_local_github_overrides_composio_github(monkeypatch):
    dummy_servers = {
        "github": ServerConfig(
            name="github",
            enabled=True,
            transport=Transport.STREAMABLE_HTTP,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr(
        "backend.mcp.commands.is_signed_in",
        lambda cfg: True if cfg.name == "github" else False,
    )

    assert is_provider_overridden_by_local("github") is True
    assert is_provider_overridden_by_local("slack") is False
