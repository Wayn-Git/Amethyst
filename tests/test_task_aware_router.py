import pytest
from backend.web.router import classify_search_task, route_search_task, SearchTaskType
from backend.web.circuit_breaker import get_circuit_breaker

def test_classify_general_web_query():
    assert classify_search_task("what is the capital of France?") == SearchTaskType.GENERAL_WEB
    assert classify_search_task("weather in Tokyo today") == SearchTaskType.GENERAL_WEB
    assert classify_search_task("latest iPhone 16 specs") == SearchTaskType.GENERAL_WEB

def test_classify_semantic_research_query():
    assert classify_search_task("find libraries similar to numpy in Rust") == SearchTaskType.SEMANTIC_RESEARCH
    assert classify_search_task("deep research on distributed consensus algorithms") == SearchTaskType.SEMANTIC_RESEARCH
    assert classify_search_task("compare architectural trade-offs of microservices vs monolith") == SearchTaskType.SEMANTIC_RESEARCH

def test_classify_deep_extraction_query():
    assert classify_search_task("https://docs.python.org/3/library/asyncio.html") == SearchTaskType.DEEP_EXTRACTION
    assert classify_search_task("scrape the full documentation for langchain") == SearchTaskType.DEEP_EXTRACTION
    assert classify_search_task("extract markdown from https://example.com/spec") == SearchTaskType.DEEP_EXTRACTION

def test_classify_verification_query():
    assert classify_search_task("is it true that GTA 6 was cancelled?") == SearchTaskType.FACTUAL_VERIFICATION
    assert classify_search_task("debunk the rumor about OpenAI shutting down") == SearchTaskType.FACTUAL_VERIFICATION

def test_route_fallback_chain_all_configured(monkeypatch):
    monkeypatch.setenv("LANGSEARCH_API_KEY", "ls-key")
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-key")
    monkeypatch.setenv("TAVILY_API_KEY", "tv-key")
    get_circuit_breaker().reset()

    # General web -> LangSearch primary
    primary, fallbacks = route_search_task("what is Python?")
    assert primary == "langsearch"
    assert "exa" in fallbacks
    assert "tavily" in fallbacks

    # Semantic research -> Exa primary
    primary, fallbacks = route_search_task("find libraries similar to pydantic in Rust")
    assert primary == "exa"
    assert "langsearch" in fallbacks

    # Deep extraction -> Firecrawl primary
    primary, fallbacks = route_search_task("https://example.com/docs")
    assert primary == "firecrawl"

    # Factual verification -> Tavily primary
    primary, fallbacks = route_search_task("did rockstar cancel gta 6?")
    assert primary == "tavily"

def test_route_fallback_bypasses_unhealthy_provider(monkeypatch):
    monkeypatch.setenv("LANGSEARCH_API_KEY", "ls-key")
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    monkeypatch.setenv("TAVILY_API_KEY", "tv-key")
    
    cb = get_circuit_breaker()
    cb.reset()
    # Langsearch has exhausted credits
    cb.record_failure("langsearch", status_code=402, error_msg="Payment required")

    primary, fallbacks = route_search_task("general query")
    # Langsearch is bypassed, Exa becomes primary
    assert primary == "exa"
    assert "langsearch" not in [primary] + fallbacks

def test_route_user_override(monkeypatch):
    monkeypatch.setenv("LANGSEARCH_API_KEY", "ls-key")
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    get_circuit_breaker().reset()

    # User explicitly requested exa
    primary, fallbacks = route_search_task("what is Python?", preferred="exa")
    assert primary == "exa"
    assert "langsearch" in fallbacks
