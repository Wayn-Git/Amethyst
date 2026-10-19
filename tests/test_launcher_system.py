import pytest
from unittest.mock import patch, MagicMock
from backend.launcher.providers.system import SystemProvider


@pytest.mark.asyncio
async def test_system_provider_matching():
    provider = SystemProvider()

    # 1. Matching 'lock'
    results = [r async for r in provider.search("lock", "s1")]
    assert len(results) > 0
    assert any("lock" in r.id for r in results)
    lock_res = next(r for r in results if "lock" in r.id)
    assert lock_res.provider_id == "system"
    assert lock_res.score > 50

    # 2. Matching 'vol'
    vol_results = [r async for r in provider.search("vol", "s2")]
    assert len(vol_results) >= 2
    assert any("volume" in r.id for r in vol_results)

    # 3. Non-matching query
    empty = [r async for r in provider.search("xyz999foobar", "s3")]
    assert len(empty) == 0


@pytest.mark.asyncio
async def test_system_provider_execution():
    provider = SystemProvider()

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        res = await provider.execute("exec", {"command": "lock"})
        assert res.get("ok") is True
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "loginctl" in args or "lock" in args[0]
