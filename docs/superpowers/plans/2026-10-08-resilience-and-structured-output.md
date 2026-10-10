# LLM Resilience and Structured Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix backend crash/reboot false alarms, harden LLM streaming and OpenCode Zen/Kilo gateway compatibility, eliminate startup and note retrieval latency, and implement a structured component pipeline with image carousels and rich widgets.

**Architecture:** Decouple frontend network errors from full-screen boot modals so chat state stays interactive; increase HTTP connect timeouts to 15s and add SSE stream resumption in the backend runtime; normalize OpenCode Zen and Kilocode gateway routes; enforce a 4s vector embedding deadline with instant BM25 keyword fallback for document search; and replace single-envelope widget parsing with a multi-block response schema backed by a frontend Component Registry featuring responsive image galleries and data tables.

**Tech Stack:** Python 3.11+ (FastAPI, httpx, pydantic, sqlite-vec), React 18 / Vite (Tailwind / Vanilla CSS Design System tokens, Framer Motion), pytest, npm.

**Spec:** User request specifying major bugs (restarting to waking screen, provider disconnects, 30s startup / 25s note search, OpenCode Zen mimo2.4 / Kilocode failures, and structured output image carousels/component registry).

## Global Constraints

- Design System: Strictly adhere to `AGENTS.md` and `frontend/src/index.css` design tokens (`--canvas`, `--surface`, `--accent`, `--border`, `--live`, `--r-*`, Inter / Geist Mono fonts).
- Motion: Respect `prefers-reduced-motion` and `--ease-out` timing under 280ms.
- Backward Compatibility: Existing conversations with `amethyst:widget` envelopes must continue to render correctly.
- Fallback Safety: Any failed component extraction or vector search timeout must degrade gracefully to readable prose or BM25 keyword search; turns must never fail with blank answers.

## Review Focus

1. Partial SSE stream disconnect: Provider drops connection mid-stream after sending 10 tokens; client resumes or finishes gracefully without crashing the UI.
2. OpenCode Zen gateway payload: Non-reasoning models or foreign gateways receiving `reasoning_effort` reject the call; adapter must strip unsupported parameters.
3. Note search with offline embedder: Ollama or remote embedding hangs; search falls back within 4s to BM25 keyword results.
4. Transient network drop: Chat stream encounters `TypeError: Failed to fetch`; UI stays mounted with inline retry button rather than forcing full-screen `BootScreen`.
5. Mixed structured output: LLM outputs introductory text, an `image_gallery` component, and follow-up source notes; frontend renders all three in clean visual hierarchy.

---

### Task 1: Decouple Frontend Stream & Network Errors from BootScreen

**Files:**
- Modify: `frontend/src/api.js:205-215`
- Modify: `frontend/src/api.js:488-495`
- Modify: `frontend/src/views/Chat.jsx:1710-1745`
- Modify: `frontend/src/App.jsx:690-710`

**Interfaces:**
- Consumes: `api.turn()`, `publish()`, `state`, `wakeBackend()`
- Produces: Resilient chat error handling where only confirmed consecutive `/api/ping` failures trigger `BootScreen`.

- [ ] **Step 1: Write test/reproduction check for fetch failure handling**

Verify in `frontend/src/api.js` that `turn()` catching a `TypeError` does not unconditionally set `publish({ phase: 'down', verified: false })`.

- [ ] **Step 2: Update `frontend/src/api.js` error handling**

In `turn()` and `j()`, on `TypeError` / network error, do not immediately force `phase: 'down'`. Instead, trigger a silent background health check (`/api/ping`). Only if `/api/ping` fails after 3 retries should `publish({ phase: 'down' })` fire.

- [ ] **Step 3: Update `frontend/src/views/Chat.jsx` to render inline turn retry**

In `openTurn` catch block:
- Catch `TypeError` / stream aborts and push an actionable error note: `pushNote('error', errMsg, { resumable: true, retryable: true, onRetry: () => send() })`.
- Ensure composer is re-enabled (`setTurnState('idle')`) and chat transcript remains visible.

- [ ] **Step 4: Verify frontend build passes**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(frontend): decouple stream errors from full-screen boot screen"
```

---

### Task 2: Provider Stream Hardening & OpenCode Parity (Timeouts, Resumption, Param Sanitization)

**Files:**
- Modify: `backend/runtime/http.py:200-220`
- Modify: `backend/runtime/http.py:410-445`
- Modify: `backend/runtime/providers/openai_compat.py:240-266`
- Modify: `backend/runtime/providers/openai_compat.py:410-435`
- Test: `tests/test_stream_resume.py`

**Interfaces:**
- Consumes: `stream_sse`, `CONNECT_TIMEOUT`, `OpenAICompatClient`
- Produces: 15s connect timeout, sanitized gateway payloads, and partial-stream continuation.

- [ ] **Step 1: Write test for stream parameter sanitization and connect timeout**

Add test in `tests/test_stream_resume.py` verifying that models which are not reasoning models or running via gateways have `reasoning_effort` stripped, and verify `CONNECT_TIMEOUT` is 15.0s.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_stream_resume.py -k test_timeout_and_params`
Expected: FAIL

