"""Tests for web models, registry, and data structures."""

import pytest
from backend.web.models import (
    EvidenceItem,
    FreshnessWindow,
    ResearchDepth,
    SearchResult,
    SourceAuthorityTier,
    SourceRegistry,
)


def test_source_authority_tier_scores():
    assert SourceAuthorityTier.OFFICIAL.score == 1.0
    assert SourceAuthorityTier.PRIMARY.score == 0.9
    assert SourceAuthorityTier.REPUTABLE.score == 0.75
    assert SourceAuthorityTier.SPECIALIZED.score == 0.6
    assert SourceAuthorityTier.COMMUNITY.score == 0.4
    assert SourceAuthorityTier.UNVERIFIED.score == 0.2


def test_search_result_composite_score():
    res = SearchResult(
        ref_id="turn0search1",
        title="Official Site",
        url="https://example.com/official",
        domain="example.com",
        snippet="Official documentation",
        relevance=1.0,
        freshness_score=1.0,
        authority_tier=SourceAuthorityTier.OFFICIAL,
    )
    # 1.0 * 0.50 + 1.0 * 0.35 + 1.0 * 0.15 = 1.0
    assert pytest.approx(res.composite_score) == 1.0

    citation = res.format_citation()
    assert "[turn0search1]" in citation
    assert "Official Site" in citation
    assert "official" in citation


def test_source_registry():
    reg = SourceRegistry(turn_index=1)
    res1 = SearchResult(
        ref_id="",
        title="Article A",
        url="https://site.com/a",
        domain="site.com",
        snippet="Snippet A",
        authority_tier=SourceAuthorityTier.REPUTABLE,
    )
    ref_id = reg.register(res1)
    assert ref_id == "turn1search1"
    assert reg.get(ref_id) == res1
    assert reg.get_by_url("https://site.com/a") == res1

    # Registering same URL returns existing reference ID
    res2 = SearchResult(
        ref_id="",
        title="Article A Dup",
        url="https://site.com/a/",
        domain="site.com",
        snippet="Snippet A Dup",
    )
    ref2 = reg.register(res2)
    assert ref2 == "turn1search1"

    # Add evidence
    ev = EvidenceItem(
        ref_id=ref_id,
        url="https://site.com/a",
        domain="site.com",
        title="Article A",
        passage="Important findings.",
        section_heading="Key Results",
        authority_tier=SourceAuthorityTier.REPUTABLE,
    )
    reg.add_evidence(ev)
    assert len(reg.all_evidence()) == 1
    assert "Key Results" in ev.format_for_context()
