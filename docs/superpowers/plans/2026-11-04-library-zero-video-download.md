# Library Zero Video Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate persistent video binary downloads (.mp4) in Amethyst's library pipeline, switching to ephemeral audio-only transcription, smart iframe embeds/streaming, and purging legacy video files.

**Architecture:** Ephemeral audio pipeline in `reels.py` extracts audio directly to scratch space for Whisper and deletes it immediately in a `finally` block; frontend player natively renders responsive iframe embeds for YouTube/Instagram/TikTok or direct remote video streams; cleanup routine purges existing local `.mp4` files and resets `media_path` to NULL.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, yt-dlp, ffmpeg, Whisper, React, Framer Motion, CSS.

**Spec:** `docs/superpowers/specs/2026-11-04-library-zero-video-download-design.md`

## Global Constraints
- No `.mp4` or other video binaries saved to `~/.amethyst/library/media/` or uploaded to Google Drive.
- `media_path` in `library_items` table must remain `NULL` for video captures.
- Existing thumbnail covers, titles, authors, durations, and text transcripts must continue to work seamlessly.
- Iframe embeds must support YouTube (nocookie), Instagram (`/reel/` and `/p/`), and TikTok without layout distortion (respect 9:16 vertical and 16:9 landscape aspect ratios).

## Review Focus
1. An Instagram reel with no caption still gets transcribed via ephemeral audio and produces a `## Transcript` section.
2. If yt-dlp fails to extract audio or Whisper is disabled, item status still successfully transitions to `ready` without crashing.
3. No `.mp4` file is created or left behind in `~/.amethyst/library/media/` or temporary folders.
4. Purging legacy files unlinks `.mp4` files and sets `media_path = NULL` in SQLite without corrupting other item fields or thumbnails.
5. In the frontend, YouTube, Instagram reels, and direct video links render responsive embeds with working fullscreen and theater controls.

---

### Task 1: Ephemeral Audio Pipeline & Zero Video Download in `backend/library/reels.py`

**Files:**
- Modify: `backend/library/reels.py:170-340`
- Test: `tests/test_library_zero_download.py`

**Interfaces:**
- Produces: `ReelCapture._process_video(item_id: int, reel: Reel, settings: InstagramSettings, scratch: Path | None = None) -> str`
- Guarantees: No video file written to `media_path(item_id, ".mp4")`. `media_path` in `library_items` remains `None`. Temporary audio file is deleted in a `finally` block.

- [ ] **Step 1: Write the failing test for zero video download and ephemeral audio cleanup**

Write test in `tests/test_library_zero_download.py`:
```python
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from backend.db.connection import reset_connection
from backend.library.reels import Reel, ReelCapture
from backend.library.service import LibraryService
from backend.library.store import LibraryStore, media_path

@pytest.mark.asyncio
async def test_reel_process_video_does_not_save_mp4(tmp_path: Path):
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    dummy_reel = Reel(
        url="https://www.instagram.com/reel/abc12345/",
        title="Zero Download Reel",
        caption="Quick tutorial",
        author="creator",
        duration=15.0,
        thumbnail_url="https://example.com/thumb.jpg",
        video_path=None,
    )

    fake_fetch = AsyncMock(return_value=dummy_reel)
    fake_extract = AsyncMock(return_value=tmp_path / "audio.wav")
    fake_transcribe = AsyncMock(return_value=MagicMock(text="Transcribed speech"))

    rc = ReelCapture(
        svc,
        fetcher=fake_fetch,
        extractor=fake_extract,
        transcriber=fake_transcribe,
    )

    captured = await rc.capture("https://www.instagram.com/reel/abc12345/")
    item_id = captured.item["id"]

    # Verify no .mp4 exists in media directory
    mp4_file = media_path(item_id, ".mp4")
    assert not mp4_file.exists(), "No mp4 video file should be saved to disk"

    # Verify media_path in database is None
    row = svc.store.get(item_id)
    assert row["media_path"] is None, "media_path in database must be None"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_zero_download.py::test_reel_process_video_does_not_save_mp4 -v`  
Expected: FAIL (current code creates/attempts to download `reel.mp4` and sets `media_path`).

- [ ] **Step 3: Refactor `ReelCapture._process_video` in `backend/library/reels.py`**

- Remove downloading `scratch_video = scratch / "reel.mp4"` and moving it to `media_path(item_id, ".mp4")`.
- Remove `self.library.store.update(item_id, media_path=str(video))` and `trigger_auto_sync(item_id)`.
- Extract audio stream directly to `scratch / "audio.wav"` (or use `self._extract_audio` on direct URL or audio stream via yt-dlp).
- Wrap audio transcription in `try ... finally` block:
  ```python
  try:
      if audio and audio.is_file():
          speech = await self._transcribe(audio)
          speech_text = speech.text if speech else None
  finally:
      if audio and audio.is_file():
          audio.unlink(missing_ok=True)
  ```
- Store embed resource in `resources` field:
  ```python
  {"type": "embed", "platform": "instagram", "url": reel.url, "remote_url": reel.direct_video_url}
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_zero_download.py::test_reel_process_video_does_not_save_mp4 -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/reels.py tests/test_library_zero_download.py
git commit -m "feat(library): eliminate video mp4 download and make audio transcription ephemeral"
```

---

### Task 2: Service Ingestion & Legacy Video Purge in `backend/library/service.py`

**Files:**
- Modify: `backend/library/service.py:1580-1630, 2080-2162`
- Modify: `backend/api/main.py:9060-9075`
- Test: `tests/test_library_zero_download.py`

