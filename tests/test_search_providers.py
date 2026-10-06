import pytest
from backend.web import search_service

def test_search_api_catalogue_contains_new_providers():
    cat = search_service.search_api_catalogue()
    names = [p["name"] for p in cat]
    assert "langsearch" in names
    assert "exa" in names
    assert "firecrawl" in names
    assert "tavily" in names
    assert "brave" not in names
    assert "serper" not in names

def test_langsearch_adapter_format_and_parse():
    adapter = next(a for a in search_service._SEARCH_APIS if a["name"] == "langsearch")
    body = adapter["body"]("AI search", 5)
    assert body["query"] == "AI search"
    assert body["count"] == 5
    assert "contents" in body
    
    mock_resp = {
        "code": 200,
        "data": {
            "webPages": {
                "value": [
                    {"name": "LangSearch Guide", "url": "https://langsearch.com", "snippet": "Search for agents", "text": "Full text"}
                ]
            }
        }
    }
    rows = adapter["rows"](mock_resp)
    assert len(rows) == 1
    assert rows[0]["name"] == "LangSearch Guide"
    assert rows[0]["url"] == "https://langsearch.com"

def test_exa_adapter_format_and_parse():
    adapter = next(a for a in search_service._SEARCH_APIS if a["name"] == "exa")
    body = adapter["body"]("neural retrieval", 5)
    assert body["query"] == "neural retrieval"
    assert body["numResults"] == 5
    
    mock_resp = {
        "results": [
            {"title": "Exa AI", "url": "https://exa.ai", "text": "Semantic search", "highlights": ["Highlight snippet"]}
        ]
    }
    rows = adapter["rows"](mock_resp)
    assert len(rows) == 1
    assert rows[0]["title"] == "Exa AI"

def test_firecrawl_adapter_format_and_parse():
    adapter = next(a for a in search_service._SEARCH_APIS if a["name"] == "firecrawl")
    body = adapter["body"]("scrape docs", 4)
    assert body["query"] == "scrape docs"
    assert body["limit"] == 4
    
    mock_resp = {
        "success": True,
        "data": [
            {"title": "Firecrawl Scrape", "url": "https://firecrawl.dev", "description": "Markdown scrape", "markdown": "# Docs"}
        ]
    }
    rows = adapter["rows"](mock_resp)
    assert len(rows) == 1
    assert rows[0]["title"] == "Firecrawl Scrape"
