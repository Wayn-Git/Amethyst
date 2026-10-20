# Library Video Playback, Synthesis Accuracy & Modernized Command Deck Design Spec

**Date:** 2026-10-20  
**Status:** Approved for Implementation  
**Target Subsystems:** 
- `frontend/src/views/Library.jsx`
- `frontend/src/views/library/LibraryToolbar.jsx`
- `frontend/src/views/library/LibraryFilterBar.jsx`
- `frontend/src/views/library/LibraryCard.jsx`
- `frontend/src/views/library/LibraryGrid.jsx`
- `frontend/src/views/library/LibraryVideoPlayer.jsx`
- `frontend/src/views/library/LibraryDetailModal.jsx`
- `frontend/src/views/library/library.css`
- `backend/api/main.py`
- `backend/library/reels.py`
- `backend/library/enrich.py`
- `backend/library/service.py`

---

## 1. Overview & Problem Statement

Users of the Library section encounter 5 distinct issues spanning the media playback pipeline, background enrichment system, and visual presentation:

1. **Native Video Playback Failure (Bug 1):**  
   Saved videos (Instagram reels, TikTok, YouTube clips) fail to play natively in the app. Videos either fail to load because YouTube embed URLs are erroneously passed into HTML5 `<video src>` elements, or Instagram reels fall back to clumsy third-party iframe widgets because on-demand media streaming endpoints 404 or video files were unlinked after transcription.
2. **Analysis Notification Race, Link Extraction & Button Physics (Bug 2):**  
   - A premature "Ready" toast notification fires immediately (~1 second after adding an item) while Whisper speech-to-text and AI synthesis are still running in the background for ~2 minutes.
   - When a video references an open-source software repository (e.g. GitHub project), the LLM hallucinates a synthetic web domain (`repo-name.com`) instead of identifying it as a code repository.
   - Action buttons in the detail modal have unnatural ballooning hover/tap scaling (`scale: 1.05` hover, `scale: 0.92` tap) and inconsistent radiuses.
3. **Thumbnail Shortening & Aspect Ratio Distortion (Bug 3):**  
   Thumbnails in bento grid cards collapse into thin, horizontal 30px slits (letterbox cutoffs). The bento grid sets `grid-auto-rows: minmax(185px, auto)` with cards forced to `height: 100%`, while card body content requires ~160px, squeezing the media wrapper to a sliver.
4. **Typography & Scale Inconsistencies (Bug 4):**  
   Date headers mix heavy bold sans with mismatched faint mono item counts; card footers pair small timestamps with raw, unpadded `★Essential` text; card titles and summaries lack comfortable readability and scale.
5. **Top Part Header Clutter (Bug 5):**  
   The top controls are split across visually heavy, conflicting tiers: an overloaded Omnibar with an awkward embedded sort selector, disconnected square icon buttons, mismatched heights, and crowded badge pills.

---

## 2. Architectural Design & Solutions

### 2.1 Native Video Playback Pipeline (Bug 1)

#### Backend Streaming & Retention
1. **Unrestricted Media Endpoint (`backend/api/main.py`):**
   - In `/api/library/{item_id}/media`:
     - Check disk for existing media candidates (`.mp4`, `.webm`, `.mov`, `.mkv`).
     - Remove the restrictive `if row.get("kind") in ("video", "podcast", "music"):` clause so that Instagram reels, TikToks, and posts with video attachments can trigger on-demand downloading via `yt_dlp` if the file is not yet cached.
     - Support HTTP Range requests (`Accept-Ranges: bytes`) for smooth seeking, scrubber control, and native playback in WebKit/Blink.
2. **Reel Persistence (`backend/library/reels.py`):**
   - Ensure `video_path` moved into `media_path(item_id, ".mp4")` is permanently preserved in library storage whenever `settings.keep_video` is enabled (default `True`).
   - Store `"type": "video", "name": "Video", "url": f"/api/library/{item_id}/media"` as the primary resource in `library_items.resources`.

#### Frontend Player Separation (`LibraryVideoPlayer.jsx` & `LibraryDetailModal.jsx`)
1. **Direct Video vs Embed Isolation:**
   - When an item is a YouTube video (`youtubeEmbedUrl` is detected), render the responsive YouTube iframe player directly. Never mount an HTML5 `<video src>` pointing to an embed URL.
   - When an item is an uploaded/captured video, Reel, TikTok, or direct video file, mount the native `<video>` tag pointing to `/api/library/{item.id}/media`.
2. **Custom Native Controls:**
   - Apple-tier frosted glass control island: Play/Pause, timeline scrubber with buffered progress bar, time readout (`current / duration`), mute/volume toggle, and fullscreen trigger.
   - Clean keyboard shortcuts: `Space`/`k` to play/pause, `Left`/`Right` to seek 5s, `m` to mute, `f` for fullscreen.

---

### 2.2 Background Analysis, Notification Timing, Link Accuracy & Button Physics (Bug 2)

#### Notification Timing Fix (`Library.jsx`)
1. An item captured in the background remains in `status: "enriching"` or `status: "processing"` throughout its duration.
2. In `Library.jsx` polling:
   - `isDone` will only evaluate to `true` when `updated.status === 'ready'` **AND** (`updated.summary` or `updated.enriched_at` exists), or when `updated.status === 'failed'`.
   - The toast `"Ready: <title>"` will only fire once AI processing is truly complete.

#### Code Repository & Link Accuracy (`backend/library/enrich.py`)
1. **Enrichment Prompt Engineering:**
   - Update `PROMPT` with explicit instructions:
     * When content discusses software, codebases, open-source libraries, or developer tools, classify it as `type: "repo"` or `"tool"`.
     * Extract the exact GitHub project (`https://github.com/<owner>/<repo>` or `https://github.com/search?q=<name>`) instead of generating synthetic websites (`foo.com`).
