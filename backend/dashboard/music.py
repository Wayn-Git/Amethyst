"""Read-only Spotify projections via the audited Composio reader."""

from urllib.parse import urlparse

from backend.dashboard.connectors import read


def track(raw):
    if not isinstance(raw, dict) or not raw.get("name"):
        return None
    url = raw.get("external_urls", {}).get("spotify")
    parsed = urlparse(url or "")
    return {
        "title": raw["name"],
        "artists": [a["name"] for a in raw.get("artists", []) if a.get("name")],
        "url": url if parsed.scheme == "https" and parsed.hostname == "open.spotify.com" else None,
    }


def unwrap(raw):
    if not isinstance(raw, dict):
        raise ValueError("Invalid Spotify response")
    return raw.get("data", raw)


async def provide(widget_id):
    current = unwrap(await read(widget_id, "spotify", "SPOTIFY_GET_CURRENTLY_PLAYING_TRACK", {}))
    recent = unwrap(
        await read(widget_id, "spotify", "SPOTIFY_GET_RECENTLY_PLAYED_TRACKS", {"limit": 10})
    )
    history = []
    for row in recent.get("items", [])[:10]:
        item = track(row.get("track"))
        if item:
            history.append({**item, "played_at": row.get("played_at")})
    now = track(current.get("item")) if current.get("is_playing") else None
    return {"items": [now] if now else [], "history": history}
