from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)

log = logging.getLogger(__name__)


class LibraryProvider(BaseLauncherProvider):
    id = "library"
    name = "Library"
    priority = 70

    async def _search_library_items(
        self, query: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Query LibraryService, falling back cleanly if degraded or empty."""
        try:
            from backend.library.service import LibraryService

            service = LibraryService()
            if query:
                return await service.search(query, limit=limit)
            return service.recent(limit=limit)
        except Exception as e:
            log.warning("Library search service unavailable: %s", e)
            return []

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        q = query.strip()
        items = await self._search_library_items(q, limit=8)

        for i, item in enumerate(items):
            score = max(85.0 - (i * 2.0), 30.0)
            yield self._to_result(item, score)

    def _to_result(self, item: dict[str, Any], score: float) -> LauncherResult:
        item_id = item.get("id")
        title = item.get("title") or "Untitled Library Item"
        url = item.get("url") or ""
        kind = item.get("kind") or "article"
        site = item.get("site") or (url.split("/")[2] if "//" in url else kind)
        summary = item.get("summary") or item.get("excerpt") or ""

        # Map kind to icon
        kind_icons = {
            "video": "play",
            "article": "file-text",
            "book": "book",
            "note": "note",
            "post": "message-circle",
        }
        icon = kind_icons.get(kind, "library")

        actions = [
            LauncherAction(
                id="open",
                title="Open Item",
                is_primary=True,
                handler_payload={"url": url, "item_id": item_id},
            ),
            LauncherAction(
                id="ask_agent",
                title="Ask Agent about Item",
                shortcut="Cmd+Shift+A",
                handler_payload={"title": title, "url": url, "summary": summary},
            ),
        ]

        if url:
            actions.append(
                LauncherAction(
                    id="copy_url",
                    title="Copy Link",
                    shortcut="Cmd+C",
                    handler_payload={"text": url},
                )
            )

        return LauncherResult(
            id=f"library:{item_id}",
            provider_id=self.id,
            title=title,
            subtitle=f"{kind.title()} · {site}",
            icon=icon,
            badge="Library",
            score=score,
            preview_type="markdown",
            preview_data={
                "title": title,
                "url": url,
                "kind": kind,
                "site": site,
                "excerpt": summary[:1200] if summary else "No preview text available.",
            },
            actions=actions,
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if action_id == "open":
            url = payload.get("url")
            item_id = payload.get("item_id")
            if url:
                import webbrowser

                webbrowser.open(url)
            return {"status": "ok", "opened": url or item_id}

        if action_id == "copy_url":
            return {"status": "ok", "copied": payload.get("text", "")}

        if action_id == "ask_agent":
            return {
                "status": "ok",
                "action": "ask_agent",
                "prompt": f"Summarize and analyze this library item: {payload.get('title')} ({payload.get('url')})",
            }

        raise ValueError(f"Unknown library action {action_id}")
