from __future__ import annotations

import asyncio
import json
import pytest

from backend.agent.config import agent_config
from backend.agent.defaults import apply_tool_defaults
from backend.agent.director import Director
from backend.agent.tool_repair import (
    balance_delimiters,
    coerce_argument_types,
    coerce_property_value,
    extract_embedded_json,
    parse_and_repair_json,
    repair_and_validate_tool_call,
    repair_json_syntax,
    strip_markdown_code_fences,
    validate_arguments,
)
from backend.runtime.types import ModelResponse, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


# ---------------------------------------------------------------------------
# Unit tests for syntax and JSON repair helpers
# ---------------------------------------------------------------------------


def test_strip_markdown_code_fences():
    # ```json ... ```
    raw = "```json\n{\n  \"query\": \"test\"\n}\n```"
    assert json.loads(strip_markdown_code_fences(raw)) == {"query": "test"}

    # ``` ... ```
    raw2 = "```\n{\"path\": \"file.txt\"}\n```"
    assert json.loads(strip_markdown_code_fences(raw2)) == {"path": "file.txt"}

    # Single-line backticks
    raw3 = "`{\"path\": \"file.txt\"}`"
    assert json.loads(strip_markdown_code_fences(raw3)) == {"path": "file.txt"}

    # Plain text without fences
    raw4 = "{\"query\": \"hello\"}"
    assert strip_markdown_code_fences(raw4) == "{\"query\": \"hello\"}"


def test_repair_json_syntax_trailing_commas():
    # Trailing comma in object
    raw = '{"path": "file.txt", "offset": 10,}'
    repaired = repair_json_syntax(raw)
    assert json.loads(repaired) == {"path": "file.txt", "offset": 10}

    # Trailing comma in array
    raw2 = '{"items": [1, 2, 3,],}'
    repaired2 = repair_json_syntax(raw2)
    assert json.loads(repaired2) == {"items": [1, 2, 3]}

    # Nested trailing commas
    raw3 = '{"nested": {"a": "val",}, "list": ["x",],}'
    repaired3 = repair_json_syntax(raw3)
    assert json.loads(repaired3) == {"nested": {"a": "val"}, "list": ["x"]}


def test_balance_delimiters():
    # Truncated object
    raw = '{"query": "amethyst", "limit": 10'
    balanced = balance_delimiters(raw)
    assert balanced == '{"query": "amethyst", "limit": 10}'
    assert json.loads(balanced) == {"query": "amethyst", "limit": 10}

    # Truncated inside string
    raw2 = '{"query": "ameth'
    balanced2 = balance_delimiters(raw2)
    assert balanced2 == '{"query": "ameth"}'
    assert json.loads(balanced2) == {"query": "ameth"}

    # Nested brackets and braces
    raw3 = '{"items": [{"name": "item1"'
    balanced3 = balance_delimiters(raw3)
    assert balanced3 == '{"items": [{"name": "item1"}]}'
    assert json.loads(balanced3) == {"items": [{"name": "item1"}]}


def test_extract_embedded_json():
    raw = 'Here is the tool call: {"query": "deep learning"} Hope this helps!'
    extracted = extract_embedded_json(raw)
    assert json.loads(extracted) == {"query": "deep learning"}


