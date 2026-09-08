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
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from backend.db.connection import get_connection
from backend.library.store import KINDS, LibraryStore, text_path
from backend.mcp.ssrf import UnsafeURL, check_url_async
from backend.media.reel import is_reel_url
from backend.retrieval import store as index_store
from backend.retrieval.embeddings import forget_unreachable
from backend.retrieval.indexer import Indexer
from backend.retrieval.search import SearchService
from backend.web.reader import (
    FetchError,
    fetch_readable,
    is_x_post,
    is_youtube,
    x_oembed,
    youtube_oembed,
)

log = logging.getLogger(__name__)

#: Background enrichment tasks, held so the event loop's weak reference to an
#: unreferenced task cannot be the reason enrichment silently vanishes.
_BACKGROUND_TASKS: set[asyncio.Task] = set()

#: Below this, the "text" is a cookie banner or a paywall stub rather than an
#: article, and indexing it would pollute the index with a page nobody read.
MIN_INDEXABLE_CHARS = 200

_KIND_BY_HOST = {
    "youtube.com": "video",
    "www.youtube.com": "video",
    "m.youtube.com": "video",
    "youtu.be": "video",
    "music.youtube.com": "podcast",
    "open.spotify.com": "podcast",
    "podcasts.apple.com": "podcast",
    # X links are posts, not articles: they have an author and a body of a
    # handful of sentences, and filing them as articles put every one of them
    # in the wrong bucket of the library.
    "x.com": "post",
    "twitter.com": "post",
    "mobile.twitter.com": "post",
    "arxiv.org": "paper",
    "www.arxiv.org": "paper",
}


class LibraryError(ValueError):
    """Something the caller can fix, phrased for whoever asked."""


@dataclass
class Captured:
    item: dict
    already_logged: bool = False


def kind_for(url: str | None) -> str:
    if not url:
        return "note"
    host = (urlparse(url).hostname or "").lower()
    return _KIND_BY_HOST.get(host, "article")


def _json_list(raw) -> list:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def as_dict(row) -> dict:
    """One item, as the interface and the model both see it."""
    from backend.library.enrich import infer_category

    data = dict(row)
    data["indexed"] = data.get("document_id") is not None
    # Stored as JSON so the columns stay simple; handed out as lists so nothing
    # above this line has to know that.
    tags = _json_list(data.get("tags"))
    resources = _json_list(data.get("resources"))
    data["tags"] = tags
    data["resources"] = resources

    cat = data.get("category")
    if not cat or cat == "general":
        cat = infer_category(resources, tags, kind=data.get("kind", ""))
    data["category"] = cat or "general"
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