**Interfaces:**
- Produces: `LibraryService.purge_legacy_video_files() -> dict[str, int]`
- Consumes: `LibraryStore.conn`
- Produces API route: `POST /api/library/purge-media`

- [ ] **Step 1: Write the failing test for legacy video purge**

Add test to `tests/test_library_zero_download.py`:
```python
def test_purge_legacy_video_files(tmp_path: Path):
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    # Create dummy item with media_path
    item_id = store.create(title="Legacy Video", kind="video", url="https://example.com/vid")
    fake_vid = tmp_path / f"{item_id:06d}.mp4"
    fake_vid.write_bytes(b"dummy video data")
    store.update(item_id, media_path=str(fake_vid))

    with patch("backend.library.service.media_dir", return_value=tmp_path):
        result = svc.purge_legacy_video_files(scan_dir=tmp_path)

    assert result["deleted_files"] >= 1
    assert result["cleared_rows"] >= 1
    assert not fake_vid.exists()

    row = store.get(item_id)
    assert row["media_path"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_zero_download.py::test_purge_legacy_video_files -v`  
Expected: FAIL (`purge_legacy_video_files` does not exist).

- [ ] **Step 3: Implement `purge_legacy_video_files` and update `enrich` in `backend/library/service.py`**

1. Implement `purge_legacy_video_files(self, scan_dir: Path | None = None) -> dict[str, int]`:
   - Scans directory for `*.mp4`, `*.webm`, `*.mov`, `*.mkv`.
   - Unlinks each file with `missing_ok=True`.
   - Executes `UPDATE library_items SET media_path = NULL WHERE media_path IS NOT NULL`.
   - Commits and returns counts.
2. In `enrich()`:
   - Remove dependency on `row["media_path"]` being a local video file.
   - Do not attempt frame extraction from non-existent `media_path`.
3. In `backend/api/main.py`:
   - Add endpoint `@app.post("/api/library/purge-media")` that calls `LibraryService().purge_legacy_video_files()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_zero_download.py::test_purge_legacy_video_files -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/service.py backend/api/main.py tests/test_library_zero_download.py
git commit -m "feat(library): add legacy video purge and decouple enrichment from local media files"
```

---

### Task 3: Streaming & Responsive Iframe Embeds in Frontend Player

**Files:**
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx:525-560`
- Modify: `frontend/src/views/library/LibraryVideoPlayer.jsx:13-75, 230-275`
- Modify: `frontend/src/views/library/library-detail.css`

**Interfaces:**
- Produces: `LibraryVideoPlayer` with props `{ src, embedUrl, fallbackUrl, isVertical, isYouTube, platform }`
- Guarantees: YouTube, Instagram reels, and TikTok URLs render inside responsive iframes when direct MP4 is unavailable.

- [ ] **Step 1: Update `videoItem` calculation in `LibraryDetailModal.jsx`**

Compute embed details based on platform URL patterns:
- YouTube: extract video ID from `watch?v=`, `shorts/`, or `youtu.be/` -> `embedUrl: "https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0"`, `isYouTube: true`.
- Instagram: extract reel or post shortcode -> `embedUrl: "https://www.instagram.com/reel/${shortcode}/embed/"` (or `/p/${shortcode}/embed/`), `platform: "instagram"`, `isVertical: true`.
- TikTok: extract video ID -> `embedUrl: "https://www.tiktok.com/embed/v2/${id}"`, `platform: "tiktok"`, `isVertical: true`.
- Pass `embedUrl`, `fallbackUrl: item.url`, `isYouTube`, `platform`, `isVertical` to `<LibraryVideoPlayer />`.

- [ ] **Step 2: Update `LibraryVideoPlayer.jsx` to render iframe embeds**

- When `embedUrl` is present:
  - If no direct local/remote playable `src` exists, or when `showEmbed` is true:
    - Render `<iframe>` with `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"` and `allowFullScreen`.
- If embed fails or platform blocks in-app iframe:
  - Provide clean "Open on [Platform]" fallback action button.
- Ensure subtitles and playback overlays gracefully adapt when in embed mode.

- [ ] **Step 3: Update CSS in `library-detail.css` for embeds**

- Style `.lib-player-embed` with `width: 100%`, `height: 100%`, `border: 0`, and proper aspect-ratio container (`9/16` for vertical, `16/9` for horizontal).

- [ ] **Step 4: Verify frontend build**

Run: `npm run build` or `npm run lint` in `frontend/`.  
Expected: Build passes without syntax or bundle errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/library/LibraryDetailModal.jsx frontend/src/views/library/LibraryVideoPlayer.jsx frontend/src/views/library/library-detail.css
git commit -m "feat(library): support responsive iframe embeds and remote streaming in video player"
```

---

### Task 4: Integration Verification & Regression Tests

**Files:**
- Modify: `tests/test_library_zero_download.py`
- Test: All touched tests

- [ ] **Step 1: Write end-to-end integration test verifying full capture-enrich lifecycle with zero downloads**

Add `test_full_capture_enrich_lifecycle_zero_download` in `tests/test_library_zero_download.py`:
- Capture a reel with caption and audio.
- Run enrich.
- Assert item status is `ready`.
- Assert markdown contains transcript.
- Assert no `.mp4` file was ever written to disk.
- Assert `media_path` is `None`.

- [ ] **Step 2: Run all library tests**

Run: `pytest tests/test_library_zero_download.py tests/test_library_fast_capture_enrich.py -v`  
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_library_zero_download.py
git commit -m "test(library): add integration verification for zero video download pipeline"
```
