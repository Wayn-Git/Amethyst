from backend.mcp import catalogue as cat
from backend.mcp import commands as cmd
from backend.mcp.config import ServerConfig, Transport
from backend.secrets import get_secret, set_secret


def test_github_catalogue_declares_api_key_ref():
    """Verify GitHub entry declares api_key_ref for Personal Access Token."""
    by_id = {e.id: e for e in cat.CATALOGUE}
    assert "github" in by_id
    gh = by_id["github"]
    assert gh.api_key_ref == "amethyst-mcp/github.api_key"
    assert gh.api_key_header == "Authorization"


def test_github_resolved_headers_with_pat(monkeypatch):
    """Verify resolved_headers formats PAT as Bearer token."""
    by_id = {e.id: e for e in cat.CATALOGUE}
    gh_entry = by_id["github"]
    config = gh_entry.to_server_config()
    
    # When PAT is set in secrets
    monkeypatch.setattr(
        "backend.secrets.get_secret",
        lambda ref: "ghp_mock_personal_access_token_12345" if ref == "amethyst-mcp/github.api_key" else None,
    )
    
    headers = config.resolved_headers()
    assert headers.get("Authorization") == "Bearer ghp_mock_personal_access_token_12345"


def test_github_missing_credentials_resolved_by_pat(monkeypatch):
    """Verify missing_credentials returns empty when PAT is configured."""
    by_id = {e.id: e for e in cat.CATALOGUE}
    gh_entry = by_id["github"]
    config = gh_entry.to_server_config()

    # Without PAT or OAuth client ID
    monkeypatch.setattr("backend.secrets.get_secret", lambda ref: None)
    monkeypatch.setattr("backend.mcp.commands.get_secret", lambda ref: None)
    assert len(cmd.missing_credentials(config)) > 0

    # With PAT
    pat_resolver = lambda ref: "ghp_mock_personal_access_token_12345" if ref == "amethyst-mcp/github.api_key" else None
    monkeypatch.setattr("backend.secrets.get_secret", pat_resolver)
    monkeypatch.setattr("backend.mcp.commands.get_secret", pat_resolver)
    assert cmd.missing_credentials(config) == []
    assert cmd.is_signed_in(config) is True
