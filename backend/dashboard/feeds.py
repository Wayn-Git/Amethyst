"""User-owned feeds, reviewed writes and bounded, audited RSS/Atom reads."""

import asyncio
import json
import time
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException
from pydantic import Field, field_validator

from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.dashboard.store import cache_read, stamp
from backend.db.connection import get_connection
from backend.db.repositories import ExecutionLogRepository
from backend.mcp.ssrf import check_url_async


class FeedInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    url: str | None = Field(default=None, max_length=2048)
    tags: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("url")
    @classmethod
    def public_url(cls, value):
        if value is not None:
            parsed = urlparse(value)
            if (
                parsed.scheme not in ("http", "https")
                or not parsed.hostname
                or parsed.username
                or parsed.password
            ):
                raise ValueError("Use an HTTP(S) feed URL without credentials")
        return value

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values):
        if any(not tag.strip() or len(tag) > 50 for tag in values):
            raise ValueError("Tags must contain 1–50 characters")
        return sorted(set(tag.strip() for tag in values))


def rows():
    return [
        dict(row) for row in get_connection().execute("SELECT * FROM dashboard_feeds ORDER BY id")
    ]


def display(row):
    return {"id": row["id"], "url": row["url"], "tags": json.loads(row["tags_json"])}


def draft(action, body):
    if action not in ("add", "edit", "delete"):
        raise HTTPException(404, "Unknown feed action")
    if action == "add" and body.id is not None or action != "add" and body.id is None:
        raise HTTPException(422, "Specify an id only for existing feeds")
    if action in ("add", "edit") and not body.url:
        raise HTTPException(422, "Feed URL is required")
    payload = body.model_dump()
    if body.id:
        row = (
            get_connection()
            .execute("SELECT * FROM dashboard_feeds WHERE id=?", (body.id,))
            .fetchone()
        )
        if row is None:
            raise HTTPException(404, "Feed not found")
        payload["expected"] = dict(row)
    return save_draft("feed.rss", action, body, payload)


def apply(conn, action, body):
    body_input = FeedInput.model_validate({k: v for k, v in body.items() if k != "expected"})
    if body_input.id:
        current = conn.execute(
            "SELECT * FROM dashboard_feeds WHERE id=?", (body_input.id,)
        ).fetchone()
        if current is None or dict(current) != body["expected"]:
            raise HTTPException(409, "Feed changed. Review a new draft.")
    if action != "delete":
        duplicate = conn.execute(
            "SELECT id FROM dashboard_feeds WHERE url=? AND id!=?",
            (body_input.url, body_input.id or 0),
        ).fetchone()
        if duplicate:
            raise HTTPException(409, "Feed already exists")
    if action == "add":
        if conn.execute("SELECT count(*) FROM dashboard_feeds").fetchone()[0] >= 20:
            raise HTTPException(409, "At most 20 feeds")
        conn.execute(
            "INSERT INTO dashboard_feeds(url,tags_json,updated_at) VALUES(?,?,?)",
            (body_input.url, json.dumps(body_input.tags), stamp()),
        )
    elif action == "edit":
        conn.execute(
            "UPDATE dashboard_feeds SET url=?,tags_json=?,updated_at=? WHERE id=?",
            (body_input.url, json.dumps(body_input.tags), stamp(), body_input.id),
        )
    elif action == "delete":
        conn.execute("DELETE FROM dashboard_feeds WHERE id=?", (body_input.id,))
    else:
        raise HTTPException(404, "Unknown feed action")
    conn.execute("DELETE FROM widget_cache WHERE widget_id IN ('feed.rss','feed.news')")


async def download(url, feed_id):
    async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client:
        for _ in range(4):
            await check_url_async(url)
            started = time.monotonic()
            succeeded = False
            try:
                async with client.stream(
                    "GET",
                    url,
                    headers={
                        "Accept": "application/rss+xml, application/atom+xml, application/xml"
                    },
                ) as response:
                    if response.is_redirect:
                        url = urljoin(url, response.headers["location"])
                        continue
                    response.raise_for_status()
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 1_000_000:
                            raise ValueError("Feed exceeds 1 MB")
                    succeeded = True
                    return bytes(content), url
            finally:
                ExecutionLogRepository().record(
                    tool_name="rss_read",
                    tool_source="api",
                    arguments={"feed_id": feed_id},
                    result_summary="Feed read" if succeeded else None,
                    error=None if succeeded else "Feed request failed or redirected",
                    duration_ms=int((time.monotonic() - started) * 1000),
                    risk_level="low",
                    confirmation_decision="auto",
                )
    raise ValueError("Too many feed redirects")


def parse(content, base, feed):
    # Reject declarations before ElementTree; never expand feed-supplied entities.
    if b"<!doctype" in content.lower() or b"<!entity" in content.lower() or b"\x00" in content:
        raise ValueError("XML declarations are not supported")
    root = ET.fromstring(content)
    atom = "{http://www.w3.org/2005/Atom}"
    if root.tag == atom + "feed":
        entries = root.findall(atom + "entry")
    elif root.tag == "rss":
        entries = root.findall("channel/item")
    else:
        raise ValueError("Expected RSS 2.0 or Atom")
    items = []
    for entry in entries[:20]:
        is_atom = entry.tag.startswith(atom)
        prefix = atom if is_atom else ""
        title = (entry.findtext(prefix + "title") or "").strip()[:500]
        link = (
            next(
                (
                    n.get("href")
                    for n in entry.findall(atom + "link")
                    if n.get("rel", "alternate") == "alternate"
                ),
                None,
            )
            if is_atom
            else entry.findtext("link")
        )
        url = urljoin(base, link or "")
        parsed = urlparse(url)
        if (
            not title
            or not link
            or parsed.scheme not in ("http", "https")
            or parsed.username
            or parsed.password
        ):
            continue
        items.append(
            {
                "title": title,
                "url": url,
                "feed_id": feed["id"],
                "tags": feed["tags"],
                "published_at": (
                    entry.findtext(prefix + "published")
                    or entry.findtext(prefix + "updated")
                    or entry.findtext("pubDate")
                    or ""
                )[:100],
            }
        )
    return items


async def provide(widget_id):
    feeds = [display(row) for row in rows()]
    previous = (cache_read("feed.rss")["payload"] or {}).get("items", [])

    async def one(feed):
        try:
            content, url = await asyncio.wait_for(download(feed["url"], feed["id"]), timeout=8)
            return parse(content, url, feed), None
        except Exception:
            saved = [item for item in previous if item["feed_id"] == feed["id"]]
            return saved, {
                "feed_id": feed["id"],
                "error": "Feed unavailable; saved items may be stale",
            }

    results = await asyncio.gather(*(one(feed) for feed in feeds))
    current = {row["id"]: display(row) for row in rows()}
    unchanged = {feed["id"] for feed in feeds if current.get(feed["id"]) == feed}
    return {
        "feeds": list(current.values()),
        "items": [item for items, _ in results for item in items if item["feed_id"] in unchanged],
        "errors": [error for _, error in results if error and error["feed_id"] in unchanged],
    }
