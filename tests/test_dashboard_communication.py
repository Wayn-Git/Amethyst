from backend.dashboard import communication, connectors


async def test_unreplied_dms(db, monkeypatch):
    async def read(widget, toolkit, slug, args):
        assert toolkit == "slack" and slug in connectors.READ_TOOLS[toolkit]
        if slug == "SLACK_TEST_AUTH":
            return {"user_id": "me"}
        if slug == "SLACK_LIST_ALL_CHANNELS":
            assert args["types"] == "im"
            return {
                "items": [{"id": "D1", "user": "them"}, {"id": "D2", "user": "other"}],
                "limited": False,
            }
        rows = [
            {
                "id": "2",
                "channel": "D1",
                "user": "them",
                "title": "Hi",
                "url": "https://slack.com/a",
            },
            {
                "id": "3",
                "channel": "D2",
                "user": "me",
                "title": "Reply",
                "url": "https://slack.com/b",
            },
        ]
        return {
            "items": rows
            if args["query"] == "in:dm"
            else [r for r in rows if args["query"] == "in:" + r["channel"]],
            "limited": False,
        }

    monkeypatch.setattr(connectors, "read", read)
    result = await communication.provide("need.lor-slack")
    assert [r["id"] for r in result["items"]] == ["D1"]
    assert "read" not in result["items"][0]

    async def empty(*args):
        return {"user_id": "me", "items": [], "limited": False}

    monkeypatch.setattr(connectors, "read", empty)
    assert (await communication.provide("need.lor-slack"))["items"] == []


async def test_thread_summaries_optional_cached_and_linked(db, monkeypatch):
    from backend.dashboard import service
    from backend.dashboard.store import cache_read, settings_write
    from backend.workers import llm

    async def read(widget, toolkit, slug, args):
        if toolkit == "slack":
            raise connectors.SourceUnavailable
        return {
            "messages": [
                {
                    "id": str(i),
                    "thread_id": "abc",
                    "subject": "Topic",
                    "snippet": "Snippet",
                    "date": "2026-10-25",
                }
                for i in range(3)
            ]
        }

    calls = []

    async def ask(prompt, **kwargs):
        assert kwargs["paid_ok"] is False
        calls.append(prompt)
        return {
            "text": (
                '[{"id":"gmail:abc","summary":"Summary fixture"},{"id":"invented","summary":"No"}]'
            )
        }

    monkeypatch.setattr(connectors, "read", read)
    monkeypatch.setattr(llm, "ask", ask)
    result = await communication.provide("comm.thread-summary")
    assert not calls and result["items"][0]["summary"] == ""
    settings_write("comm.thread-summary", {"model_enabled": True})
    await service.refresh("comm.thread-summary")
    cached = cache_read("comm.thread-summary")
    assert cached["state"] == "ok" and len(calls) == 1
    assert cached["payload"]["items"][0]["summary"] == "Summary fixture"
    assert cached["payload"]["items"][0]["url"].endswith("/abc")
    assert "snippets" not in cached["payload"]["items"][0]
    assert cached["payload"]["unavailable"] == ["Slack"]
    service.read_data("comm.thread-summary")
    assert len(calls) == 1


async def test_newsletter_detection_and_suggestions(db, monkeypatch):
    from backend.dashboard.remote import project_mail

    raw = {
        "id": "n",
        "from": "Digest <news@example.org>",
        "subject": "Weekly",
        "date": "2026-10-25",
        "body": "PRIVATE",
        "headers": [{"name": "List-Unsubscribe", "value": "https://example.org/unsubscribe"}],
    }
    # The connector projection receives no bodies and retains no unsubscribe action URL.
    row = project_mail({k: v for k, v in raw.items() if k != "body"})
    assert row["newsletter"] and "PRIVATE" not in str(row)
    assert "unsubscribe" not in str(row).lower()

    async def read(widget, toolkit, slug, args):
        assert slug == "GMAIL_FETCH_EMAILS"
        return {"messages": [row, {**row, "id": "personal", "newsletter": False}]}

    monkeypatch.setattr(connectors, "read", read)
    result = await communication.provide("comm.newsletters")
    assert len(result["items"]) == 1
    assert result["items"][0]["count"] == 1
    assert "Consider unsubscribing" in result["items"][0]["suggestion"]


async def test_contacts_metadata_and_persistence(db, monkeypatch):
    import json

    from backend.dashboard import service
    from backend.dashboard.store import cache_read

    async def read(widget, toolkit, slug, args):
        if slug == "SLACK_TEST_AUTH":
            return {"user_id": "me"}
        if slug == "SLACK_LIST_ALL_CHANNELS":
            return {"items": [{"id": "D1", "user": "them"}], "limited": False}
        if toolkit == "slack":
            return {
                "items": [
                    {
                        "id": "1700000000",
                        "channel": "D1",
                        "user": "them",
                        "title": "PRIVATE_SLACK_BODY",
                        "url": "https://slack.com/thread",
                    }
                ],
                "limited": False,
            }
        return {
            "messages": [
                {
                    "id": "a",
                    "from": "Them <them@example.org>",
                    "to": "me@example.org",
                    "subject": "Subject",
                    "snippet": "PRIVATE_MAIL",
                    "date": "2026-09-01",
                },
                {
                    "id": "b",
                    "from": "me@example.org",
                    "to": "Them <them@example.org>",
                    "sent": True,
                    "subject": "Subject",
                    "snippet": "PRIVATE_SENT",
                    "date": "2026-10-01",
                },
            ]
        }

    monkeypatch.setattr(connectors, "read", read)
    await service.refresh("comm.contacts")
    result = cache_read("comm.contacts")
    assert result["state"] == "ok"
    cards = result["payload"]["items"]
    assert cards[0]["person"] == "them@example.org" and cards[0]["at"] == "2026-10-01"
    assert len(cards[0]["threads"]) == 2
    assert "PRIVATE" not in json.dumps(result)
    assert not any(row["person"] == "me@example.org" for row in cards)

    async def unavailable(*args):
        raise connectors.SourceUnavailable

    monkeypatch.setattr(connectors, "read", unavailable)
    await service.refresh("comm.contacts")
    assert service.read_data("comm.contacts")["stale"]
    assert cache_read("comm.contacts")["payload"]["items"] == cards


