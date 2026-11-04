# Amethyst Library — Local-to-Google Drive Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst's Library into a local-first, cloud-backed personal knowledge repository using Google Drive as the cloud storage provider via Composio, while keeping internal metadata, search indexing, and existing UI completely intact.

**Architecture:** A provider-agnostic `StorageProvider` abstraction decouples Library business logic from physical storage. `GoogleDriveProvider` bridges to Google Drive via Composio within a dedicated root folder (`Amethyst/Library/` or user-selected), `LocalStorageProvider` maintains local disk compatibility, and `FileContentAccessor` manages local caching and offline transparent access.

**Tech Stack:** Python 3.12, FastAPI, SQLite WAL, Composio SDK / HTTP tool router, React 19, Tailwind CSS.

**Spec:** [LIBRARY_STORAGE_ARCHITECTURE.md](file:///home/wayne/Documents/GitHub/amethyst/LIBRARY_STORAGE_ARCHITECTURE.md) & [LIBRARY_ARCHITECTURE_AUDIT.md](file:///home/wayne/Documents/GitHub/amethyst/LIBRARY_ARCHITECTURE_AUDIT.md)

## Global Constraints

- Amethyst owns all internal file IDs, metadata, taxonomies (`kind`, `category`, `tags`), and search indexing (`chunks_fts`, `chunk_vectors`).
- Google Drive operations must be strictly scoped within the designated root folder (`Amethyst/Library` default or user-selected). Never touch or scan external Drive folders.
- Local original files are NEVER automatically deleted.
- All uploads and migrations verify SHA-256 checksums and file sizes.
- No breaking changes or redesigns to existing Library UI components (Grid, List, Detail modal, Omnibar capture).
- All changes must pass existing unit test suite (`tests/test_library*.py`).

## Review Focus

1. **Transient Network Drop During Upload:** Upload fails mid-stream; durable job must retry with exponential backoff and not duplicate files or leave orphan rows.
2. **Expired Composio OAuth Token:** Google Drive returns auth failure; system must flag `storage_configurations` as needing re-auth and pause migrations without crashing.
3. **Offline Access for Uncached Cloud File:** User requests a cloud-backed file while disconnected; `FileContentAccessor` must return `StorageUnavailableError` cleanly rather than throwing unhandled exceptions.
4. **Duplicate Root Folder Names in Drive:** User has multiple folders with the same name; Amethyst must track and store the explicit Google Drive folder ID, never relying purely on folder names.
5. **Partial Text Captures & Media Thumbnails:** Files without text or items with only video media must migrate their associated binary payloads and thumbnails into their respective subfolders.

---

### Task 1: Database Schema Additions & Additive Migrations

**Files:**
- Modify: `backend/db/schema.sql:534-640`
- Modify: `backend/db/connection.py:120-160`
- Test: `tests/test_storage_schema.py`

**Interfaces:**
- Consumes: Existing SQLite connection pool in `backend.db.connection`.
- Produces: New columns on `library_items` (`storage_provider`, `external_id`, `cached_locally`, `sync_state`, `checksum`, `last_synced_at`) and new tables `storage_configurations` and `storage_migration_manifest`.

- [ ] **Step 1: Write failing test for storage schema additions**

```python
# tests/test_storage_schema.py
import sqlite3
from backend.db.connection import get_connection

def test_storage_schema_columns_and_tables(tmp_path):
    conn = get_connection()
    # Check library_items columns
    cur = conn.execute("PRAGMA table_info(library_items)")
    cols = {row[1] for row in cur.fetchall()}
    assert "storage_provider" in cols
    assert "external_id" in cols
    assert "sync_state" in cols
    assert "checksum" in cols

    # Check new tables exist
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_configurations'")
    assert cur.fetchone() is not None
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_migration_manifest'")
    assert cur.fetchone() is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_storage_schema.py -v`
Expected: FAIL with missing columns/tables.

- [ ] **Step 3: Update `backend/db/schema.sql` and `backend/db/connection.py`**

Add `storage_configurations`, `storage_migration_manifest`, and additive migration altering `library_items` if columns missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_storage_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/db/schema.sql backend/db/connection.py tests/test_storage_schema.py
git commit -m "feat(db): add storage configurations, migration manifest, and library_items storage columns"
```

---

### Task 2: Storage Configuration Repository & Settings API

**Files:**
- Create: `backend/library/storage/config.py`
- Modify: `backend/api/main.py`
- Test: `tests/test_storage_config.py`

**Interfaces:**
- Consumes: `backend.db.connection.get_connection`
- Produces: `StorageConfigStore.get_config()`, `StorageConfigStore.update_config()`, and endpoints `GET /api/storage/config`, `PATCH /api/storage/config`.

- [ ] **Step 1: Write failing test for storage config repository**

```python
# tests/test_storage_config.py
from backend.library.storage.config import StorageConfigStore

def test_storage_config_defaults_and_updates():
    store = StorageConfigStore()
    cfg = store.get_config()
    assert cfg["active_provider"] == "local"
    assert cfg["gdrive_root_name"] == "Amethyst/Library"

    store.update_config(active_provider="google_drive", gdrive_root_id="root_123")
    updated = store.get_config()
    assert updated["active_provider"] == "google_drive"
    assert updated["gdrive_root_id"] == "root_123"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_storage_config.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `StorageConfigStore` and API endpoints**

Create `backend/library/storage/config.py` with singleton row logic and expose endpoints in `backend/api/main.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_storage_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/config.py backend/api/main.py tests/test_storage_config.py
git commit -m "feat(storage): implement storage config store and REST endpoints"
```

---

### Task 3: Storage Provider Interface & LocalStorageProvider

**Files:**
- Create: `backend/library/storage/base.py`
- Create: `backend/library/storage/local.py`
- Test: `tests/test_local_storage_provider.py`

**Interfaces:**
- Consumes: Local paths from `backend.library.store.library_dir`.
- Produces: `StorageProvider` abstract class and `LocalStorageProvider` implementing `read`, `write`, `delete`, `get_object`, `create_folder`, `list_folder`.

- [ ] **Step 1: Write failing test for LocalStorageProvider**

```python
# tests/test_local_storage_provider.py
import pytest
from backend.library.storage.local import LocalStorageProvider

@pytest.mark.asyncio
async def test_local_storage_provider_crud(tmp_path):
    provider = LocalStorageProvider(root_dir=tmp_path)
    # Write
    obj = await provider.write(
        name="test.md",
        data=b"# Hello Amethyst",
        mime_type="text/markdown"
    )
    assert obj.name == "test.md"
    assert obj.size_bytes == 16
    assert obj.checksum is not None

    # Read
    content = await provider.read(obj.external_id)
    assert content == b"# Hello Amethyst"

    # Delete
    deleted = await provider.delete(obj.external_id)
    assert deleted is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_local_storage_provider.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `base.py` and `local.py`**

Create `backend/library/storage/base.py` defining `StorageProvider`, `StorageObject`, and `StorageError`. Implement `LocalStorageProvider` in `backend/library/storage/local.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_local_storage_provider.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/base.py backend/library/storage/local.py tests/test_local_storage_provider.py
git commit -m "feat(storage): define StorageProvider interface and LocalStorageProvider implementation"
```

---

### Task 4: Composio Google Drive Action Bridge & Root Isolation

**Files:**
- Create: `backend/library/storage/gdrive_bridge.py`
- Test: `tests/test_gdrive_bridge.py`

**Interfaces:**
- Consumes: `ComposioService` in `backend.mcp.composio_service`.
- Produces: `GoogleDriveBridge` wrapping Composio Google Drive actions for files/folders within root boundary.

- [ ] **Step 1: Write failing test for GoogleDriveBridge**

```python
# tests/test_gdrive_bridge.py
import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.gdrive_bridge import GoogleDriveBridge

@pytest.mark.asyncio
async def test_gdrive_bridge_root_folder_resolution():
    bridge = GoogleDriveBridge()
    with patch.object(bridge, "_execute_action", new_callable=AsyncMock) as mock_exec:
        # Mock finding existing root folder
        mock_exec.return_value = {"files": [{"id": "folder_root_1", "name": "Library"}]}
        root_id = await bridge.ensure_root_folder("Amethyst/Library")
        assert root_id == "folder_root_1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_gdrive_bridge.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `backend/library/storage/gdrive_bridge.py`**

Implement `GoogleDriveBridge` handling:
- `ensure_root_folder(path_or_name: str) -> str`
- `list_files_in_folder(folder_id: str) -> list[dict]`
- `upload_file(name: str, content: bytes, mime_type: str, parent_id: str) -> dict`
- `download_file(file_id: str) -> bytes`
- `delete_file(file_id: str) -> bool`
- `create_subfolder(name: str, parent_id: str) -> str`

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_gdrive_bridge.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/gdrive_bridge.py tests/test_gdrive_bridge.py
git commit -m "feat(storage): implement Composio Google Drive action bridge with root folder isolation"
```

---

### Task 5: GoogleDriveProvider Implementation

**Files:**
- Create: `backend/library/storage/gdrive.py`
- Test: `tests/test_gdrive_provider.py`

**Interfaces:**
- Consumes: `StorageProvider` in `backend.library.storage.base`, `GoogleDriveBridge` in `backend.library.storage.gdrive_bridge`.
- Produces: `GoogleDriveProvider` conforming to `StorageProvider`.

- [ ] **Step 1: Write failing test for GoogleDriveProvider**

```python
# tests/test_gdrive_provider.py
import pytest
from unittest.mock import AsyncMock
from backend.library.storage.gdrive import GoogleDriveProvider

@pytest.mark.asyncio
async def test_gdrive_provider_operations():
    mock_bridge = AsyncMock()
    mock_bridge.upload_file.return_value = {
        "id": "gdrive_file_1",
        "name": "doc.md",
        "size": 100,
        "mimeType": "text/markdown",
        "md5Checksum": "abc",
        "modifiedTime": "2026-11-04T12:00:00Z",
    }
    mock_bridge.download_file.return_value = b"# Content"

    provider = GoogleDriveProvider(bridge=mock_bridge, root_folder_id="root_1")
    obj = await provider.write("doc.md", b"# Content", "text/markdown")
    assert obj.external_id == "gdrive_file_1"

    data = await provider.read("gdrive_file_1")
    assert data == b"# Content"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_gdrive_provider.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `backend/library/storage/gdrive.py`**

Map `GoogleDriveProvider` operations to `mock_bridge`/`GoogleDriveBridge` and return standardized `StorageObject` instances.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_gdrive_provider.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/gdrive.py tests/test_gdrive_provider.py
git commit -m "feat(storage): implement GoogleDriveProvider conforming to StorageProvider"
```

---

### Task 6: FileContentAccessor & Local-First Cache

**Files:**
- Create: `backend/library/storage/accessor.py`
- Test: `tests/test_file_content_accessor.py`

**Interfaces:**
- Consumes: `LocalStorageProvider`, `GoogleDriveProvider`, `LibraryStore`.
- Produces: `FileContentAccessor.get_text(item_id)`, `FileContentAccessor.get_media_path(item_id)`, `FileContentAccessor.save_text(item_id, title, text)`.

- [ ] **Step 1: Write failing test for FileContentAccessor**

```python
# tests/test_file_content_accessor.py
import pytest
from unittest.mock import AsyncMock
from backend.library.storage.accessor import FileContentAccessor

@pytest.mark.asyncio
async def test_accessor_cache_hit_and_miss(tmp_path):
    cache_dir = tmp_path / "cache"
    accessor = FileContentAccessor(cache_dir=cache_dir)
    # Test reading local provider item
    # Test downloading and caching cloud provider item
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_file_content_accessor.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `backend/library/storage/accessor.py`**

Implement cache directory resolution, cache hit verification with checksum, and on-demand cloud fetching when offline handling raises `StorageUnavailableError`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_file_content_accessor.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/accessor.py tests/test_file_content_accessor.py
git commit -m "feat(storage): implement FileContentAccessor with local caching and offline handling"
```

---

### Task 7: Resumable Migration Engine & Manifest Store

**Files:**
- Create: `backend/library/storage/migration.py`
- Test: `tests/test_storage_migration.py`

**Interfaces:**
- Consumes: `storage_migration_manifest` in DB, `LocalStorageProvider`, `GoogleDriveProvider`.
- Produces: `MigrationEngine.build_manifest()`, `MigrationEngine.step()`, `MigrationEngine.get_status()`, `MigrationEngine.reset()`.

- [ ] **Step 1: Write failing test for MigrationEngine**

```python
# tests/test_storage_migration.py
import pytest
from backend.library.storage.migration import MigrationEngine

@pytest.mark.asyncio
async def test_migration_engine_manifest_and_step():
    engine = MigrationEngine()
    count = await engine.build_manifest()
    status = engine.get_status()
    assert "total" in status
    assert "completed" in status
    assert "pending" in status
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_storage_migration.py -v`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `backend/library/storage/migration.py`**

Implement manifest population from `library_items`, batch processing loop, checksum verification, error recording without blocking next items, and status aggregation.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_storage_migration.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/library/storage/migration.py tests/test_storage_migration.py
git commit -m "feat(storage): implement resumable MigrationEngine and manifest processing"
```

---

### Task 8: Migration Durable Job & REST Endpoints

**Files:**
- Modify: `backend/api/main.py`
- Modify: `backend/jobs/` registrations
- Test: `tests/test_migration_endpoints.py`

**Interfaces:**
- Consumes: `MigrationEngine`, `backend.jobs.runner.JobRunner`.
- Produces: REST endpoints:
  - `POST /api/storage/migration/start`
  - `POST /api/storage/migration/pause`
  - `POST /api/storage/migration/retry`
  - `GET /api/storage/migration/status`

- [ ] **Step 1: Write failing test for migration endpoints**

```python
# tests/test_migration_endpoints.py
from fastapi.testclient import TestClient
from backend.api.main import app

def test_migration_status_endpoint():
    client = TestClient(app)
    res = client.get("/api/storage/migration/status")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "total" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_migration_endpoints.py -v`
Expected: FAIL with 404 Not Found.

- [ ] **Step 3: Implement durable job registration & REST endpoints**

Wire `storage_migration` job kind into `backend/api/main.py` and register handler using `MigrationEngine`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_migration_endpoints.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py tests/test_migration_endpoints.py
git commit -m "feat(storage): register migration durable job and expose status control endpoints"
```

---

### Task 9: Wire LibraryService & Indexer to FileContentAccessor

**Files:**
- Modify: `backend/library/service.py:1300-1365`
- Modify: `backend/api/main.py:8770-8810` (media and thumbnail endpoints)
- Test: `tests/test_library_cloud_backed.py`

**Interfaces:**
- Consumes: `FileContentAccessor`.
- Produces: `LibraryService` reading and storing via `FileContentAccessor` instead of hardcoding `~/.amethyst/library/`.

- [ ] **Step 1: Write failing test for cloud-backed library item access**

```python
# tests/test_library_cloud_backed.py
import pytest
from backend.library.service import LibraryService
from backend.library.store import LibraryStore

@pytest.mark.asyncio
async def test_library_service_reads_cloud_backed_item():
    store = LibraryStore()
    item_id = store.create(
        kind="article",
        title="Cloud Article",
        category="technology"
    )
    store.update(
        item_id,
        storage_provider="google_drive",
        external_id="mock_gdrive_id_123"
    )
    service = LibraryService()
    # Test reading item detail and content through accessor
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_library_cloud_backed.py -v`
Expected: FAIL.

- [ ] **Step 3: Update `LibraryService` and `main.py` media endpoints**

Inject `FileContentAccessor` into `LibraryService` methods (`get`, `_store_text`, `remove`). Update `/api/library/{id}/media` and `/thumbnail` to query `FileContentAccessor.get_media_path(item_id)` / `get_thumbnail_path(item_id)` with cache streaming.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_library_cloud_backed.py -v`
Expected: PASS

- [ ] **Step 5: Run full library test suite to verify zero regressions**

Run: `.venv/bin/pytest tests/test_library*.py -v`
Expected: All 67+ tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/library/service.py backend/api/main.py tests/test_library_cloud_backed.py
git commit -m "refactor(library): decouple LibraryService and media endpoints via FileContentAccessor"
```

---

### Task 10: Frontend UI: Settings Storage & Migration Panel

**Files:**
- Create: `frontend/src/views/settings/StorageSettings.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/api.js`
- Test: Vitest / component syntax verification

**Interfaces:**
- Consumes: `api.storageConfig()`, `api.migrationStatus()`, `api.startMigration()`, `api.pauseMigration()`.
- Produces: Storage tab in Settings showing Google Drive connection, root folder selector, and real-time migration progress.

- [ ] **Step 1: Add frontend API methods in `frontend/src/api.js`**

```javascript
storageConfig: () => j('/storage/config'),
updateStorageConfig: (patch) => j('/storage/config', json('PATCH', patch)),
migrationStatus: () => j('/storage/migration/status'),
startMigration: () => j('/storage/migration/start', json('POST', {})),
pauseMigration: () => j('/storage/migration/pause', json('POST', {})),
retryMigration: () => j('/storage/migration/retry', json('POST', {})),
```

- [ ] **Step 2: Implement `StorageSettings.jsx`**

Build clean, bento-styled component with:
- Google Drive connection card (connect via Composio, account label).
- Root folder input (`Amethyst/Library` default, editable).
- Migration stats: Total items, Migrated, In Progress, Failed.
- Progress bar and Pause/Resume/Retry buttons.

- [ ] **Step 3: Register in `frontend/src/views/Settings.jsx`**

Add "Storage" tab in Settings tabs.

- [ ] **Step 4: Verify frontend build**

Run: `npm run build` or `npm run lint`
Expected: Clean build without errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/settings/StorageSettings.jsx frontend/src/views/Settings.jsx frontend/src/api.js
git commit -m "feat(ui): add Storage and Migration management panel in Settings"
```

---

### Task 11: Frontend UI: Cloud Status Badge on Item Detail Modal

**Files:**
- Modify: `frontend/src/views/library/LibraryDetailModal.jsx`
- Modify: `frontend/src/views/library/library-detail.css`
- Test: Syntax and build check

**Interfaces:**
- Consumes: `item.storage_provider`, `item.cached_locally`.
- Produces: Subtle storage indicator badge in the item detail header (e.g., Disk icon for Local, Drive icon for Cloud).

- [ ] **Step 1: Update `LibraryDetailModal.jsx`**

Render subtle badge next to category badge:
- If `item.storage_provider === 'google_drive'`: Drive icon with tooltip `"Cloud backed (Google Drive)"`.
- If offline and not cached: `"Available when reconnected"`.
- Else: Disk icon or standard subtle indicator.

- [ ] **Step 2: Add styles in `library-detail.css`**

Add `.lib-detail-storage-badge` using existing design tokens. Zero layout shift.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS with zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryDetailModal.jsx frontend/src/views/library/library-detail.css
git commit -m "feat(ui): add subtle cloud storage status badge in LibraryDetailModal"
```

---

### Task 12: Comprehensive Integration Testing & Documentation Updates

**Files:**
- Create: `tests/test_library_gdrive_integration.py`
- Modify: `docs/agent-context/sections/library.md`
- Modify: `docs/agent-context/systems/storage.md`
- Modify: `docs/agent-context/INDEX.md`

**Interfaces:**
- Tests complete flow: local item creation -> manifest generation -> cloud migration -> cache hit/miss -> retrieval & search.

- [ ] **Step 1: Write comprehensive end-to-end integration test**

Verify item capture, migration execution, file content access, search hit resolution, and offline fallback.

- [ ] **Step 2: Run all backend test suites**

Run: `.venv/bin/pytest tests/test_library*.py tests/test_storage*.py -v`
Expected: 100% PASS.

- [ ] **Step 3: Update agent documentation**

Update `docs/agent-context/sections/library.md` and `docs/agent-context/systems/storage.md` with storage provider layer and migration guide.

- [ ] **Step 4: Commit**

```bash
git add tests/ docs/agent-context/
git commit -m "test(storage): add end-to-end integration tests and update agent context documentation"
```