2. **Authority Link Resolver (`resolve_entity_url` & `_clean_resource`):**
   - Detect repository terms (`repo`, `repository`, `github`, `codebase`, `package`, `crate`) and resolve them to `https://github.com/search?q={query}` instead of a generic domain guess or Google search.
3. **Synthesis Density:**
   - Enforce high-signal, technical summaries: core architectural takeaways, tools used, and concrete insights; strictly ban meta-commentary ("In this video the creator discusses...").

#### Button Physics & Styling (`LibraryDetailModal.jsx` & `library.css`)
1. Eliminate `whileHover={{ scale: 1.05 }}` and `whileTap={{ scale: 0.92 }}`.
2. Standardize on Emil Kowalski haptic interaction:
   - Hover: subtle background/border brightening in `130ms cubic-bezier(0.16, 1, 0.3, 1)`.
   - Active: `transform: scale(0.97)` on click.
3. Replace raw `{act.label} ↗` string with structured "Island" buttons featuring nested circular icon wrappers (`high-end-visual-design` spec).

---

### 2.3 Thumbnail Geometry & Aspect Ratio (Bug 3)

#### Grid & Card Math (`library.css` & `LibraryGrid.jsx`)
1. **Strict Flex Non-Shrink:**
   ```css
   .lib-card-media-wrap,
   .lib-card-media {
     flex-shrink: 0 !important;
     width: 100%;
   }
   ```
2. **Explicit Media Dimensions:**
   - **Portrait (9:16 - Reels, TikTok, Shorts):** `aspect-ratio: 9 / 16; min-height: 280px; max-height: 380px; width: 100%;`
   - **Square (1:1 - Carousels, Photo posts):** `aspect-ratio: 1 / 1; min-height: 200px; max-height: 240px; width: 100%;`
   - **Landscape & Standard (16:9 - YouTube, Articles):** `aspect-ratio: 16 / 9; min-height: 170px; max-height: 210px; width: 100%;`
3. **Bento Grid Row Heights:**
   - Update `.lib-bento-grid` from `minmax(185px, auto)` to `minmax(290px, auto)` on desktop, allowing vertical card content to flow naturally below the media without clipping.

---

### 2.4 Typography Harmonization & Font Sizing (Bug 4)

#### Tokens & Type Scale (`AGENTS.md` Compliance)
1. **Date Group Headers:**
   - Date text: 16px Inter (`--font-sans`), medium weight (500), tracking `-0.015em`, color `--text`.
   - Item count: Geist Mono (`--font-mono`), 11px, `--text-dim`, enclosed in a pill badge (`--surface-2`, 1px `--hairline`).
2. **Card Content Scale:**
   - Titles: Bumped to 15.5px (`--text-input` token), semibold (600), line-height 1.35, tracking `-0.015em`.
   - Summaries: Scaled to 13.5px, line-height 1.55, color `--text-dim`.
3. **Essential Rating Badge (`★Essential`):**
   - Redesigned into a luminous capsule pill:
     `display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.28); font-size: 11px; font-weight: 600;`.

---

### 2.5 Streamlined Two-Row Command Deck (Bug 5)

#### Row 1: Command Bar (38px Unified Height)
- **Left:** Title `Library` (22px bold sans) + clean artifact count chip (`242 items`).
- **Center:** Omnibar (38px height, rounded-full pill capsule, `--surface` background, 1px `--hairline`):
  - Left: Search / Link icon.
  - Input: `Search library or paste URL... (Ctrl+/)`.
  - Right: Shortcut `<kbd>Ctrl+/</kbd>`.
- **Right Controls:**
  - **Sort Capsule:** Standalone pill button (`Newest ▾`) placed beside search (not crammed inside input).
  - **View Toggle:** Segmented capsule with Grid (`⊞`) and List (`☰`) icons (38px height).
  - **Tool Actions:** Export Playlist & Integrations modal triggers.
  - **Primary CTA:** `+ Add` button (38px height, rounded-full pill, `--accent` purple fill, white text, subtle `<kbd>Ctrl+K</kbd>`).

#### Row 2: Filter Deck (32px Unified Height)
- **Left (Format Filter Pills):**
  - Horizontal pill track: `[All 242]` `[Videos 121]` `[Articles 103]` `[Posts 12]` `[Notes 4]`.
  - Active state: Clean contrast background + 130ms `--ease-out` transition.
- **Right (Curator Filters):**
  - `[★ Essential 1]` (amber pill toggle).
  - `[Filters ▾]` (secondary filter popover button with active badge count).

---

## 3. Verification Plan

### Automated & Manual Verification
1. **Video Playback Test:**
   - Open an Instagram reel and a YouTube video in the Library detail view. Verify that the reel plays natively via HTML5 `<video>` without fallback to an Instagram iframe embed, and YouTube plays cleanly in its player.
2. **Analysis Notification & Link Test:**
   - Add a test resource. Verify that "Ready" notification only appears once AI transcription/synthesis completes.
   - Verify that mentioned code repositories generate `github.com` URLs instead of generic `.com` domains.
3. **Thumbnail Sizing Verification:**
   - Inspect the bento grid with 4+ items. Verify that thumbnails render with full aspect ratio (no 30px horizontal slits).
4. **Typography & Styling Audit:**
   - Check date headers, card titles, and `★Essential` pill badge across light and dark themes. Verify font sizes, contrast, and alignment.
5. **Top Bar Regression Test:**
   - Verify search, quick URL capture, sort dropdown, view toggle, and filter pills function with responsive layouts across desktop and mobile.
