"""Read-only GitHub developer cards through the shared connector reader."""

from backend.dashboard.connectors import read


async def search(widget_id, query):
    return await read(
        widget_id,
        "github",
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        {"q": query, "sort": "updated", "order": "desc", "per_page": 50},
    )


async def provide(widget_id):
    if widget_id == "dev.issues":
        result = await search(widget_id, "is:issue is:open assignee:@me")
        return {
            **result,
            "items": [
                {**row, "source": "GitHub", "status": "Assigned to you"} for row in result["items"]
            ],
        }
    reviews = await search(widget_id, "is:pr is:open review-requested:@me")
    authored = await search(widget_id, "is:pr is:open author:@me")
    items = {}
    for result, status in ((reviews, "Awaiting your review"), (authored, "Your open PR")):
        for row in result["items"]:
            if row["id"] in items:
                items[row["id"]]["status"] += " · " + status
            else:
                items[row["id"]] = {**row, "source": "GitHub", "status": status}
    return {"items": list(items.values()), "limited": reviews["limited"] or authored["limited"]}
