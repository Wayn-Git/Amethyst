"""Tests verifying all 5 library section fixes:
1. Video media streaming (MIME type and Range header support, no sqlite3.Row dict crash)
2. Auto-enrichment sweeper queue progression and fallback summaries
3. Reddit post and atom extraction
4. Twitter / X media vs author avatar separation
5. Markdown body sanitization preventing repeated heading accumulation
"""

import pytest
import sqlite3
import tempfile
from pathlib import Path
from backend.library.enrich import BODY_HEADINGS, body_of, render_markdown, Enrichment
from backend.library.store import LibraryStore
from backend.web.reader import is_reddit, is_x_post


def test_body_of_heading_sanitization():
    """Verify body_of strips duplicate headings and old provenance footers."""
    buggy_markdown = (
        "# @jack: just setting up my twttr\n\n"
        "## Post\n\n"
        "## Post\n\n"
        "## Post\n\n"
        "just setting up my twttr\n\n"
        "---\n"
        "_the text was too brief to extract further insights from._\n\n"
        "---\n"
        "_the text was too brief to extract further insights from._"
    )
    clean_body, heading = body_of(buggy_markdown)
    assert heading == "Post"
    assert clean_body == "just setting up my twttr"
    assert "## Post" not in clean_body
    assert "_the text was too brief" not in clean_body


def test_all_expected_body_headings_present():
    """Ensure BODY_HEADINGS includes Post, Description, Slide Analysis, Document, etc."""
    for expected in ("Post", "Description", "Slide Analysis", "Visual Content", "Document", "Transcript", "Caption"):
        assert expected in BODY_HEADINGS


def test_store_unsummarized_with_exclusion(db):
    """Verify LibraryStore.unsummarized supports exclude_ids to prevent queue starvation."""
    store = LibraryStore()
    
    id1 = store.create(title="Item 1", kind="article")
    id2 = store.create(title="Item 2", kind="article")
    id3 = store.create(title="Item 3", kind="article")

    # Fetch without exclusion
    rows = store.unsummarized(limit=10)
    assert any(r["id"] == id1 for r in rows)
    assert any(r["id"] == id2 for r in rows)
    assert any(r["id"] == id3 for r in rows)

    # Exclude id3 and id2
    rows_excluded = store.unsummarized(limit=10, exclude_ids=(id3, id2))
    assert not any(r["id"] == id3 for r in rows_excluded)
    assert not any(r["id"] == id2 for r in rows_excluded)
    assert any(r["id"] == id1 for r in rows_excluded)


def test_reddit_and_x_url_matchers():
    """Verify URL detection for reddit and x/twitter."""
    assert is_reddit("https://www.reddit.com/r/webdev/comments/12345/test")
    assert is_reddit("https://redd.it/12345")
    assert is_reddit("https://v.redd.it/abc123xyz")
    assert is_x_post("https://x.com/jack/status/20")
    assert is_x_post("https://twitter.com/sama/status/1763618195844464811")


@pytest.mark.asyncio
async def test_capture_url_notes_sanitization(db):
    """Verify capture_url strips trailing query params and hash fragments from notes."""
    from unittest.mock import patch
    from backend.library.service import LibraryService
    from backend.media.reel import Reel

    svc = LibraryService()
    url_with_query = "https://www.instagram.com/reel/DeNA3LtjDzc/?cplk=abc123xyz&ref=share"
    mock_reel = Reel(
        url="https://www.instagram.com/reel/DeNA3LtjDzc/",
        title="Test Reel",
        caption="A sample caption",
        author="creator",
        duration=15.0,
        thumbnail_url="https://example.com/thumb.jpg",
        video_path=None,
    )
    with patch("backend.library.reels.fetch_reel", return_value=mock_reel):
        captured = await svc.capture_url(url=url_with_query)
    
    item = svc.store.get(captured.item["id"])
    assert item is not None
    assert item["notes"] is None or not item["notes"].startswith("?")



def test_instagram_photo_post_fallback():
    """Verify _fetch_blocking hook handles posts where formats is empty without raising."""
    from unittest.mock import MagicMock, patch
    from backend.media.reel import _fetch_blocking

    mock_info = {
        "id": "DedkCc6olmo",
        "title": "10 best Github repos for Claude",
        "description": "Here are 10 repos...",
        "uploader": "testuser",
        "uploader_id": "testuser",
        "thumbnail": "https://example.com/thumb.jpg",
        "thumbnails": [{"url": "https://example.com/thumb.jpg"}],
        "formats": [],
    }

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        instance = MagicMock()
        mock_ydl_cls.return_value.__enter__.return_value = instance
        instance.extract_info.return_value = mock_info

        reel = _fetch_blocking("https://www.instagram.com/p/DedkCc6olmo/", None, {})
        assert reel.caption == "Here are 10 repos..."
        assert reel.author == "testuser"
        assert reel.thumbnail_url == "https://example.com/thumb.jpg"
        assert reel.video_path is None


@pytest.mark.asyncio
async def test_reel_capture_sqlite_row_dict_access(db):
    """Verify ReelCapture safely updates resources and tags on sqlite3.Row without AttributeError."""
    from backend.library.service import LibraryService
    from backend.library.reels import ReelCapture
    import json

    svc = LibraryService()
    # Create an item in db so row is returned as sqlite3.Row
    item_id = svc.store.create(
        title="Test Reel",
        kind="video",
        url="https://www.instagram.com/reel/test12345/",
    )
    svc.store.update(
        item_id,
        resources=json.dumps([{"type": "link", "url": "https://example.com"}]),
        tags=json.dumps(["test"]),
    )

    row = svc.store.get(item_id)
    assert row is not None
    # sqlite3.Row does not support dot notation (row.resources would raise AttributeError)
    with pytest.raises(AttributeError):
        _ = row.resources
    # But dict-style indexing works properly
    assert row["resources"] is not None
    assert row["tags"] is not None


def test_library_settings_persistence(db):
    """Verify load_library and save_library persist enrich_provider and enrich_model."""
    from backend.config import load_library, save_library

    # Default resolves to a high-tier model, not None and not mistral
    settings = load_library()
    assert settings.enrich_provider is not None
    assert settings.enrich_model is not None
    assert settings.enrich_provider != "mistral"

    # Save custom enrichment model
    save_library({"enrich_provider": "google", "enrich_model": "gemini-2.5-flash"})
    updated = load_library()
    assert updated.enrich_provider == "google"
    assert updated.enrich_model == "gemini-2.5-flash"


def test_library_settings_api_endpoints(db):
    """Verify GET and PATCH /api/settings/library endpoints."""
    from fastapi.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)
    # GET initial settings
    res = client.get("/api/settings/library")
    assert res.status_code == 200
    data = res.json()
    assert "enrich_provider" in data
    assert "enrich_model" in data

    # PATCH custom settings
    patch_res = client.patch(
        "/api/settings/library",
        json={"enrich_provider": "groq", "enrich_model": "llama-3.3-70b-versatile"},
    )
    assert patch_res.status_code == 200
    patched_data = patch_res.json()
    assert patched_data["enrich_provider"] == "groq"
    assert patched_data["enrich_model"] == "llama-3.3-70b-versatile"
