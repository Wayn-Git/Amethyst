import json
import pytest
from starlette.testclient import TestClient
from backend.api.main import app


def test_ollama_pull_streaming(monkeypatch):
    import httpx

    class MockStreamResponse:
        status_code = 200

        def __init__(self, *args, **kwargs):
            pass

        async def aiter_bytes(self):
            yield b'{"status": "pulling manifest"}\n'
            yield b'{"status": "downloading", "total": 1000, "completed": 500}\n'
            yield b'{"status": "success"}\n'

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    def mock_send(self, request, *args, **kwargs):
        return MockStreamResponse()

    # Monkeypatch the streaming call in backend.runtime.providers.ollama.stream_pull
    from backend.runtime.providers import ollama as ollama_provider

    async def mock_stream_pull(model: str, base_url: str = ollama_provider.DEFAULT_BASE):
        yield b'{"status": "pulling manifest"}\n'
        yield b'{"status": "downloading", "total": 1000, "completed": 500}\n'
        yield b'{"status": "success"}\n'

    monkeypatch.setattr(ollama_provider, "stream_pull", mock_stream_pull)

    with TestClient(app) as client:
        resp = client.post("/api/ollama/pull", json={"model": "llama3.2"})
        assert resp.status_code == 200
        content = resp.text
        assert "pulling manifest" in content
        assert "downloading" in content
        assert "success" in content
