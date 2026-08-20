"""Local global search. Actions navigate to their existing review UI."""

import asyncio
from urllib.parse import quote

from fastapi import HTTPException

from backend.dashboard.insights import source_items
from backend.dashboard.registry import REGISTRY
from backend.db.connection import get_connection
from backend.library.service import LibraryService


def link(source, item_id):
    return f"/today?source={quote(source)}&item={quote(str(item_id), safe='')}"


async def search(query):
    query = query.strip()
    if not query:
        return {"items": [], "degraded": False}
    needle = query.casefold()
    groups = {"Widgets": [], "Actions": [], "Widget items": [], "Tasks": [], "Library": []}
    for widget_id, entry in REGISTRY.items():
        if not entry["enabled"]:
            continue
        manifest = entry["manifest"]
        href = f"/today?widget={quote(widget_id)}"
        if needle in f"{widget_id} {manifest['title']}".casefold():
            groups["Widgets"].append({"id": widget_id, "title": manifest["title"], "href": href})
        for action in manifest["actions"]:
            title = f"{action['label']} · {manifest['title']}"
            if needle in title.casefold():
                groups["Actions"].append(
                    {"id": f"{widget_id}:{action['id']}", "title": title, "href": href}
                )
    groups["Widget items"] = [
        item for item in source_items() if needle in f"{item['title']} {item['detail']}".casefold()
    ]
    # instr treats %, _ and quotes as literal search text.
    groups["Tasks"] = [
        {"id": row["id"], "title": row["title"], "href": link("tasks", row["id"])}
        for row in get_connection().execute(
            "SELECT id,title FROM tasks WHERE instr(lower(title),lower(?)) > 0 "
            "ORDER BY updated_at DESC,id DESC LIMIT 20",
            (query,),
        )
    ]
    library = LibraryService()
    try:
        groups["Library"] = [
            {"id": item["id"], "title": item["title"], "href": link("library", item["id"])}
            for item in await asyncio.wait_for(library.search(query, limit=20), timeout=8)
        ]
        degraded = library.last_search_degraded
    except Exception:
        degraded = True
    return {
        "items": [
            {**item, "group": group} for group, items in groups.items() for item in items[:20]
        ],
        "degraded": degraded,
    }


def item(source, item_id):
    if source not in ("tasks", "library"):
        raise HTTPException(404, "Unknown search source")
    table = "tasks" if source == "tasks" else "library_items"
    row = get_connection().execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Source item no longer exists")
    if source == "library":
        from backend.library.service import as_dict

        saved = as_dict(row)
        detail = saved.get("content") or row["notes"] or row["summary"] or ""
    else:
        detail = row["status"]
    return {"title": row["title"], "widget_id": source, "detail": detail}
