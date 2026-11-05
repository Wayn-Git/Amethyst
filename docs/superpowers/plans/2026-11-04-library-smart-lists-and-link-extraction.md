# Library Smart Lists & Link Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete smart lists and link extraction pipeline that normalizes outbound URLs from content, clusters related items and links into lists with zero duplicates, and displays smart lists and outbound links in the library UI.

**Architecture:** SQLite tables for extracted links, lists, and members with unique constraints; regex and normalization link harvester; cosine vector/tag semantic clustering engine; REST endpoints for lists and links; frontend lists shelf and outbound links view in detail modal.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, React, Framer Motion, CSS.

**Spec:** `docs/superpowers/specs/2026-11-04-library-smart-lists-and-link-extraction-design.md`

## Global Constraints
- `UNIQUE(list_id, item_id)` and `UNIQUE(list_id, link_id)` must be enforced at both database and application level to guarantee zero duplicates.
- All extracted URLs must be normalized: tracking query parameters (`utm_*`, `fbclid`, `igsh`, `si`, etc.) stripped, domain lowercased, trailing slashes removed.
- Cascade deletion: deleting an item automatically removes its extracted links and list memberships without orphaned rows.
- Existing library search, filtering, and detail modal functionality must remain intact.

## Review Focus
1. Adding the same link or item twice to a list triggers no SQL error and creates no duplicate entries.
2. Link harvester parses both raw URLs and Markdown `[text](url)` links while stripping query trackers.
3. Semantic clustering groups items with cosine similarity >= 0.70 into a coherent smart list with synthesized titles.
4. Deleting a list does not delete the underlying saved items or links.
5. In the UI, clicking a list filters the library canvas and displays associated outbound links cleanly.

---

### Task 1: Database Tables & Store Methods for Lists and Links

**Files:**
- Modify: `backend/db/schema.sql:614-660`
- Modify: `backend/library/store.py:240-300`
- Test: `tests/test_library_smart_lists.py`

**Interfaces:**
- Produces:
  - `LibraryStore.create_list(title: str, description: str = '', icon: str = 'bookmark', is_smart: bool = False) -> int`
  - `LibraryStore.get_lists() -> list[dict]`
  - `LibraryStore.add_list_member(list_id: int, item_id: int | None = None, link_id: int | None = None) -> bool`
  - `LibraryStore.get_list_members(list_id: int) -> dict[str, list]`
  - `LibraryStore.save_extracted_link(source_item_id: int, url: str, normalized_url: str, domain: str, title: str | None = None) -> int | None`

- [ ] **Step 1: Write the failing test for schema and store methods**

Write `tests/test_library_smart_lists.py`:
```python
import pytest
from backend.db.connection import reset_connection
from backend.library.store import LibraryStore

def test_lists_and_extracted_links_store():
    reset_connection()
    store = LibraryStore()

    # Create extracted link
    item_id = store.create(title="Article 1", kind="article", url="https://example.com/art1")
    link_id = store.save_extracted_link(
        source_item_id=item_id,
        url="https://github.com/fastapi/fastapi?utm_source=twitter",
        normalized_url="https://github.com/fastapi/fastapi",
        domain="github.com",
        title="FastAPI Repo",
    )
    assert link_id is not None

    # Test deduplication on save_extracted_link
    dup_id = store.save_extracted_link(
        source_item_id=item_id,
        url="https://github.com/fastapi/fastapi?utm_medium=social",
        normalized_url="https://github.com/fastapi/fastapi",
        domain="github.com",
    )
    assert dup_id == link_id, "Duplicate normalized URL for same item must return existing ID"

    # Create list
    list_id = store.create_list(title="Developer Tools", is_smart=True)
    assert list_id > 0

    # Add item and link to list
    assert store.add_list_member(list_id=list_id, item_id=item_id) is True
    assert store.add_list_member(list_id=list_id, link_id=link_id) is True

    # Test deduplication on list members
    assert store.add_list_member(list_id=list_id, item_id=item_id) is False, "Duplicate item should not be added again"
    assert store.add_list_member(list_id=list_id, link_id=link_id) is False, "Duplicate link should not be added again"

    members = store.get_list_members(list_id)
    assert len(members["items"]) == 1
    assert len(members["links"]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_lists_and_extracted_links_store -v`  
