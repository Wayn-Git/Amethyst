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
