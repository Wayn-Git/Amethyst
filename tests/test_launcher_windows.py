import pytest
from unittest.mock import patch, MagicMock
from backend.launcher.providers.windows import WindowProvider, parse_wmctrl_output


SAMPLE_WMCTRL_OUTPUT = """0x00c00004  0 chatgpt.codex-desktop  cavelinux ChatGPT - Project Assistant
0x02800003  1 google-chrome.Google-chrome  cavelinux GitHub - Pull Requests
0x01a00001 -1 Desktop.Nautilus  cavelinux Desktop
"""


def test_parse_wmctrl_output():
    windows = parse_wmctrl_output(SAMPLE_WMCTRL_OUTPUT)
    # Should exclude desktop -1 sticky background
    assert len(windows) == 2
    chatgpt = windows[0]
    assert chatgpt.win_id == "0x00c00004"
    assert chatgpt.workspace == 0
    assert chatgpt.class_name == "chatgpt.codex-desktop"
    assert chatgpt.title == "ChatGPT - Project Assistant"

    chrome = windows[1]
    assert chrome.win_id == "0x02800003"
    assert chrome.workspace == 1
    assert "GitHub" in chrome.title


@pytest.mark.asyncio
async def test_window_provider_search():
    provider = WindowProvider()
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_WMCTRL_OUTPUT)
        
        # 1. Search 'chat'
        results = [r async for r in provider.search("chat", "s1")]
        assert len(results) == 1
        assert "0x00c00004" in results[0].id
        assert results[0].provider_id == "window"
        assert results[0].actions[0].id == "focus"

        # 2. Search 'git'
        git_results = [r async for r in provider.search("git", "s2")]
        assert len(git_results) == 1
        assert "0x02800003" in git_results[0].id


@pytest.mark.asyncio
async def test_window_provider_execute():
    provider = WindowProvider()
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        res = await provider.execute("focus", {"win_id": "0x02800003"})
        assert res.get("ok") is True
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert args == ["wmctrl", "-i", "-a", "0x02800003"]
