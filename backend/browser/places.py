"""Reading the browser's own database.

Firefox and every fork of it -- Zen, LibreWolf, Waterfox -- keep bookmarks and
history in `places.sqlite`, an ordinary SQLite file with a schema that has
barely moved in a decade. That makes "what have I looked at" a local read with
no protocol, no extension and no automated second browser.

Two things about it are load-bearing:

* **The file must be copied before it is read.** The browser holds a write lock
  and keeps a `-wal` beside it, so opening the original read-only either blocks
  or reports a database from before the last commit. The copy takes the `-wal`
  and `-shm` too, or recent bookmarks are missing from a file that opens fine.
* **Times are microseconds since the epoch**, not seconds. Reading them as
  seconds puts every bookmark in the year 57000, and nothing complains.

Reading only. Closing a tab or moving a bookmark needs Firefox's remote agent or
a WebExtension talking back to PSOK, which is a protocol; listing and searching
what is already there is most of the value and needs none.
"""

from __future__ import annotations

import contextlib
import shutil
import sqlite3
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

PLACES = "places.sqlite"

#: Where the Firefox family keeps profiles, in the order they are searched.
#: Zen first because it is the browser on this machine; the rest so a different
#: machine needs a setting rather than a patch.
PROFILE_ROOTS = (
    "~/.config/zen",
    "~/.zen",
    "~/.mozilla/firefox",
    "~/.librewolf",
    "~/.waterfox",
    "~/Library/Application Support/zen/Profiles",
    "~/Library/Application Support/Firefox/Profiles",
    "~/AppData/Roaming/Mozilla/Firefox/Profiles",
)

#: The folder Firefox creates on a fresh profile, holding four links to its own
#: site. Nobody bookmarked those, and capturing them makes the first sync look
#: like it invented four articles. Matched by folder title because the seed
#: bookmarks' guids are generated per profile, so there is no stable id to skip.
SEED_FOLDER = "Mozilla Firefox"

#: A bookmark can point at a `place:` query (Firefox's smart folders), a
#: `javascript:` bookmarklet or a local file. None of those is a page to fetch.
FETCHABLE_SCHEMES = ("http://", "https://")


class PlacesError(RuntimeError):
    """The browser database could not be read. Carries a sentence to show someone."""


@dataclass(frozen=True)
class Bookmark:
    guid: str
    title: str
    url: str
    folder: str
    added_at: datetime
    modified_at: datetime

    @property
    def source_ref(self) -> str:
        """Stable across a title change, a move between folders, and a re-sync."""
        return f"bookmark:{self.guid}"


@dataclass(frozen=True)
class Visit:
    url: str
    title: str
    visits: int
    last_visit: datetime | None


def _epoch(microseconds: int | None) -> datetime | None:
    if not microseconds:
        return None
    try:
        return datetime.fromtimestamp(microseconds / 1_000_000)
    except (OverflowError, OSError, ValueError):
        return None


def find_profile(configured: str | None = None) -> Path:
    """The profile directory to read, or a sentence saying why there is none.

    A configured path wins outright, including when it is wrong -- being told
    "that directory has no places.sqlite in it" is more use than being silently
    given a different browser's history.
    """
    if configured:
        directory = Path(configured).expanduser()
        if not (directory / PLACES).is_file():
            raise PlacesError(f"no {PLACES} in {directory}. Check the configured profile path.")
        return directory

    candidates: list[Path] = []
    for root in PROFILE_ROOTS:
        base = Path(root).expanduser()
        if not base.is_dir():
            continue
        candidates.extend(child for child in base.iterdir() if (child / PLACES).is_file())

    if not candidates:
        raise PlacesError(
            "no Firefox-family browser profile was found on this machine. PSOK reads"
            f" bookmarks from a profile's {PLACES}; set the profile directory if the"
            " browser lives somewhere unusual."
        )
    # Most recently written wins: someone with an old profile lying around means
    # the live one, and mtime is the only evidence of which that is.
    return max(candidates, key=lambda p: (p / PLACES).stat().st_mtime)


