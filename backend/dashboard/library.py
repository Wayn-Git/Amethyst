"""Library-backed Home projections; search stays owned by LibraryService."""

from datetime import timedelta

from backend.dashboard.items import local_now, parsed, task_rows, today_item
from backend.dashboard.store import settings_read
from backend.db.connection import get_connection
from backend.library.service import LibraryService


def display(item):
    return {key: item.get(key) for key in ("id", "title", "kind", "updated_at", "excerpt")}


async def provide(widget_id):
    if widget_id == "lib.capture":
        return {"items": []}
    library = LibraryService()
    if widget_id == "lib.search":
        query = settings_read(widget_id).get("query", "")
        items = await library.search(query, limit=20) if query else []
        return {
            "items": [display(item) for item in items],
            "query": query,
            "degraded": library.last_search_degraded,
        }
    if widget_id == "lib.recent":
        rows = get_connection().execute(
            "SELECT id,title,kind,updated_at FROM library_items WHERE kind='note' "
            "ORDER BY updated_at DESC,id DESC LIMIT 20"
        )
        return {"items": [display(dict(row)) for row in rows]}
    if widget_id == "lib.inbox":
        return {"items": [display(item) for item in library.recent(limit=20)]}
    if widget_id == "lib.resurface":
        now = local_now()
        contexts = [(r["title"], "Today's task") for r in task_rows() if today_item(r, now)]
        contexts += [(r["title"], "Recent capture") for r in library.recent(limit=3)]
        items = {}
        for query, source in contexts[:6]:
            for item in await library.search(query, limit=10):
                created = parsed(item.get("created_at"))
                if item.get("kind") != "note" or not created or created >= now - timedelta(days=7):
                    continue
                if item["id"] not in items:
                    items[item["id"]] = {**display(item), "reason": f"{source}: {query}"}
        return {"items": list(items.values())[:20], "degraded": library.last_search_degraded}
    raise ValueError("Unknown Library widget")
