"""Today triage persists locally; unavailable providers never mean an empty inbox."""

from datetime import UTC, datetime

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.today import _refreshing, mail, refresh_mail, router
from backend.db import connection
from backend.today import TodayItem, items, patch_item, save_item, save_snapshot, snapshot


def test_tracking_survives_reopen_and_source_refresh(db):
    first = save_item(
        TodayItem(
            title="GitHub support",
            source="Gmail",
            external_id="thread-1",
            priority=True,
            state="waiting",
            follow_up_at="2026-10-25T09:00:00+05:30",
        )
    )
    patch_item(first["id"], {"snoozed_until": "2026-10-24T10:00:00Z"})
    connection.reset_connection()
    updated = save_item(
        TodayItem(
            title="GitHub support update",
            source="gmail",
            external_id="thread-1",
            summary="Support is investigating.",
        )
    )
    assert len(items()) == 1
    assert updated["id"] == first["id"]
    assert updated["created_at"] == first["created_at"]
    assert updated["priority"] is True
    assert updated["state"] == "waiting"
    assert updated["follow_up_at"] == "2026-10-25T03:30:00+00:00"
    assert updated["snoozed_until"] is not None


def test_done_and_snooze_are_reversible(db):
    row = save_item(TodayItem(title="Reply"))
    assert patch_item(row["id"], {"state": "done"})["state"] == "done"
    assert (
        patch_item(row["id"], {"state": "needs_reply", "snoozed_until": None})["state"]
        == "needs_reply"
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"url": "javascript:alert(1)"},
        {"url": "https:///broken"},
        {"title": " "},
        {"state": "imaginary"},
        {"follow_up_at": "2026-10-24"},
        {"unexpected": True},
    ],
)
def test_invalid_item_data_is_rejected(patch):
    with pytest.raises(ValidationError):
        TodayItem.model_validate({"title": "Valid title", **patch})


