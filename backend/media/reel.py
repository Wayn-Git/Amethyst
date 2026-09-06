"""Getting a reel out of a permalink, when Meta's API will not give you one.

The API route (`backend/instagram/`) is the right one and stays the default the
moment it is available. It is not available on an unpublished Meta app: no
webhook fires, and `/me/conversations` answers `{"data": []}` rather than an
error, which is the worst shape a refusal can take. Publishing needs Business
verification, which has a multi-day clock on it.

So this is the other door. Instagram's own share sheet hands you a permalink;
yt-dlp turns that permalink into the video and its caption. What that buys over
the direct-message route is worth stating, because it is more rather than less:

| | DM'd reel, via the API | permalink, via here |
|---|---|---|
| caption | **none** | yes |
| permalink | **none** | yes, it is the input |
| author | none | yes |
| video | expiring CDN link | yes |

Two costs, both real:

* **This reads a public page rather than calling an API.** That is against
  Instagram's terms even for personal use. It is a deliberate choice made
  with that stated, not an oversight.
* **It needs the browser's cookies.** Instagram stopped serving reel pages
  anonymously; yt-dlp's own issue tracker is a long queue of people finding
  that out. `cookies_from_browser` names a browser this machine has, and the
  cookies are read at fetch time and never copied anywhere.

It breaks whenever Instagram changes their page. When it does, the failure is a
sentence on the item saying so -- the library's existing rule -- not a lost
capture.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

#: A post, a reel or a TV permalink. Mirrors `webhook._PERMALINK`, which matches
#: the same thing inside a delivery payload.
PERMALINK = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:p|reel|reels|tv|share)/[A-Za-z0-9_\-]+/?",
    re.IGNORECASE,
)

#: Browsers yt-dlp can read a session out of. Anything else is refused rather
#: than passed through, so a typo is an error here and not a stack trace inside
#: yt-dlp four seconds later.
BROWSERS = ("firefox", "chrome", "chromium", "brave", "edge", "opera", "vivaldi", "safari")

DEFAULT_TIMEOUT = 180.0


class ReelError(RuntimeError):
    """The reel could not be fetched. Carries a sentence fit to show someone."""


@dataclass(frozen=True)
class Reel:
    """What a permalink gave up. Every field may be empty except `url`."""

    url: str
    title: str
    caption: str
    author: str
    duration: float | None
    thumbnail_url: str | None
    video_path: Path | None
    slide_urls: list[str] = field(default_factory=list)

    @property
    def has_text(self) -> bool:
        return bool(self.caption.strip())


def is_reel_url(url: str | None) -> bool:
    return bool(PERMALINK.match((url or "").strip()))


def yt_dlp_missing() -> str | None:
    """Why this cannot run, or None. Never raises -- it is asked on a status page."""
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return "yt-dlp is not installed, so Instagram links cannot be opened"
    return None


def _options(dest: Path | None, cookies_from_browser: str | None,
             cookie_file: str | None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        # Instagram serves a login wall to anonymous requests and yt-dlp falls
        # back to the embed page, which carries the video but drops the caption.
        # Better to get the poor version than nothing.
        "ignoreerrors": True,
        "socket_timeout": 30,
        "retries": 2,
    }
    if dest is None:
        opts["skip_download"] = True
    else:
        opts["outtmpl"] = str(dest.with_suffix("")) + ".%(ext)s"
        # One file. A reel is never a playlist and merging needs ffmpeg twice.
        opts["format"] = "mp4/best[ext=mp4]/best"
    if cookies_from_browser:
        if cookies_from_browser not in BROWSERS:
            raise ReelError(
                f"'{cookies_from_browser}' is not a browser yt-dlp can read."
                f" One of: {', '.join(BROWSERS)}"
            )
        opts["cookiesfrombrowser"] = (cookies_from_browser,)
    if cookie_file:
        opts["cookiefile"] = cookie_file
    return opts


def _describe(exc: Exception) -> str:
    """Turn yt-dlp's message into one somebody can act on."""
    text = str(exc)
    lowered = text.lower()
    if "login required" in lowered or "rate-limit" in lowered or "not available" in lowered:
        return (
            "Instagram would not serve this page without being signed in."
            " Set a browser in Settings so the reel can be opened with your own session."
        )
    if "cookies" in lowered and "database" in lowered:
        return (
            "the browser's cookie database could not be read."
            " Close the browser and try again, or export a cookies.txt instead."
        )
    if "private" in lowered:
        return "this account is private, so the reel cannot be opened"
    return f"Instagram did not give this up: {text[:200]}"


