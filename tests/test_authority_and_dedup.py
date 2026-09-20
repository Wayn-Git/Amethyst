"""Tests for domain authority classification, canonical URLs, and deduplication."""

import pytest
from backend.web.authority import classify_authority, determine_provenance, SourceAuthorityTier
from backend.web.dedup import (
    canonical_url,
    deduplicate_and_cluster,
    jaccard_similarity,
    tokenize_title,
)
from backend.web.models import SearchResult


def test_classify_authority():
    assert classify_authority("https://www.rockstargames.com/newswire", priority_domains=["rockstargames.com"]) == SourceAuthorityTier.OFFICIAL
    assert classify_authority("https://whitehouse.gov/briefing") == SourceAuthorityTier.OFFICIAL
    assert classify_authority("https://cs.stanford.edu/research") == SourceAuthorityTier.PRIMARY
    assert classify_authority("https://docs.python.org/3/library") == SourceAuthorityTier.PRIMARY
    assert classify_authority("https://www.reuters.com/technology/article") == SourceAuthorityTier.REPUTABLE
    assert classify_authority("https://www.ign.com/articles/2026/09/gta-6") == SourceAuthorityTier.REPUTABLE
    assert classify_authority("https://arstechnica.com/gadgets") == SourceAuthorityTier.REPUTABLE
    assert classify_authority("https://medium.com/@author/post") == SourceAuthorityTier.SPECIALIZED
    assert classify_authority("https://www.reddit.com/r/gaming") == SourceAuthorityTier.COMMUNITY
    assert classify_authority("https://unknown-aggregator-blog-123.biz/news") == SourceAuthorityTier.UNVERIFIED


def test_determine_provenance():
    assert determine_provenance(SourceAuthorityTier.OFFICIAL) == "OFFICIAL_CONFIRMATION"
    assert determine_provenance(SourceAuthorityTier.REPUTABLE, corroboration_count=2) == "CORROBORATED_REPORTING"
    assert determine_provenance(SourceAuthorityTier.COMMUNITY) == "COMMUNITY_SPECULATION"
    assert determine_provenance(SourceAuthorityTier.REPUTABLE, is_disputed=True) == "DISPUTED_CLAIM"


def test_canonical_url():
    u1 = "https://www.ign.com/articles/gta-6?utm_source=twitter&utm_medium=social#comments"
    u2 = "http://ign.com/articles/gta-6/"
    assert canonical_url(u1) == "https://ign.com/articles/gta-6"
    assert canonical_url(u2) == "https://ign.com/articles/gta-6"

    mobile = "https://en.m.wikipedia.org/wiki/Ada_Lovelace"
    assert canonical_url(mobile) == "https://en.wikipedia.org/wiki/Ada_Lovelace"


def test_syndication_deduplication():
    r_official = SearchResult(
        ref_id="s1",
        title="Rockstar announces GTA 6 soundtrack details",
        url="https://rockstargames.com/newswire/soundtrack",
        domain="rockstargames.com",
        snippet="Official soundtrack announcement",
        authority_tier=SourceAuthorityTier.OFFICIAL,
    )
    r_ign = SearchResult(
        ref_id="s2",
        title="Rockstar Announces GTA 6 Soundtrack Details - IGN",
        url="https://ign.com/articles/gta-soundtrack?ref=home",
        domain="ign.com",
        snippet="IGN reporting on the Rockstar announcement",
        authority_tier=SourceAuthorityTier.REPUTABLE,
    )
    r_gamespot = SearchResult(
        ref_id="s3",
        title="GTA 6 Soundtrack Details Announced by Rockstar - GameSpot",
        url="https://gamespot.com/articles/gta-soundtrack",
        domain="gamespot.com",
        snippet="GameSpot reporting on the soundtrack",
        authority_tier=SourceAuthorityTier.REPUTABLE,
    )
    r_other = SearchResult(
        ref_id="s4",
        title="NVIDIA announces new GeForce driver update",
        url="https://nvidia.com/news/driver",
        domain="nvidia.com",
        snippet="New driver update released",
        authority_tier=SourceAuthorityTier.OFFICIAL,
    )

    clustered = deduplicate_and_cluster([r_ign, r_gamespot, r_official, r_other])
    assert len(clustered) == 2

    # Verify official source is chosen as the leader
    leader = next(c for c in clustered if "soundtrack" in c.title.lower())
    assert leader.domain == "rockstargames.com"
    assert len(leader.syndicated_urls) == 2
    assert any("ign.com" in u for u in leader.syndicated_urls)
    assert any("gamespot.com" in u for u in leader.syndicated_urls)
