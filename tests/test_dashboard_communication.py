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
