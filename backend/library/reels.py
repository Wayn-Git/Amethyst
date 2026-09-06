"""A permalink to a library item: fetch, transcribe, enrich.

The same shape as `backend/instagram/service.py`, and deliberately so -- the
order in `capture` is the order that file defends. **The item is created as
early as it can be**, from whatever is already known, and everything slow is
added to it afterwards. Each slow step is wrapped so a failure writes a sentence
into `capture_note` and carries on, because a capture that goes wrong still logs
the fact that you saved something.

What is different is where the content comes from: `backend/media/reel.py`
rather than Meta's API, for the reasons written at the top of that file. What is
the same is everything after: `_store_text` still owns the "the text is a real
file" invariant, a reel with no words still says so rather than being given
prose nobody wrote, and enrichment is still the last thing and never the item.

This is reached from `LibraryService.capture_url`, which means every door into
the library gets it at once -- the paste box, the bookmarklet,
`POST /api/share/capture`, and the relay's `/share`. One hook, every entry point.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from backend.config import InstagramSettings, load_instagram
from backend.library.store import media_path, thumbnail_path
from backend.media.audio import MediaError, extract_audio, ffmpeg_missing, probe_duration
from backend.media.download import DownloadError, fetch_to
from backend.media.reel import Reel, ReelError, fetch_reel, is_reel_url, yt_dlp_missing
from backend.runtime.transcribe import (
    TranscriptionUnavailable,
    resolve_transcriber,
    transcribe,
    unavailable_reason,
)

log = logging.getLogger(__name__)

MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024

NO_CAPTION_NOTE = "this reel has no caption, so there was nothing to read but its audio"


def available() -> str | None:
    """Why a permalink cannot be opened, or None. Asked by the status endpoint."""
    return yt_dlp_missing()


class ReelCapture:
    """One permalink, start to finish."""

    def __init__(
        self,
        library,
        *,
        settings: InstagramSettings | None = None,
        fetcher=None,
        downloader=None,
        extractor=None,
        prober=None,
        transcriber=None,
    ):
        # Everything injected, so a test never reaches Instagram, ffmpeg or a
        # transcription API.
        self.library = library
        self._settings = settings
        self._fetch = fetcher or fetch_reel
        self._download = downloader or fetch_to
        self._extract_audio = extractor or extract_audio
        self._probe = prober or probe_duration
        self._transcribe = transcriber or transcribe
        self._can_transcribe = (
            (lambda: True) if transcriber else (lambda: resolve_transcriber() is not None)
        )

    @property
    def settings(self) -> InstagramSettings:
        return self._settings if self._settings is not None else load_instagram()

    async def capture(self, url: str, *, notes: str | None = None):
        """Log the reel. Raises ReelError only when there is no item to make."""
        settings = self.settings
        # The download happens before the row exists, because yt-dlp names the
        # file and the row is named by its id. It lands in a scratch directory
        # and is moved into place afterwards.
        scratch = Path(tempfile.mkdtemp(prefix="psok-reel-"))
        try:
            reel = await self._open(url, scratch, settings)
            return await self._store(reel, notes=notes, settings=settings)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    async def _open(self, url: str, scratch: Path, settings: InstagramSettings) -> Reel:
        """Metadata, and the video too when there is any point in having it.

        The gate is checked before the step it protects: with no transcriber and
        no reason to keep the file, a thirty-megabyte download would be fetched
        and deleted unread.
        """
        wants_video = settings.keep_video or (
            ffmpeg_missing() is None and self._can_transcribe()
        )
        return await self._fetch(
            url,
            scratch / "reel" if wants_video else None,
            cookies_from_browser=settings.cookies_from_browser or None,
        )

    async def _store(self, reel: Reel, *, notes: str | None, settings: InstagramSettings):
        text = reel.caption
        source = "caption" if reel.has_text else "none"
        note = "" if reel.has_text else NO_CAPTION_NOTE
        kind = "video" if reel.video_path is not None else "article"

        captured = await self.library.capture_media(
            title=reel.title,
            kind=kind,
            url=reel.url,
            author=reel.author or None,
            site="instagram.com",
            notes=notes,
            # The permalink is the identity. Sending the same reel twice, by any
            # door, is one item.
            source_ref=reel.url,
            text=text,
            text_source=source,
            capture_note=note,
            duration_seconds=int(reel.duration) if reel.duration else None,
        )
        if captured.already_logged:
            return captured

        item_id = captured.item["id"]
        notes_out = [captured.item.get("capture_note") or ""]
        thumb_url = reel.thumbnail_url or (reel.slide_urls[0] if reel.slide_urls else None)
        notes_out.append(await self._add_thumbnail(item_id, thumb_url))
        notes_out.append(await self._process_content(item_id, reel, settings))

        if settings.enrich:
            try:
                await self.library.enrich(item_id)
            except Exception as exc:  # enrichment is the last thing, never the item
                log.warning("enrichment failed for library item %s: %s", item_id, exc)

        combined = " · ".join(n for n in notes_out if n) or None
        self.library.store.update(item_id, capture_note=combined)
        from backend.library.service import as_dict

        return type(captured)(as_dict(self.library.store.get(item_id)))

    async def _add_thumbnail(self, item_id: int, url: str | None) -> str:
        if not url:
            return ""
        target = thumbnail_path(item_id)
        try:
            await self._download(url, target, max_bytes=MAX_THUMBNAIL_BYTES)
        except DownloadError as exc:
            return f"the thumbnail could not be fetched: {exc}"
        self.library.store.update(item_id, thumbnail_path=str(target))
        return ""

    async def _process_content(self, item_id: int, reel: Reel, settings: InstagramSettings) -> str:
        if reel.video_path is not None:
            return await self._process_video(item_id, reel, settings)
        if reel.slide_urls:
            return await self._process_slides(item_id, reel)
        return ""

    async def _process_video(self, item_id: int, reel: Reel, settings: InstagramSettings) -> str:
        """The spoken words or on-screen text from video frames."""
        if reel.video_path is None:
            return ""
        if missing := ffmpeg_missing():
            return missing

        video = media_path(item_id, reel.video_path.suffix or ".mp4")
        video.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(reel.video_path), video)

        audio: Path | None = None
        duration: float | None = None
        speech_text: str | None = None

        try:
            duration = await self._probe(video)
            if duration and duration > settings.max_duration_seconds:
                return (
                    f"this is {int(duration // 60)} minutes long, past the"
                    f" {settings.max_duration_seconds // 60}-minute limit for transcription"
                )

            if self._can_transcribe():
                try:
                    audio = await self._extract_audio(video, media_path(item_id, ".audio"))
                    result = await self._transcribe(audio)
                    if result.text and result.text.strip():
                        speech_text = result.text.strip()
                except Exception as exc:
                    log.info(
                        "audio transcription not possible for item %s (silent video?): %s",
                        item_id,
                        exc,
                    )

            visual_text: str | None = None
            # If there was no spoken audio, extract visual text from video frames
            if not speech_text:
                from backend.media.vision import extract_frames
                from backend.runtime.vision import extract_visual_text

                frames_dir = Path(tempfile.mkdtemp(prefix="psok-vision-"))
                try:
                    frames = await extract_frames(video, frames_dir)
                    if frames:
                        frame_bytes = [f.read_bytes() for f in frames]
                        visual_text = await extract_visual_text(frame_bytes)
                except Exception as exc:
                    log.warning("visual extraction failed for library item %s: %s", item_id, exc)
                finally:
                    shutil.rmtree(frames_dir, ignore_errors=True)

        except Exception as exc:
            log.warning("video processing failed for library item %s: %s", item_id, exc)
            return f"the video processing did not finish: {exc}"
        finally:
            if audio is not None:
                audio.unlink(missing_ok=True)
            if settings.keep_video:
                self.library.store.update(item_id, media_path=str(video))
            else:
                video.unlink(missing_ok=True)
            if duration is not None:
                self.library.store.update(item_id, duration_seconds=int(duration))

        extracted = speech_text or visual_text
        if extracted:
            source_parts = []
            if reel.has_text:
                source_parts.append("caption")
            if speech_text:
                source_parts.append("transcript")
            elif visual_text:
                source_parts.append("visual content")
            source = " and ".join(source_parts)

            new_text = f"{reel.caption}\n\n{extracted}" if reel.has_text else extracted
            await self.library.replace_text(item_id, new_text, text_source=source)
            return ""

        if not reel.has_text:
            return "the audio carried no speech and visual extraction found no text, so there is no content"
        return ""

    async def _process_slides(self, item_id: int, reel: Reel) -> str:
        """Extract readable text and summarize carousel slide images."""
        if not reel.slide_urls:
            return ""

        import httpx
        from backend.runtime.vision import extract_visual_text

        slide_images: list[bytes] = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            for s_url in reel.slide_urls[:5]:
                try:
                    resp = await client.get(s_url, headers={"User-Agent": "Mozilla/5.0"})
                    if resp.status_code == 200 and resp.content:
                        slide_images.append(resp.content)
                except Exception as exc:
                    log.debug("could not download slide %s: %s", s_url[:60], exc)

        if not slide_images:
            return ""

        try:
            visual_text = await extract_visual_text(slide_images)
            if visual_text:
                source = "caption and slide analysis" if reel.has_text else "slide analysis"
                new_text = f"{reel.caption}\n\n{visual_text}" if reel.has_text else visual_text
                await self.library.replace_text(item_id, new_text, text_source=source)
        except Exception as exc:
            log.warning("slide visual extraction failed for library item %s: %s", item_id, exc)

        return ""


__all__ = ["ReelCapture", "ReelError", "available", "is_reel_url"]
