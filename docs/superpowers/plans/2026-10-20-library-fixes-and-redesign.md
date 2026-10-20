# Library Video Playback, Synthesis Accuracy & Modernized Command Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix video native playback, analysis notification timing, code repository link accuracy, thumbnail aspect ratio compression, typography inconsistencies, and modernize the top header into a streamlined two-row command deck.

**Architecture:** 
- Backend: Update `/api/library/{item_id}/media` streaming endpoint to allow on-demand downloads for all video kinds, retain reel MP4 files on disk in `backend/library/reels.py`, and enhance `backend/library/enrich.py` to accurately recognize GitHub repositories and extract concrete technical synthesis.
- Frontend: Fix `Library.jsx` polling to prevent premature "Ready" notifications; isolate HTML5 `<video>` from iframe embeds in `LibraryVideoPlayer.jsx`; fix bento grid and card flex layout to prevent thumbnail squishing in `library.css` & `LibraryGrid.jsx`; align typography with Kraken design tokens in `LibraryCard.jsx`; standardize button physics with Emil Kowalski haptics in `LibraryDetailModal.jsx`; and build a streamlined two-row command bar in `LibraryToolbar.jsx` and `LibraryFilterBar.jsx`.

**Tech Stack:** Python 3.12 (FastAPI, yt-dlp, ffmpeg), React 19, Framer Motion, Vanilla CSS (Amethyst Kraken design tokens), Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-10-20-library-fixes-and-redesign-design.md`

## Global Constraints

- Never hardcode pixel font sizes; adhere to scaled tokens (`--text-caption`, `--text-input`, `--text-body`, `--text-heading`).
- Buttons and capsules must use `--radius-buttons: 9999px` (capsules), not arbitrary 12px or 6px radiuses.
- Button interactions must adhere to Emil Kowalski guidelines: sub-140ms ease-out transitions, `active:scale(0.97)` press physics, strictly no `scale(1.05)` ballooning.
- Semantic colors only: `--accent`, `--surface`, `--surface-2`, `--hairline`, `--text`, `--text-dim`, `--live`, `--confirm`, `--stop`.
- Python code must conform to ruff/lint standards and pass existing library test suites.

## Review Focus

1. **Missing or Corrupted Video Files:** `/api/library/{id}/media` returns HTTP 404 if a video is unavailable; frontend must show a clear, friendly recovery action rather than crashing or infinitely buffering.
2. **Instagram Reels with Multiple Slides/Video:** Items captured with `kind: "post"` that contain video attachments must stream natively through `/api/library/{id}/media`.
3. **Repository URL Formatting:** An open-source project named in speech or text (e.g. `fastapi` or `vllm-project/vllm`) must resolve to a valid GitHub search or repository URL (`https://github.com/...`), not a hallucinated `.com` domain.
4. **Bento Card Flex Compression:** When text content in a card has long titles, summaries, and multiple tags, the thumbnail must maintain its minimum aspect ratio and never squish below its defined height.
5. **Theme Switching on Top Bar:** The new two-row command deck and filter bar must render seamlessly across both dark and light theme modes without hardcoded background hexes.

---

### Task 1: Backend Video Streaming Endpoint & Reel Retention (Bug 1)

**Files:**
- Modify: `backend/api/main.py:7404-7499`
- Modify: `backend/library/reels.py:110-125, 360-385`
- Test: `tests/test_library_media_streaming.py`

**Interfaces:**
- Consumes: `LibraryStore.get(item_id)`, `media_path(item_id, ext)`
- Produces: Streaming `FileResponse` supporting HTTP Range requests on `/api/library/{item_id}/media` for all video formats.

- [ ] **Step 1: Write the failing test for `/api/library/{item_id}/media` with `kind="post"` and on-demand streaming**

```python
import pytest
from fastapi.testclient import TestClient
from backend.api.main import app

def test_library_media_allows_social_video_kinds(monkeypatch, tmp_path):
    client = TestClient(app)
    # create test library item with kind="post" but with a video resource or media_path
    # verify that media endpoint does not raise 404 purely due to kind != "video"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_media_streaming.py -v`  
Expected: FAIL

- [ ] **Step 3: Update `library_media` in `backend/api/main.py` and reel retention in `backend/library/reels.py`**