- [ ] **Step 3: Implement parameter sanitization and relaxed timeouts**

In `backend/runtime/http.py`:
- Set `CONNECT_TIMEOUT = 15.0` (up from 4.0s).
- In `stream_sse`: Gracefully ignore comments, keepalive pings (`: ping`, `: keepalive`), and empty lines without breaking.

In `backend/runtime/providers/openai_compat.py`:
- In `_build_payload`: Only include `reasoning_effort` if `is_reasoning_model(self.model)` and not tools and provider is not a gateway known to reject it.
- In `stream`: Allow stream reconnect attempt with backoff if stream disconnects after fewer than 32 tokens, or return partial response gracefully instead of raising unrecoverable exception.

- [ ] **Step 4: Run test to verify passes**

Run: `pytest tests/test_stream_resume.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(runtime): increase connect timeout to 15s and sanitize provider stream payload"
```

---

### Task 3: OpenCode Zen & Kilocode Gateway Compatibility

**Files:**
- Modify: `backend/provider_catalogue.py:170-195`
- Modify: `backend/runtime/providers/openai_compat.py:510-538`
- Modify: `frontend/src/views/Settings.jsx:50-55`
- Modify: `frontend/src/lib/opencode.js:150-175`
- Test: `tests/test_router.py`

**Interfaces:**
- Consumes: `ProviderPreset`, `catalogue`, `OpenCodeManager`
- Produces: Correct base URLs, model namespace preservation, and gateway model aliases (`mimo`, `minimax`, `stepfun`).

- [ ] **Step 1: Write test for OpenCode Zen preset base URL and model resolution**

Add test in `tests/test_router.py` asserting `catalogue.preset("opencode-zen").base_url == "https://opencode.ai/inference/openai/v1"` and model names with namespaces (e.g. `mimo2.4`, `stepfun/...`) resolve properly.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_router.py -k test_opencode_zen`
Expected: FAIL

- [ ] **Step 3: Update provider catalogue and model resolvers**

In `backend/provider_catalogue.py`:
- Update `opencode-zen` preset with `base_url="https://opencode.ai/inference/openai/v1"` and `default_model="kimi-k2.6"`.
- Add common aliases for OpenCode Zen: `mimo2.4` -> `minimax-m2.7`, `mimo` -> `minimax-m2.7`.

In `frontend/src/lib/opencode.js`:
- Relax Kilo Code filtering so models with `stepfun`, `mimo`, `qwen`, `deepseek`, and user-connected models are never dropped.

- [ ] **Step 4: Run test to verify passes**

Run: `pytest tests/test_router.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(providers): configure OpenCode Zen endpoint and gateway model aliases"
```

---

### Task 4: Background Async Boot & 4s Note Retrieval Deadline

**Files:**
- Modify: `backend/api/main.py:1240-1280`
- Modify: `backend/api/main.py:630-660`
- Modify: `backend/tools/builtin/documents.py:10-50`
- Modify: `backend/retrieval/search.py:80-140`
- Test: `tests/test_documents.py`

**Interfaces:**
- Consumes: `_start_connectors()`, `search_documents()`, `HybridSearch`
- Produces: Non-blocking connector boot and 4.0s deadline on vector search with instant BM25 fallback.

- [ ] **Step 1: Write test for vector search timeout fallback**

Add test in `tests/test_documents.py` simulating a slow/hanging embedder (>4s) and verifying `search_documents` returns keyword BM25 matches within 4.5s.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_documents.py -k test_embedding_timeout_fallback`
Expected: FAIL

- [ ] **Step 3: Implement 4s timeout on vector retrieval and async connector boot**

In `backend/tools/builtin/documents.py` & `backend/retrieval/search.py`:
- Wrap vector search call in `asyncio.wait_for(vector_search, timeout=4.0)`.
- If `TimeoutError` or exception occurs, log warning and immediately fall back to pure BM25 full-text keyword search against SQLite.

In `backend/api/main.py`:
- Ensure `_start_connectors()` runs strictly as background task without blocking `/api/ping` or delaying turn response.
- Set `CONNECTOR_WARM_DEADLINE = 0.5`.

- [ ] **Step 4: Run test to verify passes**

Run: `pytest tests/test_documents.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "perf(retrieval): add 4s vector embedding deadline with instant BM25 keyword fallback"
```

---

### Task 5: Structured Output Protocol & Search Images Tool

