import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.mcp import catalogue as cat
from backend.mcp.catalogue import CATALOGUE, RuntimeKind


def test_catalogue_entries_have_runtime_kind():
    """Verify that catalogue entries declare structured runtime kinds."""
    by_id = {e.id: e for e in CATALOGUE}
    
    assert "microsoft-todo" in by_id
    assert by_id["microsoft-todo"].runtime == RuntimeKind.NODE
    
    assert "fetch" in by_id
    assert by_id["fetch"].runtime == RuntimeKind.UV
    
    assert "playwright" in by_id
    assert by_id["playwright"].runtime == RuntimeKind.NODE


def test_check_runtime_helper(monkeypatch, tmp_path):
    """Verify runtime requirement evaluation against system PATH and ~/.amethyst/bin."""
    # When binary is missing
    monkeypatch.setattr("shutil.which", lambda name: None)
    fake_amethyst_bin = tmp_path / ".amethyst" / "bin"
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    
    ok, reason = cat.check_runtime(RuntimeKind.UV)
    assert ok is False
    assert "uv" in reason.lower()
    
    # When binary exists in ~/.amethyst/bin
    fake_amethyst_bin.mkdir(parents=True, exist_ok=True)
    fake_uv = fake_amethyst_bin / "uv"
    fake_uv.write_text("#!/bin/sh\nexit 0\n")
    fake_uv.chmod(0o755)
    
    ok, reason = cat.check_runtime(RuntimeKind.UV)
    assert ok is True
    assert reason is None


def test_setup_status_discovers_amethyst_bin(monkeypatch, tmp_path):
    """Verify setup_status checks ~/.amethyst/bin for runtimes."""
    from backend.setup_status import get_setup_status
    import asyncio
    
    fake_amethyst_bin = tmp_path / ".amethyst" / "bin"
    fake_amethyst_bin.mkdir(parents=True, exist_ok=True)
    fake_uv = fake_amethyst_bin / "uvx"
    fake_uv.write_text("#!/bin/sh\nexit 0\n")
    fake_uv.chmod(0o755)
    
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr("shutil.which", lambda name: None)
    
    status = asyncio.run(get_setup_status())
    assert status["runtimes"]["uvx"] is True


def test_install_uv_endpoint(tmp_path, monkeypatch):
    """Verify POST /api/setup/runtimes/uv/install downloads and sets up executable."""
    client = TestClient(app)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    
    # Mock httpx download of uv release archive/binary
    fake_tar_bytes = b"fake binary content"
    
    async def mock_download(*args, **kwargs):
        class MockResp:
            status_code = 200
            content = fake_tar_bytes
            def raise_for_status(self): pass
        return MockResp()

    with patch("httpx.AsyncClient.get", side_effect=mock_download):
        with patch("tarfile.is_tarfile", return_value=False), patch("zipfile.is_zipfile", return_value=False):
            res = client.post("/api/setup/runtimes/uv/install")
            assert res.status_code == 200
            data = res.json()
            assert data["ok"] is True
            bin_dir = tmp_path / ".amethyst" / "bin"
            assert (bin_dir / "uv").exists()
            assert (bin_dir / "uvx").exists()
            assert os.access(str(bin_dir / "uv"), os.X_OK)
