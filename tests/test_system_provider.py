import pytest
import sys
from backend.launcher.providers.system import SystemProvider, get_platform_command


def test_get_platform_command_normalizes_actions():
    assert get_platform_command("shutdown") is not None
    assert get_platform_command("act-sys-shutdown") is not None
    assert get_platform_command("reboot") is not None
    assert get_platform_command("lock") is not None
    assert get_platform_command("volume_mute") is not None


@pytest.mark.asyncio
async def test_system_provider_resolves_action_id_without_payload_command_id(monkeypatch):
    provider = SystemProvider()
    # Mock subprocess.run so we do not actually power off the machine during tests
    called = []

    def mock_run(args, **kwargs):
        called.append(args)
        class MockRes:
            returncode = 0
            stdout = "success"
            stderr = ""
        return MockRes()

    import subprocess
    monkeypatch.setattr(subprocess, "run", mock_run)

    # 1. Calling with action_id='shutdown' and empty payload
    res = await provider.execute("shutdown", {})
    assert res.get("ok") is True
    assert res.get("error") is None
    assert len(called) > 0

    # 2. Calling with action_id='act-sys-restart'
    res2 = await provider.execute("act-sys-restart", {})
    assert res2.get("ok") is True
