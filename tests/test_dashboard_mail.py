import pytest

from backend.dashboard import connectors, mail
from backend.dashboard.store import settings_write


async def test_inbox_fallback_and_ranking(db, monkeypatch):
    async def read(*args):
        assert args[1:3] == ("gmail", "GMAIL_FETCH_EMAILS")
        return {
            "messages": [
                {"id": "a", "subject": "Recent", "from": "a", "date": "2026-10-24", "snippet": "x"},
                {
                    "id": "b",
                    "subject": "Unread",
                    "from": "b",
                    "date": "2026-10-20",
                    "snippet": "y",
                    "unread": True,
                },
            ]
        }

    monkeypatch.setattr(connectors, "read", read)
    result = await mail.provide("need.inbox")
    assert [row["id"] for row in result["items"]] == ["b", "a"]
    assert not result["ranked"] and all("reason" not in row for row in result["items"])

    async def generate(prompt):
        return '[{"id":"a","reason":"Direct question"},{"id":"fake","reason":"Ignore"}]'

    monkeypatch.setattr(mail, "generate", generate)
    settings_write("need.inbox", {"model_enabled": True})
    assert (await mail.provide("need.inbox"))["items"][0]["reason"] == "Direct question"

    async def empty(*args):
        return {"messages": []}

    monkeypatch.setattr(connectors, "read", empty)
    assert (await mail.provide("need.inbox"))["items"] == []