1. In `backend/api/main.py`: remove `row.get("kind") in ("video", "podcast", "music")` restriction so any URL or item with a video resource triggers on-demand `yt_dlp` extraction if media is missing. Ensure headers support streaming.
2. In `backend/library/reels.py`: ensure `reel.video_path` moved into `media_path(item_id, ".mp4")` is preserved and not unlinked in `_process_video`. Ensure `resources` contains `{"type": "video", "name": "Video", "url": f"/api/library/{item_id}/media"}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_media_streaming.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py backend/library/reels.py tests/test_library_media_streaming.py
git commit -m "fix(library): enable native video streaming and preserve reel media"
```

---

### Task 2: Frontend Native Video Player Isolation & Controls (Bug 1)

**Files:**
- Modify: `frontend/src/views/library/LibraryVideoPlayer.jsx:1-240`
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx:480-560, 1115-1135`

**Interfaces:**
- Consumes: `/api/library/{item.id}/media`, YouTube embed URLs, item resources.
- Produces: Isolated native HTML5 `<video>` player for direct files and streamable social videos, and distinct iframe container for YouTube.

- [ ] **Step 1: Update `LibraryDetailModal.jsx` media resolution**

In `LibraryDetailModal.jsx`:
- Distinguish `isYouTube` vs `hasNativeVideo`.
- If `youtubeEmbedUrl` is detected, pass `isYouTube={true}` and `embedUrl={youtubeEmbedUrl}`.
- If native video exists, pass `src={api.mediaUrl(item.id)}`. Never pass a YouTube embed URL to `src` of `<video>`.

- [ ] **Step 2: Refactor `LibraryVideoPlayer.jsx` to cleanly separate YouTube from native video**

In `LibraryVideoPlayer.jsx`:
- If `isYouTube` or `showEmbed && embedUrl`: render clean responsive iframe wrapper.
- Otherwise, render direct HTML5 `<video>` with custom frosted glass controls, error boundary, and retry button if streaming fails.
- Fix controls auto-hide and keyboard shortcuts (`Space`/`k`, `Left`/`Right` seek, `m` mute, `f` fullscreen).

- [ ] **Step 3: Verify video player in browser**

Open a video item in the library detail modal. Ensure native video plays with custom controls and does not fall back to third-party embed iframes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryVideoPlayer.jsx frontend/src/views/library/LibraryDetailModal.jsx
git commit -m "fix(library): isolate native html5 video player from youtube iframe embed"
```

---

### Task 3: Background Analysis Notification Timing & Link/Repo Accuracy (Bug 2)

**Files:**
- Modify: `frontend/src/views/Library.jsx:189-235, 290-310`
- Modify: `backend/library/enrich.py:278-360, 590-660`
- Test: `tests/test_library_repo_enrichment.py`

**Interfaces:**
- Consumes: `api.libraryItem(id)`, LLM response payload.
- Produces: Accurate GitHub repository links (`type: "repo"`), high-signal technical synthesis, and notification trigger only upon true completion.

- [ ] **Step 1: Write test for repository resolution in `enrich.py`**

```python
from backend.library.enrich import parse_enrichment, resolve_entity_url, _clean_resource

def test_resolve_entity_url_detects_github_repo():
    url = resolve_entity_url("vllm-project/vllm", "repo")
    assert "github.com" in url

def test_clean_resource_normalizes_repository():
    raw = {"name": "vLLM", "type": "repo", "url": "https://github.com/vllm-project/vllm"}
    cleaned = _clean_resource(raw)
    assert cleaned["type"] == "repo"
    assert "github.com/vllm-project/vllm" in cleaned["url"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_repo_enrichment.py -v`  
Expected: FAIL

- [ ] **Step 3: Update `backend/library/enrich.py` and `frontend/src/views/Library.jsx`**

1. In `backend/library/enrich.py`:
   - Update `PROMPT` with explicit instructions for open-source repositories: detect software libraries, repos, or developer tools as `type: "repo"` or `"tool"`. Extract `github.com/<owner>/<repo>` or fallback to `https://github.com/search?q=<name>`.
   - Update `resolve_entity_url` and `_clean_resource` to map repository terms to GitHub URLs rather than fictitious `.com` domains.
   - Refine synthesis instructions to emphasize concrete architectural and technical takeaways.
