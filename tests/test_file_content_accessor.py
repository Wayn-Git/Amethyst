import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from backend.db.connection import get_connection, reset_connection
from backend.library.store import LibraryStore
from backend.library.storage.base import StorageObject, StorageUnavailableError
from backend.library.storage.accessor import FileContentAccessor

@pytest.mark.asyncio
async def test_file_content_accessor_local_and_cached(tmp_path: Path):
    reset_connection()
    cache_dir = tmp_path / "cache"
    store = LibraryStore()

    # 1. Local item
    local_file = tmp_path / "local.md"
    local_file.write_text("# Local Content", encoding="utf-8")
    item_id_1 = store.create(kind="article", title="Local Article")
    store.update(item_id_1, storage_provider="local", text_path=str(local_file))

    accessor = FileContentAccessor(cache_dir=cache_dir)
    text = await accessor.get_text(item_id_1)
    assert text == "# Local Content"

    # 2. Cloud-backed item (cache miss -> download -> cache hit)
    mock_gdrive = AsyncMock()
    mock_gdrive.provider_id = "google_drive"
    mock_gdrive.read.return_value = b"# Cloud Downloaded Content"

    accessor = FileContentAccessor(cache_dir=cache_dir, gdrive_provider=mock_gdrive)
    item_id_2 = store.create(kind="article", title="Cloud Article")
    store.update(
        item_id_2,
        storage_provider="google_drive",
        external_id="gdrive_ext_123",
        cached_locally=0,
    )

    # First read downloads and caches
    cloud_text = await accessor.get_text(item_id_2)
    assert cloud_text == "# Cloud Downloaded Content"
    assert mock_gdrive.read.call_count == 1

    # Second read serves directly from cache without calling provider again
    cloud_text_2 = await accessor.get_text(item_id_2)
    assert cloud_text_2 == "# Cloud Downloaded Content"
    assert mock_gdrive.read.call_count == 1
