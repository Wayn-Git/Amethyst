"""Read-only correspondence projections through the shared Composio reader."""

from backend.dashboard import connectors


async def slack_dms(widget_id):
    me = (await connectors.read(widget_id, "slack", "SLACK_TEST_AUTH", {}))["user_id"]
    found = await connectors.read(
        widget_id,
        "slack",
        "SLACK_SEARCH_MESSAGES",
        {"query": "in:dm", "count": 100, "sort": "timestamp", "sort_dir": "desc"},
    )
    latest = {}
    for row in found["items"]:
        channel = row["channel"]
        if channel and (channel not in latest or float(row["id"]) > float(latest[channel]["id"])):
            latest[channel] = row
    items = []
    for channel in latest:
        result = await connectors.read(
            widget_id,
            "slack",
            "SLACK_SEARCH_MESSAGES",
            {"query": f"in:{channel}", "count": 1, "sort": "timestamp", "sort_dir": "desc"},
        )
        if result["items"]:
            row = result["items"][0]
            if row["user"] and row["user"] != me:
                items.append(
                    {
                        "id": channel,
                        "title": row["title"],
                        "url": row["url"],
                        "source": "Slack",
                        "person": row["user"],
                    }
                )
    return {"items": items, "limited": found["limited"]}


async def provide(widget_id):
    return await slack_dms(widget_id)
