"""End-to-end integration tests for the research engine and research tools."""

import pytest
from backend.web.models import ClaimStatus, ResearchDepth, SourceAuthorityTier
from backend.web.research_engine import ResearchEngine


@pytest.mark.asyncio
async def test_research_engine_current_events():
    async def mock_search(q, limit):
        if "announcement" in q:
            return [{
                "title": "Grand Theft Auto VI Release Date Announcement",
                "url": "https://www.rockstargames.com/newswire/article/gta-vi",
                "snippet": "Rockstar Games confirms GTA 6 launches November 19, 2026.",
                "domain": "rockstargames.com",
                "published_date": "2026-09-17",
            }]
        elif "news" in q:
            return [{
                "title": "GTA 6 latest news - IGN",
                "url": "https://www.ign.com/articles/gta-6-release-date",
                "snippet": "Rockstar confirms November 2026 launch date.",
                "domain": "ign.com",
                "published_date": "2026-09-18",
            }]
        return []

    engine = ResearchEngine(search_fn=mock_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("What happened with GTA 6 recently?")

    assert trace.results_retrieved_count >= 2
    assert len(trace.queries_executed) >= 2
    assert "turn0search1" in evidence
    assert "rockstargames.com" in evidence
    assert "CONFIRMED" in evidence or "REPORTED" in evidence
    assert len(registry.all_sources()) == 2

    # Check that official source is identified
    s1 = registry.get("turn0search1")
    assert s1 is not None
    assert s1.authority_tier == SourceAuthorityTier.OFFICIAL


@pytest.mark.asyncio
async def test_research_engine_dispute_verification():
    async def mock_search(q, limit):
        return [
            {
                "title": "Take-Two Interactive reaffirms Fall 2026 GTA 6 Window",
                "url": "https://take2games.com/press",
                "snippet": "Take-Two confirms schedule remains on track with no delay.",
                "domain": "take2games.com",
                "published_date": "2026-09-10",
            },
            {
                "title": "Rumors swirl of potential GTA 6 delay to 2027",
                "url": "https://www.reddit.com/r/GTA6/comments/delay",
                "snippet": "Unconfirmed rumors claim GTA 6 delayed to 2027.",
                "domain": "reddit.com",
                "published_date": "2026-09-12",
            },
        ]

    engine = ResearchEngine(search_fn=mock_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("Has GTA 6 been delayed?")

    assert "Multi-Source Verification Matrix" in evidence
    assert "Take-Two" in evidence or "take2games.com" in evidence
    assert len(trace.claims_verified) >= 1
    claim = trace.claims_verified[0]
    assert claim["status"] in ("confirmed", "disputed")


@pytest.mark.asyncio
async def test_research_engine_simple_fast_path():
    async def mock_search(q, limit):
        return [{
            "title": "Ada Lovelace Biography",
            "url": "https://en.wikipedia.org/wiki/Ada_Lovelace",
            "snippet": "Ada Lovelace was an English mathematician and writer.",
            "domain": "wikipedia.org",
        }]

    engine = ResearchEngine(search_fn=mock_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("Who was Ada Lovelace?")

    assert len(trace.queries_executed) == 1
    assert "turn0search1" in evidence
    assert "Ada Lovelace was an English mathematician" in evidence


@pytest.mark.asyncio
async def test_research_engine_graceful_failure():
    async def empty_search(q, limit):
        return []

    engine = ResearchEngine(search_fn=empty_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("Query that yields nothing")

    assert "No results found" in evidence or "All search engines" in evidence
    assert len(registry.all_sources()) == 0


@pytest.mark.asyncio
async def test_research_engine_parallel_images_and_stale_refinement():
    calls = []

    async def mock_search(q, limit):
        calls.append(q)
        if "September 2026" in q:
            return [{
                "title": "GTA 6 September 2026 Latest Update",
                "url": "https://www.rockstargames.com/newswire/sept-2026",
                "snippet": "Rockstar Games reaffirms November 19, 2026 launch in September 2026.",
                "domain": "rockstargames.com",
                "published_date": "2026-09-19",
            }]
        return [{
            "title": "Old 2024 Trailer Recap",
            "url": "https://www.ign.com/articles/old-trailer",
            "snippet": "Recap of 2024 trailer 1.",
            "domain": "ign.com",
            "published_date": "2024-01-10",
        }]

    async def mock_image_search(q, limit):
        return [{
            "title": "Official GTA 6 Lucia & Jason Artwork",
            "image": "https://media.rockstargames.com/gta6/lucia_jason.jpg",
            "thumbnail": "https://media.rockstargames.com/gta6/lucia_jason_thumb.jpg",
        }]

    engine = ResearchEngine(search_fn=mock_search, image_search_fn=mock_image_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("Fetch me some news on GTA 6 latest only")

    # Images were gathered and formatted into evidence
    assert "Visual Context Assets" in evidence
    assert "lucia_jason.jpg" in evidence

    # Second pass triggered or executed with temporal anchors
    assert any("September 2026" in q for q in trace.queries_executed)
    assert "Editorial Response Structure Instructions" in evidence
    assert "Latest Coverage & Article Navigation" in evidence
