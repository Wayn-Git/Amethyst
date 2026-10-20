import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from backend.launcher.providers.files import FileProvider


@pytest.mark.asyncio
async def test_file_provider_search(tmp_path):
    # Setup test file tree
    doc1 = tmp_path / "quarterly_report.pdf"
    doc1.write_text("dummy pdf")
    code1 = tmp_path / "main_server.py"
    code1.write_text("print('hello')")
    hidden = tmp_path / ".secret_note.txt"
    hidden.write_text("ignore me")

    provider = FileProvider(search_roots=[tmp_path])

    # 1. Search 'report'
    results = [r async for r in provider.search("report", "s1")]
    assert len(results) == 1
    assert "quarterly_report.pdf" in results[0].title
    assert results[0].provider_id == "files"
    assert results[0].badge == "PDF"

    # 2. Search prefix 'f main'
    f_results = [r async for r in provider.search("f main", "s2")]
    assert len(f_results) == 1
    assert "main_server.py" in f_results[0].title
    assert f_results[0].score >= 90

    # 3. Hidden file excluded
    secret_results = [r async for r in provider.search("secret", "s3")]
    assert len(secret_results) == 0


@pytest.mark.asyncio
async def test_file_provider_execution(tmp_path):
    target_file = tmp_path / "test.txt"
    target_file.write_text("test content")

    provider = FileProvider(search_roots=[tmp_path])

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        res = await provider.execute("open", {"path": str(target_file)})
        assert res.get("ok") is True
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "gio" in args[0] or "xdg-open" in args[0]
        assert str(target_file) in args
