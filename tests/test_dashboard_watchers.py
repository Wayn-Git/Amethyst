from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from backend.dashboard import developer, feeds, watchers
from backend.dashboard.items import decide
from backend.db.connection import get_connection, reset_connection


async def add(kind="page"):
    body = watchers.WatchInput(
        title="Fixture watch",
        kind=kind,
        target="https://example.org" if kind == "page" else "subject:fixture",
    )
    draft = watchers.draft("add", body)
    await decide("agent.watchers", draft["draft_id"], True)


async def test_watch_interval_draft_persistence_and_changes(db, monkeypatch):
    from backend import notify

    monkeypatch.setattr(notify, "_desktop_notify", AsyncMock(return_value=True))
    with pytest.raises(ValueError):
        watchers.WatchInput(interval_s=899)
    with pytest.raises(ValueError):
        watchers.WatchInput(target="file:///etc/passwd")
    draft = watchers.draft("add", watchers.WatchInput(title="Denied", target="https://example.org"))
    await decide("agent.watchers", draft["draft_id"], False)
    assert await watchers.provide() == {"items": []}
    await add()
    reset_connection()
    download = AsyncMock(return_value=(b"First", "https://example.org"))
    monkeypatch.setattr(watchers, "download", download)
    now = datetime.now(UTC)
    await watchers.tick(now)
    assert get_connection().execute("SELECT count(*) FROM notifications").fetchone()[0] == 0
    await watchers.tick(now + timedelta(seconds=899))
    assert download.await_count == 1
    download.return_value = (b"Changed", "https://example.org")
    await watchers.tick(now + timedelta(seconds=900))
    assert get_connection().execute("SELECT count(*) FROM notifications").fetchone()[0] == 1
    await watchers.tick(now + timedelta(seconds=1800))
    assert get_connection().execute("SELECT count(*) FROM notifications").fetchone()[0] == 1


async def test_mailbox_reuses_appeal_reader_and_reports_errors(db, monkeypatch):
    from backend import notify

    monkeypatch.setattr(notify, "_desktop_notify", AsyncMock(return_value=True))
    await add("mailbox")
    reader = AsyncMock(return_value=[{"id": "fixture-message"}])
    monkeypatch.setattr(developer, "inbox_messages", reader)
    now = datetime.now(UTC)
    await watchers.tick(now)
    reader.assert_awaited_once_with("agent.watchers", "subject:fixture")
    assert db.execute("SELECT count(*) FROM notifications").fetchone()[0] == 1
    await watchers.tick(now + timedelta(seconds=900))
    assert db.execute("SELECT count(*) FROM notifications").fetchone()[0] == 1
    reader.side_effect = RuntimeError("Connector unavailable")
    await watchers.tick(now + timedelta(seconds=1800))
    assert (await watchers.provide())["items"][0]["error"] == "Connector unavailable"


async def test_page_outbound_fetch_audited_and_ssrf_blocked(db, monkeypatch):
    import httpx

    from backend.db.repositories import ExecutionLogRepository

    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        feeds.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(
            transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"fixture"))
        ),
    )
    check = AsyncMock()
    monkeypatch.setattr(feeds, "check_url_async", check)
    assert (await feeds.download("https://example.org", 1, widget_id="agent.watchers"))[
        0
    ] == b"fixture"
    rows = ExecutionLogRepository().recent()
    assert rows[0]["tool_name"] == "watcher_read"
    assert "agent.watchers" in rows[0]["arguments"]
    check.side_effect = ValueError("private address")
    with pytest.raises(ValueError, match="private address"):
        await feeds.download("http://127.0.0.1", 1, widget_id="agent.watchers")