async def test_shared_gmail_cache_excludes_bodies(db, monkeypatch):
    import json
    from types import SimpleNamespace

    from backend.agent.read_cache import read_cache
    from backend.mcp import live
    from backend.mcp.composio_service import composio_service
    from backend.tools.base import RiskLevel, Tool, ToolResult, ToolSource
    from backend.tools.registry import ToolRegistry

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: ["gmail"])
    monkeypatch.setattr(composio_service, "is_reauth_required", lambda _: False)
    monkeypatch.setattr(connectors, "is_provider_overridden_by_local", lambda _: False)

    async def accounts(**kw):
        return {"gmail": {}}

    monkeypatch.setattr(composio_service, "get_connections_async", accounts)
    from backend.tools import registry as tools

    monkeypatch.setattr(tools, "_connector_enabled", lambda *args: True)
    monkeypatch.setattr(tools, "_unsigned_connectors", lambda: set())
    calls = []

    async def handler(args, context):
        assert context.read_only
        calls.append(args)
        return ToolResult.ok(
            json.dumps(
                {
                    "messages": [
                        {
                            "id": "x",
                            "subject": "Subject",
                            "from": "Sender",
                            "date": "2026-10-24",
                            "snippet": "s" * 900,
                            "body": "PRIVATE_BODY",
                            "access_token": "SECRET",
                            "payload": {"body": {"data": "PRIVATE_BODY"}},
                        }
                    ]
                }
            )
        )

    registry = ToolRegistry()
    registry.confirmation.mcp_trust.trust("composio")
    registry.register(
        Tool(
            name="GMAIL_FETCH_EMAILS",
            description="Read mail",
            parameters={},
            handler=handler,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    monkeypatch.setattr(
        live,
        "_manager",
        SimpleNamespace(
            registry=registry, connections={"composio": SimpleNamespace(connected=True)}
        ),
    )
    first = await mail.messages("need.inbox", "in:inbox")
    second = await mail.messages("need.inbox", "in:inbox")
    assert first == second and len(calls) == 1
    assert len(first[0]["snippet"]) == 300
    assert "PRIVATE_BODY" not in str(read_cache._cache)
    assert "SECRET" not in str(read_cache._cache)
    with pytest.raises(RuntimeError, match="read-only"):
        await connectors.read("need.inbox", "gmail", "GMAIL_SEND_EMAIL", {})


async def test_local_drafts_gate_and_changed_row(db, monkeypatch):
    from fastapi import HTTPException

    from backend.dashboard.items import decide
    from backend.dashboard.mail import MailInput, draft, draft_row

    body = MailInput(recipient="test@example.com", subject="Fixture", text="Local body" * 100)
    pending = draft("need.drafts", "add", body)
    assert (await mail.provide("need.drafts"))["items"] == []
    await decide("need.drafts", pending["draft_id"], False)
    assert (await mail.provide("need.drafts"))["items"] == []
    pending = draft("need.drafts", "add", body)
    await decide("need.drafts", pending["draft_id"], True)
    item = (await mail.provide("need.drafts"))["items"][0]
    assert len(item["snippet"]) == 300 and "text" not in item
    assert draft_row(item["id"])["text"] == body.text
    approved = draft("need.drafts", "approve", MailInput(id=item["id"]))
    assert draft_row(item["id"])["status"] == "draft"
    await decide("need.drafts", approved["draft_id"], True)
    assert draft_row(item["id"])["status"] == "approved"
    with pytest.raises(HTTPException):
        await decide("need.drafts", approved["draft_id"], True)
    pending = draft("need.drafts", "edit", body.model_copy(update={"id": item["id"]}))
    db.execute("UPDATE dashboard_mail_drafts SET text='Changed'")
    db.commit()
    with pytest.raises(HTTPException, match="409"):
        await decide("need.drafts", pending["draft_id"], True)
    with pytest.raises(HTTPException):
        draft("need.drafts", "send", MailInput(id=item["id"]))


async def test_waiting_reply_rules_manual_and_nudge(db, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from backend.dashboard.items import decide
    from backend.dashboard.mail import MailInput, draft
    from backend.dashboard.store import cache_write

    now = datetime.now(UTC)
    old = (now - timedelta(days=5)).isoformat()

    async def messages(widget_id, query):
        if query.startswith("in:sent"):
            return [
                {"id": "s1", "thread_id": "t1", "date": old, "subject": "Waiting"},
                {"id": "s2", "thread_id": "t2", "date": old, "subject": "Answered"},
                {"id": "s3", "thread_id": "t3", "date": now.isoformat(), "subject": "New"},
                {"id": "s4", "thread_id": "t1", "date": old, "subject": "Waiting"},
            ]
        return [{"id": "r2", "thread_id": "t2", "date": now.isoformat()}]

    monkeypatch.setattr(mail, "messages", messages)
    result = await mail.provide("need.waiting")
    assert [r["id"] for r in result["items"]] == ["mail:s1"]
    pending = draft(
        "need.waiting",
        "add",
        MailInput(title="Manual", recipient="person@example.com", sent_at=now - timedelta(days=4)),
    )
    await decide("need.waiting", pending["draft_id"], True)
    result = await mail.provide("need.waiting")
    assert len(result["items"]) == 2
    cache_write("need.waiting", result, "ok")
    nudge = draft(
        "need.waiting",
        "nudge",
        MailInput(
            reference="mail:s1",
            recipient="person@example.com",
            subject="Waiting",
            text="Checking in.",
        ),
    )
    assert db.execute("SELECT COUNT(*) FROM dashboard_mail_drafts").fetchone()[0] == 0
    await decide("need.waiting", nudge["draft_id"], True)
    assert db.execute("SELECT status FROM dashboard_mail_drafts").fetchone()[0] == "draft"
    manual = next(r for r in result["items"] if r.get("manual_id"))
    completed = draft("need.waiting", "complete", MailInput(id=manual["manual_id"]))
    await decide("need.waiting", completed["draft_id"], True)
    settings_write("need.waiting", {"days": 7})
    assert (await mail.provide("need.waiting"))["items"] == []


async def test_waiting_manual_when_gmail_off(db, monkeypatch):
    async def offline(*args):
        raise connectors.SourceUnavailable()

    monkeypatch.setattr(mail, "messages", offline)
    db.execute(
        "INSERT INTO dashboard_mail_waiting(title,recipient,sent_at,updated_at) "
        "VALUES('Manual','a@example.com','2026-01-01T00:00:00Z','2026-01-01')"
    )
    db.commit()
    result = await mail.provide("need.waiting")
    assert not result["connected"] and result["items"][0]["subject"] == "Manual"


async def test_unread_groups_addresses_without_mutating_mail(db, monkeypatch):
    async def messages(widget_id, query):
        assert widget_id == "comm.unread" and query == "in:inbox is:unread"
        return [
            {
                "id": "1",
                "from": "Person <PERSON@example.com>",
                "subject": "One",
                "date": "2026-10-20",
                "snippet": "first",
            },
            {
                "id": "2",
                "from": "person@example.com",
                "subject": "Two",
                "date": "2026-10-24",
                "snippet": "second",
            },
            {
                "id": "3",
                "from": "other@example.com",
                "subject": "Three",
                "date": "2026-10-21",
                "snippet": "third",
            },
        ]

    monkeypatch.setattr(mail, "messages", messages)
    result = await mail.provide("comm.unread")
    assert len(result["items"]) == 2
    assert [row["id"] for row in result["items"][0]["items"]] == ["2", "1"]


@pytest.mark.parametrize("tone", ["short", "formal", "friendly"])
async def test_tone_rewrite_requires_review_and_preserves_original(db, monkeypatch, tone):
    from backend.dashboard.items import decide
    from backend.dashboard.mail import MailInput, ToneInput, draft, draft_row, rewrite

    db.execute(
        "INSERT INTO dashboard_mail_drafts(recipient,subject,text,updated_at) "
        "VALUES('a@example.com','Subject','Original','2026-10-24')"
    )
    db.commit()

    async def generate(prompt):
        assert tone in prompt and "Original" in prompt
        return "Rewritten fixture"

    monkeypatch.setattr(mail, "generate", generate)
    result = await rewrite(ToneInput(id=1, tone=tone))
    assert draft_row(1)["text"] == "Original"
    pending = draft("comm.tone", "rewrite", MailInput(**result))
    await decide("comm.tone", pending["draft_id"], False)
    assert draft_row(1)["text"] == "Original"
    pending = draft("comm.tone", "rewrite", MailInput(**result))
    await decide("comm.tone", pending["draft_id"], True)
    assert draft_row(1)["text"] == "Rewritten fixture"
    from fastapi import HTTPException

    with pytest.raises(HTTPException, match="409"):
        draft("comm.tone", "rewrite", MailInput(**result))


async def test_tone_model_off_keeps_draft(db, monkeypatch):
    from fastapi import HTTPException

    from backend.dashboard.mail import ToneInput, rewrite

    db.execute(
        "INSERT INTO dashboard_mail_drafts(recipient,subject,text,updated_at) "
        "VALUES('a@example.com','Subject','Original','2026-10-24')"
    )
    db.commit()

    async def generate(prompt):
        return ""

    monkeypatch.setattr(mail, "generate", generate)
    with pytest.raises(HTTPException, match="503"):
        await rewrite(ToneInput(id=1, tone="short"))
    assert db.execute("SELECT text FROM dashboard_mail_drafts").fetchone()[0] == "Original"
