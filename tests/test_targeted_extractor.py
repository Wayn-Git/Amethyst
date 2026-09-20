"""Tests for targeted passage extraction and token bounding."""

import pytest
from backend.web.extractor import extract_relevant_passages


def test_targeted_passage_extraction():
    sample_page = """
# Rockstar Games Official Newswire
Welcome to our official hub. Terms of service apply.

## GTA 6 Release Window and Editions
Grand Theft Auto VI is officially scheduled for worldwide launch on November 19, 2026.
The title will release for PlayStation 5 and Xbox Series X/S simultaneously.
Rockstar Games confirmed that a PC release will follow in late 2027.
The Standard Edition is priced at $79.99 while the Ultimate Edition includes the Vintage Vice City Pack.

## GTA Online Weekly Update
Earn 2X GTA$ and RP on Special Cargo Sales this week in Los Santos.
Visit Benny's Original Motor Works for 40% discounts on lowrider conversions.

## Rockstar Store Apparel
Buy official hoodies, caps, and collectibles in our online warehouse.
"""

    passages = extract_relevant_passages(
        sample_page,
        query="GTA 6 release date PC pricing",
        entities=["GTA 6", "Rockstar"],
        max_passages=2,
    )

    assert len(passages) >= 1
    heading, text, score = passages[0]
    assert "Release Window" in heading
    assert "November 19, 2026" in text
    assert "PlayStation 5" in text
    assert "$79.99" in text
    # Verify irrelevant sections are excluded
    assert "GTA Online Weekly Update" not in text
    assert "Rockstar Store Apparel" not in text


def test_empty_and_short_text():
    assert extract_relevant_passages("", query="test") == []
    assert extract_relevant_passages("   ", query="test") == []
