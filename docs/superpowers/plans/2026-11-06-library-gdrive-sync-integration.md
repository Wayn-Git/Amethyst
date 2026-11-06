# Amethyst Library — Google Drive Sync and Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full two-way cloud synchronization and inbound item ingestion between Google Drive and Amethyst Library, featuring root folder auto-detection vs custom path selection, personal folder collision safety, deduplication, search indexing, and a Superfuture-compliant UI modal in the Library view.

**Architecture:** Extend `GoogleDriveBridge` to detect and verify library roots via `.amethyst-library.json` markers without hijacking personal folders. Implement `LibrarySyncEngine` to scan, deduplicate, ingest, and index Google Drive items into Amethyst SQLite/cache alongside outbound local sync. Expose dedicated sync REST endpoints and connect to a new `LibrarySyncModal` in `LibraryToolbar.jsx`.

**Tech Stack:** Python 3.12, FastAPI, SQLite WAL (FTS5 + vectors), Composio SDK / live MCP tools, React 19, Framer Motion, Tailwind CSS / Bento design tokens.

**Spec:** [`docs/superpowers/specs/2026-11-06-library-gdrive-sync-integration-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-06-library-gdrive-sync-integration-design.md)

## Global Constraints

- Never hijack or write into an existing user folder named `amethyst` or `Amethyst` unless verified by the `.amethyst-library.json` marker or explicit user selection.
- Amethyst owns all internal item IDs, taxonomies (`kind`, `category`, `tags`), and search indices (`chunks_fts`, `chunk_vectors`).
- Drive operations are strictly confined within the verified root folder.
- Local original files are NEVER automatically deleted.
- Deduplication must verify checksums and titles to prevent duplicate cards or re-uploading identical items.
- UI elements must comply with WCAG AA contrast (≥ 4.5:1 text, ≥ 3:1 icons/borders), 8px rhythm, and visible focus rings.

## Review Focus

1. **Pre-existing personal "amethyst" folder in Drive:** Bridge must detect that the folder lacks `.amethyst-library.json` or standard subfolders, flag it as unverified, and refuse to use it as the auto-detected library root.
2. **Drive contains existing markdown/PDF items:** Inbound scanner discovers them, assigns appropriate `kind`, saves text to local cache, writes `library_items` row, and triggers FTS/vector indexing.
3. **Identical file already in local Library:** Deduplication matches by `external_id`, SHA-256 `checksum`, or title + kind; updates existing row instead of creating duplicate cards.
4. **Transient Drive API disconnect during sync:** `LibrarySyncEngine` handles `StorageUnavailableError` cleanly, sets status to `failed` with user-friendly error message, and allows resumption.
5. **Simultaneous local capture and sync:** SQLite WAL prevents database locks; new items write locally first, then sync outbound cleanly.

---

### Task 1: Google Drive Path Detection & Safety Isolation

**Files:**
- Modify: `backend/library/storage/gdrive_bridge.py`
- Modify: `backend/library/storage/config.py`
- Test: `tests/test_gdrive_path_detection.py`

**Interfaces:**
- Consumes: `composio_service` in `backend.mcp.composio_service`, `StorageConfigStore`.
- Produces:
  - `GoogleDriveBridge.detect_library_root(mode: str = "auto", custom_path: str | None = None) -> dict[str, Any]`
  - `GoogleDriveBridge.ensure_verified_root(folder_id_or_path: str, write_marker: bool = True) -> str`
  - Marker file constant: `.amethyst-library.json`

- [ ] **Step 1: Write failing test for Google Drive path detection and personal folder protection**

```python
# tests/test_gdrive_path_detection.py
import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.gdrive_bridge import GoogleDriveBridge

@pytest.mark.asyncio
async def test_detect_library_root_rejects_unverified_personal_folder():
    bridge = GoogleDriveBridge()
    # Mock finding an existing "amethyst" folder with random personal files (no marker, no library subfolders)
    with patch.object(bridge, "_execute", new_callable=AsyncMock) as mock_exec:
        def side_effect(action, params):
            if action == "GOOGLEDRIVE_FIND_FILE":
                # Searching for .amethyst-library.json returns empty
                if ".amethyst-library.json" in params.get("q", ""):
                    return {"files": []}
            if action == "GOOGLEDRIVE_FIND_FOLDER":
                if params.get("name_exact") in ("Amethyst", "amethyst"):
                    return {"files": [{"id": "personal_folder_999", "name": "amethyst"}]}
                if params.get("parent_folder_id") == "personal_folder_999":
                    return {"files": []}
            return {"files": []}
        mock_exec.side_effect = side_effect

        result = await bridge.detect_library_root(mode="auto")
        # Must NOT auto-use the personal folder
        assert result["folder_id"] != "personal_folder_999"
        assert result.get("warning") is not None
        assert "unverified" in result["warning"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_gdrive_path_detection.py -v`  
Expected: FAIL with missing `detect_library_root` method.

- [ ] **Step 3: Implement root detection and marker verification in `backend/library/storage/gdrive_bridge.py`**

Implement:
- `MARKER_FILE_NAME = ".amethyst-library.json"`
- `detect_library_root(mode="auto", custom_path=None)`:
  - In auto mode: Search for marker file via `GOOGLEDRIVE_FIND_FILE`. If found, resolve parent. If not, inspect `Amethyst/Library/`. If an `amethyst` folder exists without `Library/` or marker, reject and return safe fallback.
  - In custom mode: Resolve path parts, inspect files, check if marker is present.
- `ensure_verified_root(folder_id_or_path, write_marker=True)`: Creates/retrieves folder and writes `.amethyst-library.json` payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_gdrive_path_detection.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/gdrive_bridge.py tests/test_gdrive_path_detection.py
git commit -m "feat(storage): implement safe Google Drive root detection and personal folder protection"
```

---

### Task 2: Two-Way Library Sync Engine (Inbound Scanner & Ingestion)

**Files:**
- Create: `backend/library/storage/sync_engine.py`
- Modify: `backend/library/storage/accessor.py`
- Test: `tests/test_library_sync_engine.py`

**Interfaces:**
- Consumes: `GoogleDriveBridge`, `LibraryStore`, `FileContentAccessor`, `enrich_library_item`, `Indexer`.
- Produces: `LibrarySyncEngine`:
  - `async scan_drive_items(root_folder_id: str) -> list[dict[str, Any]]`
  - `async ingest_inbound_item(drive_file: dict[str, Any]) -> dict[str, Any]`
  - `async run_two_way_sync(root_folder_id: str | None = None) -> dict[str, Any]`
  - `get_status() -> dict[str, Any]`
  - `cancel() -> None`

- [ ] **Step 1: Write failing test for `LibrarySyncEngine` inbound ingestion and deduplication**

```python
# tests/test_library_sync_engine.py
import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.sync_engine import LibrarySyncEngine
from backend.library.store import LibraryStore
from backend.db.connection import get_connection

@pytest.mark.asyncio
async def test_inbound_ingestion_and_deduplication(tmp_path):
    conn = get_connection()
    store = LibraryStore(conn)
    engine = LibrarySyncEngine()

    mock_drive_file = {
        "id": "drive_file_abc_1",
        "name": "Design Principles.md",
        "mimeType": "text/markdown",
        "size": 250,
        "md5Checksum": "md5_hash_123",
        "parent_folder": "articles",
    }

    with patch.object(engine.bridge, "download_file", new_callable=AsyncMock) as mock_down:
        mock_down.return_value = b"# Design Principles\n\nContent here."
        res = await engine.ingest_inbound_item(mock_drive_file)
        assert res["status"] == "imported"
        assert res["item_id"] is not None

        # Verify second ingestion of identical file deduplicates and skips
        res_dup = await engine.ingest_inbound_item(mock_drive_file)
        assert res_dup["status"] == "skipped"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_sync_engine.py -v`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `backend/library/storage/sync_engine.py`**

Implement:
- `LibrarySyncEngine` class with singleton status tracking (`_is_running`, `_stage`, `_counts`).
- `scan_drive_items`: recursive list of files under root and subfolders (`articles`, `books`, `notes`, `media`), ignoring `.amethyst-library.json`.
- `ingest_inbound_item`: deduplication checks (by `external_id`, MD5/SHA256 `checksum`, normalized title), writes file to cache, inserts `library_items` row, and schedules background enrichment and FTS chunking.
- `run_two_way_sync`: runs inbound discovery and ingestion, then runs outbound migration of local items via `MigrationEngine`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_sync_engine.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/sync_engine.py tests/test_library_sync_engine.py
git commit -m "feat(library): implement two-way sync engine with inbound ingestion and deduplication"
```

---

### Task 3: REST API Endpoints for Library Sync

**Files:**
- Modify: `backend/api/main.py:8900-8960`
- Modify: `frontend/src/api.js`
- Test: `tests/test_library_sync_endpoints.py`

**Interfaces:**
- Consumes: `LibrarySyncEngine`, `GoogleDriveBridge`.
- Produces:
  - `POST /api/library/sync/detect-path`
  - `POST /api/library/sync/start`
  - `GET /api/library/sync/status`
  - `POST /api/library/sync/cancel`
  - Frontend client methods: `api.librarySyncDetect()`, `api.librarySyncStart()`, `api.librarySyncStatus()`, `api.librarySyncCancel()`.

- [ ] **Step 1: Write failing test for sync endpoints**

```python
# tests/test_library_sync_endpoints.py
from fastapi.testclient import TestClient
from backend.api.main import app

def test_library_sync_endpoints_status():
    client = TestClient(app)
    res = client.get("/api/library/sync/status")
    assert res.status_code == 200
    data = res.json()
    assert "stage" in data
    assert "is_running" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_sync_endpoints.py -v`  
Expected: FAIL with 404 Not Found.

- [ ] **Step 3: Implement endpoints in `backend/api/main.py` and `frontend/src/api.js`**

Add Pydantic models `SyncDetectRequest`, `SyncStartRequest`, implement routes calling `LibrarySyncEngine`, and wire frontend client methods in `frontend/src/api.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_sync_endpoints.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py frontend/src/api.js tests/test_library_sync_endpoints.py
git commit -m "feat(api): expose library sync detection, start, status, and cancel endpoints"
```

---

### Task 4: Library UI — `LibrarySyncModal` Component

**Files:**
- Create: `frontend/src/views/library/LibrarySyncModal.jsx`
- Modify: `frontend/src/views/library/library.css`
- Test: Component syntax check / frontend build check

**Interfaces:**
- Consumes: `api.librarySyncDetect`, `api.librarySyncStart`, `api.librarySyncStatus`, `api.librarySyncCancel`, `api.connectorsConnected`, `api.storageConfig`.
- Produces: `LibrarySyncModal` displaying auto-detected vs custom path tabs, safety verification badge, item preview metrics, and live sync progress.

- [ ] **Step 1: Implement `LibrarySyncModal.jsx`**

Implement:
- Modal frame using Bento tokens (`codex-modal-card`, `set-btn-sm`, `HouseButton`).
- Mode switcher: `[ Auto-Detect ]` vs `[ Custom Path ]`.
- Status badges: `[✓ Verified Library Root]` vs personal folder warning.
- Scannable 4-metric counter grid: `Drive Items Found`, `Imported to Library`, `Uploaded to Drive`, `Skipped (Duplicates)`.
- Smooth animated progress bar with stage description.
- Full keyboard trap and `Escape` key handler.

- [ ] **Step 2: Add styles in `frontend/src/views/library/library.css`**

Add `.lib-sync-metric-card`, `.lib-sync-progress-bar`, `.lib-sync-badge-verified`, `.lib-sync-warning-box` using CSS variables (`var(--surface-*)`, `var(--accent)`, `var(--text)`).

- [ ] **Step 3: Verify frontend build**

Run: `cd frontend && npm run build`  
Expected: Build succeeds without syntax or lint errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibrarySyncModal.jsx frontend/src/views/library/library.css
git commit -m "feat(ui): create LibrarySyncModal with path auto-detection, safety badges, and live progress"
```

---

### Task 5: Library UI — Toolbar Integration & Keyboard Shortcut

**Files:**
- Modify: `frontend/src/views/library/LibraryToolbar.jsx`
- Modify: `frontend/src/views/Library.jsx`
- Test: Build and interaction check

**Interfaces:**
- Consumes: `LibrarySyncModal`.
- Produces: Google Drive sync trigger button in `LibraryToolbar.jsx` with connection dot and tooltip, keyboard shortcut (`Cmd/Ctrl + Shift + S`), and automatic reload of library items when sync completes.

- [ ] **Step 1: Update `LibraryToolbar.jsx`**

Add Cloud Sync button adjacent to layout switcher with:
- Google Drive icon.
- Status dot (green = connected, amber = sync pending, gray = disconnected).
- Tooltip: `"Google Drive Sync (⌘⇧S)"`.
- Prop `onOpenSyncModal`.

- [ ] **Step 2: Update `Library.jsx`**

- State: `const [showSyncModal, setShowSyncModal] = useState(false)`.
- Keydown handler: `(e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's'`.
- On sync complete: trigger `load()` to immediately show newly ingested items in grid/list.

- [ ] **Step 3: Verify frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryToolbar.jsx frontend/src/views/Library.jsx
git commit -m "feat(ui): integrate Cloud Sync trigger button and keyboard shortcut into Library toolbar"
```

---

### Task 6: End-to-End Integration Tests & Agent Documentation Updates

**Files:**
- Create: `tests/test_library_sync_full_integration.py`
- Modify: `docs/agent-context/sections/library.md`
- Modify: `docs/agent-context/INDEX.md`

**Interfaces:**
- Consumes: Entire sync and ingestion pipeline.
- Produces: Comprehensive test coverage and updated documentation.

- [ ] **Step 1: Write full end-to-end integration test**

```python
# tests/test_library_sync_full_integration.py
import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.sync_engine import LibrarySyncEngine
from backend.library.store import LibraryStore
from backend.db.connection import get_connection

@pytest.mark.asyncio
async def test_full_two_way_sync_integration(tmp_path):
    conn = get_connection()
    store = LibraryStore(conn)
    engine = LibrarySyncEngine()

    # Create a local item to migrate up
    local_id = store.create(kind="note", title="Local Note", category="ideas")
    
    # Mock drive files to import down
    mock_files = [{
        "id": "drive_note_99",
        "name": "Cloud Note.md",
        "mimeType": "text/markdown",
        "size": 150,
        "md5Checksum": "cloud_hash_99",
        "parent_folder": "notes",
    }]

    with patch.object(engine.bridge, "list_files_in_folder", new_callable=AsyncMock) as mock_list, \
         patch.object(engine.bridge, "download_file", new_callable=AsyncMock) as mock_down, \
         patch.object(engine.bridge, "upload_file", new_callable=AsyncMock) as mock_up:
        
        mock_list.return_value = mock_files
        mock_down.return_value = b"# Cloud Note\n\nCloud text"
        mock_up.return_value = {"id": "uploaded_local_note_id"}

        status = await engine.run_two_way_sync("test_root_123")
        assert status["inbound_imported"] >= 1
        assert status["stage"] == "complete"
```

- [ ] **Step 2: Run all backend test suites**

Run: `.venv/bin/pytest tests/test_library*.py tests/test_gdrive*.py tests/test_storage*.py -v`  
Expected: 100% PASS.

- [ ] **Step 3: Update documentation in `docs/agent-context/sections/library.md` and `INDEX.md`**

Add section covering `LibrarySyncEngine`, two-way Google Drive sync, `.amethyst-library.json` verification marker, and `LibrarySyncModal`.

- [ ] **Step 4: Commit**

```bash
git add tests/ docs/agent-context/
git commit -m "test(library): add end-to-end two-way sync test and update agent context documentation"
```
