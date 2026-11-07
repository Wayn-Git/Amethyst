"""Tests for AI provider detector registry, detected-to-connected state machine, and vault writes."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from backend.api.main import app
from backend.detectors.registry import (
    DetectedProvider,
    EnvVarDetector,
    HermesDetector,
    KiloCodeDetector,
    LMStudioDetector,
    OllamaDetector,
    OpenCodeDetector,
    get_cached_detection,
    scan_all_detectors,
)
from backend.secrets import get_secret, set_secret


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_opencode_dir(tmp_path, monkeypatch):
    cfg_dir = tmp_path / "opencode"
    cfg_dir.mkdir(parents=True)
    cfg_file = cfg_dir / "opencode.jsonc"
    cfg_file.write_text(
        """// OpenCode sample config
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode-zen": {
      "options": {
        "baseURL": "https://opencode.ai/zen/v1",
        "apiKey": "zen_test_key_12345"
      },
      "models": {
        "kimi-k2.6": { "name": "Kimi K2.6" }
      }
    },
    "anthropic": {
      "options": {
        "apiKey": "sk-ant-test-key-67890"
      },
      "models": {
        "claude-3-7-sonnet-latest": { "name": "Sonnet" }
      }
    }
  }
}
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENCODE_CONFIG", str(cfg_file))
    return cfg_file


@pytest.fixture
def mock_hermes_dir(tmp_path, monkeypatch):
    h_dir = tmp_path / "hermes"
    h_dir.mkdir(parents=True)
    h_file = h_dir / "config.yaml"
    h_file.write_text(
        """
provider: groq
api_key: gsk_hermes_test_key_11111
model: llama-3.3-70b-versatile
base_url: https://api.groq.com/openai/v1
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_CONFIG", str(h_file))
    return h_file


@pytest.fixture
def mock_kilo_dir(tmp_path, monkeypatch):
    k_dir = tmp_path / ".config" / "Code" / "User"
    k_dir.mkdir(parents=True)
    k_file = k_dir / "settings.json"
    k_file.write_text(
        json.dumps({"kilo.apiKey": "kilo_test_key_22222"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return k_file



@pytest.mark.asyncio
async def test_env_var_detector(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-test123456789")
    monkeypatch.setenv("GROQ_API_KEY", "gsk_testgroq123456789")

    detector = EnvVarDetector()
    results = await detector.detect()
    slugs = {r.provider for r in results}
    assert "openai" in slugs
    assert "groq" in slugs

    openai_det = next(r for r in results if r.provider == "openai")
    assert openai_det.api_key == "sk-proj-test123456789"
    assert openai_det.default_model == "gpt-4o"
    masked = openai_det.to_dict(mask_key=True)["masked_key"]
    assert "sk-p" in masked
    assert "6789" in masked


@pytest.mark.asyncio
async def test_opencode_detector(mock_opencode_dir):
    detector = OpenCodeDetector()
    results = await detector.detect()
    ids = {r.id for r in results}
    assert "opencode-zen" in ids
    assert "opencode-anthropic" in ids

    zen = next(r for r in results if r.id == "opencode-zen")
    assert zen.api_key == "zen_test_key_12345"
    assert zen.default_model == "kimi-k2.6"


@pytest.mark.asyncio
async def test_hermes_detector(mock_hermes_dir):
    detector = HermesDetector()
    results = await detector.detect()
    assert len(results) == 1
    assert results[0].provider == "groq"
    assert results[0].api_key == "gsk_hermes_test_key_11111"
    assert results[0].default_model == "llama-3.3-70b-versatile"


@pytest.mark.asyncio
async def test_hermes_candidate_paths_without_env(monkeypatch):
    monkeypatch.delenv("HERMES_CONFIG", raising=False)
    monkeypatch.delenv("HERMES_CONFIG_DIR", raising=False)
    detector = HermesDetector()
    paths = detector._get_candidate_paths()
    assert isinstance(paths, list)
    assert len(paths) >= 2


@pytest.mark.asyncio
async def test_kilo_detector(mock_kilo_dir):
    detector = KiloCodeDetector()
    results = await detector.detect()
    assert len(results) == 1
    assert results[0].provider == "kilocode"
    assert results[0].api_key == "kilo_test_key_22222"


@pytest.mark.asyncio
async def test_malformed_config_fails_silently(tmp_path, monkeypatch):
    bad_file = tmp_path / "bad.jsonc"
    bad_file.write_text("{ this is not valid json at all", encoding="utf-8")
    monkeypatch.setenv("OPENCODE_CONFIG", str(bad_file))

    detector = OpenCodeDetector()
    results = await detector.detect()
    assert results == []


def test_detect_models_api(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-testapi123")
    resp = client.get("/api/setup/detect-models")
    assert resp.status_code == 200
    data = resp.json()
    assert "detections" in data
    found_openai = any(d["provider"] == "openai" for d in data["detections"])
    assert found_openai


def test_connect_detected_success_writes_vault_and_config(client, monkeypatch):
    # Setup mock detection in cache
    from backend.detectors.registry import _CACHED_DETECTIONS

    det = DetectedProvider(
        id="test-groq-det",
        name="Groq Test",
        provider="groq",
        source="test fixture",
        api_key="gsk_valid_key_test_123",
        default_model="llama-3.3-70b-versatile",
    )
    _CACHED_DETECTIONS[det.id] = det

    # Mock verify_provider_route to succeed
    async def mock_verify(name, body):
        return {"valid": True, "status": "ok", "message": "Key valid", "models": [{"id": "llama-3.3-70b-versatile"}]}

    monkeypatch.setattr("backend.api.main.verify_provider_route", mock_verify)

    resp = client.post("/api/setup/connect-detected", json={"detection_id": "test-groq-det"})
    assert resp.status_code == 200
    res_data = resp.json()
    assert res_data["ok"] is True
    assert res_data["status"] == "connected"
    assert res_data["provider"] == "groq"

    # Verify secret is saved to vault
    assert get_secret("amethyst/groq") == "gsk_valid_key_test_123"


def test_connect_detected_failure_does_not_save_vault(client, monkeypatch):
    from backend.detectors.registry import _CACHED_DETECTIONS
    from backend.secrets import delete_secret

    delete_secret("amethyst/groq")

    det = DetectedProvider(
        id="test-groq-fail",
        name="Groq Fail",
        provider="groq",
        source="test fixture",
        api_key="gsk_invalid_key_456",
        default_model="llama-3.3-70b-versatile",
    )
    _CACHED_DETECTIONS[det.id] = det

    async def mock_verify(name, body):
        return {"valid": False, "status": "invalid_key", "message": "Authentication failed (401)"}

    monkeypatch.setattr("backend.api.main.verify_provider_route", mock_verify)

    resp = client.post("/api/setup/connect-detected", json={"detection_id": "test-groq-fail"})
    assert resp.status_code == 200
    res_data = resp.json()
    assert res_data["ok"] is False
    assert res_data["status"] == "failed"
    assert "Authentication failed" in res_data["message"]

    # Crucial security rule: vault must NOT contain the failed key
    assert get_secret("amethyst/groq") is None