def test_parse_and_repair_json_variants():
    # 1. Standard valid JSON
    parsed, err = parse_and_repair_json('{"query": "hello"}')
    assert parsed == {"query": "hello"}
    assert err is None

    # 2. Markdown fenced JSON with trailing comma
    fenced = "```json\n{\n  \"query\": \"hello\",\n}\n```"
    parsed, err = parse_and_repair_json(fenced)
    assert parsed == {"query": "hello"}
    assert err is None

    # 3. Single-quoted Python dict
    single_quoted = "{'path': '/tmp/test.txt', 'limit': 20}"
    parsed, err = parse_and_repair_json(single_quoted)
    assert parsed == {"path": "/tmp/test.txt", "limit": 20}
    assert err is None

    # 4. Python literals: True, False, None
    py_literals = '{"active": True, "valid": False, "extra": None, "query": "test"}'
    parsed, err = parse_and_repair_json(py_literals)
    assert parsed == {"active": True, "valid": False, "extra": None, "query": "test"}
    assert err is None

    # 5. Double-encoded JSON string
    double_encoded = json.dumps('{"query": "nested json"}')
    parsed, err = parse_and_repair_json(double_encoded)
    assert parsed == {"query": "nested json"}
    assert err is None

    # 6. Unpacking _raw dict (from openai_compat)
    raw_dict = {"_raw": "```json\n{\"query\": \"unpacked\",}\n```"}
    parsed, err = parse_and_repair_json(raw_dict)
    assert parsed == {"query": "unpacked"}
    assert err is None

    # 7. Unclosed truncated JSON
    truncated = '{"query": "truncated search", "count": 5'
    parsed, err = parse_and_repair_json(truncated)
    assert parsed == {"query": "truncated search", "count": 5}
    assert err is None

    # 8. Unparseable invalid string
    invalid = "not json at all {broken"
    parsed, err = parse_and_repair_json(invalid)
    assert parsed is None
    assert "JSON syntax error" in err or "Expected" in err


# ---------------------------------------------------------------------------
# Unit tests for type coercion and schema validation
# ---------------------------------------------------------------------------


def test_coerce_property_value():
    # integer
    assert coerce_property_value({"type": "integer"}, "42") == 42
    assert coerce_property_value({"type": "integer"}, 42.0) == 42
    assert coerce_property_value({"type": "integer"}, True) == 1
    assert coerce_property_value({"type": "integer"}, "invalid") == "invalid"

    # number / float
    assert coerce_property_value({"type": "number"}, "3.14") == 3.14
    assert coerce_property_value({"type": "number"}, 10) == 10.0

    # boolean
    assert coerce_property_value({"type": "boolean"}, "true") is True
    assert coerce_property_value({"type": "boolean"}, "yes") is True
    assert coerce_property_value({"type": "boolean"}, "1") is True
    assert coerce_property_value({"type": "boolean"}, "false") is False
    assert coerce_property_value({"type": "boolean"}, "no") is False
    assert coerce_property_value({"type": "boolean"}, "0") is False
    assert coerce_property_value({"type": "boolean"}, 1) is True
    assert coerce_property_value({"type": "boolean"}, 0) is False

    # array
    assert coerce_property_value({"type": "array"}, "apple, banana, cherry") == ["apple", "banana", "cherry"]
    assert coerce_property_value({"type": "array"}, '["x", "y"]') == ["x", "y"]
    assert coerce_property_value({"type": "array"}, "single") == ["single"]

    # object
    assert coerce_property_value({"type": "object"}, '{"k": "v"}') == {"k": "v"}

    # string
    assert coerce_property_value({"type": "string"}, 12345) == "12345"
    assert coerce_property_value({"type": "string"}, True) == "True"


def test_validate_arguments():
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer"},
            "verbose": {"type": "boolean"},
        },
        "required": ["query"],
    }

    # Valid arguments
    assert validate_arguments("search_web", {"query": "amethyst", "limit": 10}, schema) is None

    # Missing required parameter
    err = validate_arguments("search_web", {"limit": 10}, schema)
    assert err is not None
    assert "Missing required parameter 'query' for tool 'search_web'" in err
    assert "Required: ['query']" in err

    # Null value for required non-nullable parameter
    err_null = validate_arguments("search_web", {"query": None}, schema)
    assert err_null is not None
    assert "Parameter 'query' for tool 'search_web' cannot be null" in err_null

    # Invalid type
    err_type = validate_arguments("search_web", {"query": "test", "limit": "not_an_int"}, schema)
    assert err_type is not None
    assert "Invalid value for parameter 'limit' in tool 'search_web': expected integer" in err_type


