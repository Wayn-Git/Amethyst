def test_install_view_registered():
    from pathlib import Path

    install_jsx = Path("frontend/src/views/Install.jsx")
    assert install_jsx.exists()
    content = install_jsx.read_text()
    assert "Install once." in content
    assert "Download for Mac" in content
    assert "Download for PC" in content
    assert "Pair iPhone" in content or "Download on the App Store" in content
    assert "install.ps1" in content
    assert "install.sh" in content

    registry_js = Path("frontend/src/views/registry.js")
    assert "install" in registry_js.read_text().lower()
