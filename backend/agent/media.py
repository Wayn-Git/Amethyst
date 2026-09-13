"""Media for widgets: retrieved with the tools Amethyst already has.

A step guide for carbonara is better with the video somebody already made of it,
and a comparison of two cities is better with a picture of each. This is the
layer that attaches those, and it is deliberately the thinnest thing that can:

* **No model call of its own.** The widget extraction call already happens, so
  it is the one asked whether media would help and what to search for. A second
  call to decide "should this have a picture" would double the cost of the
  feature to answer a question the first call was already in a position to.

* **No networking of its own.** Every lookup goes through
  `backend.web.search_service`, which is what the `search_web` tool uses -- the
  same free backends (DuckDuckGo, YouTube, Openverse), the same timeouts, the
  same failure handling. Nothing here opens a socket.

* **Nothing is downloaded or rehosted.** What travels to the interface is
  metadata: a title, a URL, a thumbnail URL, and where it came from. The browser
  fetches the bytes from the original host, which is also what keeps attribution
  attached to the thing it describes.

Every URL is put through `backend.mcp.ssrf.check_url_async` before it is handed
out. We never fetch these ourselves, but the interface renders them in `<img>`
and `<iframe>`, and a private-network URL in an `<img>` is a probe from the
user's own browser. Same check the rest of the system uses, rather than a
second opinion about what a safe URL is.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict

from backend.mcp.ssrf import check_url_async

log = logging.getLogger(__name__)

#: Media must not hold a widget up. The widget is the answer; this is a garnish
#: on it, and an answer that waits on a slow image search is a worse answer.
MEDIA_TIMEOUT = 6.0

#: How many of each kind are worth showing. One video, because the point is an
#: embedded player and a wall of them is a search results page; a few images,
#: because a gallery wants more than one; a few links, likewise.
LIMITS = {"video": 1, "image": 4, "web": 3}

#: A YouTube id is exactly eleven characters of a known alphabet. Matched
#: strictly and then used to *build* the embed URL, rather than passing any URL
#: through to an iframe -- which is the difference between embedding a video and
#: letting a search result choose what goes in a frame on the page.
_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

_YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "music.youtube.com", "youtu.be", "www.youtu.be",
}

#: Extensions a browser will play in a `<video>` element. Anything else is a
#: page to link to, not a file to try to play.
_PLAYABLE = (".mp4", ".webm", ".ogg", ".ogv", ".m4v")


class MediaHint(BaseModel):
    """What the extraction call said would help, if anything.

    A hint, not an instruction: it names a kind and a search, and this module
    decides whether anything came back worth showing.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["video", "image", "web", "none"]
    query: str = ""


def youtube_id(url: str) -> str | None:
    """The video id in `url`, or None if it is not a YouTube video URL.

    Handles the three forms that actually turn up: `watch?v=`, the `youtu.be`
    short link, and the `/embed/` and `/shorts/` paths. Anything else -- a
    channel, a playlist, a search, another site entirely -- is None, because the
    only thing an id is used for here is building an embed URL.
    """
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None

    candidate = None
    if host in ("youtu.be", "www.youtu.be"):
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif parsed.path == "/watch":
        values = parse_qs(parsed.query).get("v") or []
        candidate = values[0] if values else None
    else:
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in ("embed", "shorts", "v", "live"):
            candidate = parts[1]

    if candidate and _YOUTUBE_ID.match(candidate):
        return candidate
    return None


def embed_url(video_id: str) -> str:
    """The official embed URL for a validated id.

    Built here rather than taken from a search result, so what ends up in the
    iframe is always youtube-nocookie.com with an id this module has checked.
    `nocookie` because the viewer did not ask to be tracked by a video that
    turned up beside a recipe.
    """
    return f"https://www.youtube-nocookie.com/embed/{video_id}"