def test_repair_and_validate_tool_call_with_registry():
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    search_tool = Tool(
        name="search_web",
        description="Search",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
        handler=dummy,
        risk=RiskLevel.LOW,
    )
    registry.register(search_tool)

    # 1. Repaired markdown JSON + synonym normalization + type coercion
    call = ToolCall(
        id="c1",
        name="search_web",
        arguments="```json\n{\n  \"q\": \"Amethyst AI\",\n  \"limit\": \"5\",\n}\n```",  # type: ignore
    )
    repaired, err = repair_and_validate_tool_call(call, registry)
    assert err is None
    assert repaired.arguments["query"] == "Amethyst AI"
    assert repaired.arguments["limit"] == 5

    # 2. Missing required parameter
    call_missing = ToolCall(
        id="c2",
        name="search_web",
        arguments='{"limit": "10"}',  # type: ignore
    )
    repaired2, err2 = repair_and_validate_tool_call(call_missing, registry)
    assert err2 is not None
    assert "Missing required parameter 'query' for tool 'search_web'" in err2

    # 3. Malformed unparseable JSON
    call_broken = ToolCall(
        id="c3",
        name="search_web",
        arguments="not valid json {",  # type: ignore
    )
    repaired3, err3 = repair_and_validate_tool_call(call_broken, registry)
    assert err3 is not None
    assert "Malformed JSON arguments for tool 'search_web'" in err3


# ---------------------------------------------------------------------------
# Integration test: Director execution with tool call repair
# ---------------------------------------------------------------------------


class MockModelClient:
    def __init__(self, responses: list[ModelResponse]):
        self.responses = list(responses)

    async def stream(self, messages, tools=None, params=None):
        if not self.responses:
            yield type("Chunk", (), {"type": "text", "text": "All done."})()
            yield type("Chunk", (), {"type": "done", "response": ModelResponse(text="All done.")})()
            return
        resp = self.responses.pop(0)
        if resp.text:
            yield type("Chunk", (), {"type": "text", "text": resp.text})()
        yield type("Chunk", (), {"type": "done", "response": resp})()

    async def complete(self, messages, tools=None, params=None):
        if not self.responses:
            return ModelResponse(text="All done.")
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_director_repairs_malformed_arguments_and_executes(monkeypatch):
    """Verify that Director repairs markdown fences, trailing commas, and coerces types."""
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ResolvedModel
    from backend.runtime.chain import Link

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))
    received_args = {}

    async def fetch_handler(args, ctx):
        received_args.update(args)
        return ToolResult.ok(f"Fetched {args.get('path')} limit={args.get('limit')}")

    registry.register(
        Tool(
            name="view_file",
            description="View file",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "offset": {"type": "integer"},
                    "limit": {"type": "integer"},
                },
                "required": ["path"],
            },
            handler=fetch_handler,
            risk=RiskLevel.LOW,
        )
    )

    # Round 1: Model emits tool call with markdown code fence, trailing comma, and string integer
    resp1 = ModelResponse(
        text="Reading file...",
        tool_calls=[
            ToolCall(
                id="tc1",
                name="view_file",
                arguments="```json\n{\n  \"filePath\": \"/workspace/main.py\",\n  \"offset\": \"5\",\n  \"limit\": \"25\",\n}\n```",  # type: ignore
            )
        ],
    )
    # Round 2: Final answer
    resp2 = ModelResponse(text="File content was fetched successfully.")

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)

    events = [e async for e in director.run(cid, "read main.py")]

    # Ensure tool call executed and received clean arguments
    assert received_args.get("path") == "/workspace/main.py"
    # offset coerced from string to int
    assert received_args.get("offset") == 5
    # limit clamped to default_max_results (10)
    assert received_args.get("limit") == 10

    # Check tool result event was emitted with success
    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    assert "Fetched /workspace/main.py limit=10" in tool_results[0].data["content"]
    assert tool_results[0].data["is_error"] is False


