import pytest
from backend.web.search_service import _search_ddg_html, search_web


@pytest.mark.asyncio
async def test_search_ddg_html_returns_results():
    results = await _search_ddg_html("python programming", limit=5)
    assert len(results) > 0, "Expected at least 1 result from DuckDuckGo HTML"
    first = results[0]
    assert "title" in first and first["title"]
    assert "url" in first and first["url"].startswith("http")
    assert first.get("source") == "duckduckgo"
    # Verify title or snippet matches topic
    content = (first.get("title", "") + " " + first.get("snippet", "")).lower()
    assert "python" in content


@pytest.mark.asyncio
async def test_search_web_uses_ddg_over_wikipedia():
    # Calling search_web without external API keys should prioritize DDG HTML
    results = await search_web("python programming", limit=5)
    assert len(results) > 0
    # At least some results should be from web/duckduckgo, not purely wikipedia
    sources = [r.get("source") for r in results]
    assert "duckduckgo" in sources or "mixed" in sources or any("wikipedia.org" not in r.get("url", "") for r in results)

