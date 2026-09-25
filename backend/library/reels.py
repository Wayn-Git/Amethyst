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
from backend.media.audio import extract_audio, ffmpeg_missing, probe_duration
from backend.media.download import DownloadError, fetch_to
from backend.media.reel import Reel, ReelError, fetch_reel, is_reel_url, yt_dlp_missing
from backend.runtime.transcribe import (
    resolve_transcriber,
    transcribe,
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

    async def capture(
        self,
        url: str,
        *,
        notes: str | None = None,
        requested_kind: str | None = None,
    ):
        """Log the reel. Raises ReelError only when there is no item to make."""
        settings = self.settings
        scratch = Path(tempfile.mkdtemp(prefix="amethyst-reel-"))
        try:
            reel = await self._open(url, scratch, settings)
            return await self._store(
                reel,
                notes=notes,
                requested_kind=requested_kind,
                settings=settings,
                scratch=scratch,
            )
        except Exception:
            shutil.rmtree(scratch, ignore_errors=True)
            raise

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

    async def _store(
        self,
        reel: Reel,
        *,
        notes: str | None,
        requested_kind: str | None = None,
        settings: InstagramSettings,
        scratch: Path | None = None,
    ):
        text = reel.caption
        source = "caption" if reel.has_text else "none"
        note = "" if reel.has_text else NO_CAPTION_NOTE

        is_music_intent = requested_kind == "music" or (
            bool(notes and notes.strip().lower() in ("music", "song", "#music", "audio"))
        )
        kind = "music" if is_music_intent else ("video" if reel.video_path is not None else "article")

        captured = await self.library.capture_media(
            title=reel.title,
            kind=kind,
            url=reel.url,
            author=reel.author or None,
            site="instagram.com",
            notes=notes,
            category="music" if is_music_intent else None,
            # The permalink is the identity. Sending the same reel twice, by any
            # door, is one item.
            source_ref=reel.url,
            text=text,
            text_source=source,
            capture_note=note,
            duration_seconds=int(reel.duration) if reel.duration else None,
        )
        if captured.already_logged:
            if scratch:
                shutil.rmtree(scratch, ignore_errors=True)
            return captured

        item_id = captured.item["id"]

        async def process_models():
            try:
                notes_out = [captured.item.get("capture_note") or ""]
                thumb_url = reel.thumbnail_url or (reel.slide_urls[0] if reel.slide_urls else None)
                notes_out.append(await self._add_thumbnail(item_id, thumb_url, reel.video_path))
                notes_out.append(
                    await self._process_content(
                        item_id, reel, settings, is_music_intent=is_music_intent
                    )
                )

                if settings.enrich:
                    try:
                        await self.library.enrich(item_id)
                    except Exception as exc:  # enrichment is the last thing, never the item
                        log.warning("enrichment failed for library item %s: %s", item_id, exc)

                combined = " · ".join(n for n in notes_out if n) or None
                self.library.store.update(item_id, capture_note=combined)
            finally:
                if scratch:
                    shutil.rmtree(scratch, ignore_errors=True)

        import asyncio
        from backend.library.service import _BACKGROUND_TASKS
        try:
            task = asyncio.get_running_loop().create_task(process_models())
            _BACKGROUND_TASKS.add(task)
            task.add_done_callback(_BACKGROUND_TASKS.discard)
        except RuntimeError:
            if scratch:
                shutil.rmtree(scratch, ignore_errors=True)

        from backend.library.service import as_dict
        return type(captured)(as_dict(self.library.store.get(item_id)))

    async def _add_thumbnail(self, item_id: int, url: str | None, video_path: Path | None = None) -> str:
        target = thumbnail_path(item_id)
        if url:
            try:
                await self._download(url, target, max_bytes=MAX_THUMBNAIL_BYTES)
                if target.is_file() and target.stat().st_size > 500:
                    self.library.store.update(item_id, thumbnail_path=str(target))
                    return ""
            except Exception as exc:
                log.debug("thumbnail download failed for %s: %s", item_id, exc)

        # Fallback: extract frame from downloaded video with ffmpeg
        if video_path and Path(video_path).is_file():
            from backend.media.audio import _run, ffmpeg_missing
            if not ffmpeg_missing():
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    code, _ = await _run(["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(video_path), "-vframes", "1", "-q:v", "3", str(target)])
                    if code == 0 and target.is_file() and target.stat().st_size > 500:
                        self.library.store.update(item_id, thumbnail_path=str(target))
                        return ""
                except Exception as exc:
                    log.debug("video frame thumbnail extraction failed for %s: %s", item_id, exc)

        return "the thumbnail could not be fetched"

    async def _process_content(
        self,
        item_id: int,
        reel: Reel,
        settings: InstagramSettings,
        *,
        is_music_intent: bool = False,
    ) -> str:
        if reel.video_path is not None:
            return await self._process_video(
                item_id, reel, settings, is_music_intent=is_music_intent
            )
        if reel.slide_urls:
            return await self._process_slides(item_id, reel)
        return ""

    async def _process_video(
        self,
        item_id: int,
        reel: Reel,
        settings: InstagramSettings,
        *,
        is_music_intent: bool = False,
    ) -> str:
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
        detected_music: dict | None = None

        try:
            duration = await self._probe(video)
            if duration and duration > settings.max_duration_seconds:
                return (
                    f"this is {int(duration // 60)} minutes long, past the"
                    f" {settings.max_duration_seconds // 60}-minute limit for transcription"
                )

            try:
                audio = await self._extract_audio(video, media_path(item_id, ".audio"))
            except Exception as exc:
                log.debug("audio extraction failed for item %s: %s", item_id, exc)

            if audio and self._can_transcribe():
                try:
                    result = await self._transcribe(audio)
                    if result.text and result.text.strip():
                        speech_text = result.text.strip()
                except Exception as exc:
                    log.info(
                        "audio transcription not possible for item %s (silent video?): %s",
                        item_id,
                        exc,
                    )

            # Detect background music / song in reel via audio fingerprinting or caption
            try:
                from backend.media.music import detect_music
                detected_music = await detect_music(audio, text=reel.caption)
            except Exception as exc:
                log.debug("music detection failed for item %s: %s", item_id, exc)

            visual_text: str | None = None
            # If there was no spoken audio, extract visual text from video frames
            if not speech_text:
                from backend.media.vision import extract_frames
                from backend.runtime.vision import extract_visual_text

                frames_dir = Path(tempfile.mkdtemp(prefix="amethyst-vision-"))
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

        music_note = ""
        if detected_music:
            try:
                import json as _json
                row = self.library.store.get(item_id)
                r_list = []
                if row and row.resources:
                    try:
                        r_list = _json.loads(row.resources)
                    except Exception:
                        r_list = []
                r_item = {
                    "type": "music",
                    "name": detected_music["name"],
                    "detail": detected_music.get("detail", ""),
                    "url": detected_music.get("url", ""),
                }
                if not any(r.get("name") == r_item["name"] for r in r_list):
                    r_list.append(r_item)

                update_fields = {"resources": _json.dumps(r_list)}

                # ONLY tag as music and promote to music item if the user sent this with music intent!
                if is_music_intent:
                    t_list = []
                    if row and row.tags:
                        try:
                            t_list = _json.loads(row.tags)
                        except Exception:
                            t_list = []
                    if "music" not in t_list:
                        t_list.append("music")
                    update_fields["tags"] = _json.dumps(t_list)
                    update_fields["category"] = "music"
                    update_fields["title"] = detected_music["name"]
                    if detected_music.get("detail"):
                        update_fields["author"] = detected_music["detail"]

                music_note = f"🎵 Music: \"{detected_music['name']}\""
                if detected_music.get("detail"):
                    music_note += f" by {detected_music['detail']}"

                self.library.store.update(item_id, **update_fields)
            except Exception as exc:
                log.warning("failed saving music metadata for item %s: %s", item_id, exc)

        music_line = ""
        if detected_music and is_music_intent:
            music_line = f"Music: {detected_music['name']}"
            if detected_music.get("detail"):
                music_line += f" by {detected_music['detail']}"

        extracted = speech_text or visual_text
        if extracted or music_line:
            source_parts = []
            if reel.has_text:
                source_parts.append("caption")
            if speech_text:
                source_parts.append("transcript")
            elif visual_text:
                source_parts.append("visual content")
            if music_line:
                source_parts.append("detected music")
            source = " and ".join(source_parts)

            text_pieces = []
            if reel.has_text:
                text_pieces.append(reel.caption)
            if extracted:
                text_pieces.append(extracted)
            if music_line:
                text_pieces.append(music_line)

            new_text = "\n\n".join(text_pieces)
            await self.library.replace_text(item_id, new_text, text_source=source)
            return music_note if (not extracted and not reel.has_text and detected_music and is_music_intent) else ""

        if not reel.has_text:
            return (
                "the audio carried no speech and visual extraction found no"
                " text, so there is no content"
            )
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
