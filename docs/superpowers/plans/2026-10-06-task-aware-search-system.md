# Task-Aware Multi-Provider Search System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst's search subsystem into an intelligent, task-aware engine that uses LangSearch (default general search), Exa (semantic/research), Firecrawl (crawling/extraction), and Tavily (verification/deep search) with resilient circuit-breaker fallback.

**Architecture:** A Task-Aware Router (`backend/web/router.py`) classifies queries by intent, freshness, and extraction needs to dispatch to the best provider. A thread-safe Circuit Breaker (`backend/web/circuit_breaker.py`) monitors HTTP 401/402/429/5xx errors and transparently redirects to typed fallback providers without latency penalties. Providers are normalized into a unified `SearchResult` model and surfaced through `search_web`, `research_web`, and `fetch_url`.

**Tech Stack:** Python 3.12, httpx (async client pool), Pydantic / dataclasses, pytest / pytest-asyncio, FastAPI.

**Spec:** [`docs/superpowers/specs/2026-10-06-search-system-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-06-search-system-design.md)

## Global Constraints

- **Python Floor:** Python 3.12 compatibility; async/await throughout.
- **Provider Roles:** LangSearch is the default general search; Exa is semantic/research; Firecrawl is crawl/markdown scrape; Tavily is retained for verification/consensus.
- **Circuit Breaker:** 402 (credits exhausted) and 429 (rate limits) must trigger non-blocking cooldowns; broken providers must be bypassed immediately on subsequent queries.
- **Zero-Key Fallback:** When no keys are configured, free scrapers (Bing, DuckDuckGo Lite) and Wikipedia must continue functioning as emergency safety nets.
- **Key Safety:** API keys must never appear in query parameters, log messages, or response bodies.

## Review Focus

1. **Credits Exhausted (402) Latency:** Subsequent searches while a provider has exhausted credits must NOT wait for HTTP timeouts; circuit breaker must bypass in 0ms.
2. **Missing Text in LangSearch/Exa:** When full text is absent or shorter than requested, normalization must smoothly fall back to snippet without throwing KeyError.
3. **SSRF Protection in Fetch/Scrape:** Firecrawl and custom fetchers must not bypass existing IP/domain safety checks for private ranges.
4. **Empty Query & Null Results:** Empty searches, zero-result searches, or unparseable JSON payloads must return clean empty lists rather than crashing.
5. **No Key Configured:** Fresh machines with zero configured keys must cleanly use the free scraper race without errors.

---

### Task 1: Circuit Breaker & Provider Health Registry

**Files:**
- Create: `backend/web/circuit_breaker.py`
- Test: `tests/test_search_circuit_breaker.py`

**Interfaces:**
- Produces:
  - `ProviderHealth`: dataclass tracking status (`HEALTHY`, `RATE_LIMITED`, `CREDITS_EXHAUSTED`, `AUTH_FAILED`, `UNAVAILABLE`), fail count, and `cooldown_until`.
  - `SearchCircuitBreaker`: class with `is_available(provider: str) -> bool`, `record_success(provider: str) -> None`, `record_failure(provider: str, status_code: int, error_msg: str) -> None`, `reset(provider: str | None = None) -> None`, `get_status() -> dict[str, Any]`.
  - Global singleton `get_circuit_breaker() -> SearchCircuitBreaker`.

- [ ] **Step 1: Write the failing unit tests for circuit breaker**

```python
# tests/test_search_circuit_breaker.py
import time
import pytest
from backend.web.circuit_breaker import SearchCircuitBreaker, ProviderStatus

def test_circuit_breaker_initially_healthy():
    cb = SearchCircuitBreaker()
    assert cb.is_available("langsearch")
    assert cb.get_status()["langsearch"]["status"] == ProviderStatus.HEALTHY.value

def test_circuit_breaker_rate_limit_cooldown():
    cb = SearchCircuitBreaker()
    cb.record_failure("langsearch", status_code=429, error_msg="Rate limit exceeded")
    assert not cb.is_available("langsearch")
    status = cb.get_status()["langsearch"]
    assert status["status"] == ProviderStatus.RATE_LIMITED.value
    assert status["cooldown_seconds"] > 0

def test_circuit_breaker_credits_exhausted_cooldown():
    cb = SearchCircuitBreaker()
    cb.record_failure("exa", status_code=402, error_msg="Payment required")
    assert not cb.is_available("exa")
    status = cb.get_status()["exa"]
    assert status["status"] == ProviderStatus.CREDITS_EXHAUSTED.value
    assert status["cooldown_seconds"] >= 1700  # ~30 min cooldown

def test_circuit_breaker_auth_failed_disabled_until_reset():
    cb = SearchCircuitBreaker()
    cb.record_failure("firecrawl", status_code=401, error_msg="Unauthorized")
    assert not cb.is_available("firecrawl")
    assert cb.get_status()["firecrawl"]["status"] == ProviderStatus.AUTH_FAILED.value
    cb.reset("firecrawl")
    assert cb.is_available("firecrawl")
    assert cb.get_status()["firecrawl"]["status"] == ProviderStatus.HEALTHY.value

def test_circuit_breaker_success_clears_failures():
    cb = SearchCircuitBreaker()
    cb.record_failure("langsearch", status_code=500, error_msg="Server error")
    cb.record_success("langsearch")
    assert cb.is_available("langsearch")
    assert cb.get_status()["langsearch"]["consecutive_failures"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_search_circuit_breaker.py -v`  
Expected: FAIL with ModuleNotFoundError: No module named 'backend.web.circuit_breaker'

- [ ] **Step 3: Implement `SearchCircuitBreaker` in `backend/web/circuit_breaker.py`**

Implement thread-safe tracking with `threading.Lock`, enum `ProviderStatus`, cooldown calculation based on status code, and `get_circuit_breaker()` accessor.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_search_circuit_breaker.py -v`  
Expected: PASS (5 passed)

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/web/circuit_breaker.py tests/test_search_circuit_breaker.py
git commit -m "feat(search): add circuit breaker and provider health registry"
```

---

### Task 2: Provider Adapters & Definition Catalogue

**Files:**
- Modify: `backend/web/search_service.py`
- Test: `tests/test_search_providers.py`

**Interfaces:**
- Consumes: `backend.web.circuit_breaker.get_circuit_breaker`
- Produces:
  - Updated `_SEARCH_APIS`: dictionary/tuple containing `langsearch`, `exa`, `firecrawl`, and `tavily` provider adapters.
  - `search_api_catalogue() -> list[dict[str, str]]`: updated for LangSearch, Exa, Firecrawl, Tavily.
  - `execute_provider_search(provider_name: str, query: str, limit: int, options: dict | None) -> list[dict[str, Any]]`: standardized provider call.

- [ ] **Step 1: Write failing tests for provider adapters**

```python
# tests/test_search_providers.py
import pytest
from backend.web import search_service

def test_search_api_catalogue_contains_new_providers():
    cat = search_api_catalogue()
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
    assert rows[0]["title"] == "LangSearch Guide"
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_search_providers.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement provider adapters in `backend/web/search_service.py`**

Replace Brave and Serper in `_SEARCH_APIS` with LangSearch, Exa, Firecrawl, and Tavily; update `search_api_catalogue()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_search_providers.py -v`  
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/web/search_service.py tests/test_search_providers.py
git commit -m "feat(search): add LangSearch, Exa, Firecrawl, and Tavily adapters"
```

---

### Task 3: Task-Aware Search Router

**Files:**
- Modify: `backend/web/router.py`
- Test: `tests/test_task_aware_router.py`

**Interfaces:**
- Consumes: `backend.web.circuit_breaker.get_circuit_breaker`, `backend.secrets.get_secret`
- Produces:
  - `SearchTaskType`: Enum (`GENERAL_WEB`, `SEMANTIC_RESEARCH`, `DEEP_EXTRACTION`, `FACTUAL_VERIFICATION`).
  - `route_search_task(query: str, options: dict | None = None) -> tuple[str, list[str]]`: returns `(primary_provider, fallback_chain)`.
  - `classify_search_task(query: str) -> SearchTaskType`.

- [ ] **Step 1: Write failing tests for task-aware router**

```python
# tests/test_task_aware_router.py
import pytest
from backend.web.router import classify_search_task, route_search_task, SearchTaskType

def test_classify_general_web_query():
    assert classify_search_task("what is the capital of France?") == SearchTaskType.GENERAL_WEB
    assert classify_search_task("weather in Tokyo today") == SearchTaskType.GENERAL_WEB

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

def test_route_fallback_chain_prioritizes_healthy_providers(monkeypatch):
    import os
    # Mock keys present for all
    monkeypatch.setenv("LANGSEARCH_API_KEY", "ls-key")
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-key")
    monkeypatch.setenv("TAVILY_API_KEY", "tv-key")
    
    primary, fallbacks = route_search_task("what is Python?")
    assert primary == "langsearch"
    assert "exa" in fallbacks
    assert "tavily" in fallbacks
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_task_aware_router.py -v`  
Expected: FAIL with ImportError

- [ ] **Step 3: Implement task classification & routing in `backend/web/router.py`**

Implement `SearchTaskType`, regex and entity heuristic detection, and fallback chain assembly respecting circuit breaker health and configured keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_task_aware_router.py -v`  
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add backend/web/router.py tests/test_task_aware_router.py
git commit -m "feat(search): implement task-aware search router with semantic fallback chains"
```

---

### Task 4: Search Service Execution & Resilient Fallback

**Files:**
- Modify: `backend/web/search_service.py`
- Test: `tests/test_search_service.py`

**Interfaces:**
- Consumes: `backend.web.router.route_search_task`, `backend.web.circuit_breaker.get_circuit_breaker`
- Produces:
  - Updated `_search_api(query: str, limit: int, options: dict | None = None) -> list[dict[str, Any]]`: uses router, attempts primary, notifies circuit breaker on error, and seamlessly continues to fallbacks.
  - Integration with free scraper race and cached web pool.

- [ ] **Step 1: Write failing tests for resilient fallback in search_service**

```python
# In tests/test_search_service.py
@pytest.mark.asyncio
async def test_search_api_circuit_breaker_bypasses_failed_provider(monkeypatch):
    """When primary provider returns 402 or 429, circuit breaker records cooldown
    and next provider in fallback chain answers immediately without repeated calls."""
    calls = []
    
    async def mock_call(api, query, limit):
        calls.append(api["name"])
        if api["name"] == "langsearch":
            # simulate 402
            return None, 402, "Credits exhausted"
        return [{"title": "Success", "url": "https://example.com", "snippet": "ok", "domain": "example.com"}], 200, None

    monkeypatch.setattr(search_service, "_call_single_provider", mock_call)
    monkeypatch.setenv("LANGSEARCH_API_KEY", "ls-key")
    monkeypatch.setenv("EXA_API_KEY", "exa-key")
    
    # Query 1: langsearch fails 402, falls through to exa
    res1 = await search_service._search_api("test query", 5)
    assert len(res1) == 1
    assert calls == ["langsearch", "exa"]
    
    # Query 2: langsearch is on cooldown, exa called immediately
    calls.clear()
    res2 = await search_service._search_api("test query 2", 5)
    assert len(res2) == 1
    assert calls == ["exa"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_search_service.py::test_search_api_circuit_breaker_bypasses_failed_provider -v`  
Expected: FAIL

- [ ] **Step 3: Update `_search_api` in `backend/web/search_service.py`**

Refactor `_search_api` into `_call_single_provider` and orchestration loop that uses `route_search_task`, updates circuit breaker on status codes (401, 402, 429, 500), and records successes.

- [ ] **Step 4: Run search_service tests to verify they pass**

Run: `uv run pytest tests/test_search_service.py -v`  
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add backend/web/search_service.py tests/test_search_service.py
git commit -m "feat(search): orchestrate task-aware provider calls with zero-latency circuit breaker bypass"
```

---

### Task 5: Deep Webpage Retrieval & Agent Tools Enhancement

**Files:**
- Modify: `backend/web/research_engine.py`
- Modify: `backend/tools/builtin/web.py`
- Test: `tests/test_research_engine.py`
- Test: `tests/test_web_tools.py`

**Interfaces:**
- Consumes: Firecrawl REST scrape API, LangSearch text extraction, `ResearchEngine`
- Produces:
  - Enhanced `fetch_url`: direct Firecrawl REST scrape -> Firecrawl MCP -> SSRF-safe `fetch_readable`.
  - Enhanced `search_web`: task-aware routing, instant context ingestion from `contents.text`.
  - Pass-through of `provider` parameter for explicit user override.

- [ ] **Step 1: Write failing tests for direct Firecrawl fetch and search text ingestion**

```python
# tests/test_web_tools.py
import pytest
from backend.tools.builtin import web
from backend.tools.base import ToolContext

@pytest.mark.asyncio
async def test_fetch_url_uses_firecrawl_rest_when_key_present(monkeypatch):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-key")
    
    class FakeResponse:
        status_code = 200
        def json(self):
            return {"success": True, "data": {"markdown": "# Scraped via Firecrawl REST"}}

    async def fake_post(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr(web, "_http_post", fake_post)
    res = await web.fetch_url({"url": "https://example.com"}, ToolContext.empty())
    assert res.is_ok
    assert "Scraped via Firecrawl REST" in res.value
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_web_tools.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement Firecrawl REST scrape in `backend/tools/builtin/web.py` and rich text absorption in `ResearchEngine`**

In `fetch_url`, try direct Firecrawl REST scrape if `FIRECRAWL_API_KEY` or `amethyst/firecrawl` secret is configured; fall back to MCP connection; fall back to `fetch_readable`.
In `ResearchEngine`, extract `text` or `highlights` from provider results to populate evidence immediately.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_web_tools.py tests/test_research_engine.py -v`  
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add backend/tools/builtin/web.py backend/web/research_engine.py tests/test_web_tools.py
git commit -m "feat(web): integrate Firecrawl REST scrape and rich page context extraction"
```

---

### Task 6: Settings API & Preferred Provider Configuration

**Files:**
- Modify: `backend/api/main.py`
- Modify: `backend/config.py`
- Test: `tests/test_search_settings_api.py`

**Interfaces:**
- Produces:
  - Extended `/api/search/provider` endpoint returning health state (`healthy`, `cooldown`, `auth_error`), `preferred_provider` mode (`auto`, `langsearch`, `exa`, `firecrawl`, `tavily`), and keys.
  - Reset of circuit breaker state when user saves a new API key.

- [ ] **Step 1: Write failing tests for search settings API**

```python
# tests/test_search_settings_api.py
from starlette.testclient import TestClient
from backend.api.main import app

def test_get_search_provider_returns_options_and_preferred():
    client = TestClient(app)
    resp = client.get("/api/search/provider")
    assert resp.status_code == 200
    data = resp.json()
    assert "options" in data
    assert "preferred" in data
    provider_names = [o["name"] for o in data["options"]]
    assert "langsearch" in provider_names
    assert "exa" in provider_names
    assert "firecrawl" in provider_names
    assert "tavily" in provider_names

def test_set_preferred_search_provider():
    client = TestClient(app)
    resp = client.put("/api/search/provider", json={"name": "preferred", "key": "exa"})
    assert resp.status_code == 200
    assert resp.json()["preferred"] == "exa"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_search_settings_api.py -v`  
Expected: FAIL

- [ ] **Step 3: Update `/api/search/provider` in `backend/api/main.py`**

Add support for `preferred` provider persistence and report circuit breaker status per provider.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_search_settings_api.py -v`  
Expected: PASS

- [ ] **Step 5: Commit Task 6**

```bash
git add backend/api/main.py tests/test_search_settings_api.py
git commit -m "feat(api): add preferred search provider setting and health reporting"
```

---

### Task 7: End-to-End System Verification & Composio Health

**Files:**
- Test: `tests/test_composio_service.py`
- Test: `tests/test_composio_e2e.py`
- Test: All search test suites

- [ ] **Step 1: Run comprehensive search and web test suite**

Run:
```bash
uv run pytest tests/test_search_circuit_breaker.py tests/test_search_providers.py tests/test_task_aware_router.py tests/test_search_service.py tests/test_research_engine.py tests/test_web_tools.py tests/test_search_settings_api.py tests/test_authority_and_dedup.py tests/test_web_models.py tests/test_query_planner.py -v
```
Expected: All tests PASS.

- [ ] **Step 2: Run Composio test suite to ensure zero regressions**

Run:
```bash
uv run pytest tests/test_composio_service.py tests/test_composio_e2e.py -v
```
Expected: All tests PASS.

- [ ] **Step 3: Run full backend regression check**

Run: `uv run pytest tests/test_install_and_web.py tests/test_phase1_milestone.py -v`  
Expected: All tests PASS.

- [ ] **Step 4: Final commit and cleanup**

```bash
git commit --allow-empty -m "chore(search): complete task-aware search system verification"
```
