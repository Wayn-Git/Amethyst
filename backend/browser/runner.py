"""The loop that notices a new bookmark.

Polling rather than watching. `places.sqlite` is written by another process
under a write-ahead log, so a filesystem event fires while the row is still
uncommitted and says nothing about which row it was -- and the read is a file
copy, which is not something to do on every write. Five minutes is the right
granularity for "I bookmarked this, look at it later".

The shape is `backend/instagram/runner.py`'s, including the reasons: the Event
and Lock are built inside the loop that will use them, never at import, because
an asyncio.Event created under one loop keeps waiters belonging to it and every
test's app lifespan builds a new loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from backend.browser.service import BookmarkIngest, SyncReport
from backend.config import load_browser

log = logging.getLogger(__name__)

#: How often the loop wakes to check the clock. Short, because the real interval
#: is the configured one and this only has to notice it has elapsed.
TICK_SECONDS = 30.0


class BrowserRunner:
    def __init__(self, ingest_factory=BookmarkIngest) -> None:
        self._task: asyncio.Task | None = None
        self._wake: asyncio.Event | None = None
        self._ingest_factory = ingest_factory
        self._next_sync = 0.0
        #: The last report, for a status line that says what actually happened
        #: rather than that a loop is running.
        self.last: SyncReport | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._wake = asyncio.Event()
            self._task = asyncio.create_task(self._loop(), name="browser")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._wake = None

    def nudge(self) -> None:
        """Sync now rather than at the next interval. A no-op when not running."""
        self._next_sync = 0.0
        if self._wake is not None:
            self._wake.set()

    async def _loop(self) -> None:
        wake = self._wake
        while True:
            try:
                if wake is not None:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(wake.wait(), timeout=TICK_SECONDS)
                    wake.clear()
                else:
                    await asyncio.sleep(TICK_SECONDS)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("browser tick failed")

    async def tick(self) -> SyncReport | None:
        """Sync if the interval has elapsed. Returns the report, or None."""
        settings = load_browser()
        # The cheapest possible no-op on a machine that has not switched this on,
        # and it runs on every tick of every test's app lifespan.
        if not settings.enabled:
            return None

        now = time.monotonic()
        if now < self._next_sync:
            return None
        self._next_sync = now + settings.poll_seconds

        report = await self._ingest_factory().sync()
        self.last = report
        if report.captured or report.failed or report.unavailable:
            log.info("bookmark sync: %s", report.summary())
        return report
