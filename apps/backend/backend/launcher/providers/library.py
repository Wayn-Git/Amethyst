from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.launcher.wox_matcher import wox_fuzzy_match

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
        items = await self._search_library_items(q, limit=25)
        if not q:
            for i, item in enumerate(items[:15]):
                yield self._to_result(item, score=70.0 - i)
            return

        scored: list[tuple[dict[str, Any], float]] = []
        for item in items:
            title = item.get("title") or ""
            match = wox_fuzzy_match(title, q)
            score = match.score if match.is_match else 0.0

            # Tags bonus
            for t in item.get("tags") or []:
                tag_match = wox_fuzzy_match(t, q)
                if tag_match.is_match and tag_match.score * 0.8 > score:
                    score = tag_match.score * 0.8

            # Excerpt/summary check
            for text_field in (item.get("summary"), item.get("excerpt")):
                if text_field:
                    exc_match = wox_fuzzy_match(text_field[:500], q)
                    if exc_match.is_match and exc_match.score * 0.6 > score:
                        score = exc_match.score * 0.6

            if score > 0:
                scored.append((item, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        for item, score in scored[:15]:
            yield self._to_result(item, score)

    def _to_result(self, item: dict[str, Any], score: float) -> LauncherResult:
        item_id = item.get("id")
        title = item.get("title") or "Untitled Library Item"
        url = item.get("url") or ""
        kind = item.get("kind") or "article"
        site = item.get("site") or (url.split("/")[2] if "//" in url else kind)
        summary = item.get("summary") or item.get("excerpt") or ""
        thumbnail_url = f"/api/library/{item_id}/thumbnail" if item_id else None
        tags = item.get("tags") or []
        created_on = item.get("consumed_on") or item.get("created_at") or "Recently"

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
            badge=kind.title(),
            score=score,
            preview_type="markdown",
            preview_data={
                "id": item_id,
                "title": title,
                "url": url,
                "kind": kind,
                "site": site,
                "thumbnail_url": thumbnail_url,
                "tags": tags,
                "date_label": created_on,
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