2. In `frontend/src/views/Library.jsx`:
   - In active processing poll (line 204): change `isDone` check to require `updated.status === 'ready' && (Boolean(updated.enriched_at) || Boolean(updated.summary))` or `updated.status === 'failed'`.
   - Only fire `toast('Ready: ' + updated.title)` when processing and enrichment have completely finished.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_repo_enrichment.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/enrich.py frontend/src/views/Library.jsx tests/test_library_repo_enrichment.py
git commit -m "fix(library): resolve premature ready notifications and enhance repo link extraction"
```

---

### Task 4: Card Thumbnail Geometry & Bento Grid Math (Bug 3)

**Files:**
- Modify: `frontend/src/views/library/library.css:1210-1255, 1355-1410, 1470-1530`
- Modify: `frontend/src/views/library/LibraryGrid.jsx:6-100`

**Interfaces:**
- Consumes: Item metadata (app, kind, aspect ratio indicators).
- Produces: Solid non-collapsing card thumbnails with full aspect ratio in bento grid.

- [ ] **Step 1: Update `library.css` media flex non-shrink and dimensions**

In `frontend/src/views/library/library.css`:
- Add `flex-shrink: 0 !important;` to `.lib-card-media-wrap` and `.lib-card-media`.
- Set explicit heights and aspect ratios:
  * Portrait: `aspect-ratio: 9 / 16; min-height: 280px; max-height: 380px;`
  * Square: `aspect-ratio: 1 / 1; min-height: 200px; max-height: 240px;`
  * Landscape / Standard: `aspect-ratio: 16 / 9; min-height: 170px; max-height: 210px;`
- Update `.lib-bento-grid` `grid-auto-rows` from `185px` to `minmax(290px, auto)` to give cards adequate height.

- [ ] **Step 2: Update `LibraryGrid.jsx` bento item configuration**

In `frontend/src/views/library/LibraryGrid.jsx`:
- Ensure Instagram Reels and vertical social media items are correctly marked as `variant: 'portrait'` with `row-span-2`.
- Ensure standard items have appropriate row and column spans without crushing card bodies.

- [ ] **Step 3: Visual check of bento grid cards**

Inspect the library grid with 4+ items. Verify thumbnails show full images and are never squished into 30px horizontal slits.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/library.css frontend/src/views/library/LibraryGrid.jsx
git commit -m "fix(library): enforce media flex-shrink and update bento grid row math to prevent thumbnail squishing"
```

---

### Task 5: Typography Scale Harmonization & Button Haptic Physics (Bugs 2 & 4)

**Files:**
- Modify: `frontend/src/views/library/LibraryCard.jsx:440-565`
- Modify: `frontend/src/views/library/LibraryGrid.jsx:120-135`
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx:1590-1615, 1920-1970`
- Modify: `frontend/src/views/library/library.css:1260-1320, 1540-1630, 2835-2865, 4490-4530`

**Interfaces:**
- Consumes: Amethyst Kraken design tokens (`index.css`), Emil Kowalski interaction specs.
- Produces: Harmonious typography hierarchy, luminous `★Essential` pill badge, and natural button press physics.

- [ ] **Step 1: Harmonize typography in `LibraryCard.jsx` and `library.css`**

- Scale card titles from 14px to 15.5px (`--text-input` token), semibold 600, line-height 1.35, tracking `-0.015em`.
- Scale summaries to 13.5px, line-height 1.55, `--text-dim`.
- Align date headers in `LibraryGrid.jsx`: 16px medium font for date, with a subtle pill badge for item count (`font-size: 11px`, `--font-mono`).
- Convert `★Essential` rating indicator into a luminous capsule pill (`rgba(245, 158, 11, 0.12)` background, `#f59e0b` text, `border-radius: 9999px`, `font-size: 11px`, `font-weight: 600`).

- [ ] **Step 2: Standardize button haptic physics in `LibraryDetailModal.jsx` and `library.css`**

- Replace all `whileHover={{ scale: 1.05 }}` and `whileTap={{ scale: 0.92 }}` with Emil Kowalski standard physics (`transform: scale(0.97)` on active, `130ms` `--ease-out` hover).
- Standardize button border-radiuses to pill geometry (`--radius-buttons: 9999px` or `--radius-cards: 6px` per token rules).
- Style action pills with nested circular icon wrappers.