async def test_reachout_manual_birthdays_and_interval_gate(db, monkeypatch):
    from datetime import UTC, datetime

    import pytest
    from fastapi import HTTPException
    from pydantic import ValidationError

    from backend.dashboard import reachout, service
    from backend.dashboard.items import decide
    from backend.dashboard.store import cache_write, settings_read

    now = datetime(2026, 10, 25, 12, tzinfo=UTC)
    monkeypatch.setattr(reachout, "local_now", lambda: now)

    async def refresh(widget):
        assert widget == "comm.contacts"
        cache_write(
            widget,
            {
                "items": [
                    {"id": "old", "title": "Old", "at": "2026-09-01", "threads": []},
                    {"id": "recent", "title": "Recent", "at": "2026-10-20", "threads": []},
                    {"id": "unknown", "title": "Unknown", "at": "", "threads": []},
                ]
            },
            "ok",
        )

    monkeypatch.setattr(service, "refresh", refresh)
    assert [r["id"] for r in (await reachout.provide())["items"]] == ["old"]
    body = reachout.ReachoutInput(days=3, birthdays=[{"name": "Manual", "birthday": "10-25"}])
    pending = reachout.draft("configure", body)
    assert settings_read("comm.reachout") == {}
    await decide("comm.reachout", pending["draft_id"], False)
    assert settings_read("comm.reachout") == {}
    pending = reachout.draft("configure", body)
    await decide("comm.reachout", pending["draft_id"], True)
    result = await reachout.provide()
    assert result["days"] == 3
    assert [r["id"] for r in result["items"]] == ["birthday:0", "old", "recent"]
    with pytest.raises(HTTPException):
        await decide("comm.reachout", pending["draft_id"], True)
    stale = reachout.draft("configure", body)
    newer = reachout.draft("configure", reachout.ReachoutInput(days=60))
    await decide("comm.reachout", newer["draft_id"], True)
    with pytest.raises(HTTPException, match="409"):
        await decide("comm.reachout", stale["draft_id"], True)
    for data in (
        {"days": 0},
        {"birthdays": [{"name": "X", "birthday": "02-30"}]},
        {"birthdays": [{"name": " ", "birthday": "01-01"}]},
    ):
        with pytest.raises(ValidationError):
            reachout.ReachoutInput.model_validate(data)


async def test_reachout_birthday_survives_missing_connectors(db, monkeypatch):
    from backend.dashboard import reachout
    from backend.dashboard.store import settings_write

    async def unavailable(*args):
        raise connectors.SourceUnavailable

    monkeypatch.setattr(connectors, "read", unavailable)
    settings_write(
        "comm.reachout",
        {"birthdays": [{"name": "Manual", "birthday": reachout.local_now().strftime("%m-%d")}]},
    )
    result = await reachout.provide()
    assert result["items"][0]["reason"] == "Birthday today"
    assert result["unavailable"]


def test_direct_message_projection_excludes_channels_and_bodies():
    from backend.dashboard.remote import project

    result = project(
        "SLACK_LIST_ALL_CHANNELS",
        {
            "channels": [
                {"id": "D1", "is_im": True, "user": "them", "latest": {"text": "PRIVATE"}},
                {"id": "C1", "is_im": False, "name": "public"},
            ],
            "response_metadata": {"next_cursor": "more"},
        },
    )
    assert result == {"items": [{"id": "D1", "user": "them"}], "limited": True}


def test_readonly_widgets_reject_writes_and_validate_models(db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.dashboard.router import router

    async def unavailable(*args):
        raise connectors.SourceUnavailable

    monkeypatch.setattr(connectors, "read", unavailable)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        for widget in (
            "need.lor-slack",
            "comm.thread-summary",
            "comm.newsletters",
            "comm.contacts",
        ):
            for action in ("send", "unsubscribe", "delete"):
                assert (
                    client.post(f"/api/widgets/{widget}/actions/{action}", json={}).status_code
                    == 404
                )
        assert (
            client.put(
                "/api/widgets/comm.thread-summary/settings",
                json={"model_enabled": True, "send": True},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/widgets/comm.reachout/actions/configure", json={"days": 0}
            ).status_code
            == 422
        )
        assert (
            client.put("/api/widgets/comm.reachout/settings", json={"birthdays": []}).status_code
            == 405
        )


async def test_empty_source_results_dispatch(db, monkeypatch):
    from backend.dashboard.service import local_provider

    async def empty(widget, toolkit, slug, args):
        return {"user_id": "me", "items": [], "messages": [], "limited": False}

    monkeypatch.setattr(connectors, "read", empty)
    for widget in (
        "need.lor-slack",
        "comm.thread-summary",
        "comm.newsletters",
        "comm.contacts",
        "comm.reachout",
    ):
        assert (await local_provider(widget))["items"] == []
