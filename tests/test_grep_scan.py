"""Phase 1: fast file scan (ripgrep/fd) with a pruned Python fallback.

Both engines must find the same hits, must skip node_modules/.venv, and the
pure-Python path must not choke on a tree with a package cache in it.
"""

from __future__ import annotations

import pytest

from backend.tools.base import ToolContext
from backend.tools.builtin import filesystem


def _seed(root):
    (root / "app.py").write_text("alpha = 1\nbeta = 2\n")
    (root / "notes.txt").write_text("beta again\n")
    junk = root / "node_modules" / "pkg"
    junk.mkdir(parents=True)
    (junk / "index.js").write_text("beta in a dependency\n")
    venv = root / ".venv" / "lib"
    venv.mkdir(parents=True)
    (venv / "thing.py").write_text("beta in the venv\n")


@pytest.mark.asyncio
async def test_grep_excludes_package_dirs(workspace):
    _seed(workspace)
    ctx = ToolContext(workspace_root=str(workspace))
    result = await filesystem.grep_files({"pattern": "beta"}, ctx)
    assert not result.is_error
    assert "app.py:2" in result.content
    assert "notes.txt:1" in result.content
    # node_modules and .venv must never leak into a content search.
    assert "node_modules" not in result.content
    assert ".venv" not in result.content


@pytest.mark.asyncio
async def test_ripgrep_and_python_agree(workspace, monkeypatch):
    _seed(workspace)
    ctx = ToolContext(workspace_root=str(workspace))
    rg_out = await filesystem.grep_files({"pattern": "beta"}, ctx)

    # Force the fallback by hiding every CLI helper.
    monkeypatch.setattr(filesystem, "_tool", lambda name: None)
    py_out = await filesystem.grep_files({"pattern": "beta"}, ctx)

    def hits(text):
        return sorted(ln.split(":", 1)[0] for ln in text.splitlines() if ":" in ln)

    assert hits(rg_out.content) == hits(py_out.content)


@pytest.mark.asyncio
async def test_list_files_recursive_skips_package_dirs(workspace):
    _seed(workspace)
    ctx = ToolContext(workspace_root=str(workspace))
    result = await filesystem.list_files({"path": ".", "recursive": True}, ctx)
    assert "app.py" in result.content
    assert "node_modules" not in result.content
    assert ".venv" not in result.content
