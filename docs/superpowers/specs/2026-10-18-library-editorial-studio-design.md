# Library Context Scanning & Editorial Studio Design Spec

**Date:** 2026-10-18  
**Status:** Approved for Implementation  
**Target Subsystems:** `backend/library/`, `frontend/src/views/library/`

---

## 1. Overview & Problem Statement

Amethyst's library view currently suffers from two distinct problems:

1. **LLM Context Extraction Failure:**  
   The current enrichment prompt in `backend/library/enrich.py` performs generic paragraph summarization and loose resource extraction. For rich media (e.g. short films, comedy reels, podcasts, product launches), the model frequently latches onto illustrative jokes or passing cultural references (e.g. jokes referencing *Step Brothers* or *The Bourne Identity*) rather than identifying the primary entity (e.g. the film *Remain Calm*, director Jake Lewis, the cast, runtime, release date, and TMDB/IMDb ratings).

2. **Visual & Interaction Clutter:**  
   The detail studio currently displays 12+ tiny, eye-straining micro-buttons (model selectors, star ratings, copy, regenerate, lightbox, re-index, re-analyze, delete) inside nested, dark, heavy containers. The outer library cards also suffer from micro-icon button clusters in card headers. The view feels like an IDE debugger rather than an intentional, calm, spacious editorial collection.

This specification defines an **entity-first context extraction pipeline** in the backend and an **editorial, spacious UI layout** in the frontend, universal across all content platforms.

---

## 2. Goals & Non-Goals

### Goals
- **Entity-First Context Extraction:** The LLM reliably identifies the true core subject of any item and extracts a structured, domain-adaptive entity schema (Title, Subtitle, Category, Synopsis, Action CTAs, and Domain Attributes).
- **Spacious Editorial Studio Layout:** A serene, high-breathing-room two-column presentation:
  - **Left:** Floating framed media card with flush player/slides, unobtrusive pagination, creator attribution (`@handle` + `Open ↗`), and expandable caption preview.
  - **Right:** High typographic contrast, clear subtitle, rating pill badge, readable narrative synopsis, two prominent pill CTAs (e.g. `▶ Watch trailer ↗`, `Open details ↗`), a clean two-column spec table, and a unified `Yours` curation card.
- **De-cluttering & Overflow Menu:** Relocate maintenance and developer actions (Re-index, Re-analyze, Model selection, Raw JSON, Delete) to a clean `···` overflow menu in the top bar.
- **Card Grid Simplification:** Remove tiny action buttons from the headers of `LibraryCard.jsx` to reduce visual noise in the bento grid.
- **Universal Cross-Platform Support:** Works consistently across Instagram, YouTube, TikTok, GitHub, X/Twitter, Reddit, Spotify, Substack, ArXiv, and personal notes.
- **Strict Token & Theme Compliance:** Complies with Kraken design tokens (`index.css`), `AGENTS.md`, and light/dark theme modes.

### Non-Goals
- Mandatory third-party API keys (e.g. requiring TMDB or Goodreads API accounts); the LLM produces the structured metadata directly from source text and its internal knowledge base.
- Breaking database migrations; schema extensions must be backward-compatible with existing SQLite rows.

---

## 3. Backend Architecture & Schema

### 3.1 Domain-Adaptive Entity Schema
The enrichment prompt in `backend/library/enrich.py` is upgraded to return a first-class `entity` object:

```json
{
  "category": "movie",
  "summary": "...",
  "tags": ["cinema", "comedy", "thriller"],
  "entity": {
    "title": "Remain Calm",
    "subtitle": "Jake Lewis · Horror Comedy",
    "rating": "10.0/10 TMDB",
    "synopsis": "A horror-comedy film where a creature preys on people who show fear or anxiety, forcing protagonists to maintain a facade of happiness to survive.",
    "actions": [
      { "label": "Watch trailer", "url": "https://...", "kind": "trailer" },
      { "label": "Open details", "url": "https://...", "kind": "details" }
    ],
    "attributes": {
      "Genre": "Horror Comedy",
      "Rating": "10.0/10 TMDB",
      "Cast": "Pauly Shore, Nick Swardson, Doug Jones, Kevin Keppy",
      "Creator": "Jake Lewis",
      "Runtime": "13 min",
      "Released": "13 Oct 2026"
    }
  },
  "resources": [ ... ]
}
```

### 3.2 Domain Attribute Mappings

| Domain Category | Primary Attributes | Primary Action CTAs |
| :--- | :--- | :--- |
| **Cinema / Video** | `Genre`, `Rating`, `Cast`, `Creator` (or Director), `Runtime`, `Released` | `Watch trailer`, `Open details` |
| **Tools & Code** | `Category`, `Creator / Team`, `Platforms`, `License / Pricing`, `Released` | `Visit website`, `View repository` |
| **Books & Reading** | `Author`, `Genre`, `Publisher`, `Pages / Length`, `Published` | `Read book / paper`, `Goodreads / DOI` |
| **Music & Podcasts** | `Artist / Host`, `Album / Series`, `Genre`, `Duration`, `Released` | `Listen on Spotify`, `Open show` |
| **Food & Travel** | `Location / City`, `Cuisine / Category`, `Best For`, `Hours / Season` | `View on Maps`, `Open guide` |
| **General / Notes** | `Source`, `Author`, `Captured On`, `Topic` | `Open original link` |

