"""Minimal projections for the shared Composio read cache."""

import re


def mentions(body):
    return re.findall(r"(?<![\w@])@([\w-]+)", body or "")


def project(slug, value, arguments=None):
    if isinstance(value, dict):
        value = value.get("data", value)
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
            "items": [{"id": row["ts"], "user": row.get("user", "")} for row in value["messages"]],
            "cursor": value.get("response_metadata", {}).get("next_cursor", ""),
            "limited": bool(value.get("has_more")),
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
        "thread": row.get("thread_ts", row["ts"]),
        "user": row.get("user", ""),
        "title": row.get("text", "")[:200],
        "channel": row.get("channel", {}).get("id", ""),
        "url": row.get("permalink", ""),
    }
