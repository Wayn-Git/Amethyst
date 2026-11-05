import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from backend.db.connection import reset_connection
from backend.library.reels import Reel, ReelCapture
from backend.library.service import LibraryService
from backend.library.store import LibraryStore
from backend.library.enrich import parse_enrichment, enrich_text


@pytest.mark.asyncio
async def test_reel_capture_returns_immediately_with_metadata(tmp_path: Path):
    """Verify ReelCapture creates and returns the item immediately without blocking on video download."""
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    dummy_reel = Reel(
        url="https://www.instagram.com/reel/fast123/",
        title="Speedy Reel Title",
        caption="Caption explaining 5 AI tools: cursor.com, v0.dev, bolt.new",
        author="tech_creator",
        duration=30.0,
        thumbnail_url="https://example.com/thumb.jpg",
        video_path=None, # Initially None from fast metadata fetch
    )

    fake_fetch = AsyncMock(return_value=dummy_reel)
    fake_download = AsyncMock()
    fake_extract = AsyncMock(return_value=tmp_path / "audio.wav")
    fake_transcribe = AsyncMock(return_value=MagicMock(text="Audio transcription speech text"))

    rc = ReelCapture(
        svc,
        fetcher=fake_fetch,
        downloader=fake_download,
        extractor=fake_extract,
        transcriber=fake_transcribe,
    )

    # Capture should complete and return Captured item immediately
    captured = await rc.capture("https://www.instagram.com/reel/fast123/")
    assert captured.item["id"]
    assert captured.item["title"] == "Speedy Reel Title"
    assert captured.item["author"] == "tech_creator"
    assert captured.item["status"] in ("enriching", "ready")

    # Fast fetch called with dest=None
    fake_fetch.assert_called_once_with(
        "https://www.instagram.com/reel/fast123/",
        None,
        cookies_from_browser=None,
    )


@pytest.mark.asyncio
async def test_enrich_preserves_video_resource_and_known_urls():
    """Verify enrich does not re-capture already captured reels and passes known_urls to enrich_text."""
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    item_id = store.create(
        kind="video",
        title="AI Tools Video",
        url="https://www.instagram.com/reel/toolsvid/",
    )
    t_file = Path("/tmp/test_enrich_body.md")
    t_file.write_text("# AI Tools Video\n\nCheck out https://github.com/astral-sh/uv and https://cursor.com for coding.", encoding="utf-8")
    
    import json
    initial_resources = [
        {"type": "video", "name": "Video", "url": f"/api/library/{item_id}/media"},
        {"type": "link", "name": "astral", "url": "https://github.com/astral-sh/uv"},
    ]
    store.update(
        item_id,
        text_path=str(t_file),
        thumbnail_path="/tmp/thumb.jpg",
        resources=json.dumps(initial_resources),
        text_source="caption and transcript",
    )

    mock_enrich_text = AsyncMock()
    from backend.library.enrich import Enrichment
    mock_enrich_text.return_value = Enrichment(
        category="tool",
        summary="## Executive Overview\nHigh-speed Python package manager.\n\n## Comprehensive Breakdown\n- **uv**: Extremely fast pip replacement written in Rust.\n- **Cursor**: AI-first code editor.",
        tags=("ai", "tools", "programming"),
        resources=(
            {"type": "tool", "name": "Cursor", "detail": "AI code editor", "url": "https://cursor.com"},
            {"type": "repo", "name": "astral-sh/uv", "detail": "Python toolchain", "url": "https://github.com/astral-sh/uv"},
        ),
    )

    with patch("backend.library.enrich.enrich_text", mock_enrich_text):
        with patch("backend.library.reels.ReelCapture.capture") as mock_reel_capture:
            await svc.enrich(item_id)
            
            # Verify ReelCapture.capture was NOT redundantly invoked
            mock_reel_capture.assert_not_called()

            # Verify enrich_text received known_urls
            assert mock_enrich_text.called
            call_kwargs = mock_enrich_text.call_args[1]
            assert "known_urls" in call_kwargs
            assert "https://www.instagram.com/reel/toolsvid/" in call_kwargs["known_urls"]
            assert "https://github.com/astral-sh/uv" in call_kwargs["known_urls"]

    # Verify item in store was updated with video resource preserved
    updated = store.get(item_id)
    assert updated["category"] == "tool"
    assert "Executive Overview" in updated["summary"]
    saved_res = json.loads(updated["resources"])
    types = [r["type"] for r in saved_res]
    assert "video" in types # Video player resource must remain intact!
    assert "tool" in types or "repo" in types


def test_parse_enrichment_grounded_links():
    """Verify parse_enrichment uses known_urls and extracts real URLs."""
    raw_json = """
    {
      "category": "tool",
      "summary": "Full comprehensive breakdown of all features.",
      "tags": ["tools", "ai"],
      "resources": [
        {"type": "tool", "name": "Cursor", "detail": "AI editor", "url": "https://cursor.com"},
        {"type": "repo", "name": "astral-sh/uv", "detail": "Rust pip", "url": "https://github.com/astral-sh/uv"}
      ]
    }
    """
    known = ["https://cursor.com", "https://github.com/astral-sh/uv"]
    res = parse_enrichment(raw_json, source_text="Check out https://cursor.com", known_urls=known)
    assert res is not None
    assert res.category == "tool"
    assert len(res.resources) >= 2
    res_urls = [r["url"] for r in res.resources if r.get("url")]
    assert "https://cursor.com" in res_urls
    assert "https://github.com/astral-sh/uv" in res_urls
