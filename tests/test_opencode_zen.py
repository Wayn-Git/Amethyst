"""Tests for OpenCode Zen provider adapter, header injection, tool mapping, and argument normalization."""

from __future__ import annotations

import pytest

from backend.config import ProviderConfig
from backend.runtime.providers.openai_compat import (
    OPENCODE_CORE_TOOLS,
    OPENCODE_USER_AGENT,
    OpenAICompatClient,
    auth_headers_for_config,
    normalize_model_name,
)
from backend.runtime.types import ToolSchema
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.builtin.filesystem import edit_file, view_file
from backend.tools.registry import CAPABILITY_MAP, ToolRegistry


def test_opencode_model_normalization():
    assert normalize_model_name("https://opencode.ai/zen/v1", "mimo") == "mimo-v2.6-flash-free"
    assert normalize_model_name("https://opencode.ai/zen/v1", "mimo-flash") == "mimo-v2.6-flash-free"
    assert normalize_model_name("opencode-zen", "big pickle") == "big-pickle"
    assert normalize_model_name("opencode-zen", "pickle") == "big-pickle"
    assert normalize_model_name("opencode-zen", "space bunny") == "space-bunny-free"
    assert normalize_model_name("opencode-zen", "muse-spark") == "muse-spark-1.3-contributor-free"
    assert normalize_model_name("opencode-zen", "nemotron") == "nemotron-3.5-lightning-free"


def test_opencode_client_detection_and_headers():
    client = OpenAICompatClient(
        base_url="https://opencode.ai/zen/v1",
        api_key="test-key",
        model="mimo-v2.6-flash-free",
    )
    assert client.is_opencode is True

    headers = client._headers()
    assert headers["Authorization"] == "Bearer test-key"
    assert headers["User-Agent"] == OPENCODE_USER_AGENT
    assert headers["x-opencode-client"] == "cli"
    assert headers["x-opencode-session"].startswith("ses_")
    assert headers["x-opencode-session-id"] == headers["x-opencode-session"]
    assert headers["x-opencode-request"].startswith("msg_")


def test_opencode_payload_injects_core_tools_and_stream():
    client = OpenAICompatClient(
        base_url="https://opencode.ai/zen/v1",
        api_key="test-key",
        model="mimo-v2.6-flash-free",
    )
    # Even with tools=None, opencode payload must include stream=True and OPENCODE_CORE_TOOLS
    payload = client._build_payload(
        messages=[{"role": "user", "content": "hello"}],
        tools=None,
        params=None,
        stream=False,
    )
    assert payload["stream"] is True
    tool_names = [t["function"]["name"] for t in payload.get("tools", [])]
    assert "read" in tool_names
    assert "edit" in tool_names
    assert "bash" in tool_names

    # When user tools are provided, core tools are merged without duplicates
    custom_tools = [
        ToolSchema(name="search_web", description="web search", parameters={"type": "object"}),
        ToolSchema(name="read", description="custom read", parameters={"type": "object"}),
    ]
    payload2 = client._build_payload(
        messages=[{"role": "user", "content": "hello"}],
        tools=custom_tools,
        params=None,
    )
    tool_names2 = [t["function"]["name"] for t in payload2.get("tools", [])]
    assert "search_web" in tool_names2
    assert "read" in tool_names2
    assert "edit" in tool_names2
    assert "bash" in tool_names2
    # Ensure no duplicates
    assert tool_names2.count("read") == 1


def test_auth_headers_for_config():
    config = ProviderConfig(
        name="opencode-zen",
        base_url="https://opencode.ai/zen/v1",
    )
    header_fn = auth_headers_for_config(config)
    hdrs = header_fn("secret-token")
    assert hdrs["Authorization"] == "Bearer secret-token"
    assert hdrs["User-Agent"] == OPENCODE_USER_AGENT
    assert hdrs["x-opencode-client"] == "cli"


def test_capability_map_and_argument_normalization():
    assert CAPABILITY_MAP["read"] == "view_file"
    assert CAPABILITY_MAP["edit"] == "edit_file"
    assert CAPABILITY_MAP["write"] == "write_file"
    assert CAPABILITY_MAP["glob"] == "list_files"
    assert CAPABILITY_MAP["bash"] == "run_shell_command"

    reg = ToolRegistry()
    dummy_view = Tool(
        name="view_file",
        description="read file",
        parameters={"type": "object", "properties": {"path": {"type": "string"}}},
        handler=view_file,
        risk=RiskLevel.LOW,
    )
    dummy_edit = Tool(
        name="edit_file",
        description="edit file",
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"},
            },
        },
        handler=edit_file,
        risk=RiskLevel.MEDIUM,
    )
    reg.register(dummy_view)
    reg.register(dummy_edit)

    # Resolve "read" tool via alias
    resolved = reg.resolve_tool("read")
    assert resolved is not None
    assert resolved.name == "view_file"

    # Normalize arguments from OpenCode (filePath) to Amethyst (path)
    norm = reg.normalize_arguments(resolved, {"filePath": "/test/file.py"})
    assert norm["path"] == "/test/file.py"

    # Resolve "edit" tool via alias and check camelCase parameter normalization
    resolved_edit = reg.resolve_tool("edit")
    assert resolved_edit is not None
    assert resolved_edit.name == "edit_file"
    norm_edit = reg.normalize_arguments(
        resolved_edit,
        {"filePath": "/test/file.py", "oldString": "foo", "newString": "bar", "replaceAll": True},
    )
    assert norm_edit["path"] == "/test/file.py"
    assert norm_edit["old_string"] == "foo"
    assert norm_edit["new_string"] == "bar"
    assert norm_edit["replace_all"] is True


@pytest.mark.asyncio
async def test_filesystem_defensive_aliases(tmp_path):
    test_file = tmp_path / "hello.txt"
    test_file.write_text("hello world")

    ctx = ToolContext(workspace_root=str(tmp_path))

    # view_file with filePath
    res = await view_file({"filePath": "hello.txt"}, ctx)
    assert not res.is_error
    assert "hello world" in res.content

    # edit_file with oldString / newString
    edit_res = await edit_file(
        {"filePath": "hello.txt", "oldString": "world", "newString": "amethyst"}, ctx
    )
    assert not edit_res.is_error
    assert test_file.read_text() == "hello amethyst"
