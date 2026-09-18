from backend.dashboard import communication, connectors


async def test_unreplied_dms(db, monkeypatch):
    async def read(widget, toolkit, slug, args):
        assert toolkit == "slack" and slug in connectors.READ_TOOLS[toolkit]
        if slug == "SLACK_TEST_AUTH":
            return {"user_id": "me"}
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
    from backend.dashboard import mail, service
    from backend.dashboard.store import cache_read, settings_write

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

    async def generate(prompt, **kwargs):
        calls.append(prompt)
        return '[{"id":"gmail:abc","summary":"Summary fixture"},{"id":"invented","summary":"No"}]'

    monkeypatch.setattr(connectors, "read", read)
    monkeypatch.setattr(mail, "generate", generate)
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
    assert (await communication.provide("comm.contacts"))["items"] == cards