Expected: FAIL (`LibraryStore` has no attribute `save_extracted_link`).

- [ ] **Step 3: Update `backend/db/schema.sql` and `backend/library/store.py`**

- Add DDL in `schema.sql`:
  `library_extracted_links`, `library_lists`, `library_list_members`.
- Add `_ensure_tables()` in `backend/library/store.py`.
- Implement store methods: `create_list`, `get_lists`, `delete_list`, `save_extracted_link`, `add_list_member`, `remove_list_member`, `get_list_members`, `get_extracted_links`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_lists_and_extracted_links_store -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/db/schema.sql backend/library/store.py tests/test_library_smart_lists.py
git commit -m "feat(library): add schema and store methods for lists and extracted links"
```

---

### Task 2: Normalized Link Harvester & Persistence Pipeline

**Files:**
- Create: `backend/library/links.py`
- Modify: `backend/library/service.py:570-610, 1660-1700`
- Test: `tests/test_library_smart_lists.py`

**Interfaces:**
- Produces:
  - `harvest_and_store_links(store: LibraryStore, item_id: int, text: str, resources: list[dict] | None = None) -> list[dict]`
  - `backfill_all_links(service: LibraryService) -> dict[str, int]`

- [ ] **Step 1: Write the failing test for link harvesting**

Add test in `tests/test_library_smart_lists.py`:
```python
def test_harvest_and_store_links():
    reset_connection()
    store = LibraryStore()
    from backend.library.links import harvest_and_store_links

    item_id = store.create(title="Tech Article", kind="article", url="https://news.ycombinator.com/item?id=123")
    sample_markdown = """
    Check out this [FastAPI Repo](https://github.com/fastapi/fastapi?utm_source=twitter) for web APIs.
    Also read https://anthropic.com/research/overview?ref=hackernews and duplicate https://github.com/fastapi/fastapi.
    """

    links = harvest_and_store_links(store, item_id, sample_markdown)
    assert len(links) == 2
    domains = {l["domain"] for l in links}
    assert "github.com" in domains
    assert "anthropic.com" in domains

    # Verify tracking parameter was removed
    urls = [l["url"] for l in links]
    assert "https://github.com/fastapi/fastapi" in urls
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_harvest_and_store_links -v`  
Expected: FAIL (`cannot import name 'harvest_and_store_links'`).

- [ ] **Step 3: Implement `backend/library/links.py` and hook into `LibraryService`**

- Create `backend/library/links.py` with:
  - `harvest_and_store_links`: extracts markdown `[title](url)` and bare URLs via regex, calls `normalize_url`, filters private/invalid schemes, and persists to `store.save_extracted_link()`.
  - `backfill_all_links`: iterates items, reads markdown, and harvests links.
- In `backend/library/service.py`:
  - Call `harvest_and_store_links` in `_store_text` and `replace_text`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_harvest_and_store_links -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/links.py backend/library/service.py tests/test_library_smart_lists.py
git commit -m "feat(library): implement link harvesting and normalization pipeline"
```

---

### Task 3: Semantic Clustering Engine & List Management API

**Files:**
- Create: `backend/library/clustering.py`
- Modify: `backend/api/main.py:9065-9120`
- Test: `tests/test_library_smart_lists.py`

**Interfaces:**
- Produces:
  - `auto_cluster_library_items(service: LibraryService, similarity_threshold: float = 0.70) -> dict[str, Any]`
  - API Routes:
    - `GET /api/library/lists`
    - `POST /api/library/lists`
    - `GET /api/library/lists/{id}`
    - `DELETE /api/library/lists/{id}`
    - `POST /api/library/lists/{id}/members`
    - `DELETE /api/library/lists/{id}/members/{member_id}`
    - `POST /api/library/lists/auto-cluster`
    - `GET /api/library/links`

- [ ] **Step 1: Write the failing test for clustering and lists API**