- [ ] **Step 3: Visual check of typography and buttons**

Inspect card footer, date headings, and detail modal synthesis action buttons. Verify clean font sizes and natural click feel.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryCard.jsx frontend/src/views/library/LibraryGrid.jsx frontend/src/views/library/LibraryDetailModal.jsx frontend/src/views/library/library.css
git commit -m "fix(library): harmonize typography hierarchy, add essential pill badge, and normalize button physics"
```

---

### Task 6: Modernized Streamlined Two-Row Command Deck (Bug 5)

**Files:**
- Modify: `frontend/src/views/library/LibraryToolbar.jsx:1-248`
- Modify: `frontend/src/views/library/LibraryFilterBar.jsx:1-150`
- Modify: `frontend/src/views/library/library.css:45-180, 200-350`

**Interfaces:**
- Consumes: Search query, sort order, layout mode, filter counts, category/tag selections.
- Produces: Unified 38px command bar (Row 1) and fluid 32px format filter bar (Row 2).

- [ ] **Step 1: Redesign `LibraryToolbar.jsx` (Row 1 - Command Bar)**

In `LibraryToolbar.jsx`:
- Left: `Library` title (22px bold sans) + minimal item count chip (`242 items`).
- Center: Unified 38px Omnibar pill capsule with search icon, clean placeholder, and `<kbd>Ctrl+/</kbd>` hint. Remove awkward internal pipe divider and embedded sort dropdown.
- Right:
  * Standalone sort pill button (`Newest ▾` / `Oldest ▾`) beside search.
  * Segmented layout switch: Bento (`⊞`) and Stream (`☰`) in unified 38px pill.
  * Secondary tool buttons (Playlist Export, Integrations) in matching 38px pills.
  * Primary `+ Add` button (38px pill capsule, `--accent` purple fill, white text, subtle `<kbd>Ctrl+K</kbd>`).

- [ ] **Step 2: Redesign `LibraryFilterBar.jsx` (Row 2 - Filter Deck)**

In `LibraryFilterBar.jsx`:
- Left: Clean horizontal format filter pills: `[All 242]` `[Videos 121]` `[Articles 103]` `[Posts 12]` `[Notes 4]`.
  Height: 32px, rounded-full pills (`--radius-buttons: 9999px`), active contrast state with 130ms `--ease-out` transition.
- Right:
  * `[★ Essential 1]` amber curator toggle.
  * `[Filters ▾]` secondary filter dropdown with active count badge.

- [ ] **Step 3: Update CSS styling and responsiveness in `library.css`**

- Unify all heights to exact tokens (38px Row 1, 32px Row 2).
- Apply `--surface`, `--surface-2`, `--hairline` tokens cleanly.
- Ensure responsive behavior on mobile (stacking or horizontal scroll track without overflow).

- [ ] **Step 4: Verify header in browser**

Verify the two-row bar across search input, quick capture, sort toggle, view switch, filter pills, and add modal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/library/LibraryToolbar.jsx frontend/src/views/library/LibraryFilterBar.jsx frontend/src/views/library/library.css
git commit -m "feat(library): modernize header into streamlined two-row command deck"
```

---

### Task 7: End-to-End Verification & Full Regression Testing

**Files:**
- Modify: (Any regression fixes across touched files)

**Interfaces:**
- Full system verification across backend video streaming, enrichment, thumbnail rendering, typography, and top deck.

- [ ] **Step 1: Run Python test suite**

Run: `pytest tests/test_library*.py -v`  
Expected: PASS with 0 failures.

- [ ] **Step 2: Run frontend build / lint check**

Run: `npm --prefix frontend run build` (or `npx vite build --config frontend/vite.config.js`)  
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Live Verification in Browser**

Verify with running local server:
1. Video plays natively with custom controls.
2. Link capture triggers background processing without premature "Ready" toast.
3. Code repositories resolve to authentic GitHub links.
4. Thumbnails display full aspect ratio without horizontal 30px squishing.
5. Typography and `★Essential` badge render with consistent sizing.
6. Top command bar is clean, consistent (38px/32px), and easy on the eyes.

- [ ] **Step 4: Final commit and cleanup**

```bash
git commit -m "chore(library): finalize verification and clean up polish fixes"
```
