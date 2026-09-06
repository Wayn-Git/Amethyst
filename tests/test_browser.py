"""Reading the browser's bookmarks and history.

Every test names the mutation that makes it fail.

A `places.sqlite` is built here rather than copied from a real profile: the real
one is 60MB of somebody's private browsing, and a fixture that has to be
sanitised before it can be committed is a fixture that will not be.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from backend.browser.places import (
    Bookmark,
    PlacesError,
    bookmarks,
    counts,
    find_profile,
    history,
)
from backend.browser.service import BookmarkIngest, SyncReport

PLACES_SCHEMA = """
CREATE TABLE moz_places (
    id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
    visit_count INTEGER DEFAULT 0, last_visit_date INTEGER
);
CREATE TABLE moz_historyvisits (
    id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER
);
CREATE TABLE moz_bookmarks (
    id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER,
    position INTEGER, title LONGVARCHAR, dateAdded INTEGER, lastModified INTEGER, guid TEXT
);
"""


def _micros(when: datetime) -> int:
    """Firefox stores microseconds. Seconds would put every row in the year 57000."""
    return int(when.timestamp() * 1_000_000)


@pytest.fixture
def profile(tmp_path) -> Path:
    directory = tmp_path / "zen-profile"
    directory.mkdir()
    connection = sqlite3.connect(directory / "places.sqlite")
    connection.executescript(PLACES_SCHEMA)

    now = datetime.now()
    pages = [
        (1, "https://example.com/rust-async", "Async Rust, explained", 4, now - timedelta(days=1)),
        (2, "https://example.com/pasta", "The only carbonara", 1, now - timedelta(days=40)),
        (3, "https://mozilla.org/about/", "About Us", 1, now - timedelta(days=2)),
    ]
    for pid, url, title, visits, when in pages:
        connection.execute(
            "INSERT INTO moz_places (id, url, title, visit_count, last_visit_date)"
            " VALUES (?, ?, ?, ?, ?)",
            (pid, url, title, visits, _micros(when)),
        )
        connection.execute(
            "INSERT INTO moz_historyvisits (place_id, visit_date) VALUES (?, ?)",
            (pid, _micros(when)),
        )

    # Folders, then the bookmarks inside them.
    connection.execute(
        "INSERT INTO moz_bookmarks (id, type, parent, title, guid)"
        " VALUES (3, 2, 1, 'toolbar', 'f1')"
    )
    connection.execute(
        "INSERT INTO moz_bookmarks (id, type, parent, title, guid)"
        " VALUES (7, 2, 2, 'Mozilla Firefox', 'f2')"
    )
    rows = [
        (10, 1, 1, 3, "Async Rust, explained", "b-rust", now - timedelta(days=1)),
        (11, 1, 2, 3, "The only carbonara", "b-pasta", now - timedelta(days=40)),
        (12, 1, 3, 7, "About Us", "b-seed", now - timedelta(days=100)),
    ]
    for bid, kind, fk, parent, title, guid, when in rows:
        connection.execute(
            "INSERT INTO moz_bookmarks (id, type, fk, parent, title, guid, dateAdded,"
            " lastModified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (bid, kind, fk, parent, title, guid, _micros(when), _micros(when)),
        )
    # A smart folder: a bookmark row pointing at a `place:` query, not a page.
    connection.execute(
        "INSERT INTO moz_places (id, url, title) VALUES (99, 'place:sort=8', 'Recently used')"
    )
    connection.execute(
        "INSERT INTO moz_bookmarks (id, type, fk, parent, title, guid, dateAdded, lastModified)"
        " VALUES (13, 1, 99, 3, 'Recently used', 'b-smart', ?, ?)",
        (_micros(now), _micros(now)),
    )
    connection.commit()
    connection.close()
    return directory


# ------------------------------------------------------------------ reading


def test_the_seed_bookmarks_firefox_made_are_not_captured(profile):
    """A fresh profile ships four links to Mozilla's own site in a folder it
    created. Nobody bookmarked those, and capturing them makes the first sync
    look like PSOK invented four articles.

    Mutation check: drop the SEED_FOLDER check in `bookmarks`.
    """
    titles = {mark.title for mark in bookmarks(profile)}
    assert titles == {"Async Rust, explained", "The only carbonara"}
    assert "About Us" not in titles


def test_a_smart_folder_is_not_a_page_to_fetch(profile):
    """`place:` queries, `javascript:` bookmarklets and `file:` links are all
    bookmark rows and none of them is a URL anything can fetch.

    Mutation check: drop the FETCHABLE_SCHEMES check.
    """
    assert all(mark.url.startswith(("http://", "https://")) for mark in bookmarks(profile))


def test_bookmark_times_are_read_as_microseconds(profile):
    """Firefox stores microseconds since the epoch. Reading them as seconds puts
    every bookmark fifty thousand years in the future, and nothing complains.

    Mutation check: divide by 1_000 instead of 1_000_000.
    """
    added = {mark.title: mark.added_at for mark in bookmarks(profile)}
    assert added["Async Rust, explained"].year == datetime.now().year
    assert added["Async Rust, explained"] > added["The only carbonara"]


def test_a_bookmarks_ref_survives_a_rename(profile):
    """The guid is what makes the sync idempotent. A title or a folder change
    would otherwise look like a new bookmark and capture the page twice.

    Mutation check: key source_ref on the URL or the title.
    """
    mark = next(m for m in bookmarks(profile) if m.title == "The only carbonara")
    renamed = Bookmark(
        guid=mark.guid,
        title="Carbonara, actually",
        url=mark.url,
        folder="recipes",
        added_at=mark.added_at,
        modified_at=mark.modified_at,
    )
    assert renamed.source_ref == mark.source_ref


def test_history_matches_a_title_as_well_as_a_url(profile):
    """"What was that site about rust" is a question about a title. Matching only
    the URL answers it for sites that happen to be named after their subject and
    for no others.

    Mutation check: drop the title from the LIKE.
    """
    hits = history(profile, "carbonara")
    assert [visit.url for visit in hits] == ["https://example.com/pasta"]


def test_history_can_be_limited_to_recent_days(profile):
    """Mutation check: ignore since_days."""
    assert history(profile, "example", since_days=7)
    assert not [v for v in history(profile, "carbonara", since_days=7)]


def test_history_needs_something_to_search_for(profile):
    """An empty term matches sixteen thousand pages, which is not a search.

    Mutation check: allow an empty query through to the LIKE.
    """
    with pytest.raises(PlacesError):
        history(profile, "   ")


def test_a_profile_without_places_says_so(tmp_path):
    """Being told "that directory has no places.sqlite" is more use than being
    silently handed a different browser's history.

    Mutation check: fall back to the search when the configured path is wrong.
    """
    empty = tmp_path / "not-a-profile"
    empty.mkdir()
    with pytest.raises(PlacesError) as raised:
        find_profile(str(empty))
    assert "places.sqlite" in str(raised.value)


def test_counts_are_measured_rather_than_claimed(profile):
    """Mutation check: return the filtered bookmark count instead of the raw one."""
    assert counts(profile) == {"bookmarks": 4, "pages": 4, "visits": 3}


# ------------------------------------------------------------------ ingest


class FakeLibrary:
    """Stands in for LibraryService: no network, no model, no vault."""

    def __init__(self, existing: set[str] | None = None):
        self.captured: list[dict] = []
        self.enriched: list[int] = []
        self.updated: list[tuple[int, dict]] = []
        self._existing = existing or set()
        self.store = self

    # -- the LibraryStore surface BookmarkIngest touches
    def by_source_ref(self, ref: str):
        return {"id": 1} if ref in self._existing else None

    def update(self, item_id: int, **fields):
        self.updated.append((item_id, fields))

    # -- the LibraryService surface
    async def capture_url(self, url: str, **kwargs):
        self.captured.append({"url": url, **kwargs})

        class Captured:
            item = {"id": len(self.captured)}
            already_logged = False

        return Captured()

    async def enrich(self, item_id: int):
        self.enriched.append(item_id)
        return {}


async def test_a_sync_captures_each_bookmark_once(db, profile):
    """The whole point of keying on the guid: the loop runs every five minutes
    and must not re-fetch and re-summarise the same pages each time.

    Mutation check: skip the by_source_ref check in `sync`.
    """
    library = FakeLibrary()
    ingest = BookmarkIngest(library=library, profile=profile)

    first = await ingest.sync(enrich=False)
    assert first.captured == 2

    library._existing = {"bookmark:b-rust", "bookmark:b-pasta"}
    second = await ingest.sync(enrich=False)
    assert second.captured == 0
    assert second.already == 2
    assert len(library.captured) == 2, "the second sync fetched pages again"


async def test_the_folder_is_carried_across_as_a_note(db, profile):
    """The folder is the only thing a bookmark holds that the page does not, and
    it is often the reason it was filed there.

    Mutation check: drop the notes argument.
    """
    library = FakeLibrary()
    await BookmarkIngest(library=library, profile=profile).sync(enrich=False)
    assert all("toolbar" in call["notes"] for call in library.captured)


async def test_enrichment_is_per_bookmark_and_optional(db, profile):
    """Mutation check: enrich regardless of the setting."""
    library = FakeLibrary()
    await BookmarkIngest(library=library, profile=profile).sync(enrich=True)
    assert len(library.enriched) == 2

    quiet = FakeLibrary()
    await BookmarkIngest(library=quiet, profile=profile).sync(enrich=False)
    assert quiet.enriched == []


async def test_a_batch_limit_stops_a_first_sync_running_away(db, profile):
    """A profile with a thousand bookmarks would otherwise fetch and summarise a
    thousand pages in one pass. The rest arrive on the next tick.

    Mutation check: ignore the limit.
    """
    library = FakeLibrary()
    report = await BookmarkIngest(library=library, profile=profile).sync(limit=1, enrich=False)
    assert report.captured == 1
    assert report.seen == 2


async def test_a_missing_browser_is_reported_rather_than_raised(db, tmp_path):
    """A machine with no Firefox-family browser is an ordinary state. Raising
    from a background loop puts it in a log nobody reads instead of on the
    status line that would explain it.

    Mutation check: let PlacesError out of `sync`.
    """
    empty = tmp_path / "gone"
    empty.mkdir()
    report = await BookmarkIngest(library=FakeLibrary(), profile=empty).sync()
    assert report.unavailable
    assert report.captured == 0
    assert "places.sqlite" in report.summary()


async def test_a_page_that_cannot_be_fetched_does_not_end_the_sync(db, profile):
    """One dead link in a bookmark bar must not stop the other nine being
    captured, and the reason belongs in the report rather than a traceback.

    Mutation check: let the exception propagate out of `_capture`.
    """

    class HalfBroken(FakeLibrary):
        async def capture_url(self, url: str, **kwargs):
            if "pasta" in url:
                raise RuntimeError("connection refused")
            return await super().capture_url(url, **kwargs)

    library = HalfBroken()
    report = await BookmarkIngest(library=library, profile=profile).sync(enrich=False)
    assert report.captured == 1
    assert len(report.failed) == 1
    assert "connection refused" in report.failed[0]


def test_a_report_says_what_happened():
    """Mutation check: return a fixed string from summary()."""
    report = SyncReport(seen=9, captured=2, already=7, enriched=2)
    assert "9 bookmarks seen" in report.summary()
    assert "2 captured" in report.summary()
    assert "7 already in the library" in report.summary()
