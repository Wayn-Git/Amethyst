import pytest
from pathlib import Path
from backend.library.storage.base import StorageError
from backend.library.storage.local import LocalStorageProvider

@pytest.mark.asyncio
async def test_local_storage_provider_crud(tmp_path: Path):
    provider = LocalStorageProvider(root_dir=tmp_path)
    assert provider.provider_id == "local"

    # Write file
    obj = await provider.write(
        name="article.md",
        data=b"# Sample Article Content",
        mime_type="text/markdown",
    )
    assert obj.name == "article.md"
    assert obj.size_bytes == len(b"# Sample Article Content")
    assert obj.checksum is not None

    # Get object metadata
    meta = await provider.get_object(obj.external_id)
    assert meta is not None
    assert meta.name == "article.md"
    assert meta.size_bytes == obj.size_bytes

    # Read content
    content = await provider.read(obj.external_id)
    assert content == b"# Sample Article Content"

    # Folder operations
    sub = await provider.create_folder("media")
    assert sub.is_folder is True

    # Write inside folder
    f_obj = await provider.write(
        name="thumb.jpg",
        data=b"\xff\xd8\xff\xe0fakejpeg",
        mime_type="image/jpeg",
        parent_folder_id=sub.external_id,
    )
    assert f_obj.parent_folder_id == sub.external_id

    # List folder
    listed = await provider.list_folder(sub.external_id)
    assert len(listed) == 1
    assert listed[0].name == "thumb.jpg"

    # Delete
    deleted = await provider.delete(obj.external_id)
    assert deleted is True

    deleted_again = await provider.delete(obj.external_id)
    assert deleted_again is False
