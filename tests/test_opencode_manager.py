"""Tests for OpenCode manager process lifecycle and binary discovery."""

import os
import shutil
import pytest
from backend.opencode.manager import _find_binary, OpenCodeManager

def test_find_binary_resolves_or_none():
    """_find_binary should find installed binary or return None without error."""
    path = _find_binary()
    if shutil.which("opencode"):
        assert path is not None
        assert os.path.exists(path)
    else:
        assert path is None or isinstance(path, str)

def test_find_binary_env_var_override(monkeypatch, tmp_path):
    """OPENCODE_BIN env var should take top priority."""
    fake_bin = tmp_path / "custom-opencode"
    fake_bin.write_text("#!/bin/sh\necho ok")
    fake_bin.chmod(0o755)

    monkeypatch.setenv("OPENCODE_BIN", str(fake_bin))
    assert _find_binary() == str(fake_bin)

def test_manager_initialization():
    """OpenCodeManager initializes with safe defaults and without active process."""
    mgr = OpenCodeManager()
    assert not mgr.is_running
    assert mgr.port is None
    assert mgr.raw_port is None
