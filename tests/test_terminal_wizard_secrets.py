import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import scripts.setup_wizard as wizard


def test_setup_models_saves_to_secrets_and_config(monkeypatch, tmp_path):
    """R16: setup_models must store secrets via set_secret and add_provider, NOT plaintext .env."""
    saved_secrets = {}
    saved_providers = []
    env_writes = []

    monkeypatch.setattr(wizard, "set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr(wizard, "get_secret", lambda ref: saved_secrets.get(ref))
    monkeypatch.setattr(wizard, "write_env_key", lambda k, v: env_writes.append((k, v)))
    monkeypatch.setattr("backend.config.add_provider", lambda entry: saved_providers.append(entry))

    # Mock user input: choice "4" (Groq), key "gsk_test_key_12345"
    inputs = iter(["4", "gsk_test_key_12345"])
    monkeypatch.setattr(wizard, "prompt_input", lambda prompt, default="": next(inputs))

    wizard.setup_models()

    assert saved_secrets.get("amethyst/groq") == "gsk_test_key_12345"
    assert any(p.get("name") == "groq" for p in saved_providers)
    # Crucial: Must NOT write API key into .env
    assert not any("KEY" in k for k, _ in env_writes)


def test_setup_connectors_saves_github_pat(monkeypatch):
    """R16: setup_connectors saves GitHub PAT using set_secret without writing .env."""
    saved_secrets = {}
    env_writes = []

    monkeypatch.setattr(wizard, "set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr(wizard, "write_env_key", lambda k, v: env_writes.append((k, v)))
    monkeypatch.setattr("backend.mcp.commands.add_from_catalogue", lambda name: None)

    # Mock user input: choice "3" (GitHub), token "ghp_mock_token_999"
    inputs = iter(["3", "ghp_mock_token_999"])
    monkeypatch.setattr(wizard, "prompt_input", lambda prompt, default="": next(inputs))

    wizard.setup_connectors()

    assert saved_secrets.get("amethyst-mcp/github.api_key") == "ghp_mock_token_999"
    assert env_writes == []


def test_setup_connectors_saves_google_and_spotify(monkeypatch):
    """R16: setup_connectors saves Google and Spotify credentials to set_secret without writing .env."""
    saved_secrets = {}
    env_writes = []
    configured_oauth = []

    monkeypatch.setattr(wizard, "set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr(wizard, "write_env_key", lambda k, v: env_writes.append((k, v)))
    monkeypatch.setattr("backend.mcp.commands.add_from_catalogue", lambda name: None)
    monkeypatch.setattr(
        "backend.mcp.commands.set_oauth_client",
        lambda name, cid, sec: configured_oauth.append((name, cid, sec)),
    )

    # Test Google Workspace: choice "2", client_id, client_secret
    inputs_google = iter(["2", "google-cid-123", "google-sec-456"])
    monkeypatch.setattr(wizard, "prompt_input", lambda prompt, default="": next(inputs_google))
    wizard.setup_connectors()

    assert saved_secrets.get("amethyst/google-client-id") == "google-cid-123"
    assert saved_secrets.get("amethyst/google-client-secret") == "google-sec-456"
    assert saved_secrets.get("amethyst-mcp/google-workspace.client_secret") == "google-sec-456"
    assert ("google-workspace", "google-cid-123", "google-sec-456") in configured_oauth
    assert env_writes == []

    # Test Spotify: choice "4", client_id, client_secret
    inputs_spotify = iter(["4", "spotify-cid-789", "spotify-sec-012"])
    monkeypatch.setattr(wizard, "prompt_input", lambda prompt, default="": next(inputs_spotify))
    wizard.setup_connectors()

    assert saved_secrets.get("amethyst/spotify-client-id") == "spotify-cid-789"
    assert saved_secrets.get("amethyst/spotify-client-secret") == "spotify-sec-012"
    assert saved_secrets.get("amethyst-mcp/spotify.client_secret") == "spotify-sec-012"
    assert ("spotify", "spotify-cid-789", "spotify-sec-012") in configured_oauth
    assert env_writes == []


def test_setup_cloudflare_saves_to_secrets_and_config(monkeypatch):
    """R16: setup_cloudflare saves API token to set_secret and provider config without writing .env."""
    saved_secrets = {}
    saved_providers = []
    env_writes = []

    monkeypatch.setattr(wizard, "set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr(wizard, "write_env_key", lambda k, v: env_writes.append((k, v)))
    monkeypatch.setattr("backend.config.add_provider", lambda entry: saved_providers.append(entry))

    # Mock user input: account_id "cf_acc_123", token "cf_tok_456", use_emb "n"
    inputs = iter(["cf_acc_123", "cf_tok_456", "n"])
    monkeypatch.setattr(wizard, "prompt_input", lambda prompt, default="": next(inputs))

    wizard.setup_cloudflare()

    assert saved_secrets.get("amethyst/cloudflare") == "cf_tok_456"
    assert any(
        p.get("name") == "cloudflare"
        and "cf_acc_123" in p.get("base_url", "")
        and p.get("api_key_ref") == "amethyst/cloudflare"
        for p in saved_providers
    )
    assert env_writes == []

