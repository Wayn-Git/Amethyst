"""Tests verifying native video media streaming for all video formats and kinds."""

import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.library.store import LibraryStore, media_path


def test_library_media_streams_post_with_video(db, tmp_path, monkeypatch):
    """Ensure /api/library/{item_id}/media serves video for items with kind='post' or social urls."""
    store = LibraryStore()
    item_id = store.create(
        title="Instagram Reel Post",
        kind="post",
        url="https://www.instagram.com/reel/C7xyz123/",
    )

    # Place a dummy video file on disk at candidate media_path
    video_file = media_path(item_id, ".mp4")
    video_file.parent.mkdir(parents=True, exist_ok=True)
    # Write at least 1500 bytes so it passes size check (> 1000)
    video_file.write_bytes(b"\x00" * 2048)

    client = TestClient(app)
    response = client.get(f"/api/library/{item_id}/media")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("video/")
    assert response.headers.get("accept-ranges") == "bytes"


def test_library_media_invokes_ytdlp_for_post_with_video_url(db, monkeypatch):
    """Ensure on-demand yt-dlp download is triggered for social post items with video URLs."""
    store = LibraryStore()
    item_id = store.create(
        title="Instagram Reel Post",
        kind="post",
        url="https://www.instagram.com/reel/C8abc789/",
    )

    ytdlp_called = []

    class MockYDL:
        def __init__(self, opts):
            self.opts = opts
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def download(self, urls):
            ytdlp_called.extend(urls)

    monkeypatch.setattr("yt_dlp.YoutubeDL", MockYDL)

    client = TestClient(app)
    client.get(f"/api/library/{item_id}/media")

    assert "https://www.instagram.com/reel/C8abc789/" in ytdlp_called

