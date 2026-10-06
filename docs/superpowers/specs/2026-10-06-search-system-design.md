# Task-Aware Multi-Provider Search System Design

**Date**: 2026-10-06  
**Status**: Approved  
**Author**: Amethyst Core Team  
**Scope**: Search routing, provider specialization (LangSearch, Exa, Firecrawl, Tavily), health & fallback circuit breaker, deep webpage extraction, result normalization, deduplication, and agent integration.

---

## 1. Executive Summary

Amethyst's web search currently uses a static, hardcoded priority list (`Tavily` -> `Brave` -> `Serper`), falling back to free web scrapers (Bing, DuckDuckGo Lite) and Wikipedia articles. The existing implementation has three core problems:
1. **No Task Awareness**: All queries are sent to whatever single provider has an API key, ignoring provider strengths.
2. **Fragile Failure Handling**: Provider failures (such as `402 Payment Required` from exhausted credits or `429 Rate Limit`) trigger fall-through for that single call, but do not record cooldowns or failure states, causing every subsequent query to suffer connection timeouts and retry delays.
3. **Outdated Provider Stack**: Brave and Serper provide generic keyword dumps with little AI-agent optimization.

This design replaces Brave and Serper with **LangSearch**, **Exa**, and **Firecrawl**, retains **Tavily** as a specialized research/verification engine, and introduces a **Task-Aware Search Router** with an intelligent circuit breaker and unified result normalization.

---

## 2. Provider Specialization & Roles

Each provider is used for what it does best rather than treated as a generic link dump:

| Provider | Primary Role | Endpoint & Method | Key Capabilities Used |
| :--- | :--- | :--- | :--- |
| **LangSearch** *(Default)* | General web search, fast retrieval, fresh news, instant text context | `POST https://api.langsearch.com/v1/web-search` | Hybrid keyword+vector search, date filtering (`oneDay`, `oneWeek`, `oneMonth`, date ranges), domain include/exclude, `contents.text` with `maxCharacters` for instant page context without extra scrapes. |
| **Exa** | Semantic search, technical research, finding similar sources | `POST https://api.exa.ai/search` | Neural/semantic embeddings (`type="neural"` or `"auto"`), key passage `highlights`, domain filtering, authoritative source discovery. |
| **Firecrawl** | Deep crawling, clean markdown extraction, webpage scraping | `POST https://api.firecrawl.dev/v2/search`<br/>`POST https://api.firecrawl.dev/v2/scrape` | Full JavaScript-rendered scraping, clean LLM-ready markdown extraction, bypassing bot blockers, structured document extraction. |
| **Tavily** *(Retained)* | Factual dispute checks, deep research workflows, high-relevance consensus | `POST https://api.tavily.com/search` | Multi-step research workflows, `search_depth="advanced"`, claim verification. |
| **Safety Net** | Keyless fallback | Multi-engine race (Bing + DDG Lite) -> Wikipedia | Zero-configuration fallback when no API keys are present. |

---

## 3. Architecture & Data Flow

```
                                  Agent / Spotlight Query
                                             │
                                             ▼
                                  Task-Aware Search Router
                     - Intent detection (general, semantic, crawl, verify)
                     - Entity & temporal freshness analysis
                     - User preference / override check
                                             │
               ┌─────────────────────────────┼────────────────────────────┬────────────────────────────┐
               ▼                             ▼                            ▼                            ▼
           LangSearch                       Exa                       Firecrawl                     Tavily
      (General / Fast Search)       (Semantic / Research)        (Crawl / Extraction)        (Claim Verification)
               │                             │                            │                            │
               └─────────────────────────────┴────────────────────────────┴────────────────────────────┘
                                             │
                                             ▼
                             Provider Health & Circuit Breaker
                    - 401 Invalid Key: mark disabled until updated
                    - 402 Credits Exhausted: 30-minute cooldown
                    - 429 Rate Limit: exponential backoff cooldown
                    - Semantic fallback to next suitable provider
                                             │
                                             ▼
                           Result Normalization & Quality Pipeline
                    - Canonical URL normalization & deduplication
                    - Authority tiering & composite scoring
                    - Targeted passage extraction & claim verification
                                             │
                                             ▼
                           Agent Context / UI Response Delivery
```

---

## 4. Component Specifications

### 4.1 Task-Aware Search Router (`backend/web/router.py`)

The router classifies queries into four discrete task categories:
1. `GENERAL_WEB`: Factoids, questions, recent events, standard lookup.
   - Primary: **LangSearch**
   - Fallback: **Exa** -> **Tavily** -> Free Scrapers
2. `SEMANTIC_RESEARCH`: Technical architecture, "find tools like X", conceptual explanations, academic or developer deep dives.
   - Primary: **Exa**
   - Fallback: **LangSearch** -> **Tavily**
3. `DEEP_EXTRACTION` / `CRAWL`: Specific page URL reading, long documentation scraping, structured data extraction.
   - Primary: **Firecrawl** (`/v2/scrape` or `/v2/search`)
   - Fallback: **LangSearch** (`contents: {"text": {"maxCharacters": 4000}}`) -> `fetch_readable`
4. `FACTUAL_VERIFICATION`: Disputed claims, rumors, cancellations, hoax checks.
   - Primary: **Tavily** (or LangSearch with date filter)
   - Fallback: **LangSearch** -> **Exa**

#### User Preference & Override
- The router checks for a configured user preference (stored in settings or passed explicitly in tool arguments, e.g. `provider="exa"`).
- Options: `"auto"` (default, task-aware routing), `"langsearch"`, `"exa"`, `"firecrawl"`, `"tavily"`.

