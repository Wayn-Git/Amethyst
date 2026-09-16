import pytest
import json
from unittest.mock import AsyncMock, patch
from backend.library.enrich import Enrichment
from backend.library.service import LibraryService
from backend.library.store import LibraryStore
from backend.retrieval.indexer import Indexer

class FakeEmbedder:
    provider, model = "ollama", "nomic-embed-text"
    async def embed(self, texts):
        return [[0.1, 0.2] for _ in texts]
    async def embed_one(self, text):
        return [0.1, 0.2]

@pytest.mark.asyncio
async def test_service_enrich_persists_entity(db, amethyst_home):
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
        store = LibraryStore(db)
        svc = LibraryService(store=store, indexer=Indexer(embedder=FakeEmbedder()))
        item_id = store.create(kind="video", title="Remain Calm", consumed_on="2026-10-18")
        store.update(item_id, text_source="caption")
        
        t_file = amethyst_home / "library" / f"{item_id:06d}-remain-calm.md"
        t_file.parent.mkdir(parents=True, exist_ok=True)
        t_file.write_text("People who laugh when they're nervous\n\nRemain Calm short film")
        store.update(item_id, text_path=str(t_file))

        await svc.enrich(item_id)
        saved = svc.store.get(item_id)
        assert saved["entity"] is not None
        entity_obj = json.loads(saved["entity"])
        assert entity_obj["title"] == "Remain Calm"
