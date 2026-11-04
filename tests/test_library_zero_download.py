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

    item_id = store.create(title="Test Reel", kind="video", url="https://www.instagram.com/reel/abc12345/")

    from backend.config import load_instagram
    settings = load_instagram()
    scratch = tmp_path / "scratch"
    scratch.mkdir()

    # Invoke _process_video directly
    await rc._process_video(item_id, dummy_reel, settings, scratch=scratch)

    # Verify fake_fetch was never called to download video to a destination path
    for call in fake_fetch.call_args_list:
        assert len(call.args) < 2 or call.args[1] is None, "fetcher should never be called with a video destination path"

    # Verify no .mp4 exists in media directory
    mp4_file = media_path(item_id, ".mp4")
    assert not mp4_file.exists(), "No mp4 video file should be saved to disk"

    # Verify media_path in database is None
    row = svc.store.get(item_id)
    assert row["media_path"] is None, "media_path in database must be None"

    # Verify scratch video was not downloaded
    assert not (scratch / "reel.mp4").exists()


@pytest.mark.asyncio
async def test_ephemeral_audio_cleans_up_scratch_audio(tmp_path: Path):
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    dummy_reel = Reel(
        url="https://www.instagram.com/reel/ephemeral123/",
        title="Ephemeral Reel",
        caption="",
        author="creator",
        duration=10.0,
        thumbnail_url="https://example.com/thumb.jpg",
        direct_video_url="https://cdn.example.com/stream.mp4",
        video_path=None,
    )

    fake_fetch = AsyncMock(return_value=dummy_reel)
    temp_audio = tmp_path / "audio.wav"
    temp_audio.write_bytes(b"dummy audio")

    fake_extract = AsyncMock(return_value=temp_audio)
    fake_transcribe = AsyncMock(return_value=MagicMock(text="Spoken words transcribed"))

    rc = ReelCapture(
        svc,
        fetcher=fake_fetch,
        extractor=fake_extract,
        transcriber=fake_transcribe,
    )

    item_id = store.create(title="Ephemeral Reel", kind="video", url="https://www.instagram.com/reel/ephemeral123/")

    from backend.config import load_instagram
    settings = load_instagram()
    scratch = tmp_path / "scratch"
    scratch.mkdir()

    await rc._process_video(item_id, dummy_reel, settings, scratch=scratch)

    # Audio should have been deleted in finally block
    assert not temp_audio.exists(), "Ephemeral audio must be deleted after transcription"

    # Transcript should be written to item text
    row = store.get(item_id)
    text_content = Path(row["text_path"]).read_text(encoding="utf-8")
    assert "Spoken words transcribed" in text_content


def test_purge_legacy_video_files(tmp_path: Path):
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    item_id = store.create(title="Legacy Video", kind="video", url="https://example.com/vid")
    fake_vid = tmp_path / f"{item_id:06d}.mp4"
    fake_vid.write_bytes(b"dummy video data")
    store.update(item_id, media_path=str(fake_vid))

    result = svc.purge_legacy_video_files(media_dir=tmp_path)

    assert result["deleted_files"] >= 1
    assert result["cleared_rows"] >= 1
    assert not fake_vid.exists()

    row = store.get(item_id)
    assert row["media_path"] is None




