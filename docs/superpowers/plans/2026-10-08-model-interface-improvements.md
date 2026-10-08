# Model Interface Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix model stream post-turn failure and startup retrieval latency, update UI typography to Satoshi and AI chat text to Inter with ChatGPT/Claude-like sizing, implement a multi-image carousel with interactive lightbox, and add an Appearance setting to switch thinking style between Cards and Tool Chips.

**Architecture:**
- Backend: Isolate post-turn memory extraction/summary in `backend/agent/director.py` with fail-soft boundaries, and tighten retrieval timeouts so embedder latency cannot block turn start.
- Frontend Typography: Load Satoshi and Plus Jakarta Sans for UI elements, bind Inter at 16px/1.7 line-height to chat response prose.
- Media Experience: Transform markdown image galleries into horizontal scroll strips and upgrade the lightbox modal into a keyboard-navigable carousel.
- Appearance & Traces: Add `thinkingStyle` setting in `store.jsx` and `Settings.jsx`, with `TurnTrace.jsx` conditionally rendering a new `ToolChipsTrace` component inspired by `tool-chips.md` and `thinking.md`.

**Tech Stack:** Python 3.11 (FastAPI/asyncio), React 18, Vite, CSS variables/Tailwind tokens.

**Spec:** Direct user requirements and approved Round 1 grilling decisions.

## Global Constraints
- Preserve all existing comments and docstrings.
- Follow the design system rules in `AGENTS.md` and `frontend/src/index.css`.
- Ensure dark/light mode compatibility across all new components.
- Never let background or post-turn tasks throw errors that invalidate an already completed turn.

## Review Focus
1. Provider stream disconnect during background memory extraction does not show `The model stream was interrupted by the provider` to the user.
2. Embedder offline/slow does not delay turn startup beyond 400ms.
3. Chat response prose uses Inter 16px with 1.7 line height across all themes.
4. Galleries with 4+ images allow smooth horizontal scroll and lightbox carousel cycles correctly across all items.
5. Toggling thinking style in Appearance instantly switches between Card mode and Tool Chips mode without reload.

---

### Task 1: Backend Turn Stream Stability & Retrieval Latency Guard

**Files:**
- Modify: `backend/agent/director.py`
- Modify: `backend/retrieval/search.py`
- Test: `tests/agent/test_director.py` or `pytest backend/tests`

**Interfaces:**
- Consumes: `director.py:_run_turn_inner`, `director.py:_remember`, `director.py:_retrieve`
- Produces: Fail-safe post-turn memory extraction and fast-timeout retrieval.

- [ ] **Step 1: Write unit test verifying post-turn error does not fail turn**
Test that an exception in `_remember` after `done` event does not yield an `error` event.

- [ ] **Step 2: Run test to verify failure or baseline**
Run: `pytest tests/ -k test_director`

- [ ] **Step 3: Modify `director.py` to isolate post-turn execution**
In `director.py` lines 2195-2206:
Wrap `_remember` iteration and `_refresh_summary` in `try...except Exception as exc: log.warning(...)` so exceptions after `done` cannot escape to `_run_turn` outer exception handler.
In `director.py:_retrieve`: Reduce retrieval timeout from 1.2s to 0.4s to prevent note search stalls.

- [ ] **Step 4: Run test to verify pass**
Run: `pytest tests/ -k test_director`

---

### Task 2: Typography System Update (Satoshi + Inter)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: Fontshare CDN for Satoshi, Google Fonts for Plus Jakarta Sans & Inter
- Produces: `--font-sans`, `--font-display`, `--font-chat-prose` tokens

- [ ] **Step 1: Update `frontend/index.html` font links**
Include Satoshi font stylesheet from Fontshare and ensure Plus Jakarta Sans and Inter are loaded.

- [ ] **Step 2: Update CSS font tokens in `frontend/src/index.css`**
Set `--font-sans`, `--font-display`, and `--font-body` to prioritize `'Satoshi', 'Plus Jakarta Sans', system-ui, sans-serif`.
Define `--font-chat-prose: 'Inter', system-ui, -apple-system, sans-serif;`.

- [ ] **Step 3: Verify build**
Run: `npm --prefix frontend run build`

---

### Task 3: AI Response Typography & Spacing (ChatGPT/Claude Parity)

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/ResponseArtifactBox.jsx`

**Interfaces:**
- Consumes: `--font-chat-prose`
- Produces: Enhanced `.chat-assistant-prose`, `.md-p`, `.md-list`, headings styling

- [ ] **Step 1: Update `.chat-assistant-prose` and Markdown styles in `frontend/src/index.css`**
Set `.chat-assistant-prose`:
- `font-family: var(--font-chat-prose);`
- `font-size: 16px;`
- `line-height: 1.7;`
- `letter-spacing: -0.011em;`
Adjust `.md-p` and list item margin-bottom to 16px to match natural reading rhythm.

- [ ] **Step 2: Verify responsive rendering and typography hierarchy**
Check styling rules in `index.css` to ensure no conflicting font overrides.

---

### Task 4: Image Multi-View Scroll Strip & Lightbox Carousel

**Files:**
- Modify: `frontend/src/components/markdown/Markdown.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: Markdown AST image arrays
- Produces: Horizontal snap-scroll image gallery and full modal carousel with prev/next/arrow keys

- [ ] **Step 1: Update `ImageGallery` in `Markdown.jsx`**
Allow rendering all images (removing `slice(0, 3)` limit). If `items.length > 1`, render horizontal scrollable container with smooth scrolling, navigation buttons, and counter badge.

- [ ] **Step 2: Upgrade `ImageLightbox` in `Markdown.jsx` to a carousel**
Add `currentIndex`, `onPrev`, `onNext`, and keyboard event listener (`ArrowLeft`, `ArrowRight`, `Escape`).
Render active image with counter (`i + 1 of N`), prev/next chevron buttons, and thumbnail track.

- [ ] **Step 3: Add CSS for gallery strip and lightbox carousel in `frontend/src/index.css`**
Add styles for `.md-gallery-scroll`, `.md-lightbox-nav`, and `.md-lightbox-counter`.

---

### Task 5: Thinking & Tool Execution Style (Appearance Switch)

**Files:**
- Create: `frontend/src/components/ToolChipsTrace.jsx`
- Modify: `frontend/src/store.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/components/TurnTrace.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `UIInspirations/components/tool-chips.md`, `UIInspirations/components/thinking.md`
- Produces: `settings.thinkingStyle` ('cards' | 'chips') and `ToolChipsTrace` component

- [ ] **Step 1: Add `thinkingStyle` state to `frontend/src/store.jsx`**
Default to `'cards'`. Persist to `localStorage.getItem('amethyst:thinking-style')`.
Add `setThinkingStyle` action and expose via store.

- [ ] **Step 2: Add Appearance UI in `frontend/src/views/Settings.jsx`**
In the Appearance view, add a segmented control or dropdown for "Thinking & Tool Display":
- `Cards (Detailed)`
- `Tool Chips (Compact)`

- [ ] **Step 3: Create `frontend/src/components/ToolChipsTrace.jsx`**
Adapt `UIInspirations/components/tool-chips.md` and `UIInspirations/components/thinking.md` to accept dynamic `events`, `reasoning`, and `live` props from Amethyst turns.

- [ ] **Step 4: Update `frontend/src/components/TurnTrace.jsx`**
Read `thinkingStyle` from store. If `'chips'`, render `ToolChipsTrace`; otherwise render existing `AgentRun`.

- [ ] **Step 5: Verify build and test all modes**
Run: `npm --prefix frontend run build`
