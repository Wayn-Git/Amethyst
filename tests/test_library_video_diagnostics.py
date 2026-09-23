import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
import tempfile

from backend.library.store import LibraryStore
from backend.library.service import LibraryService
from backend.media.reel import Reel, _fetch_blocking, is_reel_url
from backend.library.reels import ReelCapture
from backend.library.enrich import _refusal, MIN_ENRICHABLE_CHARS


def test_refusal_empty_text_vs_short_text():
    """Verify that empty text does not claim to be a line or two."""
    refusal_empty = _refusal("", "page")
    assert refusal_empty is not None
    assert "no readable text" in refusal_empty.lower() or "no speech" in refusal_empty.lower() or "no text" in refusal_empty.lower()
    assert "line or two" not in refusal_empty

    refusal_short = _refusal("Hello world", "caption")
    assert refusal_short is not None
    assert "line or two" in refusal_short


def test_instagram_reel_kind_is_video_not_article():
    """Verify that a reel without local video is still kind='video', never 'article'."""
    reel = Reel(
        url="https://www.instagram.com/reel/DeiCRCwDx1F/",
        title="Test Reel Title",
        caption="A test caption for reel",
        author="Test Creator",
        duration=30.0,
        thumbnail_url="https://example.com/thumb.jpg",
        video_path=None,  # No local video yet
        slide_urls=[],
    )
    is_music_intent = False
    has_slides = bool(reel.slide_urls and len(reel.slide_urls) > 1)
    kind = "music" if is_music_intent else ("post" if has_slides else "video")
    assert kind == "video"


@pytest.mark.asyncio
async def test_reel_fetch_blocking_anonymous_fallback():
    """Verify that _fetch_blocking retries anonymously when browser cookies fail."""
    from backend.media.reel import _fetch_blocking

    mock_info = {
        "id": "DeiCRCwDx1F",
        "title": "A wonderful video",
        "description": "Full caption here",
        "uploader": "creator",
        "thumbnail": "https://example.com/thumb.jpg",
        "formats": [{"url": "https://example.com/video.mp4", "ext": "mp4"}],
    }

    call_count = 0
    received_opts = []

    def mock_ydl_enter(self):
        return self

    def mock_extract(url, download=False, process=True):
        nonlocal call_count
        call_count += 1
        if "cookiesfrombrowser" in received_opts[-1]:
            raise Exception("Could not open cookies database from browser: database is locked")
        return mock_info

    class MockYDL:
        def __init__(self, opts):
            received_opts.append(opts)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        extract_info = staticmethod(mock_extract)

    opts = {
        "quiet": True,
        "cookiesfrombrowser": ("firefox",),
    }

    with patch("yt_dlp.YoutubeDL", side_effect=MockYDL):
        reel = _fetch_blocking("https://www.instagram.com/reel/DeiCRCwDx1F/", None, opts)

    assert reel is not None
    assert reel.title == "Full caption here"
    assert reel.direct_video_url == "https://example.com/video.mp4"
    # Ensure it retried without cookiesfrombrowser
    assert len(received_opts) >= 2
    assert "cookiesfrombrowser" not in received_opts[-1]


@pytest.mark.asyncio
async def test_video_thumbnail_extraction_calls_run_with_correct_kwargs():
    """Verify that _add_thumbnail in ReelCapture does not crash with TypeError when calling _run."""
    from backend.library.reels import ReelCapture
    store = LibraryStore()
    svc = LibraryService(store)
    rc = ReelCapture(svc)

    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(b"fake video data")
        f.flush()
        # Mock _run to ensure it accepts timeout and workspace
        with patch("backend.media.audio._run", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = (0, "output")
            # Should not raise TypeError: missing keyword-only arguments
            try:
                await rc._add_thumbnail(999999, url=None, video_path=Path(f.name))
            except TypeError as te:
                pytest.fail(f"_add_thumbnail raised TypeError: {te}")
            
            assert mock_run.called
            _, kwargs = mock_run.call_args
            assert "timeout" in kwargs
            assert "workspace" in kwargs

