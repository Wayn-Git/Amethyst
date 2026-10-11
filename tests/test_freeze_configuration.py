def test_freeze_configuration():
    from pathlib import Path

    entry = Path("packaging/freeze_entry.py")
    assert entry.exists()
    content = entry.read_text()
    assert "uvicorn" in content
    assert "backend.api.main" in content

    spec = Path("packaging/amethyst-backend.spec")
    assert spec.exists()
    spec_content = spec.read_text()
    assert "Analysis(" in spec_content
    assert "hiddenimports" in spec_content
    assert "uvicorn.logging" in spec_content
    assert "sqlite_vec" in spec_content
