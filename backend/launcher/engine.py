from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator

from backend.launcher.provider import BaseLauncherProvider, LauncherResult

log = logging.getLogger(__name__)


class LauncherEngine:
    """Coordinates search providers, concurrency, cancellation, and execution."""

    def __init__(self) -> None:
        self._providers: dict[str, BaseLauncherProvider] = {}
        self._current_session: str | None = None
        self._current_tasks: set[asyncio.Task] = set()

    def register_provider(self, provider: BaseLauncherProvider) -> None:
        self._providers[provider.id] = provider

    def unregister_provider(self, provider_id: str) -> None:
        self._providers.pop(provider_id, None)

    def get_provider(self, provider_id: str) -> BaseLauncherProvider | None:
        return self._providers.get(provider_id)

    async def query(
        self, query_text: str, session_id: str
    ) -> AsyncIterator[list[LauncherResult]]:
        """Stream ranked result batches for query_text.
        Cancels any prior active query session.
        """
        # Cancel previous session tasks
        self._cancel_active_tasks()
        self._current_session = session_id

        # Queue to collect results across all providers
        queue: asyncio.Queue[LauncherResult | None] = asyncio.Queue()
        providers = list(self._providers.values())
        if not providers:
            return

        async def _run_provider(p: BaseLauncherProvider) -> None:
            try:
                async for res in p.search(query_text, session_id):
                    if session_id != self._current_session:
                        break
                    await queue.put(res)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("Provider %s error on search: %s", p.id, e)
            finally:
                await queue.put(None)  # Sentinel for this provider

        # Spawn provider tasks
        tasks = [asyncio.create_task(_run_provider(p)) for p in providers]
        for t in tasks:
            self._current_tasks.add(t)
            t.add_done_callback(self._current_tasks.discard)

        active_producers = len(providers)
        batch: list[LauncherResult] = []

        try:
            while active_producers > 0:
                try:
                    item = await queue.get()
                except asyncio.CancelledError:
                    break

                if item is None:
                    active_producers -= 1
                    # Flush what we have when a provider finishes
                    if batch:
                        yield sorted(batch, key=lambda r: r.score, reverse=True)
                        batch = []
                else:
                    batch.append(item)
                    # Yield incremental batches of 4 or more for immediate UI response
                    if len(batch) >= 4:
                        yield sorted(batch, key=lambda r: r.score, reverse=True)
                        batch = []

            if batch:
                yield sorted(batch, key=lambda r: r.score, reverse=True)
        finally:
            for t in tasks:
                if not t.done():
                    t.cancel()

    def _cancel_active_tasks(self) -> None:
        for t in list(self._current_tasks):
            if not t.done():
                t.cancel()
        self._current_tasks.clear()

    async def execute_action(
        self, provider_id: str, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Dispatch action to the responsible provider."""
        provider = self.get_provider(provider_id)
        if not provider:
            raise ValueError(f"Unknown provider: {provider_id}")
        return await provider.execute(action_id, payload)
