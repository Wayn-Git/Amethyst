"""Bookmarks into the library.

Bookmarking is the one thing a person does in a browser that means "this
mattered". History is the record of everything else, and the difference is why
this ingests one and only searches the other.

Capture is one-way on purpose. Deleting a bookmark in the browser means "I am
done with this tab", not "destroy the notes AMETHYST made"; the library item stays,
the way every other capture does. Nothing here writes to the browser at all.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from backend.browser.places import Bookmark, PlacesError, bookmarks, find_profile
from backend.config import load_browser
from backend.library.service import LibraryError, LibraryService

log = logging.getLogger(__name__)

#: How many new bookmarks one sync will take. A first sync on a profile with a
#: thousand bookmarks would otherwise fetch and summarise a thousand pages in
#: one pass; the rest arrive on the next tick, minutes later.
BATCH_LIMIT = 20


@dataclass
class SyncReport:
    seen: int = 0
    captured: int = 0
    already: int = 0
    enriched: int = 0
    failed: list[str] = field(default_factory=list)
    #: Set when the browser could not be read at all, which is a different thing
    #: from every bookmark failing and is worth saying differently.
    unavailable: str | None = None

    def summary(self) -> str:
        if self.unavailable:
            return self.unavailable
        parts = [f"{self.seen} bookmarks seen", f"{self.captured} captured"]
        if self.already:
            parts.append(f"{self.already} already in the library")
        if self.enriched:
            parts.append(f"{self.enriched} enriched")
        if self.failed:
            parts.append(f"{len(self.failed)} failed")
        return ", ".join(parts)


class BookmarkIngest:
    def __init__(self, library: LibraryService | None = None, profile: Path | None = None):
        # Injected so a test never reaches the network, and so the runner, the
        # API and the CLI share one implementation rather than three.
        self.library = library or LibraryService()
        self._profile = profile

    def profile(self) -> Path:
        if self._profile is not None:
            return self._profile
        return find_profile(load_browser().profile_dir or None)

    async def sync(self, *, limit: int = BATCH_LIMIT, enrich: bool | None = None) -> SyncReport:
        """Capture bookmarks the library has not seen. Returns what happened."""
        report = SyncReport()
        settings = load_browser()
        should_enrich = settings.enrich if enrich is None else enrich

        try:
            found = bookmarks(self.profile())
        except PlacesError as exc:
            # Not an error to raise at a background loop: a browser that is not
            # installed, or a profile path that moved, is a state to report on a
            # status line rather than an exception in a log nobody reads.
            report.unavailable = str(exc)
            return report

        report.seen = len(found)
        for mark in found:
            if report.captured >= limit:
                break
            if self.library.store.by_source_ref(mark.source_ref) is not None:
                report.already += 1
                continue
            await self._capture(mark, report, should_enrich)
        return report

    async def _capture(self, mark: Bookmark, report: SyncReport, should_enrich: bool) -> None:
        try:
            captured = await self.library.capture_url(
                mark.url,
                title=mark.title or None,
                # The folder is the only thing a bookmark carries that the page
                # does not, and it is often the whole reason it was filed there.
                notes=f"Bookmarked in {mark.folder}" if mark.folder else "Bookmarked",
                consumed_on=mark.added_at.date().isoformat(),
                source_ref=mark.source_ref,
            )
        except LibraryError as exc:
            report.failed.append(f"{mark.url}: {exc}")
            return
        except Exception as exc:  # one unreachable page must not end the sync
            log.info("could not capture bookmark %s: %s", mark.url, exc)
            report.failed.append(f"{mark.url}: {exc}")
            return

        if captured.already_logged:
            # The same page reached the library another way -- pasted into a
            # conversation, say. Claim it for this bookmark so the next sync
            # recognises it by guid rather than fetching it again.
            self.library.store.update(captured.item["id"], source_ref=mark.source_ref)
            report.already += 1
            return

        report.captured += 1
        if not should_enrich:
            return
        try:
            await self.library.enrich(captured.item["id"])
            report.enriched += 1
        except Exception as exc:
            # The item is captured, indexed and searchable; it just has no
            # summary yet. Failing the capture over that would be the wrong
            # trade, and `enrich` can be re-run from the Library view.
            log.info("could not enrich bookmark %s: %s", mark.url, exc)
