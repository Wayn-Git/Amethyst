"""Rows for the library, and where its text lives on disk.

The repository idiom of `backend/db/repositories.py`: a connection injected or
taken from the process singleton, raw `sqlite3.Row` out, commits its own writes,
local-naive timestamps written by Python rather than by SQLite's UTC `now`.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import date, datetime
from pathlib import Path

from backend.config import paths
from backend.db.connection import get_connection

#: What a library item can be. Not a CHECK constraint -- SQLite cannot alter one
#: in place, and this list will grow. The service validates against it and names
#: the accepted values in the error.
#:
#: `post` is a social post -- an X/Twitter status, a Reddit thread: a thing
#: with an author and a short body, which is neither an article nor a note
#: (a note is the user's own words).
KINDS = (
    "article",
    "book",
    "video",
    "podcast",
    "newsletter",
    "paper",
    "post",
    "note",
    "other",
)

#: Longest slug in a filename, leaving room for the id prefix and the extension
#: inside the 255-byte limit every filesystem in play here shares.
MAX_SLUG_CHARS = 80

_UPDATABLE = frozenset(
    {
        "kind",
        "category",
        "title",
        "url",
        "author",
        "site",
        "published_on",
        "consumed_on",
        "notes",
        "rating",
        "document_id",
        "text_path",
        "capture_note",
        "word_count",
        # Enrichment and media. Every one of these has to be named here or
        # `update()` drops it silently -- no error, no write, and a column that
        # is simply always NULL for reasons nothing reports.
        "summary",
        "tags",
        "resources",
        "enrichment_note",
        "enrichment_model",
        "enriched_at",
        "text_source",
        "thumbnail_path",
        "media_path",
        "duration_seconds",
        "source_ref",
        "status",
    }
)

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def _now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def _today() -> str:
    return date.today().isoformat()


def library_dir() -> Path:
    directory = paths().library_dir
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def slugify(title: str) -> str:
    slug = _SLUG_STRIP.sub("-", (title or "").lower()).strip("-")
    return slug[:MAX_SLUG_CHARS].strip("-") or "untitled"


def text_path(item_id: int, title: str) -> Path:
    """Where one item's text is kept.

    The id leads, so two articles with the same title cannot collide -- which is
    also what makes `documents.path` UNIQUE impossible to trip.
    """
    return library_dir() / f"{item_id:06d}-{slugify(title)}.md"


def media_dir() -> Path:
    """Thumbnails and video, kept apart from the text.

    `~/.amethyst/library/` is a directory a person opens and reads; thirty megabytes
    of mp4 sitting between the markdown files is noise in the one place the
    filesystem-is-the-source-of-truth rule was supposed to pay off.
    """
    directory = paths().library_media_dir
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def thumbnail_path(item_id: int) -> Path:
    return media_dir() / f"{item_id:06d}-thumb.jpg"


def media_path(item_id: int, suffix: str) -> Path:
    return media_dir() / f"{item_id:06d}{suffix if suffix.startswith('.') else '.' + suffix}"


def app_tag_for_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return None
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]
    if "pinterest." in host or host == "pin.it":
        return "pinterest"
    if host in ("youtube.com", "youtu.be", "music.youtube.com"):
        return "youtube"
    if host in ("instagram.com", "instagr.am"):
        return "instagram"
    if host in ("x.com", "twitter.com", "mobile.twitter.com"):
        return "x"
    if host in ("github.com", "gist.github.com"):
        return "github"
    if host in ("reddit.com", "old.reddit.com"):
        return "reddit"
    if host in ("spotify.com", "open.spotify.com"):
        return "spotify"
    if "substack.com" in host:
        return "substack"
    if host in ("medium.com",):
        return "medium"
    if host in ("arxiv.org",):
        return "arxiv"
    if host in ("linkedin.com",):
        return "linkedin"
    if host in ("tiktok.com",):
        return "tiktok"
    return None


class LibraryStore:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()
        self._ensure_columns()

    def _ensure_columns(self) -> None:
        try:
            self.conn.execute("ALTER TABLE library_items ADD COLUMN category TEXT")
            self.conn.commit()
        except (sqlite3.OperationalError, sqlite3.DatabaseError, Exception):
            pass

        try:
            self.conn.execute("ALTER TABLE library_items ADD COLUMN status TEXT DEFAULT 'ready'")
            self.conn.commit()
        except (sqlite3.OperationalError, sqlite3.DatabaseError, Exception):
            pass

        try:
            import json as _json
            rows = self.conn.execute("SELECT id, url, tags FROM library_items WHERE url IS NOT NULL").fetchall()
            for r in rows:
                app = app_tag_for_url(r["url"])
                if not app:
                    continue
                raw_tags = []
                if r["tags"]:
                    try:
                        raw_tags = _json.loads(r["tags"])
                        if not isinstance(raw_tags, list):
                            raw_tags = []
                    except Exception:
                        raw_tags = []
                if app not in raw_tags:
                    raw_tags.append(app)
                    self.conn.execute("UPDATE library_items SET tags = ? WHERE id = ?", (_json.dumps(raw_tags), r["id"]))
            self.conn.commit()
        except Exception:
            pass

    def create(
        self,
        *,
        kind: str,
        title: str,
        category: str | None = None,
        url: str | None = None,
        author: str | None = None,
        site: str | None = None,
        published_on: str | None = None,
        consumed_on: str | None = None,
        notes: str | None = None,
        rating: int | None = None,
        source_ref: str | None = None,
    ) -> int:
        cursor = self.conn.execute(
            "INSERT INTO library_items (kind, title, category, url, author, site, published_on,"
            " consumed_on, notes, rating, source_ref, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                kind,
                title,
                category,
                url,
                author,
                site,
                published_on,
                consumed_on or _today(),
                notes,
                rating,
                source_ref,
                _now(),
                _now(),
            ),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def update(self, item_id: int, **fields) -> None:
        allowed = {k: v for k, v in fields.items() if k in _UPDATABLE}
        if not allowed:
            return
        clauses = ", ".join(f"{key} = ?" for key in allowed)
        self.conn.execute(
            f"UPDATE library_items SET {clauses}, updated_at = ? WHERE id = ?",
            (*allowed.values(), _now(), item_id),
        )
        self.conn.commit()

    def get(self, item_id: int) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM library_items WHERE id = ?", (item_id,)
        ).fetchone()

    def by_url(self, url: str) -> sqlite3.Row | None:
        """The most recent item logged for this URL, if any."""
        return self.conn.execute(
            "SELECT * FROM library_items WHERE url = ? ORDER BY id DESC LIMIT 1", (url,)
        ).fetchone()

    def by_source_ref(self, ref: str) -> sqlite3.Row | None:
        """The most recent item logged under this external identity, if any."""
        return self.conn.execute(
            "SELECT * FROM library_items WHERE source_ref = ? ORDER BY id DESC LIMIT 1", (ref,)
        ).fetchone()

    def by_document(self, document_id: int) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM library_items WHERE document_id = ?", (document_id,)
        ).fetchone()

    def by_document_ids(self, document_ids: list[int]) -> dict[int, sqlite3.Row]:
        if not document_ids:
            return {}
        placeholders = ",".join("?" * len(document_ids))
        rows = self.conn.execute(
            f"SELECT * FROM library_items WHERE document_id IN ({placeholders})", document_ids
        ).fetchall()
        return {row["document_id"]: row for row in rows}

    def list(
        self,
        *,
        kind: str | None = None,
        category: str | None = None,
        tag: str | None = None,
        order: str = "desc",
        since: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[sqlite3.Row]:
        sql = "SELECT DISTINCT library_items.* FROM library_items"
        joins = []
        params: list = []
        where = []
        if tag:
            joins.append(", json_each(library_items.tags)")
            where.append("json_each.value = ?")
            params.append(tag)
        if kind:
            where.append("kind = ?")
            params.append(kind)
        if category:
            where.append("category = ?")
            params.append(category)
        if since:
            where.append("consumed_on >= ?")
            params.append(since)
        if joins:
            sql += " " + " ".join(joins)
        if where:
            sql += " WHERE " + " AND ".join(where)
        order_dir = "ASC" if str(order).lower() == "asc" else "DESC"
        sql += f" ORDER BY library_items.consumed_on {order_dir}, library_items.id {order_dir} LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        return self.conn.execute(sql, params).fetchall()

    def unfiled(
        self,
        *,
        kind: str | None = None,
        tag: str | None = None,
        order: str = "desc",
    ) -> list[sqlite3.Row]:
        """Rows with no category of their own.

        `LibraryService.as_dict` infers a category for exactly these, so a
        filter or a count that only looked at the stored column disagreed with
        what the same items say when they are listed -- a chip reading 21 that
        showed 19 when clicked. Narrowed in SQL so the inference, which is
        Python, runs over the unfiled rows rather than the whole table.
        """
        sql = "SELECT DISTINCT library_items.* FROM library_items"
        params: list = []
        where = ["(category IS NULL OR category = '' OR category = 'general')"]
        if tag:
            sql += ", json_each(library_items.tags)"
            where.append("json_each.value = ?")
            params.append(tag)
        if kind:
            where.append("kind = ?")
            params.append(kind)
        sql += " WHERE " + " AND ".join(where)
        order_dir = "ASC" if str(order).lower() == "asc" else "DESC"
        sql += (
            f" ORDER BY library_items.consumed_on {order_dir}, library_items.id {order_dir}"
        )
        return self.conn.execute(sql, params).fetchall()

    def consumed_on(self, day: str) -> list[sqlite3.Row]:
        """Everything logged for one local calendar day. The journal's signal."""
        return self.conn.execute(
            "SELECT * FROM library_items WHERE consumed_on = ? ORDER BY id", (day,)
        ).fetchall()

    def consumed_between(self, start: str, end: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM library_items WHERE consumed_on >= ? AND consumed_on <= ?"
            " ORDER BY consumed_on, id",
            (start, end),
        ).fetchall()

    def counts(self) -> dict[str, int]:
        rows = self.conn.execute(
            "SELECT kind, COUNT(*) AS n FROM library_items GROUP BY kind"
        ).fetchall()
        return {row["kind"]: row["n"] for row in rows}

    def category_counts(self) -> dict[str, int]:
        rows = self.conn.execute(
            "SELECT category, COUNT(*) AS n FROM library_items"
            " WHERE category IS NOT NULL GROUP BY category"
        ).fetchall()
        return {row["category"]: row["n"] for row in rows}

    def delete(self, item_id: int) -> bool:
        cursor = self.conn.execute("DELETE FROM library_items WHERE id = ?", (item_id,))
        self.conn.commit()
        return cursor.rowcount > 0
