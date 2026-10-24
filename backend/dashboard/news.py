"""Group the existing RSS projection by user-assigned tags."""

from backend.dashboard import service


async def provide(widget_id):
    cached = service.read_data("feed.rss")
    if cached["state"] in ("loading", "error", "stale"):
        await service.refresh("feed.rss")
        cached = service.read_data("feed.rss")
    payload = cached["payload"]
    if payload is None:
        raise RuntimeError("RSS data unavailable")
    groups = {}
    for item in payload["items"]:
        for tag in item["tags"] or ["Untagged"]:
            groups.setdefault(tag, []).append(item)
    return {
        "items": [{"tag": tag, "items": groups[tag]} for tag in sorted(groups)],
        "errors": payload.get("errors", []),
    }
