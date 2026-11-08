"""Rows for the library, and where its text lives on disk.

The repository idiom of `backend/db/repositories.py`: a connection injected or
taken from the process singleton, raw `sqlite3.Row` out, commits its own writes,
local-naive timestamps written by Python rather than by SQLite's UTC `now`.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from backend.config import paths
from backend.db.connection import get_connection

log = logging.getLogger(__name__)

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
    "place",
    "idea",
    "video",
    "podcast",
    "music",
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
        "entity",
        # SaveToList feature fields
        "progress",
        "is_pinned",
        "position",
        "remind_at",
        "remind_action",
        "reminded_at",
        "private_notes",
        # Storage & migration fields
        "storage_provider",
        "external_id",
        "cached_locally",
        "sync_state",
        "checksum",
        "last_synced_at",
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


def opt_thumbnail_path(item_id: int) -> Path:
    return media_dir() / f"{item_id:06d}-thumb-opt.jpg"


def slide_path(item_id: int, index: int) -> Path:
    return media_dir() / f"{item_id:06d}-slide-{index}.jpg"


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
    if host in ("threads.net", "threads.com"):
        return "threads"
    if host in ("x.com", "twitter.com", "mobile.twitter.com"):
        return "x"
    if host in ("github.com", "gist.github.com"):
        return "github"
    if host in ("reddit.com", "old.reddit.com"):
        return "reddit"
    if host in ("spotify.com", "open.spotify.com"):
        return "spotify"
    if host in ("music.apple.com",):
        return "apple-music"
    if host in ("soundcloud.com",):
        return "soundcloud"
    if "bandcamp.com" in host:
        return "bandcamp"
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
            self.conn.execute("ALTER TABLE library_items ADD COLUMN entity TEXT")
            self.conn.commit()
        except (sqlite3.OperationalError, sqlite3.DatabaseError, Exception):
            pass

        # SaveToList columns migration
        for col, col_type in (
            ("progress", "TEXT DEFAULT 'unstarted'"),
            ("is_pinned", "INTEGER DEFAULT 0"),
            ("position", "INTEGER DEFAULT 0"),
            ("remind_at", "TEXT"),
            ("remind_action", "TEXT DEFAULT 'revisit'"),
            ("reminded_at", "TEXT"),
            ("private_notes", "TEXT"),
            ("storage_provider", "TEXT DEFAULT 'local'"),
            ("external_id", "TEXT"),
            ("cached_locally", "INTEGER DEFAULT 1"),
            ("sync_state", "TEXT DEFAULT 'synced'"),
            ("checksum", "TEXT"),
            ("last_synced_at", "TEXT"),
        ):
            try:
                self.conn.execute(f"ALTER TABLE library_items ADD COLUMN {col} {col_type}")
                self.conn.commit()
            except (sqlite3.OperationalError, sqlite3.DatabaseError, Exception):
                pass

        # Ensure library_lists columns for sync & UUID
        for col, col_type in (
            ("uuid", "TEXT"),
            ("updated_hlc", "TEXT"),
        ):
            try:
                self.conn.execute(f"ALTER TABLE library_lists ADD COLUMN {col} {col_type}")
                self.conn.commit()
            except (sqlite3.OperationalError, sqlite3.DatabaseError, Exception):
                pass

        # Backfill uuid for lists that lack it
        try:
            import uuid as _uuidlib
            unassigned = self.conn.execute("SELECT id FROM library_lists WHERE uuid IS NULL").fetchall()
            for r in unassigned:
                self.conn.execute("UPDATE library_lists SET uuid = ? WHERE id = ?", (str(_uuidlib.uuid4()), r[0]))
            if unassigned:
                self.conn.commit()
        except Exception:
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

        self.recover_stale_items()
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        try:
            self.conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS library_extracted_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
                    url TEXT NOT NULL,
                    normalized_url TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    title TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(source_item_id, normalized_url)
                );
                CREATE INDEX IF NOT EXISTS idx_extracted_links_norm ON library_extracted_links(normalized_url);
                CREATE INDEX IF NOT EXISTS idx_extracted_links_source ON library_extracted_links(source_item_id);
                CREATE INDEX IF NOT EXISTS idx_extracted_links_domain ON library_extracted_links(domain);

                CREATE TABLE IF NOT EXISTS library_lists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    icon TEXT DEFAULT 'bookmark',
                    is_smart BOOLEAN DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now')),
                    updated_hlc TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_library_lists_title ON library_lists(title);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_library_lists_uuid ON library_lists(uuid) WHERE uuid IS NOT NULL;

                CREATE TABLE IF NOT EXISTS library_list_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    list_id INTEGER NOT NULL REFERENCES library_lists(id) ON DELETE CASCADE,
                    item_id INTEGER REFERENCES library_items(id) ON DELETE CASCADE,
                    link_id INTEGER REFERENCES library_extracted_links(id) ON DELETE CASCADE,
                    position INTEGER DEFAULT 0,
                    added_at TEXT DEFAULT (datetime('now')),
                    CHECK ((item_id IS NOT NULL AND link_id IS NULL) OR (item_id IS NULL AND link_id IS NOT NULL)),
                    UNIQUE(list_id, item_id),
                    UNIQUE(list_id, link_id)
                );
                CREATE INDEX IF NOT EXISTS idx_list_members_list ON library_list_members(list_id);
                CREATE INDEX IF NOT EXISTS idx_list_members_item ON library_list_members(item_id);
                CREATE INDEX IF NOT EXISTS idx_list_members_link ON library_list_members(link_id);
                """
            )
            self.conn.commit()
        except Exception:
            pass

    def recover_stale_items(self, max_age_seconds: int = 180) -> list[int]:
        """Reset items left in 'enriching', 'processing' or 'received' by a killed or interrupted process."""
        try:
            cutoff = (datetime.now() - timedelta(seconds=max_age_seconds)).strftime("%Y-%m-%d %H:%M:%S")
            rows = self.conn.execute(
                """
                SELECT id FROM library_items
                WHERE status IN ('enriching', 'processing', 'received')
                  AND (updated_at IS NULL OR updated_at < ?)
                """,
                (cutoff,),
            ).fetchall()
            if rows:
                ids = [r["id"] for r in rows]
                placeholders = ",".join("?" for _ in ids)
                self.conn.execute(
                    f"""
                    UPDATE library_items
                    SET status = 'ready',
                        enrichment_note = coalesce(enrichment_note, 'Enrichment timed out or was interrupted')
                    WHERE id IN ({placeholders})
                    """,
                    ids,
                )
                self.conn.commit()
                return ids
        except Exception:
            pass
        return []

    def create(
        self,
        *,
        item_id: int | None = None,
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
        if item_id is not None:
            cursor = self.conn.execute(
                "INSERT OR REPLACE INTO library_items (id, kind, title, category, url, author, site, published_on,"
                " consumed_on, notes, rating, source_ref, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    item_id,
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
            created_id = item_id
        else:
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
            created_id = int(cursor.lastrowid)
        self.conn.commit()
        item_id = created_id
        try:
            from notifier.library_hook import on_library_item_saved

            on_library_item_saved(item_id=item_id, title=title, url=url, kind=kind)
        except Exception as hook_err:
            log.debug("Notifier library hook failed (ignored): %s", hook_err)
        return item_id

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
        list_id: int | None = None,
        order: str = "desc",
        since: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[sqlite3.Row]:
        sql = "SELECT DISTINCT library_items.* FROM library_items"
        joins = []
        params: list = []
        where = []
        if list_id is not None:
            joins.append("JOIN library_list_members ON library_items.id = library_list_members.item_id")
            where.append("library_list_members.list_id = ?")
            params.append(list_id)
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
        if str(order).lower() == "manual":
            sql += " ORDER BY library_items.is_pinned DESC, library_items.position ASC, library_items.consumed_on DESC, library_items.id DESC LIMIT ? OFFSET ?"
        else:
            order_dir = "ASC" if str(order).lower() == "asc" else "DESC"
            sql += f" ORDER BY library_items.is_pinned DESC, library_items.consumed_on {order_dir}, library_items.id {order_dir} LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        return self.conn.execute(sql, params).fetchall()

    def unsummarized(
        self, limit: int = 50, exclude_ids: tuple[int, ...] = ()
    ) -> list[sqlite3.Row]:
        """Items that currently have no summary and are not already being enriched."""
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            return self.conn.execute(
                f"""
                SELECT * FROM library_items
                WHERE (summary IS NULL OR summary = '')
                  AND status != 'enriching'
                  AND id NOT IN ({placeholders})
                ORDER BY id DESC
                LIMIT ?
                """,
                (*exclude_ids, limit),
            ).fetchall()
        return self.conn.execute(
            """
            SELECT * FROM library_items
            WHERE (summary IS NULL OR summary = '')
              AND status != 'enriching'
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

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
        self.conn.execute("DELETE FROM library_list_members WHERE item_id = ?", (item_id,))
        cursor = self.conn.execute("DELETE FROM library_items WHERE id = ?", (item_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def reorder(self, item_ids: list[int]) -> None:
        """Set manual sort position for a sequence of item ids."""
        if not item_ids:
            return
        self.conn.executemany(
            "UPDATE library_items SET position = ? WHERE id = ?",
            [(idx, item_id) for idx, item_id in enumerate(item_ids)],
        )
        self.conn.commit()

    def search_text(self, query: str, limit: int = 50) -> list[sqlite3.Row]:
        """Search across all text fields in library_items (titles, notes, private notes, tags, summaries)."""
        term = f"%{query}%"
        return self.conn.execute(
            """
            SELECT * FROM library_items
            WHERE title LIKE ?
               OR notes LIKE ?
               OR private_notes LIKE ?
               OR summary LIKE ?
               OR author LIKE ?
               OR url LIKE ?
               OR tags LIKE ?
               OR category LIKE ?
               OR site LIKE ?
            ORDER BY is_pinned DESC, position ASC, id DESC
            LIMIT ?
            """,
            (term, term, term, term, term, term, term, term, term, limit),
        ).fetchall()

    def save_extracted_link(
        self,
        source_item_id: int,
        url: str,
        normalized_url: str,
        domain: str,
        title: str | None = None,
    ) -> int | None:
        """Insert or return an extracted link for a source item."""
        cursor = self.conn.execute(
            """
            INSERT INTO library_extracted_links (source_item_id, url, normalized_url, domain, title)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(source_item_id, normalized_url) DO UPDATE SET
                url = excluded.url,
                title = COALESCE(excluded.title, library_extracted_links.title)
            RETURNING id
            """,
            (source_item_id, url, normalized_url, domain, title),
        )
        row = cursor.fetchone()
        self.conn.commit()
        return row[0] if row else None

    def get_extracted_links(self, item_id: int | None = None, limit: int = 100) -> list[dict]:
        """Fetch extracted outbound links."""
        if item_id is not None:
            rows = self.conn.execute(
                "SELECT * FROM library_extracted_links WHERE source_item_id = ? ORDER BY id DESC LIMIT ?",
                (item_id, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM library_extracted_links ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def create_list(
        self,
        title: str,
        description: str = "",
        icon: str = "bookmark",
        is_smart: bool = False,
        uuid: str | None = None,
    ) -> int:
        """Create a new library list."""
        import uuid as _uuidlib
        row_uuid = uuid or str(_uuidlib.uuid4())
        cursor = self.conn.execute(
            """
            INSERT INTO library_lists (title, description, icon, is_smart, uuid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            (title.strip(), description.strip(), icon.strip(), 1 if is_smart else 0, row_uuid),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_lists(self) -> list[dict]:
        """Fetch all lists with member counts and optional cover thumbnail."""
        rows = self.conn.execute(
            """
            SELECT l.*,
                   COUNT(DISTINCT m.item_id) as item_count,
                   COUNT(DISTINCT m.link_id) as link_count,
                   (
                       SELECT m2.item_id 
                       FROM library_list_members m2
                       JOIN library_items i2 ON m2.item_id = i2.id
                       WHERE m2.list_id = l.id AND i2.thumbnail_path IS NOT NULL
                       ORDER BY m2.position ASC, m2.added_at DESC
                       LIMIT 1
                   ) as cover_item_id
            FROM library_lists l
            LEFT JOIN library_list_members m ON l.id = m.list_id
            GROUP BY l.id
            ORDER BY l.is_smart DESC, l.title ASC
            """
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("cover_item_id"):
                d["thumbnail_url"] = f"/api/library/{d['cover_item_id']}/thumbnail"
            result.append(d)
        return result

    def get_list(self, list_id: int) -> dict | None:
        """Fetch a single list by ID."""
        row = self.conn.execute("SELECT * FROM library_lists WHERE id = ?", (list_id,)).fetchone()
        return dict(row) if row else None

    def delete_list(self, list_id: int) -> bool:
        """Delete a list and its member relations."""
        self.conn.execute("DELETE FROM library_list_members WHERE list_id = ?", (list_id,))
        cursor = self.conn.execute("DELETE FROM library_lists WHERE id = ?", (list_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def update_list(
        self,
        list_id: int,
        title: str | None = None,
        description: str | None = None,
        icon: str | None = None,
    ) -> bool:
        """Update list metadata."""
        sets = []
        params = []
        if title is not None:
            sets.append("title = ?")
            params.append(title.strip())
        if description is not None:
            sets.append("description = ?")
            params.append(description.strip())
        if icon is not None:
            sets.append("icon = ?")
            params.append(icon.strip())
        if not sets:
            return False
        sets.append("updated_at = datetime('now')")
        params.append(list_id)
        cursor = self.conn.execute(
            f"UPDATE library_lists SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_item_collections(self, item_id: int) -> list[dict]:
        """Fetch all collections/lists that an item belongs to."""
        rows = self.conn.execute(
            """
            SELECT l.id, l.title, l.icon, l.is_smart
            FROM library_lists l
            JOIN library_list_members m ON l.id = m.list_id
            WHERE m.item_id = ?
            ORDER BY l.title ASC
            """,
            (item_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def add_list_member(
        self,
        list_id: int,
        item_id: int | None = None,
        link_id: int | None = None,
        position: int = 0,
    ) -> bool:
        """Add an item or extracted link to a list. Returns False if already in list."""
        if (item_id is None and link_id is None) or (item_id is not None and link_id is not None):
            return False
        cursor = self.conn.execute(
            """
            INSERT OR IGNORE INTO library_list_members (list_id, item_id, link_id, position)
            VALUES (?, ?, ?, ?)
            """,
            (list_id, item_id, link_id, position),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def remove_list_member(
        self,
        list_id: int,
        item_id: int | None = None,
        link_id: int | None = None,
    ) -> bool:
        """Remove a member from a list."""
        if item_id is not None:
            cursor = self.conn.execute(
                "DELETE FROM library_list_members WHERE list_id = ? AND item_id = ?",
                (list_id, item_id),
            )
        elif link_id is not None:
            cursor = self.conn.execute(
                "DELETE FROM library_list_members WHERE list_id = ? AND link_id = ?",
                (list_id, link_id),
            )
        else:
            return False
        self.conn.commit()
        return cursor.rowcount > 0

    def get_list_members(self, list_id: int) -> dict[str, list]:
        """Fetch all items and extracted links belonging to a list."""
        item_rows = self.conn.execute(
            """
            SELECT i.*, m.position as member_position, m.added_at as member_added_at
            FROM library_items i
            JOIN library_list_members m ON i.id = m.item_id
            WHERE m.list_id = ?
            ORDER BY m.position ASC, m.added_at DESC
            """,
            (list_id,),
        ).fetchall()

        link_rows = self.conn.execute(
            """
            SELECT l.*, m.position as member_position, m.added_at as member_added_at
            FROM library_extracted_links l
            JOIN library_list_members m ON l.id = m.link_id
            WHERE m.list_id = ?
            ORDER BY m.position ASC, m.added_at DESC
            """,
            (list_id,),
        ).fetchall()

        from backend.library.service import as_dict
        formatted_items = []
        for r in item_rows:
            d = as_dict(r, include_content=False, store=self)
            d["member_position"] = r["member_position"]
            d["member_added_at"] = r["member_added_at"]
            formatted_items.append(d)

        return {
            "items": formatted_items,
            "links": [dict(r) for r in link_rows],
        }
