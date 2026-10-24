"""Unanswered mentions from independently connected read-only sources."""

import asyncio
import re
from datetime import UTC, datetime

from backend.dashboard.connectors import SourceUnavailable, read


async def github(widget_id):
    me = (await read(widget_id, "github", "GITHUB_GET_THE_AUTHENTICATED_USER", {}))["login"]
    result = await read(
        widget_id,
        "github",
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        {"q": "is:open mentions:@me", "sort": "updated", "order": "desc", "per_page": 20},
    )
    items = []
    limited = result["limited"]
    for issue in result["items"]:
        match = re.fullmatch(
            r"https://api.github.com/repos/([^/]+)/([^/]+)", issue["repository_url"]
        )
        if not match or not isinstance(issue["number"], int):
            raise ValueError("Invalid GitHub repository")
        args = {
            "owner": match[1],
            "repo": match[2],
            "issue_number": issue["number"],
            "per_page": 100,
        }
        comments = [issue]
        slugs = ["GITHUB_LIST_ISSUE_COMMENTS"]
        if issue["pull_request"]:
            slugs += [
                "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST",
                "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST",
            ]
        for slug in slugs:
            params = dict(args)
            if slug != "GITHUB_LIST_ISSUE_COMMENTS":
                params["pull_number"] = params.pop("issue_number")
            page = 1
            while True:
                rows = await read(widget_id, "github", slug, {**params, "page": page})
                comments.extend(rows["items"])
                if len(rows["items"]) < 100:
                    break
                page += 1
        mentioned = [
            c
            for c in comments
            if me.lower() in [m.lower() for m in c["mentions"]]
            and c["user"].lower() != me.lower()
            and c["at"]
        ]
        replied = [c["at"] for c in comments[1:] if c["user"].lower() == me.lower() and c["at"]]
        if mentioned:
            latest = max(mentioned, key=lambda c: c["at"])
            if not replied or max(replied) < latest["at"]:
                items.append(
                    {
                        "id": issue["id"],
                        "title": issue["title"],
                        "url": latest["url"] or issue["url"],
                        "at": latest["at"],
                        "source": "GitHub",
                    }
                )
    return {"items": items, "limited": limited}


async def slack(widget_id):
    me = (await read(widget_id, "slack", "SLACK_TEST_AUTH", {}))["user_id"]
    result = await read(
        widget_id, "slack", "SLACK_SEARCH_MESSAGES", {"query": f"<@{me}>", "count": 20}
    )
    items = []
    for mention in result["items"]:
        if mention["user"] == me:
            continue
        args = {"channel": mention["channel"], "ts": mention["thread"], "limit": 100}
        replies = []
        while True:
            thread = await read(
                widget_id, "slack", "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", args
            )
            replies.extend(thread["items"])
            if not thread["limited"]:
                break
            if not thread["cursor"]:
                raise ValueError("Incomplete Slack thread")
            args = {**args, "cursor": thread["cursor"]}
        if any(row["user"] == me and float(row["id"]) > float(mention["id"]) for row in replies):
            continue
        items.append(
            {
                "id": mention["id"],
                "title": mention["title"],
                "url": mention["url"],
                "at": datetime.fromtimestamp(float(mention["id"]), UTC).isoformat(),
                "source": "Slack",
            }
        )
    return {"items": items, "limited": result["limited"]}


async def provide(widget_id):
    results = await asyncio.gather(slack(widget_id), github(widget_id), return_exceptions=True)
    available = [r for r in results if not isinstance(r, Exception)]
    if not available:
        if all(isinstance(r, SourceUnavailable) for r in results):
            raise SourceUnavailable
        raise RuntimeError("Mention sources unavailable")
    return {
        "items": sorted(
            [item for r in available for item in r["items"]],
            key=lambda item: item["at"],
            reverse=True,
        ),
        "limited": any(r["limited"] for r in available),
        "unavailable": [
            name
            for name, r in zip(("Slack", "GitHub"), results, strict=True)
            if isinstance(r, Exception)
        ],
    }
