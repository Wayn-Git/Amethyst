import pytest
from httpx import AsyncClient, ASGITransport
from backend.api.main import app
from backend.library.enrich import enrich_text, Enrichment


@pytest.mark.asyncio
async def test_api_models_test_endpoint_failure():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/models/test", json={"provider": "nonexistent_prov", "model": "fake_model"})
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is False
        assert "nonexistent_prov" in data["error"]


@pytest.mark.asyncio
async def test_enrich_text_explicit_model_does_not_silently_fallback():
    # Calling enrich_text with an explicit broken model must not silently pick default_chain models
    res = await enrich_text(
        "A sufficiently long text for enrichment testing about coffee grinding and brewing techniques.",
        title="Coffee Guide",
        text_source="page",
        provider="nonexistent_provider",
        model="nonexistent_model",
    )
    assert isinstance(res, Enrichment)
    # The note must mention the explicit model failure and NOT return a summary from a random fallback chain
    assert res.note is not None
    assert "nonexistent_provider:nonexistent_model" in res.note
    assert res.provider == "nonexistent_provider"
    assert res.model == "nonexistent_model"