@contextlib.contextmanager
def snapshot(profile: Path) -> Iterator[sqlite3.Connection]:
    """A readable copy of places.sqlite, deleted when the caller is done.

    The `-wal` and `-shm` are copied alongside deliberately. Without the `-wal`
    the copy opens perfectly and is simply *older* than the browser -- so a
    bookmark added a minute ago is absent, with nothing to indicate why.
    """
    source = profile / PLACES
    if not source.is_file():
        raise PlacesError(f"no {PLACES} in {profile}")

    with tempfile.TemporaryDirectory(prefix="psok-places-") as directory:
        target = Path(directory) / PLACES
        try:
            shutil.copy2(source, target)
            for suffix in ("-wal", "-shm"):
                sidecar = source.with_name(source.name + suffix)
                if sidecar.exists():
                    shutil.copy2(sidecar, target.with_name(target.name + suffix))
        except OSError as exc:
            raise PlacesError(f"could not copy the browser database: {exc}") from exc

        connection = sqlite3.connect(target)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        except sqlite3.DatabaseError as exc:
            raise PlacesError(f"the browser database could not be read: {exc}") from exc
        finally:
            connection.close()


_BOOKMARK_SQL = """
SELECT b.guid, b.title, b.dateAdded, b.lastModified, p.url,
       COALESCE(f.title, '') AS folder
FROM moz_bookmarks b
JOIN moz_places p ON p.id = b.fk
LEFT JOIN moz_bookmarks f ON f.id = b.parent
WHERE b.type = 1 AND b.fk IS NOT NULL
ORDER BY b.dateAdded ASC
"""


def bookmarks(profile: Path) -> list[Bookmark]:
    """Every real bookmark, oldest first, minus the ones nobody made."""
    with snapshot(profile) as connection:
        rows = connection.execute(_BOOKMARK_SQL).fetchall()

    found: list[Bookmark] = []
    for row in rows:
        url = (row["url"] or "").strip()
        if not url.startswith(FETCHABLE_SCHEMES):
            continue
        if (row["folder"] or "") == SEED_FOLDER:
            continue
        added = _epoch(row["dateAdded"])
        if added is None:
            continue
        found.append(
            Bookmark(
                guid=row["guid"],
                title=(row["title"] or "").strip(),
                url=url,
                folder=(row["folder"] or "").strip(),
                added_at=added,
                modified_at=_epoch(row["lastModified"]) or added,
            )
        )
    return found


_HISTORY_SQL = """
SELECT p.url, p.title, p.visit_count, p.last_visit_date
FROM moz_places p
WHERE p.visit_count > 0
  AND (p.url LIKE :term OR IFNULL(p.title, '') LIKE :term)
  AND (:since IS NULL OR p.last_visit_date >= :since)
ORDER BY p.last_visit_date DESC
LIMIT :limit
"""


def history(
    profile: Path, query: str, *, limit: int = 20, since_days: int | None = None
) -> list[Visit]:
    """Pages matching a substring of the URL or title, most recent first.

    A `LIKE` rather than the retrieval index, and that is the design: sixteen
    thousand pages is an embedding bill and a large index for material that is
    mostly noise, and the question people actually ask of their history --
    "what was that site about X" -- is answered by a substring against a title.
    Bookmarks are the part worth indexing, because bookmarking is the act of
    saying a page mattered.
    """
    query = (query or "").strip()
    if not query:
        raise PlacesError("searching history needs something to search for")

    since = None
    if since_days:
        cutoff = datetime.now().timestamp() - since_days * 86_400
        since = int(cutoff * 1_000_000)

    with snapshot(profile) as connection:
        rows = connection.execute(
            _HISTORY_SQL,
            {
                # Escaping is not needed: `%` or `_` in the term makes the match
                # broader, never a syntax error, and the value is bound.
                "term": f"%{query}%",
                "since": since,
                "limit": max(1, min(int(limit), 100)),
            },
        ).fetchall()

    return [
        Visit(
            url=row["url"],
            title=(row["title"] or "").strip(),
            visits=row["visit_count"] or 0,
            last_visit=_epoch(row["last_visit_date"]),
        )
        for row in rows
    ]


def counts(profile: Path) -> dict[str, int]:
    """What is in there, for a status line that is measured rather than claimed."""
    with snapshot(profile) as connection:
        return {
            "bookmarks": connection.execute(
                "SELECT COUNT(*) AS n FROM moz_bookmarks WHERE type = 1 AND fk IS NOT NULL"
            ).fetchone()["n"],
            "pages": connection.execute("SELECT COUNT(*) AS n FROM moz_places").fetchone()["n"],
            "visits": connection.execute(
                "SELECT COUNT(*) AS n FROM moz_historyvisits"
            ).fetchone()["n"],
        }