def _pick(info: dict[str, Any]) -> dict[str, Any]:
    """The one entry that matters. A carousel comes back as a playlist."""
    if info.get("_type") == "playlist" and info.get("entries"):
        entries = [e for e in info["entries"] if e]
        if entries:
            # In Instagram carousels, the caption (description) and author 
            # are on the playlist level, not the individual item.
            picked = dict(entries[0])
            picked["description"] = info.get("description") or picked.get("description")
            picked["title"] = info.get("title") or picked.get("title")
            picked["uploader"] = info.get("uploader") or picked.get("uploader")
            return picked
        return info
    return info


def _to_reel(
    url: str,
    info: dict[str, Any],
    raw_info: dict[str, Any] | None,
    video: Path | None,
) -> Reel:
    # `description` is the caption. `title` is often the caption's first line
    # with the username bolted on, so the caption is the better source and the
    # title is the fallback rather than the other way round.
    caption = (
        info.get("description")
        or (raw_info.get("description") if raw_info else None)
        or ""
    ).strip()
    raw_title = (
        info.get("title")
        or (raw_info.get("title") if raw_info else None)
        or ""
    ).strip()
    author = (
        info.get("uploader")
        or info.get("channel")
        or (raw_info.get("uploader") if raw_info else None)
        or (raw_info.get("channel") if raw_info else None)
        or info.get("uploader_id")
        or ""
    ).strip()

    # Collect slide URLs from raw_info or info
    slide_urls: list[str] = []
    source_for_slides = raw_info or info
    if source_for_slides.get("entries"):
        for entry in source_for_slides["entries"]:
            if not isinstance(entry, dict):
                continue
            thumbs = entry.get("thumbnails") or []
            if thumbs:
                slide_urls.append(thumbs[-1]["url"])
    elif source_for_slides.get("thumbnails"):
        slide_urls.append(source_for_slides["thumbnails"][-1]["url"])

    thumbnail_url = (
        info.get("thumbnail")
        or (raw_info.get("thumbnail") if raw_info else None)
        or (slide_urls[0] if slide_urls else None)
    )

    title = _title_from(caption) or raw_title or "an Instagram post"
    duration = info.get("duration") or (raw_info.get("duration") if raw_info else None)
    return Reel(
        url=info.get("webpage_url") or (raw_info.get("webpage_url") if raw_info else None) or url,
        title=title[:400],
        caption=caption,
        author=author,
        duration=float(duration) if isinstance(duration, (int, float)) else None,
        thumbnail_url=thumbnail_url,
        video_path=video,
        slide_urls=slide_urls,
    )


def _title_from(caption: str) -> str:
    """A title out of a caption: its first line, trimmed. Same rule as the API route."""
    first = caption.strip().splitlines()[0].strip() if caption.strip() else ""
    if len(first) <= 90:
        return first
    return first[:87].rsplit(" ", 1)[0] + "…"


def _found_file(dest: Path) -> Path | None:
    """What yt-dlp actually wrote. The extension is its decision, not ours."""
    stem = dest.with_suffix("").name
    for path in sorted(dest.parent.glob(f"{stem}.*")):
        if path.is_file() and path.stat().st_size > 0:
            return path
    return None


def _fetch_blocking(url: str, dest: Path | None, opts: dict[str, Any]) -> Reel:
    import yt_dlp

    raw_info: dict[str, Any] | None = None
    info: dict[str, Any] | None = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            try:
                raw_info = ydl.extract_info(url, download=False, process=False)
            except Exception as exc:
                log.debug("raw extraction failed for %s: %s", url, exc)

            try:
                info = ydl.extract_info(url, download=dest is not None)
            except Exception as exc:
                if not raw_info:
                    raise ReelError(_describe(exc)) from exc
                log.debug("processed download failed for %s: %s", url, exc)
    except ReelError:
        raise
    except Exception as exc:
        raise ReelError(_describe(exc)) from exc

    if not info and not raw_info:
        raise ReelError("Instagram returned nothing for this link")

    picked = _pick(info) if info else (raw_info or {})
    return _to_reel(url, picked, raw_info, _found_file(dest) if dest is not None else None)


async def fetch_reel(
    url: str,
    dest: Path | None = None,
    *,
    cookies_from_browser: str | None = None,
    cookie_file: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Reel:
    """Open a permalink. `dest` None means metadata only, no download.

    yt-dlp is synchronous and does real network work, so it runs in a thread --
    blocking the loop here would stall the drain, the reminder loop and any turn
    that happens to be streaming.
    """
    if reason := yt_dlp_missing():
        raise ReelError(reason)
    if not is_reel_url(url):
        raise ReelError("that is not an Instagram post or reel link")

    opts = _options(dest, cookies_from_browser, cookie_file)
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_fetch_blocking, url, dest, opts), timeout=timeout
        )
    except TimeoutError as exc:
        raise ReelError(f"Instagram did not answer within {int(timeout)} seconds") from exc
