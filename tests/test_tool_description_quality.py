from __future__ import annotations

import json
import pytest

from backend.tools.builtin.filesystem import tools as fs_tools
from backend.tools.builtin.shell import tools as shell_tools
from backend.tools.builtin.web import tools as web_tools
from backend.tools.builtin.ask import tools as ask_tools
from backend.agent.scratch_store import scratch_tool
from backend.mcp.composio_service import STATIC_PINNED_SCHEMAS


REQUIRED_SECTIONS = [
    "WHAT IT DOES",
    "WHEN TO USE",
    "WHEN NOT TO USE",
    "EXAMPLE",
]


def _assert_quality_description(name: str, description: str):
    assert description, f"Tool {name} has empty description"
    for section in REQUIRED_SECTIONS:
        assert section in description, f"Tool {name} description missing required section: '{section}'"


def test_builtin_tool_descriptions():
    all_builtin = (
        fs_tools()
        + shell_tools()
        + web_tools()
        + ask_tools()
        + [scratch_tool()]
    )
    tools_by_name = {t.name: t for t in all_builtin}

    target_builtins = [
        "view_file",
        "list_files",
        "grep_files",
        "write_file",
        "create_artifact",
        "edit_file",
        "run_shell_command",
        "search_web",
        "fetch_url",
        "ask_user",
        "read_scratch_payload",
    ]

    for name in target_builtins:
        assert name in tools_by_name, f"Target builtin tool '{name}' not found"
        _assert_quality_description(name, tools_by_name[name].description)


def test_composio_static_tool_descriptions():
    pinned_by_slug = {}
    for tk_tools in STATIC_PINNED_SCHEMAS.values():
        for t in tk_tools:
            pinned_by_slug[t["slug"]] = t

    target_composio = [
        "GOOGLECALENDAR_FIND_EVENT",
        "GOOGLECALENDAR_CREATE_EVENT",
        "GMAIL_FETCH_EMAILS",
        "GMAIL_SEND_EMAIL",
        "GITHUB_GET_AN_ISSUE",
        "GITHUB_CREATE_AN_ISSUE",
        "SLACK_SEND_MESSAGE",
        "SLACK_SEARCH_MESSAGES",
        "NOTION_SEARCH_NOTION_PAGE",
    ]

    for slug in target_composio:
        assert slug in pinned_by_slug, f"Target composio tool '{slug}' not found in STATIC_PINNED_SCHEMAS"
        _assert_quality_description(slug, pinned_by_slug[slug]["description"])
