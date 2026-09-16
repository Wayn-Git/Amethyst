from backend.dashboard.system import provide
from backend.db.connection import reset_connection


async def test_vault_counts_existing_index_and_storage(db):
    empty = await provide("sys.vault")
    assert empty["items"][0]["detail"] == "0 files · 0 bytes"
    db.execute("INSERT INTO documents(path,content_hash,size_bytes) VALUES('/fixture','test',125)")
    db.execute(
        "INSERT INTO documents(path,content_hash,size_bytes,source) "
        "VALUES('/article','test',500,'library')"
    )
    db.commit()
    reset_connection()
    value = await provide("sys.vault")
    assert value["items"][0]["detail"] == "1 files · 125 bytes"
    assert "bytes free of" in value["items"][2]["detail"]


async def test_notification_center_persists_and_reminders_fire_once(db, monkeypatch):
    from backend import notify, reminders

    monkeypatch.setattr(notify, "_notifier", lambda: None)
    assert await provide("sys.notify") == {"items": []}
    db.execute(
        "INSERT INTO reminders(title,due_at) VALUES('Due fixture','2020-01-01T00:00:00+00:00')"
    )
    db.execute(
        "INSERT INTO reminders(title,due_at,status) "
        "VALUES('Done fixture','2020-01-01T00:00:00+00:00','done')"
    )
    db.execute(
        "INSERT INTO reminders(title,due_at) VALUES('Future fixture','2099-01-01T00:00:00+00:00')"
    )
    db.commit()
    assert await reminders.fire_due() == 1
    reset_connection()
    assert await reminders.fire_due() == 0
    items = (await provide("sys.notify"))["items"]
    assert len(items) == 1 and items[0]["title"] == "Due fixture"


async def test_quiet_notifications_still_reach_center(db, monkeypatch):
    from unittest.mock import AsyncMock

    from backend import notify
    from backend.dashboard.store import settings_write

    settings_write("dash.quiet", {"snoozed_until": "2099-01-01T00:00:00+00:00"})
    desktop = AsyncMock()
    monkeypatch.setattr(notify, "_desktop_notify", desktop)
    assert not await notify.notify("Quiet fixture", "Test notification")
    desktop.assert_not_awaited()
    assert (await provide("sys.notify"))["items"][0]["title"] == "Quiet fixture"