def test_api_updates_report_validation_and_missing_records(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        row = client.post("/api/today/items", json={"title": "Support"}).json()
        assert (
            client.patch(f"/api/today/items/{row['id']}", json={"state": "done"}).status_code == 200
        )
        assert client.patch(f"/api/today/items/{row['id']}", json={"title": ""}).status_code == 422
        assert client.patch("/api/today/items/missing", json={"state": "done"}).status_code == 404
        assert client.get("/api/today/items").json()["items"][0]["state"] == "done"


async def test_mail_first_read_returns_before_provider_is_called(db, monkeypatch):
    called = []

    async def read(*args, **kwargs):
        called.append(True)
        return [{"id": "m1", "subject": "Hello"}]

    monkeypatch.setattr("backend.mail.threads", read)
    background = BackgroundTasks()
    result = await mail(background)
    assert result["refreshing"] and not called
    await background()
    assert called and snapshot("mail")["items"][0]["id"] == "m1"
    second = BackgroundTasks()
    assert not (await mail(second))["refreshing"]
    assert not second.tasks


async def test_mail_refresh_failure_preserves_last_success(db, monkeypatch):
    stamp = datetime.now(UTC).isoformat()
    save_snapshot("mail", {"items": [{"id": "kept"}], "updated_at": stamp})

    async def fail(*args, **kwargs):
        raise RuntimeError("credential or network problem")

    monkeypatch.setattr("backend.mail.threads", fail)
    await refresh_mail("test")
    cached = snapshot("mail")
    assert cached["items"] == [{"id": "kept"}]
    assert cached["updated_at"] == stamp
    assert cached["error"]


async def test_parallel_mail_reads_schedule_one_refresh(db, monkeypatch):
    async def read(*args, **kwargs):
        return []

    monkeypatch.setattr("backend.mail.threads", read)
    first, second = BackgroundTasks(), BackgroundTasks()
    await mail(first)
    await mail(second)
    assert len(first.tasks) == 1 and not second.tasks
    await first()
    assert not _refreshing


def test_whatsapp_personal_export_updates_one_conversation(db):
    from backend.today_import import ConversationImport, import_conversation

    text = "24/10/26, 09:00 - Sam: Can we review today?\n24/10/26, 09:05 - Wayne: Yes\nMore context"
    first = import_conversation(
        ConversationImport(
            source="WhatsApp",
            title="Design group",
            content=text,
            timezone="Asia/Kolkata",
            state="waiting",
        )
    )
    assert first["occurred_at"] == "2026-10-24T03:35:00+00:00"
    assert "Wayne: Yes\nMore context" in first["summary"]
    second = import_conversation(
        ConversationImport(
            source="WhatsApp",
            title="Design group",
            content=text + "\n[24/10/26, 10:02:01] Sam: See you then",
            timezone="Asia/Kolkata",
        )
    )
    assert first["id"] == second["id"]
    assert len(items()) == 1
    assert second["summary"].startswith("Latest 3 of 3")


def test_instagram_export_sorts_reverse_chronology_and_rejects_wrong_file(db):
    import json

    from backend.today_import import ConversationImport, import_conversation

    body = ConversationImport(
        source="Instagram",
        title="Sam",
        content=json.dumps(
            {
                "messages": [
                    {"sender_name": "Sam", "timestamp_ms": 1792800000000, "content": "Latest"},
                    {"sender_name": "Wayne", "timestamp_ms": 1792700000000, "content": "Earlier"},
                ]
            }
        ),
    )
    row = import_conversation(body)
    assert row["summary"].index("Earlier") < row["summary"].index("Sam: Latest")
    with pytest.raises(ValueError, match="message_1.json"):
        import_conversation(body.model_copy(update={"content": "[]"}))


def test_import_requires_correct_date_order_and_recognizable_messages(db):
    from backend.today_import import ConversationImport, import_conversation

    body = ConversationImport(
        source="WhatsApp",
        title="Sam",
        day_first=False,
        content="10/24/26, 9:05 PM - Sam: Hello",
        timezone="UTC",
    )
    assert import_conversation(body)["occurred_at"] == "2026-10-24T21:05:00+00:00"
    with pytest.raises(ValueError, match="day/month"):
        import_conversation(body.model_copy(update={"day_first": True}))
    with pytest.raises(ValueError, match="No readable messages"):
        import_conversation(body.model_copy(update={"content": "not a chat export"}))


async def test_tracked_gmail_refresh_preserves_user_triage(db, monkeypatch):
    from backend.today_sync import due_threads, refresh_threads

    row = save_item(
        TodayItem(
            title="GitHub support",
            source="Gmail",
            external_id="thread",
            state="waiting",
            priority=True,
        )
    )

    async def read(thread_id):
        assert thread_id == "thread"
        return {
            "messages": [
                {
                    "id": "reply",
                    "from": "Support",
                    "snippet": "Your access is restored.",
                    "date": "Sat, 24 Oct 2026 10:00:00 +0530",
                }
            ]
        }

    monkeypatch.setattr("backend.mail.thread", read)
    await refresh_threads(due_threads())
    updated = items()[0]
    assert updated["id"] == row["id"]
    assert "access is restored" in updated["summary"]
    assert updated["state"] == "waiting" and updated["priority"]
    assert updated["occurred_at"] == "2026-10-24T04:30:00+00:00"
    assert not due_threads()


async def test_tracked_gmail_failure_keeps_evidence_and_sets_backoff(db, monkeypatch):
    from backend.today_sync import due_threads, refresh_threads

    row = save_item(
        TodayItem(
            title="Support", source="Gmail", external_id="thread", summary="Existing evidence"
        )
    )

    async def fail(thread_id):
        raise RuntimeError("offline")

    monkeypatch.setattr("backend.mail.thread", fail)
    await refresh_threads(due_threads())
    assert items()[0]["summary"] == "Existing evidence"
    assert snapshot(f"thread:{row['id']}")["error"]
    assert not due_threads()


def test_tracked_refresh_excludes_done_and_unconnected_sources(db):
    from backend.today_sync import due_threads

    save_item(TodayItem(title="Done", source="Gmail", external_id="done", state="done"))
    save_item(
        TodayItem(title="Personal chat", source="WhatsApp", external_id="chat", kind="message")
    )
    assert not due_threads()
