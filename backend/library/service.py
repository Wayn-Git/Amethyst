"""The library: what you read, watched and listened to, and how to find it again.

One service, three thin callers -- the HTTP routes, the agent tools, and the
share endpoint -- following `backend/tasks/service.py`. The callers translate
arguments in and phrase results out; the decisions live here.

**The text is a real file.** AMETHYST stores an index that points at the filesystem
and treats the file as the source of truth (ADR-0004), so a captured article is
written to `~/.amethyst/library/{id}-{slug}.md` and indexed by the ordinary
`Indexer`. Nothing about search had to be taught the library exists: a saved
article is found by `search_documents` exactly as a vault note is, ranked by the
same hybrid index, and the user can open the file.

**A capture that goes wrong still logs the item.** A paywall, a 403, a video
with no transcript, an embedder that is not running -- each of those loses some
of what the item could have been, and none of them should lose the fact that you
read it. Every partial outcome writes `capture_note` saying which one happened,
because an item with no text and no explanation is indistinguishable from a bug.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from backend.db.connection import get_connection
from backend.library.store import KINDS, LibraryStore, app_tag_for_url, media_path, slide_path, text_path, thumbnail_path
from backend.mcp.ssrf import UnsafeURL, check_url_async
from backend.media.reel import is_reel_url
from backend.retrieval import store as index_store
from backend.retrieval.embeddings import forget_unreachable
from backend.retrieval.indexer import Indexer
from backend.retrieval.search import SearchService
from backend.web.reader import (
    FetchError,
    fetch_readable,
    is_pinterest,
    is_reddit,
    is_threads,
    is_x_post,
    is_youtube,
    pinterest_oembed,
    reddit_post,
    threads_oembed,
    x_oembed,
    youtube_oembed,
)

log = logging.getLogger(__name__)

#: Background enrichment tasks, held so the event loop's weak reference to an
#: unreferenced task cannot be the reason enrichment silently vanishes.
_BACKGROUND_TASKS: set[asyncio.Task] = set()
_SWEEP_ATTEMPTS: dict[int, float] = {}

#: Below this, the "text" is a cookie banner or a paywall stub rather than an
#: article, and indexing it would pollute the index with a page nobody read.
MIN_INDEXABLE_CHARS = 200

_KIND_BY_HOST = {
    "youtube.com": "video",
    "www.youtube.com": "video",
    "m.youtube.com": "video",
    "youtu.be": "video",
    "music.youtube.com": "music",
    "podcasts.apple.com": "podcast",
    # X links are posts, not articles: they have an author and a body of a
    # handful of sentences, and filing them as articles put every one of them
    # in the wrong bucket of the library.
    "x.com": "post",
    "twitter.com": "post",
    "mobile.twitter.com": "post",
    "pinterest.com": "post",
    "www.pinterest.com": "post",
    "pin.it": "post",
    "reddit.com": "post",
    "www.reddit.com": "post",
    "old.reddit.com": "post",
    "redd.it": "post",
    "v.redd.it": "video",
    "arxiv.org": "paper",
    "www.arxiv.org": "paper",
    # Music platforms
    "music.apple.com": "music",
    "soundcloud.com": "music",
    "www.soundcloud.com": "music",
    # Social video & post platforms
    "instagram.com": "video",
    "www.instagram.com": "video",
    "instagr.am": "video",
    "threads.net": "post",
    "www.threads.net": "post",
    "threads.com": "post",
    "tiktok.com": "video",
    "www.tiktok.com": "video",
}

#: Spotify mixes music (/track, /album, /artist) with podcasts (/show,
#: /episode) on the same host, so a flat host map picks the wrong bucket
#: half the time.  A path prefix check after the map miss decides.
_SPOTIFY_PODCAST_PREFIXES = ("/show", "/episode")


class LibraryError(ValueError):
    """Something the caller can fix, phrased for whoever asked."""


@dataclass
class Captured:
    item: dict
    already_logged: bool = False


def kind_for(url: str | None) -> str:
    if not url:
        return "note"
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    # Spotify: path-aware — /track, /album, /artist → music; /show, /episode → podcast
    if host in ("open.spotify.com", "spotify.com"):
        path = (parsed.path or "").lower()
        if any(path.startswith(p) for p in _SPOTIFY_PODCAST_PREFIXES):
            return "podcast"
        return "music"

    # Bandcamp subdomains: *.bandcamp.com
    if host.endswith(".bandcamp.com") or host == "bandcamp.com":
        return "music"

    return _KIND_BY_HOST.get(host, "article")



def _json_list(raw) -> list:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _json_dict(raw) -> dict | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def as_dict(row) -> dict:
    """One item, as the interface and the model both see it."""
    from backend.library.enrich import infer_category

    data = dict(row)
    data["indexed"] = data.get("document_id") is not None
    # Stored as JSON so the columns stay simple; handed out as lists so nothing
    # above this line has to know that.
    tags = _json_list(data.get("tags"))
    resources = _json_list(data.get("resources"))
    data["entity"] = _json_dict(data.get("entity"))

    app_tag = app_tag_for_url(data.get("url"))
    if app_tag and app_tag not in tags:
        tags.append(app_tag)

    data["tags"] = tags
    data["resources"] = resources
    data["app"] = app_tag

    cat = data.get("category")
    if not cat or cat == "general":
        cat = infer_category(resources, tags, kind=data.get("kind", ""))
    data["category"] = cat or "general"

    # Explicit lifecycle status: 'received' | 'processing' | 'enriching' | 'ready' | 'failed'
    status = data.get("status")
    if not status or status not in ("received", "processing", "enriching", "ready", "failed"):
        status = "ready"
    data["status"] = status

    item_id = data.get("id")

    # 1. Fallback & resolution for text content
    text_p = None
    if data.get("text_path"):
        text_p = Path(data["text_path"])
        if not text_p.is_file():
            if ".psok" in str(text_p):
                alt = Path(str(text_p).replace(".psok", ".amethyst"))
                if alt.is_file():
                    text_p = alt
            elif ".amethyst" in str(text_p):
                alt = Path(str(text_p).replace(".amethyst", ".psok"))
                if alt.is_file():
                    text_p = alt
        if not text_p.is_file() and item_id:
            from backend.config import paths
            cand1 = paths().library_dir / text_p.name
            if cand1.is_file():
                text_p = cand1
            else:
                for match in paths().library_dir.glob(f"{item_id:06d}-*.md"):
                    if match.is_file():
                        text_p = match
                        break

    if text_p and text_p.is_file():
        data["text_path"] = str(text_p)
        try:
            raw = text_p.read_text(encoding="utf-8", errors="replace")
            data["content"] = raw
            if not data.get("excerpt"):
                from backend.library.enrich import body_of
                body, _ = body_of(raw)
                data["excerpt"] = body.strip()[:1000]
        except Exception:
            pass

    # 2. Fallback & resolution for thumbnail path
    thumb_p = Path(data["thumbnail_path"]) if data.get("thumbnail_path") else None
    if thumb_p and not thumb_p.is_file():
        if ".psok" in str(thumb_p):
            alt = Path(str(thumb_p).replace(".psok", ".amethyst"))
            if alt.is_file():
                thumb_p = alt
        elif ".amethyst" in str(thumb_p):
            alt = Path(str(thumb_p).replace(".amethyst", ".psok"))
            if alt.is_file():
                thumb_p = alt

    if (not thumb_p or not thumb_p.is_file()) and item_id:
        cand = thumbnail_path(item_id)
        if cand.is_file():
            thumb_p = cand
        else:
            for ext in (".jpg", ".jpeg", ".png", ".webp"):
                alt_cand = cand.parent / f"{item_id:06d}-thumb{ext}"
                if alt_cand.is_file():
                    thumb_p = alt_cand
                    break
    if thumb_p and thumb_p.is_file():
        data["thumbnail_path"] = str(thumb_p)

    # 3. Fallback & resolution for media path
    media_p = Path(data["media_path"]) if data.get("media_path") else None
    if media_p and not media_p.is_file():
        if ".psok" in str(media_p):
            alt = Path(str(media_p).replace(".psok", ".amethyst"))
            if alt.is_file():
                media_p = alt
        elif ".amethyst" in str(media_p):
            alt = Path(str(media_p).replace(".amethyst", ".psok"))
            if alt.is_file():
                media_p = alt

    if (not media_p or not media_p.is_file()) and item_id:
        for ext in (".mp4", ".webm", ".mov", ".mkv"):
            cand = media_path(item_id, ext)
            if cand.is_file() and cand.stat().st_size > 1000:
                media_p = cand
                break
    if media_p and media_p.is_file():
        data["media_path"] = str(media_p)

    if not data.get("excerpt") and not data.get("summary") and data.get("enriched_at"):
        data["excerpt"] = data.get("notes") or data.get("title") or ""

    return data


async def _rendered_if_empty(url: str, page):
    """Try a renderer when the page itself gave up nothing.

    A single-page app returns markup with no words in it, and the honest note
    `fetch_readable` writes -- "the page returned no readable text" -- is what a
    library item full of nothing looks like. Only reached after the ordinary
    fetch has already failed to produce text, so a page AMETHYST can read itself is
    never sent to a third party. Off if the user switched it off.
    """
    if page is not None and page.text.strip():
        return page

    from backend.config import load_social

    if not load_social().reader_fallback:
        return page

    from backend.web.jina import fetch_rendered

    rendered = await fetch_rendered(url)
    return rendered if rendered is not None else page


def _extract_youtube_info(url: str) -> dict | None:
    """Extract YouTube metadata (title, uploader, description, thumbnail) via yt-dlp.

    Runs with skip_download=True so no video media is fetched. Returns None on failure.
    """
    try:
        import yt_dlp

        opts = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception as exc:
        log.debug("yt-dlp extraction failed for %s: %s", url, exc)
        return None


class LibraryService:
    #: Why the last `search` ran without its vector half, if it did.
    last_search_degraded: str | None = None

    def __init__(self, store: LibraryStore | None = None, indexer=None, fetcher=None):
        # Injected so a test never reaches the network or an embedding server,
        # and so the share endpoint and the tool share one implementation.
        self.store = store or LibraryStore()
        self._indexer = indexer
        self._fetch = fetcher or fetch_readable

    @property
    def indexer(self) -> Indexer:
        if self._indexer is None:
            self._indexer = Indexer()
        return self._indexer

    # -- capture ---------------------------------------------------------

    async def capture_url(
        self,
        url: str,
        *,
        kind: str | None = None,
        category: str | None = None,
        consumed_on: str | None = None,
        notes: str | None = None,
        title: str | None = None,
        source_ref: str | None = None,
        existing_id: int | None = None,
        force: bool = False,
    ) -> Captured:
        """Log a URL, fetching whatever text it will give up.

        `source_ref` names where the link came from -- a browser bookmark's guid,
        say -- and is checked before the URL is. The two answer different
        questions: the URL catches the same page arriving twice, the ref catches
        the same *bookmark* arriving twice after its page was moved or renamed.
        """
        from backend.library.enrich import normalize_url

        raw_input = str(url or "").strip()
        url = normalize_url(raw_input)
        if not url:
            raise LibraryError("a url is needed")
        if not notes and raw_input != url:
            surrounding = raw_input.replace(url, "").strip()
            surrounding = re.sub(r"^(check out|look what i found|found on|shared from)[^:\n]*:?\s*", "", surrounding, flags=re.I).strip()
            # Strip query strings, hash fragments, and raw links from being treated as notes
            if surrounding and not re.match(r"^[?&#/]", surrounding) and not surrounding.startswith("http"):
                notes = surrounding[:2000]
        if kind and kind not in KINDS:
            raise LibraryError(f"unknown kind '{kind}'. One of: {', '.join(KINDS)}")

        existing = None
        if source_ref:
            existing = self.store.by_source_ref(source_ref)
        if existing is None:
            existing = self.store.by_url(url)

        try:
            await check_url_async(url)
        except UnsafeURL as exc:
            raise LibraryError(str(exc)) from exc

        if existing_id is None and existing is not None:
            is_skeleton = (
                existing["status"] in ("received", "processing", "failed")
                or (existing["title"] == existing["url"] and not existing["text_path"] and not existing["thumbnail_path"])
            )
            if is_skeleton or force:
                existing_id = existing["id"]
            else:
                return Captured(as_dict(existing), already_logged=True)

        # An Instagram permalink is not a page anybody can read: Instagram
        # serves a login wall, so `fetch_readable` would log a title-less item
        # with a note where the content should be. `backend/library/reels.py`
        # opens it properly -- caption, author, video, transcript -- and every
        # door into the library gets that by hooking it here rather than at each
        # caller.
        capture_note = ""
        if is_reel_url(url):
            from backend.library.reels import ReelCapture, ReelError

            try:
                return await ReelCapture(self).capture(
                    url, notes=notes, requested_kind=kind, existing_id=existing_id
                )
            except (ReelError, Exception) as exc:
                capture_note = str(exc)
                log.info("reel capture could not open %s: %s", url, exc)
                # Parse shortcode from reel URL for an honest, informative title
                m_code = re.search(r"/(?:reel|reels|p)/([A-Za-z0-9_-]+)", url)
                shortcode = m_code.group(1) if m_code else ""
                fallback_title = title or (f"Instagram Reel {shortcode}" if shortcode else "Instagram Reel")
                return await self.capture_media(
                    title=fallback_title,
                    kind=kind or "video",
                    category=category,
                    url=url,
                    site="instagram.com",
                    consumed_on=consumed_on,
                    notes=notes,
                    source_ref=url,
                    text="",
                    text_source="none",
                    capture_note=capture_note,
                    existing_id=existing_id,
                )

        # An X link is a three-rung ladder, because the top rung needs setup a
        # fresh machine will not have and the bottom rung is nothing. X serves
        # a JavaScript shell to AMETHYST's user agent and the third-party renderer
        # fallback is usually blocked, so without this the row landed as a
        # bare URL: no text, no document, invisible to search.
        #
        # Rung 1 -- the reader in `backend/web/social.py`, which acts as the
        # signed-in user and reads the whole thread. It was wired to the
        # agent's social tool but never consulted here, which is the gap this
        # fills. It needs `amethyst social allow x`, a `twitter` binary and two
        # cookies in the keychain; every one of those is a deliberate opt-in,
        # so its absence reads as a note, never an exception.
        #
        # Rung 2 -- the public oEmbed endpoint, used the way YouTube's is
        # below. One post, no thread, no credentials: the honest zero-config
        # answer.
        #
        # Rung 3 -- fall through to the ordinary fetch, which will fail
        # against X's shell, and say so in the capture note.
        if is_x_post(url):
            x_note: str | None = None
            from backend.config import load_social
            from backend.web.social import SocialError, reader_for
            from backend.web.social import read as social_read

            social = load_social()
            reader = reader_for(url)
            reader_text = None
            if social.allows("x") and reader is not None:
                from backend.config import paths as config_paths

                try:
                    # A workspace the reader may write in. The library itself
                    # is the workspace here: the reader is only ever going to
                    # write scratch files, and a capture has no tool context
                    # to name a better one.
                    workspace = str(config_paths().home)
                    reader_text, _reader = await social_read(
                        url, workspace=workspace, allowed=social.allow
                    )
                except SocialError as exc:
                    x_note = str(exc)
                except Exception as exc:  # a reader crash is not a lost capture
                    x_note = f"the {reader.source} reader failed: {exc}"
                    log.info("social reader failed for %s: %s", url, exc)
            if reader_text:
                meta = await x_oembed(url)
                return await self.capture_media(
                    title=(meta or {}).get("title") or url,
                    kind=kind or kind_for(url),
                    category=category,
                    url=url,
                    author=(meta or {}).get("author"),
                    site="x.com",
                    consumed_on=consumed_on,
                    notes=notes,
                    source_ref=source_ref,
                    text=reader_text,
                    text_source="page",
                    capture_note="",
                    existing_id=existing_id,
                )
            meta = await x_oembed(url)
            if meta:
                title = title or meta["title"]
                author = meta.get("author") or None
                site = meta.get("site")
                text = meta.get("text") or ""
                published_on = None
                # oEmbed answered, so the capture is complete; the reader's
                # failure (a stale cookie, say) is a detail, and it is logged.
                if x_note:
                    log.info("x reader rung failed for %s: %s", url, x_note)
                capture_note = "x.com post: the post text via oEmbed, no thread context"
                if existing_id is not None:
                    item_id = existing_id
                    self.store.update(
                        item_id,
                        kind=kind or kind_for(url),
                        title=(title or url)[:400],
                        category=category,
                        url=url,
                        author=author,
                        site=site,
                        published_on=published_on,
                        consumed_on=consumed_on or date.today().isoformat(),
                        notes=notes,
                        source_ref=source_ref,
                    )
                else:
                    item_id = self.store.create(
                        kind=kind or kind_for(url),
                        title=(title or url)[:400],
                        category=category,
                        url=url,
                        author=author,
                        site=site,
                        published_on=published_on,
                        consumed_on=consumed_on or date.today().isoformat(),
                        notes=notes,
                        source_ref=source_ref,
                    )
                note = await self._store_text(item_id, title or url, text, capture_note)
                app_tag = app_tag_for_url(url)
                can_enrich = False
                try:
                    from backend.config import load_library
                    can_enrich = bool(load_library().auto_enrich)
                except Exception:
                    can_enrich = False
                initial_status = "enriching" if (can_enrich and len(text.strip()) >= 15) else "ready"
                updates = {
                    "capture_note": note or None,
                    "text_source": "thread text",
                    "status": initial_status,
                }
                if app_tag:
                    updates["tags"] = json.dumps([app_tag])
                all_resources = []
                if meta.get("slide_urls"):
                    all_resources.extend([
                        {"type": "slide", "name": f"Photo {i + 1}", "url": u, "index": i}
                        for i, u in enumerate(meta["slide_urls"])
                    ])
                if meta.get("video_url"):
                    video_item = {"type": "video", "name": "Video", "url": meta["video_url"]}
                    all_resources.insert(0, video_item)
                    updates["kind"] = "video"
                if all_resources:
                    updates["resources"] = json.dumps(all_resources)
                    async def _cache_video(i_id: int, v_u: str):
                        try:
                            import httpx
                            from backend.library.store import media_path
                            target = media_path(i_id, ".mp4")
                            if not target.is_file():
                                async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as c:
                                    r = await c.get(v_u)
                                    if r.status_code == 200 and len(r.content) > 1000:
                                        target.parent.mkdir(parents=True, exist_ok=True)
                                        target.write_bytes(r.content)
                                        self.store.update(i_id, media_path=str(target))
                        except Exception:
                            pass
                    try:
                        asyncio.create_task(_cache_video(item_id, meta["video_url"]))
                    except Exception:
                        pass
                self.store.update(item_id, **updates)
                thumb_url = meta.get("thumbnail_url")
                if thumb_url:
                    await self._save_thumb(item_id, thumb_url)
                if initial_status == "enriching":
                    self._enrich_later(item_id)
                return Captured(as_dict(self.store.get(item_id)))
            # Rung 3: the note names whichever rung was the last one tried.
            if x_note:
                capture_note = x_note

        page = None
        author: str | None = None
        site: str | None = None
        text_source = "none"
        duration_seconds = None
        thumb_url: str | None = None
        threads_slides: list[str] | None = None
        if is_youtube(url):
            info = None
            try:
                info = await asyncio.wait_for(
                    asyncio.to_thread(_extract_youtube_info, url), timeout=10.0
                )
            except (asyncio.TimeoutError, Exception) as exc:
                log.debug("youtube extraction timeout or error for %s: %s", url, exc)

            if info:
                title = title or info.get("title")
                author = info.get("uploader") or info.get("channel") or None
                site = "youtube.com"
                thumb_url = info.get("thumbnail") or None
                duration_seconds = int(info.get("duration")) if info.get("duration") else None
                text = (info.get("description") or "").strip()
                if text:
                    text_source = "video description"
                capture_note = ""
            else:
                meta = await youtube_oembed(url)
                if meta:
                    title = title or meta["title"]
                    author = meta.get("author") or None
                    site = meta.get("site")
                    thumb_url = meta.get("thumbnail_url") or None
                else:
                    author = None
                    site = None
                    thumb_url = None
                    capture_note = "YouTube did not answer for this video's title"
                capture_note = capture_note or "video: title and channel only, no transcript available"
                text = ""
            published_on = None
        elif is_pinterest(url):
            site = "Pinterest"
            meta = await pinterest_oembed(url)
            if meta:
                title = title or meta.get("title")
                author = meta.get("author") or None
                thumb_url = meta.get("thumbnail_url")
            try:
                page = await self._fetch(url)
                if page:
                    title = title or page.title
                    author = author or page.author
                    site = site or page.site
                    published_on = page.published_on
                    text = page.text if page else ""
                    if not thumb_url and page.image:
                        thumb_url = page.image
            except Exception as exc:
                log.debug("pinterest page fetch failed for %s: %s", url, exc)
                text = ""
                published_on = None
            if not text and title:
                text = title
                text_source = "title"
            capture_note = ""
        elif is_threads(url):
            site = "Threads"
            meta = await threads_oembed(url)
            if meta:
                title = title or meta.get("title")
                author = meta.get("author") or None
                text = meta.get("text") or ""
                thumb_url = meta.get("thumbnail_url")
                if meta.get("slide_urls"):
                    threads_slides = meta["slide_urls"]
                if text:
                    text_source = "thread text"
            if not text:
                try:
                    page = await self._fetch(url)
                    if page:
                        title = title or page.title
                        author = author or page.author
                        text = page.text if page else ""
                        if not thumb_url and page.image:
                            thumb_url = page.image
                        if text:
                            text_source = "thread text"
                except Exception as exc:
                    log.debug("threads page fetch fallback failed for %s: %s", url, exc)
            if not text and title:
                text = title
                text_source = "title"
            capture_note = ""
            published_on = None
        elif is_reddit(url):
            site = "reddit.com"
            meta = await reddit_post(url)
            if meta:
                title = title or meta.get("title")
                author = author or meta.get("author")
                text = meta.get("text") or ""
                thumb_url = meta.get("thumbnail_url")
                if text:
                    text_source = "post"
            capture_note = ""
            published_on = None
        else:
            try:
                page = await self._fetch(url)
            except UnsafeURL as exc:
                raise LibraryError(str(exc)) from exc
            except FetchError as exc:
                capture_note = str(exc)
            page = await _rendered_if_empty(url, page)
            title = title or (page.title if page else None)
            author = page.author if page else None
            site = page.site if page else None
            published_on = page.published_on if page else None
            text = page.text if page else ""
            if text:
                text_source = "page"
            if page and page.image:
                thumb_url = page.image
            if not thumb_url and url:
                try:
                    host = (urlparse(url).hostname or "").lower()
                    if host and not any(h in host for h in ("localhost", "127.0.0.1")):
                        thumb_url = f"https://www.google.com/s2/favicons?domain={host}&sz=128"
                except Exception:
                    pass
            if page and page.note:
                capture_note = page.note

        if existing_id is not None:
            item_id = existing_id
            self.store.update(
                item_id,
                kind=kind or kind_for(url),
                title=(title or url)[:400],
                category=category,
                url=url,
                author=author,
                site=site,
                published_on=published_on,
                consumed_on=consumed_on or date.today().isoformat(),
                notes=notes,
                source_ref=source_ref,
            )
        else:
            item_id = self.store.create(
                kind=kind or kind_for(url),
                title=(title or url)[:400],
                category=category,
                url=url,
                author=author,
                site=site,
                published_on=published_on,
                consumed_on=consumed_on or date.today().isoformat(),
                notes=notes,
                source_ref=source_ref,
            )

        note = await self._store_text(item_id, title or url, text, capture_note)
        can_enrich = False
        try:
            from backend.config import load_library
            can_enrich = bool(load_library().auto_enrich)
        except Exception:
            can_enrich = False
        initial_status = "enriching" if (can_enrich and (is_youtube(url) or (text and len(text.strip()) >= 15))) else "ready"
        updates = {"capture_note": note or None, "status": initial_status}
        if text_source != "none":
            updates["text_source"] = text_source
        if duration_seconds is not None:
            updates["duration_seconds"] = duration_seconds
        if threads_slides:
            slide_items = [
                {"type": "slide", "name": f"Photo {i + 1}", "url": u, "index": i}
                for i, u in enumerate(threads_slides)
            ]
            updates["resources"] = json.dumps(slide_items)
            try:
                asyncio.create_task(self.fetch_slides_for_item(item_id))
            except Exception:
                pass

        # Automatically tag item according to originating app/platform
        app_tag = app_tag_for_url(url)
        if app_tag:
            updates["tags"] = json.dumps([app_tag])

        self.store.update(item_id, **updates)

        # Save the thumbnail to disk so the card shows an image across all websites
        if thumb_url:
            await self._save_thumb(item_id, thumb_url)

        if initial_status == "enriching":
            self._enrich_later(item_id)
        return Captured(as_dict(self.store.get(item_id)))

    def _enrich_later(self, item_id: int) -> None:
        """Summarise and tag a fresh capture, out of band.

        Every other door into the library enriches inline -- the reel path, the
        bookmark path -- because a person or a runner is already doing the
        slow work there. `capture_url` is different in the one way that
        matters: the relay poll calls it on a fifteen-second loop, and inline
        enrichment would hold that loop for a model call while more shares
        pile up. Backgrounded instead, so the row lands fast and the summary
        lands when it lands.

        Gated on `library.auto_enrich` so a machine with no provider key can
        turn it off rather than log a refusal per share. The task is held in a
        module-level set with a done-callback: asyncio keeps only weak
        references, so an unreferenced task can be garbage-collected mid-run,
        which is a nondeterministic way for enrichment to vanish without even
        the logged failure. `enrich` can always be re-run from the Library view.
        """
        try:
            from backend.config import load_library

            if not load_library().auto_enrich:
                self.store.update(item_id, status="ready")
                return
        except Exception:
            self.store.update(item_id, status="ready")
            return

        async def run() -> None:
            try:
                await self.enrich(item_id)
            except Exception as exc:  # the item is captured and searchable already
                log.info("auto-enrichment failed for library item %s: %s", item_id, exc)
                try:
                    from backend.library import enrich as enrichment
                    self.store.update(
                        item_id,
                        status="ready",
                        enrichment_note=f"Enrichment note: {exc}",
                        enriched_at=enrichment.stamp(),
                    )
                except Exception:
                    pass

        try:
            task = asyncio.get_running_loop().create_task(run())
        except RuntimeError:  # no loop: a sync caller gets no enrichment
            log.debug("no loop to enrich library item %s on", item_id)
            self.store.update(item_id, status="ready")
            return
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)

    async def log_manual(
        self,
        *,
        title: str,
        kind: str = "note",
        category: str | None = None,
        text: str | None = None,
        url: str | None = None,
        author: str | None = None,
        notes: str | None = None,
        consumed_on: str | None = None,
        rating: int | None = None,
    ) -> Captured:
        """Log something with no URL to fetch -- a book, a talk, a conversation."""
        title = (title or "").strip()
        if not title:
            raise LibraryError("a title is needed")
        if kind not in KINDS:
            raise LibraryError(f"unknown kind '{kind}'. One of: {', '.join(KINDS)}")

        item_id = self.store.create(
            kind=kind,
            title=title[:400],
            category=category,
            url=(url or "").strip() or None,
            author=author,
            site=None,
            consumed_on=consumed_on or date.today().isoformat(),
            notes=notes,
            rating=_rating(rating),
        )
        # Notes are the text when there is no body: what you wrote about a book
        # is the only searchable thing about it.
        body = (text or "").strip() or (notes or "").strip()
        note = await self._store_text(item_id, title, body, "", fetched=False)
        can_enrich = False
        try:
            from backend.config import load_library
            can_enrich = bool(load_library().auto_enrich)
        except Exception:
            can_enrich = False
        text_source = "manual" if body else "none"
        initial_status = "enriching" if (can_enrich and len(body) >= 15) else "ready"
        self.store.update(item_id, capture_note=note or None, text_source=text_source, status=initial_status)
        if initial_status == "enriching":
            self._enrich_later(item_id)
        return Captured(as_dict(self.store.get(item_id)))

    async def capture_media_file(
        self,
        media_path_src: str,
        *,
        title: str | None = None,
        kind: str | None = None,
        category: str | None = None,
        notes: str | None = None,
        consumed_on: str | None = None,
        rating: int | None = None,
        author: str | None = None,
    ) -> Captured:
        """Log a local media file (video, audio, image, document) uploaded to the platform."""
        src = Path(media_path_src).resolve()
        if not src.is_file():
            raise LibraryError(f"file not found: {media_path_src}")

        ext = src.suffix.lower()
        if not kind or kind not in KINDS:
            if ext in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
                kind = "video"
            elif ext in (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"):
                kind = "podcast"
            elif ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"):
                kind = "image"
            elif ext in (".pdf", ".epub"):
                kind = "book"
            else:
                kind = "note"

        clean_title = (title or src.stem).replace("_", " ").strip() or "Uploaded File"

        item_id = self.store.create(
            kind=kind,
            title=clean_title[:400],
            category=category,
            url=None,
            author=author,
            site=None,
            consumed_on=consumed_on or date.today().isoformat(),
            notes=notes,
            rating=_rating(rating),
        )

        dest_media = media_path(item_id, ext or ".bin")
        dest_media.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(src, dest_media)
        except Exception as exc:
            log.warning("failed to copy media to library storage for %s: %s", item_id, exc)
            dest_media = src

        thumb_saved = None
        duration_seconds = None
        text = ""
        text_source = "none"

        if kind == "video":
            t_target = thumbnail_path(item_id)
            from backend.media.audio import _run, ffmpeg_missing
            if not ffmpeg_missing():
                try:
                    code, _ = await _run(["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(dest_media), "-vframes", "1", "-q:v", "3", str(t_target)])
                    if code == 0 and t_target.is_file() and t_target.stat().st_size > 500:
                        thumb_saved = str(t_target)
                except Exception as exc:
                    log.debug("ffmpeg thumbnail generation failed for %s: %s", item_id, exc)

            try:
                from backend.media.audio import extract_audio
                from backend.runtime.transcribe import resolve_transcriber, transcribe
                audio_dest = media_path(item_id, ".audio")
                audio_file = await extract_audio(dest_media, audio_dest)
                if audio_file and resolve_transcriber() is not None:
                    res = await transcribe(audio_file)
                    if res.text and res.text.strip():
                        text = res.text.strip()
                        text_source = "transcript"
            except Exception as exc:
                log.debug("transcription for uploaded video %s failed: %s", item_id, exc)

        elif kind in ("podcast", "audio", "music"):
            try:
                from backend.runtime.transcribe import resolve_transcriber, transcribe
                if resolve_transcriber() is not None:
                    res = await transcribe(dest_media)
                    if res.text and res.text.strip():
                        text = res.text.strip()
                        text_source = "transcript"
            except Exception as exc:
                log.debug("audio transcription for %s failed: %s", item_id, exc)

        elif kind == "image":
            t_target = thumbnail_path(item_id)
            try:
                shutil.copy2(dest_media, t_target)
                thumb_saved = str(t_target)
                text_source = "image"
            except Exception:
                pass

        elif ext in (".txt", ".md"):
            try:
                text = dest_media.read_text(encoding="utf-8", errors="replace")[:50000]
                text_source = "document"
            except Exception:
                pass

        elif ext == ".pdf":
            try:
                from pypdf import PdfReader
                reader = PdfReader(str(dest_media))
                pages = [p.extract_text() for p in reader.pages[:20] if p.extract_text()]
                text = "\n\n".join(pages)
                if text:
                    text_source = "document"
            except Exception:
                pass

        body = (text or "").strip() or (notes or "").strip() or clean_title
        if text_source == "none" and body:
            text_source = "manual" if notes else "title"

        note = await self._store_text(item_id, clean_title, body, "", fetched=False)

        can_enrich = False
        try:
            from backend.config import load_library
            can_enrich = bool(load_library().auto_enrich)
        except Exception:
            can_enrich = False

        initial_status = "enriching" if (can_enrich and len(body.strip()) >= 15) else "ready"
        updates = {
            "capture_note": note or None,
            "text_source": text_source,
            "media_path": str(dest_media),
            "thumbnail_path": thumb_saved,
            "status": initial_status,
        }
        if duration_seconds:
            updates["duration_seconds"] = duration_seconds
        self.store.update(item_id, **updates)

        if initial_status == "enriching":
            self._enrich_later(item_id)

        return Captured(as_dict(self.store.get(item_id)))

    async def _save_thumb(self, item_id: int, thumb_url: str, base_url: str | None = None) -> None:
        """Download a thumbnail and attach it to the library item.

        Best-effort — a failure is logged but never raised, because the item
        is already saved and a missing image is better than a missing row.
        """
        if not thumb_url:
            return
        if base_url and not thumb_url.startswith(("http://", "https://")):
            from urllib.parse import urljoin
            thumb_url = urljoin(base_url, thumb_url)
        import httpx as _httpx
        from backend.web.reader import DEFAULT_HEADERS

        target = thumbnail_path(item_id)
        try:
            async with _httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(thumb_url, headers=DEFAULT_HEADERS)
            if resp.status_code == 200 and resp.content and len(resp.content) >= 300:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(resp.content)
                self.store.update(item_id, thumbnail_path=str(target))
            else:
                log.debug("thumbnail fetch returned %s (bytes: %d) for item %s", resp.status_code, len(resp.content) if resp.content else 0, item_id)
        except Exception as exc:
            log.debug("could not save thumbnail for item %s: %s", item_id, exc)

    async def _save_youtube_thumb(self, item_id: int, thumb_url: str) -> None:
        await self._save_thumb(item_id, thumb_url)

    async def fetch_thumbnail_for_item(self, item_id: int) -> bool:
        """Fetch or backfill thumbnail for an item that currently lacks one."""
        raw = self.store.get(item_id)
        if not raw:
            return False
        row = dict(raw)

        # Rung 0: If video file exists on disk, extract frame directly using ffmpeg
        if row.get("media_path"):
            vpath = Path(row["media_path"])
            if vpath.is_file():
                target = thumbnail_path(item_id)
                target.parent.mkdir(parents=True, exist_ok=True)
                from backend.media.audio import _run, ffmpeg_missing
                if not ffmpeg_missing():
                    try:
                        code, _ = await _run(
                            ["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(vpath), "-vframes", "1", "-q:v", "3", str(target)],
                            timeout=30.0,
                            workspace=str(target.parent),
                        )
                        if code == 0 and target.is_file() and target.stat().st_size > 500:
                            self.store.update(item_id, thumbnail_path=str(target))
                            return True
                    except Exception as exc:
                        log.debug("frame extract failed for item %s: %s", item_id, exc)

        url = row.get("url")
        if not url:
            return False

        thumb_url = None
        if is_reel_url(url):
            from backend.media.reel import fetch_reel
            try:
                reel = await fetch_reel(url, None)
                thumb_url = reel.thumbnail_url or (reel.slide_urls[0] if reel.slide_urls else None)
            except Exception as exc:
                log.debug("reel thumbnail fetch failed for %s: %s", url, exc)
        elif is_youtube(url):
            try:
                info = await asyncio.to_thread(_extract_youtube_info, url)
                if info and info.get("thumbnail"):
                    thumb_url = info.get("thumbnail")
            except Exception:
                pass
            if not thumb_url:
                meta = await youtube_oembed(url)
                if meta and meta.get("thumbnail_url"):
                    thumb_url = meta.get("thumbnail_url")
        elif is_reddit(url):
            meta = await reddit_post(url)
            if meta and meta.get("thumbnail_url"):
                thumb_url = meta.get("thumbnail_url")
        elif is_x_post(url):
            meta = await x_oembed(url)
            if meta and meta.get("thumbnail_url"):
                thumb_url = meta.get("thumbnail_url")
        elif is_pinterest(url):
            meta = await pinterest_oembed(url)
            if meta and meta.get("thumbnail_url"):
                thumb_url = meta.get("thumbnail_url")
            if not thumb_url:
                try:
                    page = await self._fetch(url)
                    if page and page.image:
                        thumb_url = page.image
                except Exception:
                    pass
        elif is_threads(url):
            meta = await threads_oembed(url)
            if meta and meta.get("thumbnail_url"):
                thumb_url = meta.get("thumbnail_url")
            if not thumb_url:
                try:
                    page = await self._fetch(url)
                    if page and page.image:
                        thumb_url = page.image
                except Exception:
                    pass
        else:
            try:
                page = await self._fetch(url)
                if page and page.image:
                    thumb_url = page.image
            except Exception:
                pass

        # High-res favicon/touch-icon fallback if webpage had no og:image
        if not thumb_url and url:
            try:
                from urllib.parse import urlparse
                host = (urlparse(url).hostname or "").lower()
                if host and not any(h in host for h in ("localhost", "127.0.0.1")):
                    thumb_url = f"https://www.google.com/s2/favicons?domain={host}&sz=128"
            except Exception:
                pass

        if thumb_url:
            await self._save_thumb(item_id, thumb_url)
            updated = self.store.get(item_id)
            return bool(updated and updated["thumbnail_path"])
        return False

    async def fetch_slides_for_item(self, item_id: int) -> list[str]:
        """Fetch and cache carousel slides for an item on-demand."""
        import json as _json
        import httpx
        from backend.library.store import slide_path, thumbnail_path
        from backend.media.reel import fetch_reel, is_reel_url

        raw = self.store.get(item_id)
        if not raw:
            return []
        row = dict(raw)
        url = row.get("url")
        slide_urls: list[str] = []
        if url and is_reel_url(url):
            try:
                reel = await fetch_reel(url, None)
                if reel and reel.slide_urls:
                    slide_urls = list(reel.slide_urls)
            except Exception as exc:
                log.debug("on-demand reel fetch failed for item %s: %s", item_id, exc)

        if not slide_urls and row.get("resources"):
            try:
                existing_res = _json.loads(row["resources"])
                for r in existing_res:
                    if isinstance(r, dict) and r.get("type") in ("slide", "image"):
                        u = r.get("url")
                        if u and u.startswith("http"):
                            slide_urls.append(u)
            except Exception:
                pass

        if not slide_urls:
            return []

        saved_paths: list[str] = []
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for i, s_url in enumerate(slide_urls[:10]):
                target = slide_path(item_id, i)
                if not (target.is_file() and target.stat().st_size > 500):
                    try:
                        resp = await client.get(
                            s_url,
                            headers={
                                "User-Agent": (
                                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                                )
                            },
                        )
                        if resp.status_code == 200 and resp.content:
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_bytes(resp.content)
                            saved_paths.append(str(target))
                            if i == 0:
                                t_target = thumbnail_path(item_id)
                                if not t_target.is_file() or t_target.stat().st_size < 500:
                                    t_target.parent.mkdir(parents=True, exist_ok=True)
                                    t_target.write_bytes(resp.content)
                                    self.store.update(item_id, thumbnail_path=str(t_target))
                    except Exception as exc:
                        log.debug("could not fetch slide %d for item %s: %s", i, item_id, exc)
                else:
                    saved_paths.append(str(target))

        # Update resources to reflect local slide endpoints while keeping remote_url
        slide_items = [
            {
                "type": "slide",
                "name": f"Slide {idx + 1}",
                "url": f"/api/library/{item_id}/slides/{idx}",
                "remote_url": slide_urls[idx] if idx < len(slide_urls) else None,
                "index": idx,
            }
            for idx in range(len(slide_urls))
        ]
        existing_res = []
        if row.get("resources"):
            try:
                existing_res = _json.loads(row["resources"])
            except Exception:
                existing_res = []
        non_slides = [r for r in existing_res if isinstance(r, dict) and r.get("type") not in ("slide", "image")]
        self.store.update(item_id, resources=_json.dumps(non_slides + slide_items))

        return saved_paths

    async def _store_text(
        self,
        item_id: int,
        title: str,
        text: str,
        note: str,
        *,
        fetched: bool = True,
        rendered: bool = False,
    ) -> str:
        """Write the text to disk and index it. Returns the note to record.

        `fetched` says whether there was a page to read. A book logged with two
        lines of your own notes is complete; a *page* that returned two lines is
        a paywall, and only the second is worth a note.

        `rendered` says `text` is already the whole document, heading and all --
        which is how `enrich` hands back a file carrying a summary, tags and a
        transcript under their own headings. Without it the title would be
        written twice.
        """
        text = (text or "").strip()
        if not text:
            return note or (
                "no text was captured, so this is findable by its title and notes only"
            )
        if fetched and len(text) < MIN_INDEXABLE_CHARS and not note:
            note = "the page gave up very little text"

        path = text_path(item_id, title)
        document_text = text if rendered else f"# {title}\n\n{text}\n"
        try:
            # Atomic: this file is indexed the line below, and a crash mid-write
            # would index a truncated capture that then reads as unchanged on
            # every later scan.
            from backend.config import write_atomic

            write_atomic(path, document_text)
        except OSError as exc:
            log.warning("could not write library text for %s: %s", item_id, exc)
            return f"the text could not be saved: {exc}"

        report = await self.indexer.index_file(
            path, source="library", title=title, require_embeddings=False
        )
        document = get_connection().execute(
            "SELECT id FROM documents WHERE path = ?", (str(path.resolve()),)
        ).fetchone()
        self.store.update(
            item_id,
            document_id=document["id"] if document else None,
            text_path=str(path),
            word_count=len(text.split()),
        )
        if report == 0 and document is None:
            return note or "the text could not be indexed"
        return note

    async def capture_media(
        self,
        *,
        title: str,
        kind: str = "video",
        category: str | None = None,
        url: str | None = None,
        author: str | None = None,
        site: str | None = None,
        published_on: str | None = None,
        consumed_on: str | None = None,
        notes: str | None = None,
        source_ref: str | None = None,
        text: str = "",
        text_source: str = "none",
        capture_note: str = "",
        thumbnail_path: str | None = None,
        media_path: str | None = None,
        duration_seconds: int | None = None,
        existing_id: int | None = None,
    ) -> Captured:
        """Log something whose text AMETHYST fetched itself, not through a page fetch.

        A reel is neither `capture_url` nor `log_manual`: there was something to
        fetch, but it did not come from `fetch_readable` and there may be no text
        at all. This is that third case, and it goes through the same
        `_store_text` so the "the text is a real file" invariant keeps one owner.
        """
        title = (title or "").strip()
        if not title:
            raise LibraryError("a title is needed")
        if kind not in KINDS:
            raise LibraryError(f"unknown kind '{kind}'. One of: {', '.join(KINDS)}")

        if existing_id is None:
            existing = None
            if source_ref:
                existing = self.store.by_source_ref(source_ref)
            if existing is None and url:
                existing = self.store.by_url(url)
            if existing is not None:
                is_skeleton = (
                    existing["status"] in ("received", "processing", "failed")
                    or (existing["title"] == existing["url"] and not existing["text_path"] and not existing["thumbnail_path"])
                )
                if is_skeleton:
                    existing_id = existing["id"]
                else:
                    return Captured(as_dict(existing), already_logged=True)

        if existing_id is not None:
            item_id = existing_id
            self.store.update(
                item_id,
                kind=kind,
                title=title[:400],
                category=category,
                url=url,
                author=author,
                site=site,
                published_on=published_on,
                consumed_on=consumed_on or date.today().isoformat(),
                notes=notes,
                source_ref=source_ref,
                status="ready",
            )
        else:
            item_id = self.store.create(
                kind=kind,
                title=title[:400],
                category=category,
                url=url,
                author=author,
                site=site,
                published_on=published_on,
                consumed_on=consumed_on or date.today().isoformat(),
                notes=notes,
                source_ref=source_ref,
            )
        note = await self._store_text(item_id, title, text, capture_note, fetched=False)
        app_tag = app_tag_for_url(url)
        updates = {
            "capture_note": note or None,
            "text_source": text_source,
            "thumbnail_path": thumbnail_path,
            "media_path": media_path,
            "duration_seconds": duration_seconds,
            "status": "ready",
        }
        if app_tag:
            updates["tags"] = json.dumps([app_tag])
        self.store.update(item_id, **updates)
        return Captured(as_dict(self.store.get(item_id)))

    async def replace_text(
        self,
        item_id: int,
        text: str,
        *,
        note: str = "",
        text_source: str | None = None,
        rendered: bool = False,
    ) -> dict:
        """Rewrite an item's text and its index entries.

        The transcript arrives minutes after the row does, and the summary later
        still. Appending to the file without dropping the old chunks first leaves
        the caption indexed twice, so one reel comes back as two hits.
        """
        row = self.store.get(item_id)
        if row is None:
            raise LibraryError(f"no library item {item_id}")

        if row["document_id"]:
            self._drop_chunks(row["document_id"])
            # Load-bearing, and not obvious. The indexer skips a file whose
            # content hash is unchanged, so dropping the chunks and then writing
            # the same bytes back leaves the item with *no* index at all -- worse
            # than the double-indexing this method exists to prevent. Marking it
            # stale is what makes the re-index actually happen.
            self.indexer.mark_stale(text_path(item_id, row["title"]))
        stored = await self._store_text(
            item_id, row["title"], text, note, fetched=False, rendered=rendered
        )
        fields: dict = {"capture_note": stored or None}
        if text_source:
            fields["text_source"] = text_source
        self.store.update(item_id, **fields)
        return as_dict(self.store.get(item_id))

    async def enrich(
        self,
        item_id: int,
        *,
        client=None,
        provider: str | None = None,
        model: str | None = None,
    ) -> dict:
        """Say what this item is about, from the text it actually has.

        Rewrites the item's file so the summary, the tags and the mentioned
        things are indexed alongside the source text -- which is what lets "that
        video about coffee grind" find a reel whose transcript never says the
        phrase. The source text is read back out of the file first, so
        re-enriching summarises the transcript again and never the last summary.
        """
        from backend.library import enrich as enrichment

        raw_row = self.store.get(item_id)
        if raw_row is None:
            raise LibraryError(f"no library item {item_id}")
        row = dict(raw_row)

        body, heading = "", "Text"
        if row["text_path"]:
            try:
                body, heading = enrichment.body_of(
                    Path(row["text_path"]).read_text(encoding="utf-8")
                )
            except OSError as exc:
                log.warning("could not read library text for %s: %s", item_id, exc)

        text_source = row["text_source"] or ("page" if row["url"] else "note")

        # If this is a reel/video/carousel and has not had visual content extracted yet,
        # try re-extracting slides, caption or frames so enrichment has full context
        if row["url"] and is_reel_url(row["url"]) and (
            row["title"] in ("Instagram", row["url"])
            or text_source in ("caption", "none", "title", "page")
            or not row.get("resources")
            or not row.get("thumbnail_path")
        ):
            from backend.config import load_instagram
            from backend.library.reels import ReelCapture
            ig_settings = load_instagram()
            try:
                rc = ReelCapture(self, settings=ig_settings)
                recaptured = await rc.capture(row["url"], existing_id=item_id)
                updated_row = self.store.get(item_id)
                if updated_row:
                    row = dict(updated_row)
                    if row["text_path"]:
                        body, heading = enrichment.body_of(
                            Path(row["text_path"]).read_text(encoding="utf-8")
                        )
                    text_source = row["text_source"] or "caption"
            except Exception as exc:
                log.debug("re-extraction of reel during enrich skipped/failed: %s", exc)

        # Check if local video exists on disk if media_path was null in DB
        if not row.get("media_path"):
            for ext in (".mp4", ".mov", ".webm", ".mkv"):
                cand = media_path(item_id, ext)
                if cand.is_file():
                    row["media_path"] = str(cand)
                    self.store.update(item_id, media_path=str(cand))
                    break

        elif row.get("media_path") and Path(row["media_path"]).is_file():
            # If transcript is missing, try audio extraction and transcription
            if "transcript" not in text_source:
                try:
                    from backend.media.audio import extract_audio
                    from backend.runtime.transcribe import resolve_transcriber, transcribe
                    if resolve_transcriber() is not None:
                        a_dest = media_path(item_id, ".audio")
                        a_file = await extract_audio(Path(row["media_path"]), a_dest)
                        if a_file:
                            res = await transcribe(a_file)
                            if res and res.text and res.text.strip():
                                t_text = res.text.strip()
                                body = f"{body}\n\n## Transcript\n\n{t_text}" if body else t_text
                                text_source = f"{text_source} and transcript" if text_source not in ("none", "") else "transcript"
                                await self.replace_text(item_id, body, text_source=text_source)
                                updated_row = self.store.get(item_id)
                                if updated_row and updated_row["text_path"]:
                                    body, heading = enrichment.body_of(Path(updated_row["text_path"]).read_text(encoding="utf-8"))
                                    row = dict(updated_row)
                except Exception as exc:
                    log.debug("transcription during enrich failed: %s", exc)

            if "visual content" not in text_source:
                try:
                    import tempfile
                    from backend.media.vision import extract_frames
                    from backend.runtime.vision import extract_visual_text
                    frames_dir = Path(tempfile.mkdtemp(prefix="amethyst-vision-enrich-"))
                    try:
                        frames = await extract_frames(Path(row["media_path"]), frames_dir)
                        if frames:
                            vtext = await extract_visual_text([f.read_bytes() for f in frames])
                            if vtext:
                                new_body = f"{body}\n\n## Visual Content\n\n{vtext}" if body else vtext
                                new_source = f"{text_source} and visual content" if text_source not in ("none", "") else "visual content"
                                await self.replace_text(item_id, new_body, text_source=new_source)
                                updated_row = self.store.get(item_id)
                                if updated_row and updated_row["text_path"]:
                                    body, heading = enrichment.body_of(Path(updated_row["text_path"]).read_text(encoding="utf-8"))
                                    text_source = updated_row["text_source"]
                                    row = dict(updated_row)
                    finally:
                        shutil.rmtree(frames_dir, ignore_errors=True)
                except Exception as exc:
                    log.debug("frame re-extraction during enrich failed: %s", exc)

        # If body is still empty but URL exists, re-fetch page/post
        if not body.strip() and row["url"]:
            try:
                await self.capture_url(row["url"], existing_id=item_id, force=True)
                updated_row = self.store.get(item_id)
                if updated_row:
                    row = dict(updated_row)
                    if row["text_path"] and Path(row["text_path"]).is_file():
                        body, heading = enrichment.body_of(
                            Path(row["text_path"]).read_text(encoding="utf-8")
                        )
                    text_source = row["text_source"] or "page"
            except Exception as exc:
                log.debug("re-fetching link during enrich for item %s failed: %s", item_id, exc)

        if (
            not body.strip()
            and row.get("notes")
            and not re.match(r"^[?&#]", row["notes"].strip())
            and not row["notes"].strip().startswith("http")
        ):
            body = row["notes"]
            heading = "Notes"
            text_source = "notes"
        elif not body.strip() and row.get("title") and len(row["title"].strip()) >= 5 and row["title"].strip() not in ("Instagram", "YouTube", "Twitter", "X", "TikTok", "Reddit"):
            body = row["title"]
            heading = "Title"
            text_source = "title"

        if text_source == "transcript":
            heading = "Transcript"
        elif text_source == "caption":
            heading = "Caption"
        elif text_source == "caption and transcript":
            heading = "Caption and Transcript"
        elif "slide analysis" in text_source:
            heading = "Slide Analysis"
        elif "visual content" in text_source:
            heading = "Visual Content"
        elif text_source in ("video description", "description"):
            heading = "Description"
        elif text_source in ("notes", "note", "manual"):
            heading = "Notes"
        elif text_source in ("thread text", "tweet", "social post"):
            heading = "Post"
        elif text_source == "document":
            heading = "Document"

        self.store.update(item_id, status="enriching")
        try:
            result = await enrichment.enrich_text(
                body,
                title=row["title"],
                kind=row["kind"],
                text_source=text_source,
                client=client,
                provider=provider,
                model=model,
            )

            existing_tags = _json_list(row["tags"])
            app_tag = app_tag_for_url(row["url"])
            raw_tags = list(result.tags or [])
            if not raw_tags and existing_tags:
                raw_tags = existing_tags
            canon = enrichment.canonicalize_tags(raw_tags)
            if not canon and raw_tags:
                clean_tags = [t.strip().lower() for t in raw_tags if isinstance(t, str) and t.strip()]
                canon = clean_tags[:enrichment.MAX_TAGS]
            combined_tags = []
            for t in canon:
                if t != app_tag and t not in combined_tags:
                    combined_tags.append(t)
            if app_tag and app_tag not in combined_tags:
                combined_tags.append(app_tag)
            combined_tags = combined_tags[:enrichment.MAX_TAGS + 1]

            existing_resources = _json_list(row.get("resources"))
            merged_resources = list(result.resources) if result.resources else []
            for r in existing_resources:
                if isinstance(r, dict) and r.get("type") in ("slide", "image", "music", "song"):
                    if not any(mr.get("url") == r.get("url") for mr in merged_resources if isinstance(mr, dict)):
                        merged_resources.append(r)

            clean_summary = result.summary
            if not clean_summary and not result.note and text_source not in ("none", "") and body.strip() and 10 <= len(body.strip()) <= 400:
                clean_summary = body.strip()

            update_fields = {
                "status": "ready",
                "category": result.category,
                "summary": clean_summary,
                "tags": json.dumps(combined_tags) if combined_tags else None,
                "resources": json.dumps(merged_resources) if merged_resources else None,
                "enrichment_note": result.note,
                "enrichment_model": (
                    f"{result.provider}:{result.model}" if result.provider and result.model else None
                ),
                "enriched_at": enrichment.stamp(),
            }
            if getattr(result, "entity", None):
                update_fields["entity"] = json.dumps(result.entity)
                if (
                    row["title"] in ("Instagram", "YouTube", "TikTok", "Reddit", "Twitter", "X", row.get("url"))
                    or not row.get("title")
                ) and result.entity.get("title"):
                    update_fields["title"] = result.entity["title"]

            self.store.update(item_id, **update_fields)

            if body.strip():
                rendered = enrichment.render_markdown(
                    title=row["title"],
                    body=body,
                    body_heading=heading,
                    enrichment=result,
                    capture_note=row["capture_note"],
                )
                await self.replace_text(
                    item_id, rendered, note=row["capture_note"] or "", rendered=True
                )
        except Exception as exc:
            log.warning("enrichment failed for library item %s: %s", item_id, exc)
            self.store.update(
                item_id,
                status="ready",
                enrichment_note=f"Enrichment note: {exc}",
                enriched_at=enrichment.stamp(),
            )
            raise
        finally:
            curr = self.store.get(item_id)
            if curr and curr["status"] == "enriching":
                self.store.update(item_id, status="ready", enriched_at=enrichment.stamp())

        return as_dict(self.store.get(item_id))

    # -- maintenance -----------------------------------------------------

    async def reindex(self, item_id: int) -> dict:
        """Index an item's text again, first forgetting a refused embedder.

        `_UNREACHABLE` is cached for the life of the process, so an item captured
        while Ollama was down stays keyword-only until something clears it. This
        is that something: starting Ollama and pressing re-index is enough, and
        restarting AMETHYST is not required.
        """
        row = self.store.get(item_id)
        if row is None:
            raise LibraryError(f"no library item {item_id}")
        if not row["text_path"]:
            raise LibraryError("there is no captured text for this item to index")
        path = Path(row["text_path"])
        if not path.exists():
            raise LibraryError(f"the captured text is missing from {path}")

        forget_unreachable()
        # Force a re-embed rather than trusting the content hash: the text has
        # not changed, the index is what was incomplete.
        self.indexer.mark_stale(path)
        if row["document_id"]:
            self._drop_chunks(row["document_id"])
        await self.indexer.index_file(
            path, source="library", title=row["title"], require_embeddings=True
        )
        document = get_connection().execute(
            "SELECT id FROM documents WHERE path = ?", (str(path.resolve()),)
        ).fetchone()
        self.store.update(
            item_id,
            document_id=document["id"] if document else None,
            capture_note=None,
        )
        return as_dict(self.store.get(item_id))

    def _drop_chunks(self, document_id: int) -> None:
        conn = get_connection()
        chunk_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM document_chunks WHERE document_id = ?", (document_id,)
            ).fetchall()
        ]
        index_store.remove_chunks(conn, chunk_ids)
        conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
        conn.commit()

    def remove(self, item_id: int) -> bool:
        """Delete an item, its text, its chunks and its index entries."""
        row = self.store.get(item_id)
        if row is None:
            return False
        conn = get_connection()
        if row["document_id"]:
            self._drop_chunks(row["document_id"])
            conn.execute("DELETE FROM documents WHERE id = ?", (row["document_id"],))
            conn.commit()
        # Every file the item owns, not just the text. A thumbnail is small and
        # a video is not, and an orphaned mp4 under ~/.amethyst/library/media with
        # no row pointing at it is one nothing will ever clean up.
        for field in ("text_path", "thumbnail_path", "media_path"):
            if row[field]:
                Path(row[field]).unlink(missing_ok=True)
        return self.store.delete(item_id)

    # -- reading ---------------------------------------------------------

    def recent(
        self,
        *,
        kind: str | None = None,
        category: str | None = None,
        tag: str | None = None,
        order: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        # The store does the filtering.
        #
        # `category` used to be handled here instead: read 5000 rows, keep the
        # ones that match in Python, then slice. `LibraryStore.list` has taken
        # a `category` argument the whole time -- this read the entire table to
        # do in memory what an indexed WHERE does, and silently truncated at
        # 5000 items.
        if not category:
            rows = self.store.list(
                kind=kind, tag=tag, order=order, limit=limit, offset=offset
            )
            return [as_dict(row) for row in rows]

        # A category filter has to find what `as_dict` *calls* an item, not
        # only what the column stores. Items filed as null or 'general' get an
        # inferred category on the way out, so filtering on the column alone
        # returned nineteen movies out of a chip that said twenty-one -- the
        # count and the filter disagreeing about the same word. Two narrowed
        # queries: the ones stored under this category, plus the unfiled ones
        # whose inference lands on it.
        rows = list(
            self.store.list(kind=kind, tag=tag, category=category, order=order, limit=5000)
        )
        rows += self.store.unfiled(kind=kind, tag=tag, order=order)
        items: list[dict] = []
        seen: set[int] = set()
        for row in rows:
            # A row stored as 'general' is in both queries; `as_dict` decides
            # once what it is called and that answer is what gets matched.
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            item = as_dict(row)
            if item.get("category") == category:
                items.append(item)
        reverse = str(order).lower() != "asc"
        items.sort(key=lambda i: (i.get("consumed_on") or "", i["id"]), reverse=reverse)
        return items[offset : offset + limit]

    def category_counts(self) -> dict[str, int]:
        """How many items sit under each category.

        Counted in SQL. This used to read the first 500 rows and tally them in
        Python, so on a library of any size it reported the composition of the
        most recent 500 items as though it were the whole shelf -- and the
        interface's category chips, which read this, were quietly wrong.
        Items with no category are still reported under 'general', which is
        what the interface calls them.
        """
        counts = {
            name: n
            for name, n in self.store.category_counts().items()
            if name and name != "general"
        }
        # The unfiled rows are the only ones that need Python. `as_dict` infers
        # a category for an item stored as null or 'general', so counting the
        # stored column alone would disagree with what the same items say when
        # they are listed -- the interface would show a chip labelled with a
        # number that no filter reproduces. Bounded to the unfiled subset
        # rather than the whole table.
        unfiled = self.store.conn.execute(
            "SELECT * FROM library_items WHERE category IS NULL OR category = ''"
            " OR category = 'general'"
        ).fetchall()
        for row in unfiled:
            name = as_dict(row).get("category") or "general"
            counts[name] = counts.get(name, 0) + 1
        return counts

    def tag_counts(self) -> dict[str, int]:
        try:
            rows = self.store.conn.execute(
                "SELECT json_each.value AS tag, COUNT(DISTINCT library_items.id) AS count "
                "FROM library_items, json_each(library_items.tags) "
                "WHERE library_items.tags IS NOT NULL "
                "GROUP BY json_each.value ORDER BY count DESC, tag ASC LIMIT 100"
            ).fetchall()
            return {row["tag"]: row["count"] for row in rows}
        except Exception:
            return {}

    def app_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        try:
            rows = self.store.conn.execute(
                "SELECT url FROM library_items WHERE url IS NOT NULL"
            ).fetchall()
            for row in rows:
                app = app_tag_for_url(row["url"])
                if app:
                    counts[app] = counts.get(app, 0) + 1
        except Exception:
            pass
        return counts

    def consolidate_tags(self) -> dict[str, int]:
        """Normalize and consolidate all existing tags in SQLite to canonical topics."""
        from backend.library.enrich import canonicalize_tags

        rows = self.store.list(limit=5000)
        updated = 0
        for row in rows:
            raw = _json_list(row["tags"])
            if not raw:
                continue
            canonical = canonicalize_tags(raw)
            if not canonical and raw:
                canonical = [r.strip().lower() for r in raw[:2]]
            if canonical != raw:
                self.store.update(row["id"], tags=json.dumps(canonical))
                updated += 1
        return {"updated_items": updated, "distinct_tags": len(self.tag_counts())}

    def counts(self) -> dict[str, int]:
        return self.store.counts()

    async def search(self, query: str, *, limit: int = 20) -> list[dict]:
        """Find library items by meaning and by keyword, ranked together.

        Results are items, not chunks: a hit is joined back to what you read, so
        the answer is "this article, and the passage that matched" rather than a
        path under ~/.amethyst.
        """
        query = (query or "").strip()
        if not query:
            return []
        searcher = SearchService()
        hits = await searcher.search(query, limit=limit * 3, source="library")
        # Recorded on the service so a caller can say the result is a floor
        # rather than a total. With the embedder unreachable this is keyword
        # matching alone, and half this library's titles are an emoji.
        self.last_search_degraded = searcher.degraded
        if not hits:
            return []

        conn = get_connection()
        placeholders = ",".join("?" * len(hits))
        rows = conn.execute(
            "SELECT c.id AS chunk_id, c.document_id FROM document_chunks c"
            f" WHERE c.id IN ({placeholders})",
            [hit.chunk_id for hit in hits],
        ).fetchall()
        document_for = {row["chunk_id"]: row["document_id"] for row in rows}
        items = self.store.by_document_ids(sorted({row["document_id"] for row in rows}))

        out: list[dict] = []
        seen: set[int] = set()
        for hit in hits:
            document_id = document_for.get(hit.chunk_id)
            item = items.get(document_id) if document_id else None
            if item is None or item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append({**as_dict(item), "excerpt": _excerpt(hit.content), "score": hit.score})
            if len(out) >= limit:
                break
        return out

    async def sweep_unsummarized(self, max_items: int = 50, force: bool = False) -> int:
        """Find items that lack summaries and enrich them sequentially.

        Returns the number of items processed.
        """
        try:
            from backend.config import load_library
            if not load_library().auto_enrich:
                return 0
        except Exception:
            return 0

        import time
        now = time.time()
        if force:
            _SWEEP_ATTEMPTS.clear()

        # Clean up attempts older than 10 minutes so items can be retried eventually
        expired = [item_id for item_id, t in _SWEEP_ATTEMPTS.items() if now - t > 600]
        for item_id in expired:
            _SWEEP_ATTEMPTS.pop(item_id, None)

        recent_ids = tuple(_SWEEP_ATTEMPTS.keys())
        rows = self.store.unsummarized(limit=max_items, exclude_ids=recent_ids)
        if not rows:
            return 0

        processed = 0
        for row in rows:
            item_id = row["id"]
            _SWEEP_ATTEMPTS[item_id] = now
            try:
                log.info("auto-enriching unsummarized library item %d: %s", item_id, row["title"] or "")
                await self.enrich(item_id)
                processed += 1
            except Exception as exc:
                log.warning("auto-enrichment sweep failed for item %d: %s", item_id, exc)
            # Gentle throttle between items to prevent rate limiting
            await asyncio.sleep(1.2)

        return processed



def _rating(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return min(5, max(1, number))


def _excerpt(content: str, *, limit: int = 320) -> str:
    text = " ".join(content.split())
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def describe(item: dict) -> str:
    """One line about an item, for a model reading a tool result.

    Category and tags are part of the line because they are what the user
    asks in. "Which movies have I saved" is answered by `category=movie` or
    `tag=cinema`, and a result that printed neither left the model unable to
    see the classification it had just filtered on -- or to group by it when
    it had not. Half this library's titles are an emoji and nothing else; the
    tags are the only readable thing about those rows.
    """
    bits = [item["title"]]
    if item.get("author"):
        bits.append(f"by {item['author']}")
    facts = [item["kind"]]
    if item.get("category"):
        facts.append(item["category"])
    facts.append(f"logged {item['consumed_on']}")
    bits.append(f"({', '.join(facts)})")
    tags = item.get("tags")
    if tags:
        bits.append(f"[{', '.join(tags)}]")
    if item.get("capture_note"):
        bits.append(f"-- {item['capture_note']}")
    return " ".join(bits)