### 3.3 Database Storage & Persistence (`store.py` & `service.py`)
1. **Column Extension:** Add `entity TEXT` to `library_items` via `LibraryStore._ensure_columns()` using standard `ALTER TABLE library_items ADD COLUMN entity TEXT` guarded against existing column errors.
2. **Updatable Fields:** Include `"entity"` in `_UPDATABLE` set in `store.py`.
3. **Serialization:** `as_dict(row)` in `service.py` deserializes `entity` from JSON string into a Python dictionary.
4. **Enrichment Handler:** `service.enrich()` stores `result.entity` directly in the database.

---

## 4. Frontend UI Architecture

### 4.1 Studio Layout (`LibraryDetailModal.jsx`)
The layout transitions to an expansive two-column editorial split:

```
+---------------------------------------------------------------------------------+
|  ← Library                                            < 1 of 50 >   🔔 Save   ··· |
+---------------------------------------------------------------------------------+
|                                       |                                         |
|  [ Floating Framed Media Card ]       |  Remain Calm                            |
|  +---------------------------------+  |  Jake Lewis · Horror Comedy             |
|  |                                 |  |  [R] 10.0/10 TMDB                       |
|  |   Video Player / Slide Track    |  |                                         |
|  |   (Counter: 1 / 3, Scrubber)    |  |  A horror-comedy film where a creature  |
|  |                                 |  |  preys on people who show fear...       |
|  +---------------------------------+  |                                         |
|  |  (avatar) @dumbfever    [Open ↗]|  |  [ ▶ Watch trailer ↗ ]  [ Open details ↗ ]|
|  |  Remain Calm (2026)...          |  |                                         |
|  |  More ⌄                         |  |  Genre       Horror Comedy              |
|  +---------------------------------+  |  Rating      10.0/10 TMDB               |
|                                       |  Cast        Pauly Shore, Doug Jones    |
|                                       |  Creator     Jake Lewis                 |
|                                       |  Runtime     13 min                     |
|                                       |  Released    13 Oct 2026                |
|                                       |                                         |
|                                       |  Category: Horror Comedy                |
|                                       |                                         |
|                                       |  [ Yours Card ]                         |
|                                       |  +-----------------------------------+  |
|                                       |  | Lists:  [≡ Random]  [+]           |  |
|                                       |  | Tags:   [movie] [horror] [+]      |  |
|                                       |  | Notes:  [Add a note...          ] |  |
|                                       |  +-----------------------------------+  |
+---------------------------------------------------------------------------------+
```

### 4.2 Top Bar & Overflow Menu (`···`)
- Clean header: Back button (`← Library`), Pager (`< 1 of 50 >`), Remind / Bookmark button (`🔔`), and `···` (More menu).
- Overflow Menu Options:
  1. `Re-analyze with AI` (Triggers enrichment with toast feedback)
  2. `AI Model Selector` (Displays active model e.g. Groq LLaMA 3.3, opens model picker)
  3. `Re-index for Search` (Re-calculates vector embeddings)
  4. `Inspect Transcripts & Raw Text` (Opens side drawer for whisper transcript, visual OCR, and slide analysis)
  5. `Copy Link / Synopsis`
  6. `Delete Item` (Danger action with confirmation)

### 4.3 Outside the Cards (`LibraryCard.jsx`)
- Remove the inline micro-buttons (`Link`, `AI Spark`, `Re-index`, `Trash`) from card headers.
- Emphasize media cover, channel/author pill, clear typography, and a single category tag badge.
- Clicking any card opens the spacious detail studio.

---

## 5. Universal Platform Adaptations

1. **Video (Instagram, YouTube, TikTok, Vimeo):** Flush 9:16 or 16:9 canvas with playback controls, channel handle, and trailer/details CTAs.
2. **Code & Tools (GitHub, Dev utilities):** Clean repo preview banner, repo owner avatar, repository handle, and `Visit website ↗` / `View repository ↗` CTAs.
3. **Articles & Papers (Substack, Medium, ArXiv):** Editorial reader card, author attribution, reading time, and `Read paper / article ↗` CTA.
4. **Music & Audio (Spotify, Apple Music, Podcasts):** Album / show artwork, audio preview bar, artist / host name, and `Listen on Spotify ↗` CTA.
5. **Social Posts (X / Twitter, Reddit, Threads):** Post media carousel or quote card with author avatar, username/subreddit, and `View thread ↗` CTA.

---

## 6. Backward Compatibility & Fallbacks

- **Legacy Items:** When rendering an item where `entity` is `null`:
  - Synthesize a fallback spec table from existing attributes: `Source` (`item.site || item.url`), `Author` (`item.author`), `Date` (`item.published_on || item.consumed_on`), `Duration` (`item.duration_seconds`), and `Category` (`item.category`).
  - Synthesize primary CTA to `item.url`.
- **LLM Refusal / Timeout:** If the model times out or returns a refusal note, item status returns to `ready` with fallback metadata, and the `···` menu offers a direct "Re-analyze with AI" retry.

---

## 7. Verification & Testing Plan

1. **Unit & Integration Tests (`tests/test_library_enrich.py` & `tests/test_library.py`):**
   - Test `parse_enrichment()` with entity JSON schema for cinema, tools, and reading.
   - Test `_ensure_columns()` safely adds `entity` column.
   - Test `as_dict()` correctly deserializes `entity` dictionary.
   - Verify `enrich_text()` outputs valid entity payload without breaking legacy fields (`category`, `summary`, `tags`, `resources`).
2. **Frontend Build & Linter:**
   - Execute `npm run build` in `frontend/` to ensure 0 JSX errors and clean asset generation.
3. **End-to-End Verification:**
   - Verify `Remain Calm` reel displays the short film title, Jake Lewis, cast, runtime, 10/10 TMDB rating, and spacious layout matching the reference aesthetic.
