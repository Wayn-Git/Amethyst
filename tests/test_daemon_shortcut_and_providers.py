"""Unit & integration tests for daemon spotlight shortcuts and new launcher providers."""

import pytest
from starlette.testclient import TestClient
from backend.api.main import app
from backend.launcher.providers.emojis import EmojiProvider
from backend.launcher.providers.bookmarks import BookmarkProvider
from backend.launcher.providers.quicknotes import QuickNoteProvider
from backend.launcher.providers.commands import CommandProvider
from backend.desktop import _gnome_chord, check_shortcut_conflicts


def test_desktop_shortcut_endpoints():
    client = TestClient(app)

    # 1. GET current shortcut
    res = client.get("/api/desktop/shortcut")
    assert res.status_code == 200
    data = res.json()
    assert data.get("ok") is True
    assert "hotkey" in data

    # 2. Check shortcut conflicts
    res_check = client.post("/api/desktop/shortcut/check", json={"hotkey": "Alt+Shift+Space"})
    assert res_check.status_code == 200
    assert "conflict" in res_check.json()

    # 3. Test empty shortcut rejection
    res_empty = client.post("/api/desktop/shortcut", json={"hotkey": ""})
    assert res_empty.status_code == 400

    # 4. Set valid shortcut
    res_set = client.post("/api/desktop/shortcut", json={"hotkey": "Alt+Shift+Space"})
    assert res_set.status_code == 200
    assert res_set.json().get("ok") is True


@pytest.mark.asyncio
async def test_emoji_provider():
    ep = EmojiProvider()
    results = [r async for r in ep.search(":fire", "test_emoji_session")]
    assert len(results) > 0
    first = results[0]
    assert "🔥" in first.title
    assert first.badge == "EMOJI"

    # Test execution
    res = await ep.execute(first.actions[0].id, first.actions[0].handler_payload)
    assert res.get("ok") is True
    assert res.get("copied") == "🔥"


@pytest.mark.asyncio
async def test_quicknote_provider():
    qp = QuickNoteProvider()
    results = [r async for r in qp.search("note: buy oat milk and coffee", "test_note_session")]
    assert len(results) > 0
    first = results[0]
    assert "buy oat milk" in first.title
    assert first.badge == "NEW NOTE"

    # Test saving note
    res = await qp.execute("save_note", {"text": "buy oat milk and coffee"})
    assert res.get("ok") is True
    assert "note" in res


@pytest.mark.asyncio
async def test_bookmark_provider():
    bp = BookmarkProvider()
    # Should not throw on search even if browser bookmarks file not found
    results = [r async for r in bp.search("bm test", "test_bm_session")]
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_commands_media_controls():
    cp = CommandProvider()
    # Test volume up command search
    results = [r async for r in cp.search("volume up", "test_cmd_session")]
    assert any("Volume" in r.title for r in results)

    # Test shell execution
    shell_results = [r async for r in cp.search("> echo hello", "test_cmd_session")]
    assert len(shell_results) > 0
    assert shell_results[0].badge == "SHELL"
