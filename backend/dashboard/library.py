"""Library-backed Home projections; search stays owned by LibraryService."""

from backend.library.service import LibraryService


def display(item):
    return {key: item.get(key) for key in ("id", "title", "kind", "updated_at", "excerpt")}


async def provide(widget_id):
    library = LibraryService()
    if widget_id == "lib.inbox":
        return {"items": [display(item) for item in library.recent(limit=20)]}
    raise ValueError("Unknown Library widget")