class LibraryService:
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
    ) -> Captured:
        """Log a URL, fetching whatever text it will give up.

        `source_ref` names where the link came from -- a browser bookmark's guid,
        say -- and is checked before the URL is. The two answer different
        questions: the URL catches the same page arriving twice, the ref catches
        the same *bookmark* arriving twice after its page was moved or renamed.
        """
        url = (url or "").strip()
        if not url:
            raise LibraryError("a url is needed")
        if "://" not in url:
            url = f"https://{url}"
        if kind and kind not in KINDS:
            raise LibraryError(f"unknown kind '{kind}'. One of: {', '.join(KINDS)}")

        if source_ref:
            existing = self.store.by_source_ref(source_ref)
            if existing is not None:
                return Captured(as_dict(existing), already_logged=True)

        try:
            await check_url_async(url)
        except UnsafeURL as exc:
            raise LibraryError(str(exc)) from exc

        existing = self.store.by_url(url)
        if existing is not None:
            # Idempotent: saving a link twice is a common mistake when
            # catching up on tabs, and clobbering what was already there with a
            # second fetch is not what that meant.
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
                return await ReelCapture(self).capture(url, notes=notes)
            except ReelError as exc:
                # Not fatal. The link is still worth logging, with the reason it
                # could not be opened written on it -- the same rule every other
                # failed fetch here follows. The plain-page attempt below will
                # not get far either, and its note says so.
                capture_note = str(exc)
                log.info("falling back to a plain link for %s: %s", url, exc)

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
                self.store.update(item_id, capture_note=note or None)
                return Captured(as_dict(self.store.get(item_id)))
            # Rung 3: the note names whichever rung was the last one tried.
            if x_note:
                capture_note = x_note

        page = None
        if is_youtube(url):
            # YouTube's watch page is a script bundle; oEmbed is the only thing
            # it will state plainly, and it does not carry a transcript.
            meta = await youtube_oembed(url)
            if meta:
                title = title or meta["title"]
                author = meta.get("author") or None
                site = meta.get("site")
            else:
                author = site = None
                capture_note = "YouTube did not answer for this video's title"
            capture_note = capture_note or "video: title and channel only, no transcript available"
            published_on = None
            text = ""
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
            if page and page.note:
                capture_note = page.note

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
        self.store.update(item_id, capture_note=note or None)
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
                return
        except Exception:
            return

        async def run() -> None:
            try:
                await self.enrich(item_id)
            except Exception as exc:  # the item is captured and searchable already
                log.info("auto-enrichment failed for library item %s: %s", item_id, exc)

        try:
            task = asyncio.get_running_loop().create_task(run())
        except RuntimeError:  # no loop: a sync caller gets no enrichment
            log.debug("no loop to enrich library item %s on", item_id)
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
        self.store.update(item_id, capture_note=note or None)
        return Captured(as_dict(self.store.get(item_id)))

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

        if source_ref:
            existing = self.store.by_source_ref(source_ref)
            if existing is not None:
                # The same reel arriving twice -- a Meta retry that slipped past
                # the delivery key, or the user sending it again.
                return Captured(as_dict(existing), already_logged=True)

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
        self.store.update(
            item_id,
            capture_note=note or None,
            text_source=text_source,
            thumbnail_path=thumbnail_path,
            media_path=media_path,
            duration_seconds=duration_seconds,
        )
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

    async def enrich(self, item_id: int, *, client=None) -> dict:
        """Say what this item is about, from the text it actually has.

        Rewrites the item's file so the summary, the tags and the mentioned
        things are indexed alongside the source text -- which is what lets "that
        video about coffee grind" find a reel whose transcript never says the
        phrase. The source text is read back out of the file first, so
        re-enriching summarises the transcript again and never the last summary.
        """
        from backend.library import enrich as enrichment

        row = self.store.get(item_id)
        if row is None:
            raise LibraryError(f"no library item {item_id}")

        body, heading = "", "Text"
        if row["text_path"]:
            try:
                body, heading = enrichment.body_of(
                    Path(row["text_path"]).read_text(encoding="utf-8")
                )
            except OSError as exc:
                log.warning("could not read library text for %s: %s", item_id, exc)

        text_source = row["text_source"] or ("page" if row["url"] else "none")
        if text_source == "transcript":
            heading = "Transcript"
        elif text_source == "caption":
            heading = "Caption"
        elif text_source == "caption and transcript":
            heading = "Caption and Transcript"

        result = await enrichment.enrich_text(
            body, title=row["title"], kind=row["kind"], text_source=text_source, client=client
        )

        self.store.update(
            item_id,
            category=result.category,
            summary=result.summary,
            tags=json.dumps(list(result.tags)) if result.tags else None,
            resources=json.dumps(list(result.resources)) if result.resources else None,
            enrichment_note=result.note,
            enrichment_model=(
                f"{result.provider}:{result.model}" if result.provider and result.model else None
            ),
            enriched_at=enrichment.stamp(),
        )

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
        if tag:
            rows = self.store.list(
                kind=kind, category=category, tag=tag, order=order, limit=limit, offset=offset
            )
            return [as_dict(row) for row in rows]
        if category:
            all_rows = self.store.list(kind=kind, order=order, limit=5000)
            items = [as_dict(row) for row in all_rows]
            matched = [it for it in items if it.get("category") == category]
            return matched[offset : offset + limit]
        return [
            as_dict(row)
            for row in self.store.list(kind=kind, order=order, limit=limit, offset=offset)
        ]

    def category_counts(self) -> dict[str, int]:
        all_items = [as_dict(row) for row in self.store.list(limit=500)]
        c: dict[str, int] = {}
        for it in all_items:
            cat = it.get("category") or "general"
            c[cat] = c.get(cat, 0) + 1
        return c

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
        hits = await SearchService().search(query, limit=limit * 3, source="library")
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
    """One line about an item, for a model reading a tool result."""
    bits = [item["title"]]
    if item.get("author"):
        bits.append(f"by {item['author']}")
    bits.append(f"({item['kind']}, logged {item['consumed_on']})")
    if item.get("capture_note"):
        bits.append(f"-- {item['capture_note']}")
    return " ".join(bits)
