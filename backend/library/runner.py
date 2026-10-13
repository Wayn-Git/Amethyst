"""Background runner that keeps library items enriched and synthesized."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from backend.library.service import LibraryService

log = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 30.0


class LibraryRunner:
    def __init__(self, service_factory=LibraryService) -> None:
        self._task: asyncio.Task | None = None
        self._wake: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self._service_factory = service_factory

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._wake = asyncio.Event()
            self._lock = asyncio.Lock()
            self._task = asyncio.create_task(self._loop(), name="library_runner")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._wake = None
        self._lock = None

    def nudge(self) -> None:
        """Wake the sweeper immediately."""
        if self._wake is not None:
            self._wake.set()

    async def _loop(self) -> None:
        # Give the server a moment to finish initial boot
        await asyncio.sleep(2.0)
        wake = self._wake
        while True:
            try:
                if wake is not None:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(wake.wait(), timeout=SWEEP_INTERVAL_SECONDS)
                    wake.clear()
                else:
                    await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("library runner tick failed")

    async def tick(self) -> int:
        if self._lock is None:
            return 0
        async with self._lock:
            try:
                service = self._service_factory()
                return await service.sweep_unsummarized(max_items=25)
            except Exception as exc:
                log.debug("library sweep tick encountered an error: %s", exc)
                return 0