### 4.2 Provider Health & Circuit Breaker (`backend/web/circuit_breaker.py`)

A thread-safe, in-memory health registry tracks the operational status of each provider:
- **Statuses**: `HEALTHY`, `RATE_LIMITED` (429), `CREDITS_EXHAUSTED` (402), `AUTH_FAILED` (401/403), `UNAVAILABLE` (network/5xx).
- **Cooldown Policies**:
  - `402 Credits Exhausted`: 30-minute cooldown before retry.
  - `429 Rate Limit`: Exponential cooldown (starts at 30s, doubles up to 10m).
  - `401/403 Auth Failed`: Disabled until key is re-saved via settings.
  - `5xx / Network Timeout`: 60s cooldown after 2 consecutive errors.
- **Immediate Bypass**: A degraded provider is immediately bypassed in the routing stage without attempting HTTP requests, eliminating latency spikes.

### 4.3 Provider Integrations (`backend/web/search_service.py` & adapters)

#### A. LangSearch Adapter
- **Endpoint**: `https://api.langsearch.com/v1/web-search`
- **Headers**: `{"Authorization": f"Bearer {key}", "Content-Type": "application/json"}`
- **Payload**:
  ```json
  {
    "query": "...",
    "count": 10,
    "freshness": "noLimit" | "oneDay" | "oneWeek" | "oneMonth" | "oneYear",
    "includeDomains": [...],
    "excludeDomains": [...],
    "contents": {"text": {"maxCharacters": 3500}}
  }
  ```
- **Response Parsing**: Read `response["data"]["webPages"]["value"]` -> extract `name` (title), `url`, `snippet`, `text`, `datePublished`.

#### B. Exa Adapter
- **Endpoint**: `https://api.exa.ai/search`
- **Headers**: `{"x-api-key": key, "Content-Type": "application/json"}`
- **Payload**:
  ```json
  {
    "query": "...",
    "type": "auto",
    "numResults": 10,
    "contents": {"highlights": true, "text": {"maxCharacters": 2500}}
  }
  ```
- **Response Parsing**: Read `response["results"]` -> extract `title`, `url`, `text`, `highlights`, `publishedDate`.

#### C. Firecrawl Adapter
- **Search Endpoint**: `https://api.firecrawl.dev/v2/search`
- **Scrape Endpoint**: `https://api.firecrawl.dev/v2/scrape`
- **Headers**: `{"Authorization": f"Bearer {key}", "Content-Type": "application/json"}`
- **Search Payload**:
  ```json
  {
    "query": "...",
    "limit": 6,
    "scrapeOptions": {"formats": ["markdown"]}
  }
  ```
- **Response Parsing**: Read `response["data"]` -> extract `title`, `url`, `description`, `markdown`.

#### D. Tavily Adapter
- Preserved with cleaned headers and standardized output mapping.

### 4.4 Result Normalization & Deduplication (`backend/web/dedup.py`)

- Every provider result is transformed into the standard `SearchResult` dataclass.
- **Canonical URL Normalization**: Strips trailing slashes, tracking parameters (`utm_*`, `ref`, `fbclid`), normalizes `www.` and HTTPS.
- **Syndication & Content Deduplication**: Identifies mirrored press releases or syndicated articles sharing identical titles or high Jaccard token overlap, grouping them under the primary authoritative domain.

### 4.5 Agent Tool Enhancements (`backend/tools/builtin/web.py`)

1. **`search_web`**:
   - Accepts optional `provider: str` override.
   - Dispatches to Task-Aware Router.
   - When LangSearch or Firecrawl returns rich text or markdown, passes this directly to `ResearchEngine` evidence pipeline, avoiding secondary page scrape calls.
2. **`fetch_url`**:
   - Direct REST API Firecrawl scrape when Firecrawl key is present.
   - Fallback to Firecrawl MCP if connected.
   - Fallback to built-in SSRF-safe `fetch_readable`.
3. **`research_web`**:
   - Leverages Exa and LangSearch in parallel for multifaceted topic decomposition.

### 4.6 UI & Settings API (`backend/api/main.py`)

- `GET /api/search/provider`: Returns active provider, preferred provider setting (`auto`, `langsearch`, `exa`, `firecrawl`, `tavily`), health status per provider, and configuration options.
- `PUT /api/search/provider`: Supports updating/clearing keys and updating preferred provider mode.

---

## 5. Security & SSRF Protections

- All external API calls use centralized httpx connection pool with strict timeouts (8-10s connect/read).
- All direct URL scraping continues to enforce SSRF validation (blocking localhost, private IP ranges 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, cloud metadata endpoints 169.254.169.254).
- API keys are stored exclusively in the system keychain (`backend.secrets`) or environment variables, never logged or leaked into HTTP responses.

---

## 6. Verification & Test Plan

1. **Unit Tests**:
   - Router task classification tests (general vs semantic vs deep crawl vs verification).
   - Circuit breaker cooldown tests (401, 402, 429 transition and recovery).
   - Provider request payload & response normalization tests for LangSearch, Exa, Firecrawl, Tavily.
   - URL canonicalization and deduplication tests.
2. **Fallback Integration Tests**:
   - Simulate LangSearch 402 (quota exceeded) -> verifies instant seamless fallback to Exa/Tavily without latency stall.
   - Simulate all keys absent -> verifies seamless fallback to Bing/DDG scrapers and Wikipedia.
3. **End-to-End Agent Verification**:
   - Verify `search_web`, `research_web`, and `fetch_url` tool executions.
   - Verify Composio and search workflows end-to-end.
