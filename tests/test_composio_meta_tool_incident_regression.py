"""Regression tests for the 16 Oct Composio incident report:

"Incident report: Composio meta-tool interface caused 13 calls for a 2-call task"

Asserts:
1. The text/plain body is present inline, untruncated, without a workbench offload.
2. Total response under 2,000 tokens for Meetup-style marketing mail (~18KB CSS, 4KB text).
3. COMPOSIO_SEARCH_TOOLS called with a bare string does not error.
4. COMPOSIO_MULTI_EXECUTE_TOOL called without sync_response_to_workbench does not error.
5. A malformed tools[] entry returns an error naming the index and the expected shape.
"""

from __future__ import annotations

import base64
import json
import pytest

from backend.agent.tool_search import CatalogEntry, dispatch_tool_call, dispatch_tool_search
from backend.mcp.composio_sanitizer import (
    decode_email_data,
    sanitize_composio_content,
    sanitize_composio_tool_result,
    strip_style_and_scripts,
)
from backend.mcp.manager import (
    normalize_composio_multi_execute_args,
    normalize_composio_remote_workbench_args,
    normalize_composio_search_tools_args,
)
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry, ToolSchema


@pytest.fixture
def meetup_email_fixture() -> dict:
    """Fixture: one Meetup-style email with ~18KB inline CSS and ~4KB real text."""
    real_text_block = (
        "You are confirmed for the Meetup: Advanced AI Engineering Workshop!\n"
        "Date: Saturday, October 18, 2026\n"
        "Time: 10:00 AM - 4:00 PM PDT\n"
        "Location: Moscone Center West, Level 2, Room 201\n"
        "Organizer: Silicon Valley AI Builders & Researchers\n"
        "Event description: Join top AI practitioners for deep-dive sessions on "
        "agent workflows, multi-tool orchestration, and reliable tool calling interfaces. "
        "Bring your laptop with Python 3.12+ installed.\n"
    )
    # Replicate to reach ~4,000 characters
    while len(real_text_block) < 4000:
        real_text_block += (
            "Session agenda details: Registration, keynote, lightning talks, "
            "hands-on labs, Q&A, and networking mixer.\n"
        )
    real_text_block = real_text_block[:4096]

    # ~18KB of inline CSS rules
    css_rules = "\n".join(
        f".meetup-btn-style-{i} {{ display: inline-block; padding: 12px 24px; "
        f"margin: 4px; border-radius: 8px; background-color: #{i % 999:03d}ff; color: #fff; font-size: 14px; }}"
        for i in range(250)
    )
    assert len(css_rules) >= 18000, f"Expected >= 18KB CSS, got {len(css_rules)}"

    html_content = (
        f"<!DOCTYPE html><html><head><style type='text/css'>{css_rules}</style></head>"
        f"<body><div class='container'><h1>Meetup Confirmation</h1>"
        f"<p>{real_text_block}</p></div></body></html>"
    )

    encoded_text = base64.urlsafe_b64encode(real_text_block.encode("utf-8")).decode("utf-8")
    encoded_html = base64.urlsafe_b64encode(html_content.encode("utf-8")).decode("utf-8")

    return {
        "id": "18b965f3a098cdef",
        "threadId": "18b965f3a098cdef",
        "snippet": "You are confirmed for the Meetup: Advanced AI Engineering Workshop!",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "Subject", "value": "Meetup: Advanced AI Engineering Workshop RSVP Confirmation"},
                {"name": "From", "value": "events@meetup.com"},
                {"name": "To", "value": "user@example.com"},
                {"name": "Date", "value": "Wed, 16 Oct 2026 10:00:00 -0700"},
            ],
            "body": {"size": 0},
            "parts": [
                {
                    "partId": "0",
                    "mimeType": "text/plain",
                    "body": {
                        "size": len(real_text_block),
                        "data": encoded_text,
                    },
                },
                {
                    "partId": "1",
                    "mimeType": "text/html",
                    "body": {
                        "size": len(html_content),
                        "data": encoded_html,
                    },
                },
            ],
        },
    }


