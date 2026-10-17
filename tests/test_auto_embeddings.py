import pytest
from unittest.mock import AsyncMock, patch
from backend.retrieval import embeddings


@pytest.mark.asyncio
async def test_auto_configure_returns_existing_configuration(monkeypatch):
    """When embeddings are already configured, return them without re-detecting."""
    monkeypatch.setattr(
        embeddings, "load_embeddings", lambda path=None: ("openai", "text-embedding-3-small")
    )
    detect_mock = AsyncMock()
    monkeypatch.setattr(embeddings, "detect", detect_mock)

    result = await embeddings.auto_configure_embeddings()
    assert result == ("openai", "text-embedding-3-small")
    detect_mock.assert_not_called()


@pytest.mark.asyncio
async def test_auto_configure_picks_and_saves_first_working_candidate(monkeypatch):
    """When unconfigured, probe candidates via detect() and persist the first match."""
    monkeypatch.setattr(embeddings, "load_embeddings", lambda path=None: None)
    monkeypatch.setattr(
        embeddings,
        "detect",
        AsyncMock(return_value=[("ollama", "nomic-embed-text", 768), ("cloudflare", "@cf/baai/bge-base-en-v1.5", 768)]),
    )
    saved = []
    monkeypatch.setattr(
        embeddings,
        "save_embeddings",
        lambda provider, model, path=None: saved.append((provider, model)),
    )

    result = await embeddings.auto_configure_embeddings()
    assert result == ("ollama", "nomic-embed-text")
    assert saved == [("ollama", "nomic-embed-text")]


@pytest.mark.asyncio
async def test_auto_configure_returns_none_when_no_candidates(monkeypatch):
    """When unconfigured and detect() finds nothing, return None without crashing."""
    monkeypatch.setattr(embeddings, "load_embeddings", lambda path=None: None)
    monkeypatch.setattr(embeddings, "detect", AsyncMock(return_value=[]))
    saved = []
    monkeypatch.setattr(
        embeddings,
        "save_embeddings",
        lambda provider, model, path=None: saved.append((provider, model)),
    )

    result = await embeddings.auto_configure_embeddings()
    assert result is None
    assert saved == []


def test_complete_setup_triggers_auto_embeddings(monkeypatch):
    """POST /api/setup/complete invokes auto_configure_embeddings and returns detected config."""
    from starlette.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)
    monkeypatch.setattr(
        "backend.retrieval.embeddings.auto_configure_embeddings",
        AsyncMock(return_value=("ollama", "nomic-embed-text")),
    )
    monkeypatch.setattr("backend.setup_status.mark_setup_complete", lambda opts: {"completed": True})

    resp = client.post("/api/setup/complete", json={"browser_enabled": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["completed"] is True
    assert data["embeddings"] == {"provider": "ollama", "model": "nomic-embed-text"}


def test_auto_configure_embeddings_route(monkeypatch):
    """POST /api/setup/embeddings/auto triggers auto_configure_embeddings."""
    from starlette.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)
    monkeypatch.setattr(
        "backend.retrieval.embeddings.auto_configure_embeddings",
        AsyncMock(return_value=("cloudflare", "@cf/baai/bge-base-en-v1.5")),
    )

    resp = client.post("/api/setup/embeddings/auto")
    assert resp.status_code == 200
    data = resp.json()
    assert data["configured"] is True
    assert data["provider"] == "cloudflare"
    assert data["model"] == "@cf/baai/bge-base-en-v1.5"
