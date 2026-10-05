import pytest
from backend.tools.builtin import web
from backend.tools.base import ToolContext

@pytest.mark.asyncio
async def test_fetch_url_uses_firecrawl_rest_when_key_present(monkeypatch):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-key")
    from backend.web.circuit_breaker import get_circuit_breaker
    get_circuit_breaker().reset()

    class FakeResponse:
        status_code = 200
        text = "OK"
        def json(self):
            return {"success": True, "data": {"markdown": "# Scraped via Firecrawl REST\nDeep content"}}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(web.httpx, "AsyncClient", FakeClient)

    res = await web.fetch_url({"url": "https://example.com/deep"}, ToolContext())
    assert not res.is_error
    assert "Scraped via Firecrawl REST" in res.content

@pytest.mark.asyncio
async def test_search_web_accepts_provider_override(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    from backend.web.circuit_breaker import get_circuit_breaker
    get_circuit_breaker().reset()

    executed_options = []

    async def mock_execute(self, query, depth=None, limit_per_query=6, explicit_queries=None, options=None):
        executed_options.append(options)
        return "Search result evidence", None, None

    from backend.web.research_engine import ResearchEngine
    monkeypatch.setattr(ResearchEngine, "execute_research", mock_execute)

    res = await web.search_web({"query": "python", "provider": "exa"}, ToolContext())
    assert not res.is_error
    assert len(executed_options) == 1
    assert executed_options[0].get("preferred") == "exa"


@pytest.mark.asyncio
async def test_research_engine_ingests_rich_text_without_scrape():
    from backend.web.research_engine import ResearchEngine

    async def mock_search(q, limit, options=None):
        return [
            {
                "title": "Python 3.13 Documentation",
                "url": "https://docs.python.org/3.13",
                "snippet": "Python 3.13 includes a free-threaded build mode.",
                "domain": "docs.python.org",
                "text": "## Free-threaded CPython\nPython 3.13 introduces experimental free-threading without the GIL.",
            }
        ]

    engine = ResearchEngine(search_fn=mock_search)
    evidence, registry, trace = await engine.execute_research("Python 3.13 free-threaded", depth="research")

    assert len(trace.evidence_extracted) > 0
    # No network pages were inspected because rich text was ingested directly
    assert len(trace.pages_inspected) == 0
    assert any("Free-threaded" in ev["passage"] or "GIL" in ev["passage"] for ev in trace.evidence_extracted)

