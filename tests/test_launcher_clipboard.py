import pytest
from unittest.mock import patch
from backend.launcher.providers.clipboard import ClipboardHistoryStore, ClipboardProvider


def test_clipboard_history_store(tmp_path):
    db_file = tmp_path / "test_clipboard.db"
    store = ClipboardHistoryStore(db_path=db_file)

    # 1. Add items
    id1 = store.add("Hello World")
    id2 = store.add("https://github.com/amethyst")
    assert id1 is not None
    assert id2 is not None

    # 2. Duplicate re-ordering
    id3 = store.add("Hello World")
    assert store.count() == 2

    # 3. Search
    results = store.search("github")
    assert len(results) == 1
    assert "github.com" in results[0]["text"]

    all_items = store.search("")
    assert len(all_items) == 2


@pytest.mark.asyncio
async def test_clipboard_provider_search_and_execute(tmp_path):
    db_file = tmp_path / "test_clipboard.db"
    store = ClipboardHistoryStore(db_path=db_file)
    store.add("Bearer secret_token_12345")
    store.add("Docker compose up -d")

    provider = ClipboardProvider(store=store)

    # 1. Search 'docker'
    results = [r async for r in provider.search("docker", "s1")]
    assert len(results) == 1
    assert "Docker compose" in results[0].title
    assert results[0].provider_id == "clipboard"
    assert results[0].actions[0].id == "copy"

    # 2. Search with prefix 'cb '
    cb_results = [r async for r in provider.search("cb token", "s2")]
    assert len(cb_results) == 1
    assert "Bearer secret" in cb_results[0].title
    assert cb_results[0].score >= 90

    # 3. Execution (copy to system clipboard)
    with patch("backend.launcher.providers.clipboard.set_clipboard") as mock_set:
        mock_set.return_value = {"ok": True}
        exec_res = await provider.execute("copy", {"text": "Docker compose up -d"})
        assert exec_res.get("ok") is True
        mock_set.assert_called_once_with("Docker compose up -d")