def is_playable(url: str) -> bool:
    """Whether a browser can be expected to play this URL in a `<video>`.

    Extension-based and therefore a guess, but the failure mode is mild: a card
    with a link instead of a player. The alternative -- a HEAD request per
    result to read its content type -- is networking this module has no business
    doing for a garnish.
    """
    if not url:
        return False
    try:
        path = urlparse(url).path.lower()
    except ValueError:
        return False
    return path.endswith(_PLAYABLE)


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").replace("www.", "")
    except ValueError:
        return ""


async def _safe(url: str | None) -> bool:
    """Whether this URL is one we are willing to put in front of the browser."""
    if not url:
        return False
    try:
        await check_url_async(url)
    except Exception:
        return False
    return True


async def _keep(item: dict[str, Any]) -> dict[str, Any] | None:
    """Drop an item unless every URL on it passes the SSRF check.

    Checked per field rather than per item so a good result with a bad thumbnail
    loses the thumbnail rather than the whole card.
    """
    if not await _safe(item.get("url")):
        return None
    for field in ("thumbnail", "direct_url"):
        if item.get(field) and not await _safe(item[field]):
            item[field] = None
    return item


async def _videos(query: str) -> list[dict[str, Any]]:
    from backend.web.search_service import search_youtube

    out = []
    for video in await search_youtube(query, limit=LIMITS["video"]):
        vid = video.get("id") if _YOUTUBE_ID.match(video.get("id") or "") else None
        if vid is None:
            # The id is what the embed is built from; a result without a usable
            # one is a link at best and is not worth a card here.
            continue
        out.append({
            "kind": "youtube",
            "title": video.get("title") or "Video",
            "url": f"https://www.youtube.com/watch?v={vid}",
            "embed_url": embed_url(vid),
            "thumbnail": video.get("thumbnail"),
            "source": video.get("channel") or "YouTube",
            "duration": video.get("duration") or "",
        })
    return out


async def _images(query: str) -> list[dict[str, Any]]:
    from backend.web.search_service import search_images

    out = []
    for image in await search_images(query, limit=LIMITS["image"]):
        full = image.get("image")
        if not full:
            continue
        out.append({
            "kind": "image",
            "title": image.get("title") or "Image",
            # The landing page, not the file: attribution has to point somewhere
            # a person can read the licence.
            "url": image.get("source_url") or full,
            "direct_url": full,
            "thumbnail": image.get("thumbnail") or full,
            "source": image.get("creator") or _domain(full),
            "license": image.get("license") or "",
        })
    return out


async def _links(query: str) -> list[dict[str, Any]]:
    from backend.web.search_service import search_web

    out = []
    for page in await search_web(query, limit=LIMITS["web"]):
        url = page.get("url")
        if not url:
            continue
        out.append({
            "kind": "link",
            "title": page.get("title") or url,
            "url": url,
            "thumbnail": None,
            "source": page.get("domain") or _domain(url),
            "snippet": page.get("snippet") or "",
        })
    return out


async def fetch(hint: MediaHint | None) -> list[dict[str, Any]]:
    """Whatever the hint asked for, as structured metadata. Never raises.

    An empty list is a perfectly good answer and the common one: no hint, a kind
    of `none`, a search that found nothing, a backend that was down. The widget
    renders the same either way, which is what keeps this a garnish rather than
    a dependency.
    """
    if hint is None or hint.kind == "none" or not hint.query.strip():
        return []

    finder = {"video": _videos, "image": _images, "web": _links}.get(hint.kind)
    if finder is None:
        return []

    try:
        found = await asyncio.wait_for(finder(hint.query.strip()), timeout=MEDIA_TIMEOUT)
    except TimeoutError:
        log.debug("media lookup timed out for %r", hint.query)
        return []
    except Exception as exc:
        log.debug("media lookup failed for %r: %s", hint.query, exc)
        return []

    checked = await asyncio.gather(*(_keep(item) for item in found), return_exceptions=True)
    return [item for item in checked if isinstance(item, dict)]