def test_gmail_fetch_message_by_message_id_sanitizes_body(meetup_email_fixture):
    """Assert 1 & 2:

    1. The text/plain body is present inline, untruncated, without a workbench offload.
    2. Total response under 2,000 tokens (~8,000 characters).
    """
    raw_content = json.dumps(meetup_email_fixture)
    initial_res = ToolResult.ok(raw_content)

    sanitized = sanitize_composio_tool_result(
        initial_res,
        tool_name="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        arguments={"id": "18b965f3a098cdef"},
    )

    assert not sanitized.is_error
    content = sanitized.content

    # 1. Plain text body is present inline and untruncated
    assert "You are confirmed for the Meetup: Advanced AI Engineering Workshop!" in content
    assert "Moscone Center West, Level 2, Room 201" in content
    assert "Registration, keynote, lightning talks" in content

    # 2. No workbench offload (no /mnt/files/ and no base64 lockup)
    assert "/mnt/files" not in content
    assert "COMPOSIO_REMOTE_WORKBENCH" not in content

    # 3. Total response under 2,000 tokens (CHARS_PER_TOKEN = 4)
    tokens_estimate = len(content) // 4
    assert tokens_estimate < 2000, f"Expected < 2000 tokens, got {tokens_estimate} ({len(content)} chars)"

    # 4. 18KB of inline CSS rules were omitted
    assert ".meetup-btn-style-" not in content
    assert "tokens of MIME/CSS omitted, plain-text body returned" in content


def test_gmail_fetch_emails_multi_execute_sanitizes_body(meetup_email_fixture):
    """Assert 1 & 2 through GMAIL_FETCH_EMAILS in multi-execute structure."""
    multi_res = {
        "results": [
            {
                "tool_slug": "GMAIL_FETCH_EMAILS",
                "response_data": {
                    "messages": [meetup_email_fixture],
                },
            }
        ]
    }
    raw_content = json.dumps(multi_res)
    initial_res = ToolResult.ok(raw_content)

    sanitized = sanitize_composio_tool_result(
        initial_res,
        tool_name="COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments={
            "tools": [{"tool_slug": "GMAIL_FETCH_EMAILS", "arguments": {"query": "event"}}],
        },
    )

    assert not sanitized.is_error
    content = sanitized.content

    # Plain text present inline, no workbench offload, response under 2,000 tokens
    assert "You are confirmed for the Meetup: Advanced AI Engineering Workshop!" in content
    assert "/mnt/files" not in content
    tokens_estimate = len(content) // 4
    assert tokens_estimate < 2000, f"Expected < 2000 tokens, got {tokens_estimate}"


def test_composio_search_tools_bare_string_does_not_error():
    """Assert 3: COMPOSIO_SEARCH_TOOLS called with a bare string does not error."""
    # Test normalization from bare string
    bare_str = "did I get any emails about that event?"
    norm = normalize_composio_search_tools_args(bare_str)
    assert norm == {
        "queries": [{"use_case": "did I get any emails about that event?"}]
    }

    # Test normalization from use_case dict
    from_dict = normalize_composio_search_tools_args({"use_case": "search emails"})
    assert from_dict == {
        "queries": [{"use_case": "search emails"}]
    }

    # Test normalization from array of bare strings
    from_arr = normalize_composio_search_tools_args({"queries": ["check calendar", "find emails"]})
    assert from_arr == {
        "queries": [
            {"use_case": "check calendar"},
            {"use_case": "find emails"},
        ]
    }


def test_composio_multi_execute_tool_without_sync_response_to_workbench():
    """Assert 4: COMPOSIO_MULTI_EXECUTE_TOOL called without sync_response_to_workbench does not error."""
    args = {
        "tools": [
            {
                "tool_slug": "GMAIL_FETCH_EMAILS",
                "arguments": {"max_results": 5},
            }
        ]
    }
    norm = normalize_composio_multi_execute_args(args)
    assert norm["sync_response_to_workbench"] is False
    assert len(norm["tools"]) == 1
    assert norm["tools"][0]["tool_slug"] == "GMAIL_FETCH_EMAILS"
    # Also verify GMAIL_FETCH_EMAILS verbose defaulted to False
    assert norm["tools"][0]["arguments"]["verbose"] is False


def test_malformed_tools_entry_returns_error_naming_index_and_expected_shape():
    """Assert 5: A malformed tools[] entry returns an error naming the index and the expected shape."""
    # Test missing tool_slug at index 1
    malformed_args = {
        "tools": [
            {"tool_slug": "GMAIL_FETCH_EMAILS", "arguments": {}},
            {"arguments": {"query": "something"}},  # index 1: missing tool_slug
        ]
    }
    with pytest.raises(ValueError) as excinfo:
        normalize_composio_multi_execute_args(malformed_args)

    err = str(excinfo.value)
    assert "tools[1].tool_slug is empty" in err
    assert 'expected {"tool_slug": "...", "arguments": {...}}' in err
    assert "something" in err  # echoes the received value


