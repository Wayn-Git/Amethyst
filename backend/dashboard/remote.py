"""Minimal projections for the shared Composio read cache."""

import re
from urllib.parse import parse_qs, urlsplit


def mentions(body):
    return re.findall(r"(?<![\w@])@([\w-]+)", body or "")


def project(slug, value, arguments=None):
    if isinstance(value, dict):
        value = value.get("data", value)
    if slug == "GOOGLECALENDAR_FIND_EVENT":
        rows = value if isinstance(value, list) else value.get("items", value.get("events"))
        if not isinstance(rows, list):
            raise ValueError("Invalid calendar response")
        items = []
        for row in rows:
            item = {key: row[key] for key in ("id", "summary", "status") if key in row}
            for key in ("start", "end"):
                if key in row:
                    when = row[key]
                    item[key] = (
                        when
                        if isinstance(when, str)
                        else {
                            field: when[field]
                            for field in ("date", "dateTime", "timeZone")
                            if field in when
                        }
                    )
            items.append(item)
        return {
            "items": items,
            "nextPageToken": bool(isinstance(value, dict) and value.get("nextPageToken")),
        }
    if slug == "GITHUB_GET_THE_AUTHENTICATED_USER":
        return {"login": value["login"]}
    if slug == "SLACK_TEST_AUTH":
        if not value.get("ok", True):
            raise ValueError("Slack authentication failed")
        return {"user_id": value["user_id"]}
    if slug == "SLACK_SEARCH_MESSAGES":
        messages = value["messages"]
        return {
            "items": [slack_row(row) for row in messages["matches"]],
            "limited": messages.get("paging", {}).get("pages", 1) > 1,
        }
    if slug == "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION":
        return {
            "items": [
                {"id": row["ts"], "user": row.get("user", ""), "title": row.get("text", "")[:200]}
                for row in value["messages"]
            ],
            "cursor": value.get("response_metadata", {}).get("next_cursor", ""),
            "limited": bool(value.get("has_more")),
        }
    if slug == "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER":
        rows = value if isinstance(value, list) else value["repositories"]
        return {
            "items": [{"name": row["full_name"]} for row in rows],
            "limited": len(rows) >= (arguments or {}).get("per_page", 50),
        }
    if slug == "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY":
        rows = value["workflow_runs"]
        return {
            "items": [
                {
                    "status": row["status"],
                    "conclusion": row.get("conclusion"),
                    "at": row["created_at"],
                    "url": row.get("html_url", ""),
                }
                for row in rows
            ]
        }
    search = slug == "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
    rows = value["items"] if search else value
    if not isinstance(rows, list):
        raise ValueError("Invalid GitHub response")
    if search and "mentions:" not in (arguments or {}).get("q", ""):
        return {
            "items": [
                {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "url": row.get("html_url", ""),
                    "at": row.get("updated_at"),
                }
                for row in rows
            ],
            "limited": bool(
                value.get("incomplete_results") or value.get("total_count", len(rows)) > len(rows)
            ),
        }
    return {
        "items": [
            github_row(row)
            if search
            else {
                "user": row.get("user", {}).get("login", ""),
                "mentions": mentions(row.get("body")),
                "at": row.get("updated_at") or row.get("submitted_at") or row.get("created_at"),
                "url": row.get("html_url", ""),
            }
            for row in rows
        ],
        "limited": bool(
            search
            and (value.get("incomplete_results") or value.get("total_count", len(rows)) > len(rows))
        ),
    }


def github_row(row):
    return {
        "id": str(row["id"]),
        "title": row.get("title", ""),
        "url": row.get("html_url", ""),
        "number": row.get("number"),
        "repository_url": row.get("repository_url", ""),
        "user": row.get("user", {}).get("login", ""),
        "mentions": mentions(row.get("body")),
        "at": (
            row.get("created_at")
            if "title" in row
            else row.get("updated_at") or row.get("submitted_at") or row.get("created_at")
        ),
        "pull_request": "pull_request" in row,
    }


def slack_row(row):
    return {
        "id": row["ts"],
        "thread": row.get("thread_ts")
        or parse_qs(urlsplit(row.get("permalink", "")).query).get("thread_ts", [row["ts"]])[0],
        "user": row.get("user", ""),
        "title": row.get("text", "")[:200],
        "channel": row.get("channel", {}).get("id", ""),
        "url": row.get("permalink", ""),
    }


def project_mail(row):
    from backend.agent.projection import project_email_item

    headers = row.get("payload", {}).get("headers") or row.get("headers") or []
    if isinstance(headers, list):
        headers = {
            h.get("name", "").lower(): h.get("value", "") for h in headers if isinstance(h, dict)
        }
    elif isinstance(headers, dict):
        headers = {str(k).lower(): v for k, v in headers.items()}
    else:
        headers = {}
    return {
        **project_email_item(row),
        "to": str(row.get("to") or headers.get("to") or "")[:2000],
        "newsletter": bool(headers.get("list-unsubscribe") or headers.get("list-id")),
        "sent": "SENT" in (row.get("labelIds") or row.get("label_ids") or []),
    }