**Files:**
- Create: `backend/tools/builtin/image_search.py`
- Modify: `backend/agent/widgets.py:100-280`
- Modify: `backend/tools/registry.py:40-80`
- Modify: `backend/agent/prompt.py:25-70`
- Test: `tests/test_widgets.py`

**Interfaces:**
- Consumes: `search_images(query: str, limit: int = 6)`
- Produces: Typed `image_gallery`, `data_table`, `video_player`, and `search_results` envelopes.

- [ ] **Step 1: Write test for image search tool and image_gallery envelope**

Add test in `tests/test_widgets.py` verifying `search_images` returns structured list of images (`url`, `title`, `thumbnail`, `source`) and serializes to `image_gallery` widget format.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_widgets.py -k test_image_gallery`
Expected: FAIL

- [ ] **Step 3: Implement `image_search` tool and add `image_gallery` / `data_table` schemas**

In `backend/tools/builtin/image_search.py`:
- Implement `search_images(query: str, limit: int = 6)` using DuckDuckGo / web image search from `backend.web.search_service`.
- Returns structured JSON with list of images and layout hint (`carousel` or `grid`).

In `backend/agent/widgets.py`:
- Add `ImageItem(url, title, thumbnail, source)` and `ImageGallery(title, images, layout)`.
- Add `DataTable(title, columns, rows)`.
- Register in `WIDGET_MODELS`.

In `backend/agent/prompt.py`:
- Instruct model: When user asks for images, call `search_images` instead of dumping raw URLs.

- [ ] **Step 4: Run test to verify passes**

Run: `pytest tests/test_widgets.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(agent): add search_images tool and structured image_gallery schemas"
```

---

### Task 6: Frontend Component Registry & Multi-Block Message Rendering

**Files:**
- Modify: `frontend/src/components/widgets/envelope.js:10-50`
- Create: `frontend/src/components/widgets/ImageGallery.jsx`
- Create: `frontend/src/components/widgets/DataTable.jsx`
- Modify: `frontend/src/components/widgets/WidgetRenderer.jsx:15-80`
- Modify: `frontend/src/views/Chat.jsx:300-310, 770-805`

**Interfaces:**
- Consumes: `parseWidgetBlocks(text: string)`
- Produces: Multi-block rendering in chat bubbles with carousel/grid image gallery, lightbox, and data tables.

- [ ] **Step 1: Update `frontend/src/components/widgets/envelope.js` for multi-block parsing**

Implement `parseContentBlocks(text: string)`:
- Scans for all ```amethyst:widget ... ``` blocks in content.
- Returns array of blocks: `{ type: 'text', content: '...' }` or `{ type: 'widget', widget: { type: 'image_gallery', data: ... } }`.
- Preserves backwards compatibility for full-message widgets.

- [ ] **Step 2: Create `ImageGallery.jsx` component**

In `frontend/src/components/widgets/ImageGallery.jsx`:
- Supports `carousel` (horizontal scroll with next/prev buttons and dots) and `grid` layouts.
- Cards show high-res image, title, domain chip, and click-to-enlarge lightbox modal.
- Styled using Amethyst design system tokens (`--canvas`, `--surface-2`, `--border`, `--r-md`, `--accent`).

- [ ] **Step 3: Create `DataTable.jsx` component**

In `frontend/src/components/widgets/DataTable.jsx`:
- Responsive scrollable table with styled header, alternating rows, copy CSV button, and search filter.

- [ ] **Step 4: Update `WidgetRenderer.jsx` and `Chat.jsx`**

In `WidgetRenderer.jsx`:
- Register `image_gallery` -> `ImageGallery` and `data_table` -> `DataTable`.

In `Chat.jsx`:
- Parse messages into blocks using `parseContentBlocks(m.content)`.
- In `msg-assistant`, render blocks sequentially so prose and widgets seamlessly interleave:
  ```jsx
  {blocks.map((b, i) => b.type === 'widget' ? <WidgetRenderer key={i} widget={b.widget} /> : <ResponseArtifactBox key={i} text={b.content} ... />)}
  ```

- [ ] **Step 5: Build and test frontend**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(frontend): implement Component Registry with ImageGallery carousel and multi-block chat rendering"
```

---

### Task 7: Full System Verification

**Files:**
- Run backend test suite
- Run frontend build
- Test image search query end-to-end

- [ ] **Step 1: Run complete backend test suite for modified modules**

Run: `pytest tests/test_widgets.py tests/test_stream_resume.py tests/test_documents.py tests/test_router.py -v`
Expected: All tests pass (0 failures).

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build finishes cleanly.

- [ ] **Step 3: Verify no regression in running server**

Run: `curl -s http://127.0.0.1:8000/api/ping`
Expected: `{"status":"ok", ...}` or active status.

- [ ] **Step 4: Final commit and summary**

```bash
git commit --allow-empty -m "chore: complete resilience hardening and structured output pipeline"
```