@pytest.mark.asyncio
async def test_director_handles_invalid_arguments_gracefully(monkeypatch):
    """Verify that Director returns a precise error for missing required arguments without crashing."""
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ResolvedModel
    from backend.runtime.chain import Link

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))

    registry.register(
        Tool(
            name="view_file",
            description="View file",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                },
                "required": ["path"],
            },
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
        )
    )

    # Round 1: Model emits tool call missing 'path'
    resp1 = ModelResponse(
        text="Trying view_file...",
        tool_calls=[
            ToolCall(
                id="tc_bad",
                name="view_file",
                arguments={},
            )
        ],
    )
    # Round 2: Final answer after error
    resp2 = ModelResponse(text="I see the path was missing.")

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)

    events = [e async for e in director.run(cid, "check file")]

    # Tool result should report missing parameter error
    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    assert tool_results[0].data["is_error"] is True
    assert "Missing required parameter 'path' for tool 'view_file'" in tool_results[0].data["content"]


@pytest.mark.asyncio
async def test_director_parallel_batch_with_mixed_valid_and_invalid_tool_calls(monkeypatch):
    """Verify that in parallel batches, a valid call succeeds while an invalid call returns precise error."""
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ResolvedModel
    from backend.runtime.chain import Link

    conv_repo = ConversationRepository()
    cid = conv_repo.create("mock", "mock-model")

    registry = ToolRegistry(ConfirmationService(auto_approve))
    executed_tools = []

    async def search_handler(args, ctx):
        executed_tools.append(("search_web", args))
        return ToolResult.ok(f"Found 3 results for {args.get('query')}")

    async def view_handler(args, ctx):
        executed_tools.append(("view_file", args))
        return ToolResult.ok(f"Contents of {args.get('path')}")

    registry.register(
        Tool(
            name="search_web",
            description="Search web",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            handler=search_handler,
            risk=RiskLevel.LOW,
        )
    )
    registry.register(
        Tool(
            name="view_file",
            description="View file",
            parameters={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
            handler=view_handler,
            risk=RiskLevel.LOW,
        )
    )

    # Round 1: Two parallel calls:
    # 1. search_web: valid call with markdown fence
    # 2. view_file: missing required 'path' parameter
    resp1 = ModelResponse(
        text="Searching and reading...",
        tool_calls=[
            ToolCall(
                id="tc_valid",
                name="search_web",
                arguments="```json\n{\"q\": \"amethyst architecture\",}\n```",  # type: ignore
            ),
            ToolCall(
                id="tc_invalid",
                name="view_file",
                arguments={},
            ),
        ],
    )
    # Round 2: Final answer
    resp2 = ModelResponse(text="Done searching and checking.")

    mock_client = MockModelClient([resp1, resp2])
    resolved_model = ResolvedModel(
        provider="mock",
        model="mock-model",
        client=mock_client,
        capabilities=Capabilities(streaming=False),
    )

    monkeypatch.setattr("backend.agent.director.resolve", lambda *args, **kwargs: resolved_model)
    monkeypatch.setattr(
        "backend.agent.director.build_chain",
        lambda *args, **kwargs: [Link("mock", "mock-model")],
    )

    director = Director(registry, stream=False, memory=False)

    events = [e async for e in director.run(cid, "search and view")]

    # Check execution
    assert len(executed_tools) == 1
    assert executed_tools[0][0] == "search_web"
    assert executed_tools[0][1]["query"] == "amethyst architecture"

    # Both tool results should be emitted
    tool_results = [e for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2

    valid_res = next(r for r in tool_results if r.data["name"] == "search_web")
    assert valid_res.data["is_error"] is False
    assert "Found 3 results for amethyst architecture" in valid_res.data["content"]

    invalid_res = next(r for r in tool_results if r.data["name"] == "view_file")
    assert invalid_res.data["is_error"] is True
    assert "Missing required parameter 'path' for tool 'view_file'" in invalid_res.data["content"]


