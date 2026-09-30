"""End-to-end integration tests for the research engine and research tools."""

import pytest

from backend.web.models import ResearchDepth, SourceAuthorityTier
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
    import datetime
    current_month_year = datetime.datetime.now().strftime("%B %Y")

    async def mock_search(q, limit):
        calls.append(q)
        if current_month_year in q:
            return [{
                "title": f"GTA 6 {current_month_year} Latest Update",
                "url": "https://www.rockstargames.com/newswire/latest",
                "snippet": (
                    f"Rockstar Games reaffirms November 19, 2026 launch in {current_month_year}."
                ),
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
    evidence, registry, trace = await engine.execute_research(
        "Fetch me some news on GTA 6 latest only"
    )

    # Images were gathered and formatted into evidence
    assert "Visual Context Assets" in evidence
    assert "lucia_jason.jpg" in evidence

    # Second pass triggered or executed with temporal anchors
    assert any(current_month_year in q for q in trace.queries_executed)
    assert "Editorial Response Structure Instructions" in evidence
    assert "Latest Coverage & Article Navigation" in evidence


@pytest.mark.asyncio
async def test_research_engine_everything_query_and_unique_thumbnails():
    async def mock_search(q, limit):
        return [
            {
                "title": f"Rockstar Official Overview - {q[:10]}",
                "url": f"https://www.rockstargames.com/vi/{abs(hash(q)) % 100}",
                "snippet": "Official release date and gameplay details.",
                "domain": "rockstargames.com",
                "published_date": "2026-09-29",
            },
            {
                "title": f"Game Informer GTA 6 Cover Story - {q[:10]}",
                "url": f"https://www.gameinformer.com/features/{abs(hash(q)) % 100}",
                "snippet": "14-page exclusive cover story with lead developers.",
                "domain": "gameinformer.com",
                "published_date": "2026-09-29",
            },
            {
                "title": f"IGN Hands-on Analysis - {q[:10]}",
                "url": f"https://www.ign.com/articles/{abs(hash(q)) % 100}",
                "snippet": "First impressions of Vice City world and physics.",
                "domain": "ign.com",
                "published_date": "2026-09-28",
            },
        ]

    # Provide a list containing duplicates, different sizes of same image, and unique shots
    async def mock_image_search(q, limit):
        return [
            {
                "title": "GTA 6 Official Key Art",
                "image": "https://media.rockstargames.com/gta6/art_hero.jpg",
                "thumbnail": "https://media.rockstargames.com/gta6/art_hero_thumb.jpg",
                "source_url": "https://www.rockstargames.com/VI",
            },
            {
                # Duplicate by scaled filename
                "title": "GTA 6 Official Key Art 4K",
                "image": "https://media.rockstargames.com/gta6/art_hero_3840x2160.jpg",
                "thumbnail": "https://media.rockstargames.com/gta6/art_hero_thumb.jpg",
                "source_url": "https://www.rockstargames.com/VI",
            },
            {
                "title": "Game Informer Issue 382 Cover",
                "image": "https://media.gameinformer.com/covers/issue382.jpg",
                "thumbnail": "https://media.gameinformer.com/covers/issue382_sm.jpg",
                "source_url": "https://www.gameinformer.com/cover/382",
            },
            {
                "title": "Vice City Beach Sunset Screenshot",
                "image": "https://assets.ign.com/screenshots/vice_city_beach.jpg",
                "thumbnail": "https://assets.ign.com/screenshots/vice_city_beach_thumb.jpg",
                "source_url": "https://www.ign.com/screenshots",
            },
            {
                "title": "Lucia Car Chase Screenshot",
                "image": "https://cdn.polygon.com/gta6/car_chase.jpg",
                "thumbnail": "https://cdn.polygon.com/gta6/car_chase_thumb.jpg",
                "source_url": "https://www.polygon.com/gta6",
            },
        ]

    engine = ResearchEngine(search_fn=mock_search, image_search_fn=mock_image_search, turn_index=0)
    evidence, registry, trace = await engine.execute_research("everything about gta 6")

    # 1. Routing & Plan check
    assert trace.plan.depth == ResearchDepth.DEEP_RESEARCH
    assert len(trace.queries_executed) >= 4

    # 2. Visual assets deduplication check
    assert "Visual Context Assets" in evidence
    assert "art_hero.jpg" in evidence
    # Scaled duplicate should have been filtered out
    assert "art_hero_3840x2160.jpg" not in evidence

    # 3. Latest Coverage section check
    assert "Latest Coverage & Article Navigation:" in evidence
    lines = evidence.splitlines()
    nav_lines = [item for item in lines if item.startswith("- [") and "— *" in item]
    assert len(nav_lines) >= 3

    # 4. Ensure each navigation line has an image tag and thumbnails are not repeated
    seen_nav_thumbs = set()
    import re
    for line in nav_lines:
        img_match = re.search(r"!\[[^\]]*\]\((https?://[^\s\)]+)\)", line)
        assert img_match is not None, f"Article card missing thumbnail: {line}"
        thumb_url = img_match.group(1)
        assert thumb_url not in seen_nav_thumbs, (
            f"Duplicate thumbnail assigned across cards: {thumb_url}"
        )
        seen_nav_thumbs.add(thumb_url)


def test_formulate_image_query_domain_targeting():
    """Verify topic-specific targeting terms and prefix stripping in image queries."""
    from backend.web.research_engine import _formulate_image_query

    # Gaming query: targets official screenshots
    q1 = _formulate_image_query("GTA 6 trailer and release date", ["GTA 6"])
    assert q1 == "GTA 6 official screenshots"

    # Automotive query: targets reveal press photo
    q2 = _formulate_image_query("Ferrari F80 specs and price", ["Ferrari F80"])
    assert q2 == "Ferrari F80 official reveal press photo"

    # Space query: targets official mission photo
    q3 = _formulate_image_query(
        "James Webb Space Telescope findings", ["James Webb Space Telescope"]
    )
    assert q3 == "James Webb Space Telescope official mission photo"

    # Hardware query: targets official reveal photos
    q4 = _formulate_image_query("RTX 5090 announcement", ["RTX 5090"])
    assert q4 == "RTX 5090 official reveal photos"

    # Conversational prefix stripping when entities is empty
    q5 = _formulate_image_query("can you show me pictures of the Golden Gate Bridge", [])
    assert q5 == "Golden Gate Bridge official press photo"


def test_clean_image_caption():
    """Verify noisy headlines, review prefixes, and resolutions are stripped from alt text."""
    from backend.web.research_engine import _clean_image_caption

    # Review prefix and site suffix
    c1 = _clean_image_caption(
        "Review: Ferrari F80 Is a 1,184-HP Monster | MotorTrend",
        ["Ferrari F80"],
    )
    assert c1 == "Ferrari F80 Is a 1,184-HP Monster"

    # Wallpaper and resolution tags
    c2 = _clean_image_caption("GTA 6 Lucia & Jason Wallpaper 4K Ultra HD", ["GTA 6"])
    assert "Wallpaper" not in c2
    assert "4K" not in c2
    assert "GTA 6 Lucia & Jason" in c2

    # Numbering and brackets
    c3 = _clean_image_caption("Ferrari F80 (2025) [picture 1 of 45]", ["Ferrari F80"])
    assert "picture 1 of 45" not in c3
    assert "Ferrari F80" in c3

    # Generic gallery title with concrete slug subject
    c4 = _clean_image_caption(
        "GTA 6: All Official Screenshots for PS5 & Xbox Series X|S",
        ["GTA 6"],
        slug_subject="Leonida Keys",
    )
    assert c4 == "GTA 6 Leonida Keys"


def test_extract_slug_subject():
    """Verify extraction of semantic sub-topics from image URLs across diverse domains."""
    from backend.web.research_engine import _extract_slug_subject

    # Gaming environments & characters
    s1 = _extract_slug_subject("https://topgear.com/files/2025/05/Ambrosia_01_0.jpg")
    assert s1 == "Ambrosia"

    s2 = _extract_slug_subject(
        "https://gtabase.com/gta-6-screens/leonida-keys-05-1080.jpg",
        entities=["GTA 6"],
    )
    assert s2 == "Leonida Keys"

    s3 = _extract_slug_subject(
        "https://gta.com.ua/screenshots/gta6-port-gellhorn-02.jpg",
        entities=["GTA 6"],
    )
    assert s3 == "Port Gellhorn"

    s4 = _extract_slug_subject("https://gtabase.com/screens/jason-duval-05-1080.jpg")
    assert s4 == "Jason Duval"

    # Automotive sub-components
    s5 = _extract_slug_subject(
        "https://assets.topgear.com/ferrari-f80-rear-diffuser-track.jpg",
        entities=["Ferrari F80"],
    )
    assert s5 == "Rear Diffuser Track"

    # Space & astronomy features
    s6 = _extract_slug_subject(
        "https://images.nasa.gov/details/jwst-carina-nebula-deep-field.jpg",
        entities=["JWST"],
    )
    assert s6 == "Carina Nebula Deep Field"

    # Tech hardware colorways
    s7 = _extract_slug_subject(
        "https://cdn.futurecdn.net/macbook-pro-m4-space-black.jpg",
        entities=["MacBook Pro M4"],
    )
    assert s7 == "Space Black"

    # Generic filenames return empty slug for safe fallback
    assert _extract_slug_subject("https://example.com/images/screenshot.jpg") == ""
    assert _extract_slug_subject("https://example.com/assets/banner_hero.png") == ""