Add test in `tests/test_library_smart_lists.py`:
```python
def test_auto_cluster_and_lists_api():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    # Create related items
    id1 = store.create(title="FastAPI High Performance Web", kind="article", url="https://fastapi.tiangolo.com")
    id2 = store.create(title="Async Python and Starlette Architecture", kind="article", url="https://starlette.io")
    store.update(id1, tags='["#python", "#api", "#backend"]')
    store.update(id2, tags='["#python", "#async", "#backend"]')

    client = TestClient(app)
    # Trigger auto clustering
    res = client.post("/api/library/lists/auto-cluster")
    assert res.status_code == 200
    data = res.json()
    assert "clusters_created" in data

    # Verify list retrieval
    lists_res = client.get("/api/library/lists")
    assert lists_res.status_code == 200
    all_lists = lists_res.json()
    assert len(all_lists) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_auto_cluster_and_lists_api -v`  
Expected: FAIL (`404 Not Found` for `/api/library/lists/auto-cluster`).

- [ ] **Step 3: Implement `backend/library/clustering.py` and API routes in `backend/api/main.py`**

- In `backend/library/clustering.py`:
  - Calculate pairwise similarity between items using vector embeddings from `chunk_vectors` or Jaccard similarity on tags/tokens.
  - Group into clusters >= 2 items.
  - Derive concise cluster names from highest-frequency tags and domains.
  - Create smart list in `library_lists` and add items/extracted links into `library_list_members`.
- In `backend/api/main.py`:
  - Add routes: `/api/library/lists`, `/api/library/lists/{id}`, `/api/library/lists/{id}/members`, `/api/library/lists/auto-cluster`, `/api/library/links`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_smart_lists.py::test_auto_cluster_and_lists_api -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/library/clustering.py backend/api/main.py tests/test_library_smart_lists.py
git commit -m "feat(library): implement semantic clustering engine and lists REST API"
```

---

### Task 4: Frontend Lists Shelf, Member View, & Outbound Links in Detail Modal

**Files:**
- Create: `frontend/src/views/library/LibraryListsShelf.jsx`
- Modify: `frontend/src/views/Library.jsx:770-820`
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx:900-980`
- Modify: `frontend/src/views/library/library.css`
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces:
  - `api.libraryLists`, `api.createLibraryList`, `api.autoClusterLibraryLists`, `api.addListMember`, `api.deleteLibraryList`
  - `LibraryListsShelf` component allowing filtering by list and triggering auto-clustering.
  - Outbound links section in `LibraryDetailModal`.

- [ ] **Step 1: Add frontend API client methods in `frontend/src/api.js`**

Add `libraryLists`, `createLibraryList`, `deleteLibraryList`, `autoClusterLibraryLists`, `addListMember`, `removeListMember`, `libraryExtractedLinks`.

- [ ] **Step 2: Create `frontend/src/views/library/LibraryListsShelf.jsx`**

- Render horizontal pill bar with "All Items", followed by smart clusters (`✦ AI Tools`, `✦ Backend`) and custom lists.
- Action buttons: "+ New List" modal trigger, "⚡ Auto-Group" button calling `api.autoClusterLibraryLists`.
- Filter library view by selected list ID.

- [ ] **Step 3: Integrate `LibraryListsShelf` into `frontend/src/views/Library.jsx`**

- Place `LibraryListsShelf` below the capture/search bar.
- When a list is active, filter canvas items to list members.

- [ ] **Step 4: Add Outbound Links section to `LibraryDetailModal.jsx`**

- Display extracted links under a "Referenced Links" card.
- Allow clicking to open link, and "+ Add to list" dropdown action.

- [ ] **Step 5: Verify frontend build**

Run: `cd frontend && npm run build`  
Expected: Build passes without syntax or bundle errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.js frontend/src/views/library/LibraryListsShelf.jsx frontend/src/views/Library.jsx frontend/src/views/library/LibraryDetailModal.jsx frontend/src/views/library/library.css
git commit -m "feat(library): add lists shelf, list filtering, and outbound links in detail modal"
```

---

### Task 5: Integration Verification & Regression Tests

**Files:**
- Modify/Add: `tests/test_library_smart_lists.py`
- Test: All touched library tests

- [ ] **Step 1: Run full backend and frontend regression test suite**

Run:
1. `.venv/bin/pytest tests/test_library_smart_lists.py tests/test_library_zero_download.py tests/test_library_fast_capture_enrich.py -v`
2. `cd frontend && npm run build`

- [ ] **Step 2: Commit**

```bash
git add tests/test_library_smart_lists.py
git commit -m "test(library): complete integration verification for smart lists and link extraction"
```
