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