@pytest.mark.asyncio
async def test_tool_call_malformed_and_missing_name_echoes_payload(monkeypatch):
    """Test that tool_call bridge reports empty or missing name with index and expected shape."""
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    registry = ToolRegistry()
    catalog = [
        CatalogEntry(
            name="COMPOSIO_SEARCH_TOOLS",
            description="Search tools",
            schema={
                "type": "function",
                "function": {
                    "name": "COMPOSIO_SEARCH_TOOLS",
                    "parameters": {
                        "type": "object",
                        "properties": {"queries": {"type": "array"}},
                        "required": ["queries"],
                    },
                },
            },
            source="mcp",
            source_name="composio",
        )
    ]
    ctx = ToolContext()

    # Model sends payload missing name
    bad_calls = [
        {"arguments": {"use_case": "search email"}},  # index 0: missing name
    ]
    results = await dispatch_tool_call(bad_calls, catalog, registry, ctx)
    assert len(results) == 1
    assert results[0]["result"]["is_error"] is True
    assert "Tool call at index 0 has an empty or missing 'name'" in results[0]["result"]["content"]
    assert 'expected {"name": "<tool_name>", "arguments": {...}}' in results[0]["result"]["content"]

    # Model sends bare string to COMPOSIO_SEARCH_TOOLS through tool_call
    good_calls = [
        {"name": "COMPOSIO_SEARCH_TOOLS", "arguments": "search emails for receipts"},
    ]
    async def mock_handler(args, ctx):
        return ToolResult.ok(f"searched for {args}")

    registry.register(
        Tool(
            name="COMPOSIO_SEARCH_TOOLS",
            description="",
            parameters={"type": "object", "properties": {"queries": {"type": "array"}}, "required": ["queries"]},
            handler=mock_handler,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    results2 = await dispatch_tool_call(good_calls, catalog, registry, ctx)
    assert len(results2) == 1
    assert not results2[0]["result"]["is_error"]
    assert "searched for" in results2[0]["result"]["content"]
    assert "search emails for receipts" in results2[0]["result"]["content"]


def test_composio_remote_workbench_normalizes_guessed_arguments():
    """Assert: COMPOSIO_REMOTE_WORKBENCH normalizes bare strings, code, command, script to code_to_execute."""
    # 1. Bare string
    bare = normalize_composio_remote_workbench_args("print('hello world')")
    assert bare == {"code_to_execute": "print('hello world')"}

    # 2. Guessed field "code"
    from_code = normalize_composio_remote_workbench_args({"code": "cat /mnt/files/payload.json"})
    assert from_code["code_to_execute"] == "cat /mnt/files/payload.json"

    # 3. Guessed field "command"
    from_cmd = normalize_composio_remote_workbench_args({"command": "ls -la"})
    assert from_cmd["code_to_execute"] == "ls -la"

    # 4. Guessed field "script"
    from_script = normalize_composio_remote_workbench_args({"script": "import json\nprint(1)"})
    assert from_script["code_to_execute"] == "import json\nprint(1)"

    # 5. Already correct
    correct = normalize_composio_remote_workbench_args({"code_to_execute": "python test.py"})
    assert correct == {"code_to_execute": "python test.py"}


@pytest.mark.asyncio
async def test_tool_call_remote_workbench_with_guessed_argument(monkeypatch):
    """Test that tool_call bridge automatically normalizes 'code' to 'code_to_execute' for COMPOSIO_REMOTE_WORKBENCH."""
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    registry = ToolRegistry()
    catalog = [
        CatalogEntry(
            name="COMPOSIO_REMOTE_WORKBENCH",
            description="Remote workbench code executor",
            schema={
                "type": "function",
                "function": {
                    "name": "COMPOSIO_REMOTE_WORKBENCH",
                    "parameters": {
                        "type": "object",
                        "properties": {"code_to_execute": {"type": "string"}},
                        "required": ["code_to_execute"],
                    },
                },
            },
            source="mcp",
            source_name="composio",
        )
    ]
    ctx = ToolContext()

    async def mock_workbench(args, ctx):
        return ToolResult.ok(f"executed: {args.get('code_to_execute')}")

    registry.register(
        Tool(
            name="COMPOSIO_REMOTE_WORKBENCH",
            description="",
            parameters={
                "type": "object",
                "properties": {"code_to_execute": {"type": "string"}},
                "required": ["code_to_execute"],
            },
            handler=mock_workbench,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    # Model guesses "code" instead of "code_to_execute"
    calls = [
        {"name": "COMPOSIO_REMOTE_WORKBENCH", "arguments": {"code": "print('decoded')"}},
    ]
    results = await dispatch_tool_call(calls, catalog, registry, ctx)
    assert len(results) == 1
    assert not results[0]["result"]["is_error"]
    assert "executed: print('decoded')" in results[0]["result"]["content"]

