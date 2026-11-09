"""Read-only GitHub developer cards through the shared connector reader."""

import re

from backend.dashboard.connectors import read


async def search(widget_id, query):
    return await read(
        widget_id,
        "github",
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        {"q": query, "sort": "updated", "order": "desc", "per_page": 50},
    )


async def ci(widget_id):
    repositories = await read(
        widget_id,
        "github",
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        {"per_page": 50, "sort": "pushed", "direction": "desc"},
    )
    items = []
    for repository in repositories["items"]:
        name = repository["name"]
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", name):
            raise ValueError("Invalid GitHub repository")
        owner, repo = name.split("/")
        result = await read(
            widget_id,
            "github",
            "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
            {"owner": owner, "repo": repo, "per_page": 1},
        )
        latest = max(result["items"], key=lambda row: row["at"], default=None)
        status = "No workflow runs"
        if latest:
            status = latest["conclusion"] if latest["status"] == "completed" else latest["status"]
            status = status or latest["status"]
        items.append(
            {
                "id": name,
                "title": name,
                "source": "GitHub Actions",
                "status": status,
                "url": latest["url"] if latest else "",
                "at": latest["at"] if latest else None,
            }
        )
    return {"items": items, "limited": repositories["limited"]}


async def provide(widget_id):
    if widget_id == "dev.ci":
        return await ci(widget_id)
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
