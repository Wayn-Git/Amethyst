import os
import tempfile
import pytest
from pathlib import Path

from backend.launcher.providers.apps import (
    AppProvider,
    DesktopAppEntry,
    parse_desktop_file,
)


SAMPLE_DESKTOP_ENTRY = """[Desktop Entry]
Version=1.0
Type=Application
Name=Visual Studio Code
GenericName=Text Editor
Comment=Code Editing. Redefined.
Exec=/usr/share/code/code --unity-launch %F
Icon=vscode
Terminal=false
Categories=Utility;TextEditor;Development;IDE;
MimeType=text/plain;inode/directory;
Keywords=vscode;editor;
NoDisplay=false
"""

SAMPLE_HIDDEN_ENTRY = """[Desktop Entry]
Type=Application
Name=Hidden Internal App
Exec=hidden-tool
NoDisplay=true
"""


def test_parse_desktop_file():
    with tempfile.NamedTemporaryFile("w+", suffix=".desktop", delete=False) as f:
        f.write(SAMPLE_DESKTOP_ENTRY)
        f_path = Path(f.name)

    try:
        app = parse_desktop_file(f_path)
        assert app is not None
        assert app.name == "Visual Studio Code"
        assert app.generic_name == "Text Editor"
        assert app.icon == "vscode"
        assert app.clean_exec == "/usr/share/code/code --unity-launch"
        assert "vscode" in app.keywords
        assert not app.no_display
    finally:
        f_path.unlink(missing_ok=True)


def test_parse_hidden_desktop_file():
    with tempfile.NamedTemporaryFile("w+", suffix=".desktop", delete=False) as f:
        f.write(SAMPLE_HIDDEN_ENTRY)
        f_path = Path(f.name)

    try:
        app = parse_desktop_file(f_path)
        assert app is not None
        assert app.no_display is True
    finally:
        f_path.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_app_provider_search():
    with tempfile.TemporaryDirectory() as tmpdir:
        dir_path = Path(tmpdir)
        app_file = dir_path / "code.desktop"
        app_file.write_text(SAMPLE_DESKTOP_ENTRY)

        hidden_file = dir_path / "hidden.desktop"
        hidden_file.write_text(SAMPLE_HIDDEN_ENTRY)

        provider = AppProvider(search_dirs=[dir_path])
        provider.reload_index()

        # Search for "code"
        results = [r async for r in provider.search("code", session_id="test1")]
        assert len(results) == 1
        res = results[0]
        assert res.title == "Visual Studio Code"
        assert res.provider_id == "apps"
        assert res.preview_type == "app_info"
        assert len(res.actions) >= 1
        assert res.actions[0].id == "launch"
        assert res.actions[0].is_primary is True

        # Search for hidden app -> should return 0 results
        hidden_results = [
            r async for r in provider.search("Hidden", session_id="test2")
        ]
        assert len(hidden_results) == 0


@pytest.mark.asyncio
async def test_app_provider_launch(monkeypatch):
    provider = AppProvider(search_dirs=[])

    launched = []

    def fake_popen(args, **kwargs):
        launched.append(args)
        return object()

    monkeypatch.setattr("subprocess.Popen", fake_popen)
    monkeypatch.setattr("shutil.which", lambda cmd: None)

    res = await provider.execute(
        "launch",
        {"clean_exec": "echo test", "desktop_path": "/fake/path.desktop"},
    )
    assert res.get("status") == "ok"
    assert len(launched) == 1
    assert launched[0] == ["echo", "test"]

    # Test with gio enabled
    monkeypatch.setattr(
        "shutil.which", lambda cmd: "/usr/bin/gio" if cmd == "gio" else None
    )
    res2 = await provider.execute(
        "launch",
        {"clean_exec": "echo test", "desktop_path": "/fake/path.desktop"},
    )
    assert res2.get("status") == "ok"
    assert res2.get("method") == "gio"
    assert launched[1] == ["gio", "launch", "/fake/path.desktop"]
