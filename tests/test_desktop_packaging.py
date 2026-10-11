def test_electron_package_json_configuration():
    import json
    from pathlib import Path

    pkg_path = Path("package.json")
    assert pkg_path.exists()
    pkg = json.loads(pkg_path.read_text())
    assert "electron" in pkg.get("devDependencies", {}) or "electron" in pkg.get("dependencies", {})
    assert "electron-builder" in pkg.get("devDependencies", {})
    assert "electron-updater" in pkg.get("dependencies", {})
    assert "dev:desktop" in pkg.get("scripts", {})
    assert "package:desktop" in pkg.get("scripts", {})

    builder_cfg = Path("electron-builder.yml")
    assert builder_cfg.exists()
    content = builder_cfg.read_text()
    assert "appId: ai.amethyst.desktop" in content
    assert "publish:" in content
    assert "provider: github" in content
