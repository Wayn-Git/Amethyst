import inspect
from backend.mcp.catalogue import GOOGLE_SETUP_HINT
import scripts.setup_wizard as wiz


def test_setup_wizard_imports_google_setup_hint():
    """Verify that scripts/setup_wizard.py uses GOOGLE_SETUP_HINT from catalogue."""
    source = inspect.getsource(wiz)
    assert "GOOGLE_SETUP_HINT" in source
    assert "from backend.mcp.catalogue import" in source or "from backend.mcp import catalogue" in source


def test_setup_wizard_prints_true_redirect_uri(capsys, monkeypatch):
    """Verify setup_wizard prints the exact port 8765 redirect URI rather than 33418."""
    # Mock prompt_input to immediately return blank to skip waiting for input
    monkeypatch.setattr(wiz, "prompt_input", lambda prompt="": "")
    
    # Run choice 2 (Google Workspace)
    wiz.setup_connectors(auto_choice="2")
    captured = capsys.readouterr()
    
    assert "http://localhost:8765/oauth2callback" in captured.out
    assert "Web application" in captured.out
    assert "33418/oauth/callback" not in captured.out
