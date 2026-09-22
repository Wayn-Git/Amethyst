"""Read-only correspondence projections through the shared Composio reader."""

import asyncio
import json
from urllib.parse import quote

from backend.dashboard import connectors, mail
from backend.dashboard.store import settings_read


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
    if widget_id == "need.lor-slack":
        return await slack_dms(widget_id)
    if widget_id == "comm.newsletters":
        return await newsletters(widget_id)
    return await summaries(widget_id)


async def mail_threads(widget_id):
    rows = await mail.messages(widget_id, "-in:drafts newer_than:30d")
    groups = {}
    for row in rows:
        key = row.get("thread_id") or row["id"]
        groups.setdefault(key, []).append(row)
    return [
        {
            "id": "gmail:" + key,
            "title": rows[-1]["subject"],
            "source": "Gmail",
            "url": "https://mail.google.com/mail/u/0/#all/" + quote(key, safe=""),
            "snippets": [r["snippet"] for r in rows],
        }
        for key, rows in groups.items()
        if len(rows) >= 3
    ]


async def slack_threads(widget_id):
    result = await connectors.read(
        widget_id,
        "slack",
        "SLACK_SEARCH_MESSAGES",
        {
            "query": "after:"
            + (mail.datetime.now(mail.UTC) - mail.timedelta(days=30)).strftime("%Y-%m-%d"),
            "count": 20,
        },
    )
    groups = {}
    for row in result["items"]:
        groups.setdefault((row["channel"], row["thread"]), row)
    items = []
    for (channel, ts), row in groups.items():
        thread = await connectors.read(
            widget_id,
            "slack",
            "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
            {"channel": channel, "ts": ts, "limit": 100},
        )
        if len(thread["items"]) >= 3:
            items.append(
                {
                    "id": "slack:" + channel + ":" + ts,
                    "title": row["title"],
                    "source": "Slack",
                    "url": row["url"],
                    "snippets": [r.get("title", "") for r in thread["items"]],
                }
            )
    return items


async def summaries(widget_id):
    results = await asyncio.gather(
        mail_threads(widget_id), slack_threads(widget_id), return_exceptions=True
    )
    available = [r for r in results if not isinstance(r, Exception)]
    if not available:
        if all(isinstance(r, connectors.SourceUnavailable) for r in results):
            raise connectors.SourceUnavailable
        raise RuntimeError("Thread sources unavailable")
    candidates = [row for result in available for row in result][:20]
    enabled = settings_read(widget_id).get("model_enabled", False)
    summaries_by_id = {}
    if candidates and enabled:
        text = await mail.generate(
            "Summarize each thread from these partial snippets. "
            'Return a JSON array of {"id", "summary"}; state uncertainty. ' + json.dumps(candidates)
        )
        result = json.loads(text)
        if not isinstance(result, list):
            raise ValueError("Invalid summaries")
        for row in result:
            if isinstance(row, dict) and isinstance(row.get("summary"), str):
                summaries_by_id[row.get("id")] = row["summary"][:2000]
    return {
        "items": [
            {k: v for k, v in row.items() if k != "snippets"}
            | {"summary": summaries_by_id.get(row["id"], "")}
            for row in candidates
        ],
        "model_enabled": enabled,
        "limited": True,
        "unavailable": [
            name
            for name, result in zip(("Gmail", "Slack"), results, strict=True)
            if isinstance(result, Exception)
        ],
    }


async def newsletters(widget_id):
    from email.utils import parseaddr

    rows = await mail.messages(widget_id, "-in:sent -in:drafts newer_than:30d")
    limited = len(rows) >= 100
    groups = {}
    for row in rows:
        if not row.get("newsletter"):
            continue
        sender = parseaddr(row["from"])[1].lower() or row["from"]
        groups.setdefault(sender, []).append(row)
    items = []
    for sender, rows in groups.items():
        rows.sort(key=lambda r: mail.mail_date(r["date"]), reverse=True)
        items.append(
            {
                "id": sender,
                "title": sender,
                "source": "Gmail",
                "url": "https://mail.google.com/mail/u/0/#all/"
                + quote(rows[0].get("thread_id") or rows[0]["id"], safe=""),
                "summary": "; ".join(r["subject"] for r in rows[:5]),
                "count": len(rows),
                "suggestion": "Consider unsubscribing in Gmail if no longer useful.",
            }
        )
    enabled = settings_read(widget_id).get("model_enabled", False)
    if items and enabled:
        text = await mail.generate(
            "Summarize this newsletter digest, using only these subjects. "
            'Return a JSON array of {"id", "summary"}. ' + json.dumps(items)
        )
        result = json.loads(text)
        if not isinstance(result, list):
            raise ValueError("Invalid newsletter digest")
        by_id = {row["id"]: row for row in items}
        for row in result:
            if (
                isinstance(row, dict)
                and row.get("id") in by_id
                and isinstance(row.get("summary"), str)
            ):
                by_id[row["id"]]["summary"] = row["summary"][:2000]
    return {"items": items, "model_enabled": enabled, "limited": limited}
