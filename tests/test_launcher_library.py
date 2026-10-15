import pytest
from backend.launcher.providers.commands import CommandProvider
from backend.launcher.providers.library import LibraryProvider


@pytest.mark.asyncio
async def test_command_provider_search():
    provider = CommandProvider()

    # Empty query yields default/frequent commands
    all_cmds = [r async for r in provider.search("", session_id="s1")]
    assert len(all_cmds) >= 5

    # Specific command search
    theme_cmds = [r async for r in provider.search("theme", session_id="s2")]
    assert any("Theme" in r.title or "theme" in (r.subtitle or "").lower() for r in theme_cmds)

    chat_cmds = [r async for r in provider.search("chat", session_id="s3")]
    assert any("Chat" in r.title for r in chat_cmds)


@pytest.mark.asyncio
async def test_command_provider_execute():
    provider = CommandProvider()
    res = await provider.execute("run", {"command_id": "nav:chat"})
    assert res.get("status") == "ok"
    assert res.get("action") == "navigate"
    assert res.get("target") == "chat"


@pytest.mark.asyncio
async def test_library_provider_search(monkeypatch):
    provider = LibraryProvider()

    # Mock service search
    fake_items = [
        {
            "id": 101,
            "title": "Deep Learning with Python",
            "url": "https://example.com/dl",
            "kind": "article",
            "site": "example.com",
            "excerpt": "A comprehensive guide to neural networks...",
            "summary": "Key insights into backprop.",
        }
    ]

    async def fake_search(query, limit=10):
        return fake_items

    monkeypatch.setattr(provider, "_search_library_items", fake_search)

    results = [r async for r in provider.search("neural", session_id="s1")]
    assert len(results) == 1
    r = results[0]
    assert r.title == "Deep Learning with Python"
    assert r.provider_id == "library"
    assert r.preview_type == "markdown"
    assert r.actions[0].id == "open"
