import pytest


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


def _load_freeze_entry():
    import importlib.util
    from pathlib import Path

    freeze_path = Path(__file__).resolve().parents[1] / "packaging" / "freeze_entry.py"
    spec = importlib.util.spec_from_file_location("freeze_entry", freeze_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_freeze_entry_routes_through_cli(monkeypatch):
    import sys
    fe = _load_freeze_entry()

    called_argv = []

    def mock_cli_main(argv=None):
        called_argv.append(argv)
        return 0

    monkeypatch.setattr(fe, "cli_main", mock_cli_main)
    monkeypatch.setattr(sys, "argv", ["amethyst-backend", "doctor"])
    with pytest.raises(SystemExit):
        fe.main()
    assert called_argv == [["doctor"]]


def test_freeze_entry_default_serve(monkeypatch):
    import sys
    fe = _load_freeze_entry()

    called_argv = []

    def mock_cli_main(argv=None):
        called_argv.append(argv)
        return 0

    monkeypatch.setattr(fe, "cli_main", mock_cli_main)
    monkeypatch.setattr(sys, "argv", ["amethyst-backend"])
    monkeypatch.setenv("AMETHYST_PORT", "8005")
    monkeypatch.setenv("AMETHYST_HOST", "127.0.0.1")
    with pytest.raises(SystemExit):
        fe.main()
    assert len(called_argv) == 1
    assert "serve" in called_argv[0]
    assert "--port" in called_argv[0] and "8005" in called_argv[0]
    assert "--host" in called_argv[0] and "127.0.0.1" in called_argv[0]
    assert "--no-build" in called_argv[0]



