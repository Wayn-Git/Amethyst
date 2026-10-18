# Library Context Scanning & Editorial Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Amethyst's library context scanning pipeline to extract structured entity metadata (creators, cast, runtime, ratings, primary CTAs) across all media platforms and redesign the detail studio and library cards into a spacious, calm editorial layout with reduced button clutter.

**Architecture:** Extend the backend enrichment prompt and schema to output a first-class `entity` object containing domain-adaptive attributes and primary actions. Store `entity` as a JSON column in SQLite. Redesign the frontend `LibraryDetailModal.jsx` into a two-column editorial studio (floating framed media card on the left; bold typography, primary action CTAs, key-value spec table, and unified `Yours` curation card on the right) and consolidate maintenance tools into a `···` overflow menu. Simplify outer library cards in `LibraryCard.jsx`.

**Tech Stack:** Python 3.12, SQLite, Pytest, React 19, Framer Motion, Tailwind CSS / Kraken design tokens.

**Spec:** [`docs/superpowers/specs/2026-10-18-library-editorial-studio-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-18-library-editorial-studio-design.md)

---

## Global Constraints

- **Design System Tokens:** Adhere strictly to `AGENTS.md` and `frontend/src/index.css` (Kraken tokens: `--canvas`, `--surface-raised`, `--border`, `--accent`, `--r-pill`, `--r-lg`, `--font-sans`, `--text-scale`).
- **Theme Support:** Must support light mode (`paper`, `sand`, etc.) and dark mode (`ink`, `graphite`, etc.) via CSS semantic variables.
- **Library Model Isolation:** Library enrichment must preserve its independent model configuration (`groq:llama-3.3-70b-versatile` default) without leaking into chat composer settings.
- **Universal Multi-Platform Support:** Must support YouTube, TikTok, Instagram, GitHub, X/Twitter, Reddit, Spotify, Substack, ArXiv, and personal notes.
- **Zero Breaking DB Migrations:** Column additions must use `ALTER TABLE library_items ADD COLUMN entity TEXT` guarded against existing column errors.

---

## Review Focus

1. **Items without entity payload (legacy items):** Ensure old items render gracefully without crashing or showing blank spec tables by synthesizing fallback rows from existing attributes.
2. **LLM timeout or refusal:** Ensure timeouts or empty responses preserve item state as `ready` and leave existing metadata intact without error toasts on mount.
3. **Cross-platform action URLs:** Verify action CTAs (e.g. `Watch trailer`, `Open details`, `Visit website`) handle relative, missing, or malformed URLs safely with `normalize_url()`.
4. **Slide carousel vs single video layout:** Ensure 9:16 portrait videos, 16:9 landscape videos, and multi-slide carousels maintain proper aspect ratio without letterboxing artifacts.
5. **Card click vs action button click propagation:** Ensure card clicks open the studio while pill links and overflow actions stop event propagation (`e.stopPropagation()`).

---

### Task 1: SQLite Storage Extension & Persistence

**Files:**
- Modify: `backend/library/store.py:42-74`, `backend/library/store.py:180-210`
- Modify: `backend/library/service.py:165-210`
- Test: `tests/test_library_entity_store.py`

**Interfaces:**
- Consumes: Existing SQLite connection from `backend.db.connection`.
- Produces: `entity` column in `library_items`, updated `_UPDATABLE` set, and deserialized `entity` dict in `as_dict(row)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_library_entity_store.py
import json
import pytest
from backend.library.store import LibraryStore
from backend.library.service import as_dict

def test_store_entity_column_and_as_dict(tmp_path):
    import sqlite3
    from backend.db.connection import init_db
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # create table with base schema
    conn.execute("""
        CREATE TABLE library_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            consumed_on TEXT NOT NULL
        )
    """)
    store = LibraryStore(conn)
    # verify column exists
    cols = [col[1] for col in conn.execute("PRAGMA table_info(library_items)").fetchall()]
    assert "entity" in cols

    item_id = store.insert(kind="video", title="Remain Calm", consumed_on="2026-10-18")
    entity_data = {
        "title": "Remain Calm",
        "subtitle": "Jake Lewis · Horror Comedy",
        "rating": "10.0/10 TMDB",
        "attributes": {"Genre": "Horror", "Runtime": "13 min"}
    }
    store.update(item_id, entity=json.dumps(entity_data))
    row = store.get(item_id)
    d = as_dict(row)
    assert d["entity"] == entity_data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_entity_store.py -v`  
Expected: FAIL with missing column or assertion error.

- [ ] **Step 3: Implement `entity` column handling in `store.py` and `as_dict` in `service.py`**
  - Add `"entity"` to `_UPDATABLE` in `backend/library/store.py`.
  - Add `ALTER TABLE library_items ADD COLUMN entity TEXT` in `LibraryStore._ensure_columns()`.
  - In `backend/library/service.py` `as_dict()`, parse `entity` JSON string into a Python dict if present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_entity_store.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/store.py backend/library/service.py tests/test_library_entity_store.py
git commit -m "feat(library): add entity storage column and serialization"
```

---

### Task 2: Backend Prompt & Extraction Engine Upgrade

**Files:**
- Modify: `backend/library/enrich.py:278-315`, `backend/library/enrich.py:376-395`, `backend/library/enrich.py:628-698`
- Test: `tests/test_library_enrich_entity.py`

**Interfaces:**
- Consumes: Raw content text, kind, title, text source.
- Produces: `Enrichment(category=..., summary=..., tags=..., resources=..., entity=...)` where `entity` contains `title`, `subtitle`, `rating`, `synopsis`, `actions`, and `attributes`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_library_enrich_entity.py
from backend.library.enrich import parse_enrichment, Enrichment

def test_parse_enrichment_extracts_structured_entity():
    raw_json = '''{
        "category": "movie",
        "summary": "A horror-comedy film where a creature preys on people who show anxiety.",
        "tags": ["cinema", "comedy"],
        "entity": {
            "title": "Remain Calm",
            "subtitle": "Jake Lewis · Horror Comedy",
            "rating": "10.0/10 TMDB",
            "synopsis": "A creature forces victims to smile to survive.",
            "actions": [
                {"label": "Watch trailer", "url": "https://youtube.com/watch?v=123", "kind": "trailer"},
                {"label": "Open details", "url": "https://themoviedb.org/movie/456", "kind": "details"}
            ],
            "attributes": {
                "Genre": "Horror Comedy",
                "Rating": "10.0/10 TMDB",
                "Cast": "Pauly Shore, Doug Jones",
                "Creator": "Jake Lewis",
                "Runtime": "13 min",
                "Released": "13 Oct 2026"
            }
        },
        "resources": []
    }'''
    res = parse_enrichment(raw_json)
    assert res is not None
    assert res.entity is not None
    assert res.entity["title"] == "Remain Calm"
    assert res.entity["subtitle"] == "Jake Lewis · Horror Comedy"
    assert res.entity["attributes"]["Cast"] == "Pauly Shore, Doug Jones"
    assert len(res.entity["actions"]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_enrich_entity.py -v`  
Expected: FAIL (`AttributeError: 'Enrichment' object has no attribute 'entity'`).

- [ ] **Step 3: Update `Enrichment` dataclass, `PROMPT`, and `parse_enrichment` in `backend/library/enrich.py`**
  - Add `entity: dict | None = None` to `Enrichment` dataclass.
  - Upgrade `PROMPT` with domain-adaptive instructions to distinguish primary subjects from secondary references and return `{ category, summary, tags, entity: { title, subtitle, rating, synopsis, actions, attributes }, resources }`.
  - Update `parse_enrichment()` to validate, sanitize, and attach `entity`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_enrich_entity.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/enrich.py tests/test_library_enrich_entity.py
git commit -m "feat(library): upgrade enrichment prompt and parser for structured entity extraction"
```

---

### Task 3: Backend Integration in `service.enrich()`

**Files:**
- Modify: `backend/library/service.py:1610-1670`
- Test: `tests/test_library_service_enrich.py`

**Interfaces:**
- Consumes: `Enrichment` from `enrich_text()`.
- Produces: Persisted `entity` JSON string in SQLite row and updated search document.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_library_service_enrich.py
import pytest
from unittest.mock import AsyncMock, patch
from backend.library.enrich import Enrichment
from backend.library.service import LibraryService

@pytest.mark.asyncio
async def test_service_enrich_persists_entity(tmp_path):
    # Mock enrichment result returning an entity
    mock_enrichment = Enrichment(
        category="movie",
        summary="A comedy horror film.",
        tags=("cinema", "comedy"),
        entity={
            "title": "Remain Calm",
            "subtitle": "Jake Lewis · Comedy",
            "attributes": {"Genre": "Horror", "Runtime": "13 min"}
        }
    )
    with patch("backend.library.enrich.enrich_text", new=AsyncMock(return_value=mock_enrichment)):
        # setup service with memory db
        import sqlite3
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        from backend.library.store import LibraryStore
        store = LibraryStore(conn)
        service = LibraryService(store)
        item_id = store.insert(kind="video", title="Remain Calm", consumed_on="2026-10-18")
        await service.enrich(item_id)
        saved = service.store.get(item_id)
        assert saved["entity"] is not None
        import json
        entity_obj = json.loads(saved["entity"])
        assert entity_obj["title"] == "Remain Calm"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_library_service_enrich.py -v`  
Expected: FAIL (`saved["entity"] is None`).

- [ ] **Step 3: Update `service.enrich()` in `backend/library/service.py`**
  - Serialize `result.entity` to JSON and save via `self.store.update(item_id, entity=json.dumps(result.entity) if result.entity else None, ...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_library_service_enrich.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/service.py tests/test_library_service_enrich.py
git commit -m "feat(library): persist entity metadata during service enrichment"
```

---

### Task 4: Frontend Studio Layout Redesign (`LibraryDetailModal.jsx`)

**Files:**
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx`
- Modify: `frontend/src/views/library/library.css`
- Test: Verify with `npm run build` and visual inspection.

**Interfaces:**
- Consumes: Library item payload with optional `entity` object, `resources`, `tags`, `category`.
- Produces: Two-column editorial studio (Framed media card on left; title, subtitle, rating pill, synopsis, 2 large action CTAs, key-value spec table, unified `Yours` card on right; `···` overflow menu in header).

- [ ] **Step 1: Build the Framed Left Media Card & Navigation**
  - Implement flush aspect-ratio media container with subtle counter badge (`1 / 3`) and dot indicators.
  - Implement media footer card: author avatar, `@handle` (with platform icon), `Open ↗` pill button, and expandable caption with `More ⌄` toggle.

- [ ] **Step 2: Build the Right Editorial Spec & Action CTAs**
  - Display title (`--text-heading`), subtitle row, rating pill badge (`[R] 10.0/10 TMDB`).
  - Narrative synopsis without cluttered outer boxes.
  - Two prominent action pill buttons:
    - Primary CTA: `▶ Watch trailer ↗` (or domain-specific action)
    - Secondary CTA: `Open details ↗`
  - Two-column spec table mapping `entity.attributes` (or synthetic fallback for legacy items).
  - Unified `Yours` curation card grouping Lists, Tags, and inline Notes input.

- [ ] **Step 3: Implement Top Bar & `···` Overflow Menu**
  - Header: `← Library`, pager `< 1 of 50 >`, `🔔 Remind / Bookmark`, and `···` button.
  - Overflow menu containing: Re-analyze with AI, Change AI Model, Re-index, Inspect Transcripts & Slide OCR drawer, Copy, Delete.

- [ ] **Step 4: Style with Kraken Tokens in `library.css`**
  - Ensure generous padding, high typographic contrast, and seamless dark/light mode rendering using `--surface-raised`, `--border`, `--text`, `--text-dim`, `--accent`.

- [ ] **Step 5: Run frontend build to verify zero compile or lint errors**

Run: `npm run build` in `frontend/`  
Expected: Clean build in < 3s with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/library/LibraryDetailModal.jsx frontend/src/views/library/library.css
git commit -m "feat(library): redesign detail studio into spacious editorial layout with spec table"
```

---

### Task 5: Frontend Card Grid Simplification (`LibraryCard.jsx`)

**Files:**
- Modify: `frontend/src/views/library/LibraryCard.jsx`
- Modify: `frontend/src/views/library/library.css`
- Test: Verify with `npm run build`.

**Interfaces:**
- Consumes: Item data in bento / grid views.
- Produces: De-cluttered card without micro-button clusters in card headers; clean cover, single category pill, and clear typography.

- [ ] **Step 1: Remove inline micro-icon action buttons from card header in `LibraryCard.jsx`**
  - Delete `lib-card-inline-actions` (Link, Spark, Re-index, Trash) from the card header.
  - Card click navigates directly to the spacious detail studio.

- [ ] **Step 2: Polish card typography and padding**
  - Enhance card cover ratio and font hierarchy in `library.css`.

- [ ] **Step 3: Run frontend build to verify zero errors**

Run: `npm run build` in `frontend/`  
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryCard.jsx frontend/src/views/library/library.css
git commit -m "feat(library): simplify card grid items by removing micro-action button clusters"
```

---

### Task 6: Comprehensive Verification & Regression Suite

**Files:**
- Test: `tests/test_library.py`, `tests/test_library_fixes.py`, `tests/test_library_enrich*.py`
- Test: `frontend/` production build

- [ ] **Step 1: Run all Python library tests**

Run: `pytest tests/test_library*.py -v`  
Expected: All tests pass.

- [ ] **Step 2: Run frontend production build**

Run: `npm run build` in `frontend/`  
Expected: Successful build with 0 errors.

- [ ] **Step 3: Commit all verification artifacts**

```bash
git commit --allow-empty -m "chore(library): complete verification suite for editorial studio"
```
