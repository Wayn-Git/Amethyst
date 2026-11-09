"""Progressive tool disclosure: bridge tools that let the model discover tools on demand.

When Amethyst has 178+ tools across connectors, sending all schemas overwhelms the
model and wastes ~29K tokens. Instead, core tools are always offered and the rest
are deferred behind three bridge tools:

- tool_search: BM25 search over deferred tools
- tool_describe: full schemas for named tools
- tool_call: invoke a deferred tool by name

The model discovers tools as needed rather than seeing everything upfront.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from backend.agent.trace import is_trace_enabled

from backend.agent.tool_search_catalog import (
    CatalogEntry,
    build_catalog,
    build_catalog_listing,
    search_catalog,
    _corpus_stats,
    _estimate_tokens,
)
from backend.mcp.composio_service import ALL_FAST_LANE_SLUGS
from backend.mcp.manager import (
    normalize_composio_multi_execute_args,
    normalize_composio_remote_workbench_args,
    normalize_composio_search_tools_args,
)
from backend.runtime.types import ToolSchema
from backend.tools.registry import ToolRegistry

log = logging.getLogger(__name__)

COMPOSIO_META_TOOLS: frozenset[str] = frozenset({
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MANAGE_CONNECTIONS",
})

# Core tools that are always visible (never deferred). These are the tools
# almost every task routes through; withholding one to save tokens makes the
# agent look incapable.
CORE_TOOLS: frozenset[str] = frozenset({
    "view_file",
    "list_files",
    "grep_files",
    "edit_file",
    "write_file",
    "create_artifact",
    "run_shell_command",
    "ask_user",
    "dispatch_parallel_jobs",
    "collect_jobs",
    "task",
    "search_web",
    "research_web",
    "web_search",
    "tavily_search",
    "fetch_url",
    # Composio meta-tools are always visible with full schemas
    *COMPOSIO_META_TOOLS,
    # Bridge tools themselves must never be deferred
    "tool_search",
    "tool_describe",
    "tool_call",
})

BRIDGE_TOOL_NAMES = ("tool_search", "tool_describe", "tool_call")

# Max queries per tool_search call to avoid overwhelming the catalog
_MAX_QUERIES_PER_CALL = 7
_MAX_DESCRIBE_NAMES_PER_CALL = 10


@dataclass
class ToolSearchConfig:
    """Resolved tool-search configuration."""

    enabled: str  # "auto" | "on" | "off"
    threshold_pct: float  # listing budget as % of context window
    listing_max_tokens: int

    @classmethod
    def from_raw(cls, raw: Any) -> "ToolSearchConfig":
        if not isinstance(raw, dict):
            raw = {}
        enabled = str(raw.get("enabled", "auto")).strip().lower()
        if enabled in ("true", "1", "yes"):
            enabled = "on"
        elif enabled in ("false", "0", "no"):
            enabled = "off"
        elif enabled not in ("on", "off", "auto"):
            enabled = "auto"
        threshold_pct = max(0.0, min(100.0, float(raw.get("threshold_pct", 5.0))))
        listing_max_tokens = max(200, min(60000, int(raw.get("listing_max_tokens", 4000))))
        return cls(
            enabled=enabled,
            threshold_pct=threshold_pct,
            listing_max_tokens=listing_max_tokens,
        )


def _is_deferrable(tool_name: str, server_name: str | None) -> bool:
    """Whether a tool can be deferred behind bridge tools."""
    bare_name = tool_name.split("__mcp__")[0]
    if (
        tool_name in CORE_TOOLS
        or bare_name in CORE_TOOLS
        or bare_name in COMPOSIO_META_TOOLS
        or bare_name in ALL_FAST_LANE_SLUGS
    ):
        return False
    if server_name:
        return True  # MCP/connector tools are always deferrable
    return False  # other builtins stay visible


def classify_tools(
    tool_schemas: list[ToolSchema],
    registry=None,
) -> tuple[list[ToolSchema], list[CatalogEntry]]:
    """Split tools into visible (core) and deferrable (catalog entries).

    Returns (visible_schemas, catalog_entries).
    """
    visible: list[ToolSchema] = []
    deferrable_schemas: list[ToolSchema] = []

    for schema in tool_schemas:
        server_name = None
        if registry:
            tool_obj = registry.get(schema.name)
            if tool_obj and hasattr(tool_obj, "server_name"):
                server_name = tool_obj.server_name

        if _is_deferrable(schema.name, server_name):
            deferrable_schemas.append(schema)
        else:
            visible.append(schema)

    catalog = build_catalog(deferrable_schemas, registry=registry) if deferrable_schemas else []
    return visible, catalog


def _listing_token_budget(context_length: int, config: ToolSearchConfig) -> int:
    """How many tokens the embedded catalog listing may use."""
    pct_leg = int(context_length * (config.threshold_pct / 100.0))
    return max(0, min(config.listing_max_tokens, pct_leg))


def bridge_tool_schemas(catalog_listing: str = "") -> list[ToolSchema]:
    """Bridge tools that replace deferred tools in the model-visible array."""

    search_desc = (
        "Search for deferred tools by describing what you need. "
        "Returns up to 3 matching tools with their full schemas (description and parameters). "
        "Matched tools are promoted into your active tools on the next step so you can call them directly.\n"
        "Note: For connected services like Gmail or Google Calendar via Composio, "
        "use direct tools (e.g. GOOGLECALENDAR_FIND_EVENT, GMAIL_FETCH_EMAILS) or the visible COMPOSIO_SEARCH_TOOLS directly."
    )
    if catalog_listing:
        search_desc += f"\n\nAvailable tool groups:\n{catalog_listing}"

    return [
        ToolSchema(
            name="tool_search",
            description=search_desc,
            parameters={
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": f"Search queries (max {_MAX_QUERIES_PER_CALL}). Be specific.",
                    },
                },
                "required": ["queries"],
            },
        ),
        ToolSchema(
            name="tool_call",
            description=(
                "Invoke a deferred tool by name and arguments if you need to execute it immediately "
                "before it is promoted. Otherwise, prefer calling promoted tools directly by name."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "calls": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Tool name"},
                                "arguments": {
                                    "type": "object",
                                    "description": "Tool arguments",
                                },
                            },
                            "required": ["name", "arguments"],
                        },
                        "description": "Tool calls to execute.",
                    },
                },
                "required": ["calls"],
            },
        ),
    ]


def assemble_tool_defs(
    tool_schemas: list[ToolSchema],
    *,
    context_length: int = 128_000,
    config: ToolSearchConfig | None = None,
    registry=None,
) -> tuple[list[ToolSchema], list[CatalogEntry] | None]:
    """Replace deferred tools with bridge tools if the catalog is large enough.

    Returns (final_schemas, catalog_or_none).
    If catalog_or_none is None, no deferral happened.
    """
    _t0 = time.perf_counter()
    if config is None:
        config = ToolSearchConfig.from_raw({})

    if config.enabled == "off":
        if is_trace_enabled():
            log.info("[TRACE] tool_search.assemble_tool_defs: took %.2fms (enabled=off)", (time.perf_counter() - _t0) * 1000.0)
        return tool_schemas, None

    visible, catalog = classify_tools(tool_schemas, registry=registry)

    if not catalog:
        # No deferrable tools — passthrough
        if is_trace_enabled():
            log.info("[TRACE] tool_search.assemble_tool_defs: took %.2fms (deferral active=False, no deferrable tools)", (time.perf_counter() - _t0) * 1000.0)
        return tool_schemas, None

    # Check if the catalog is large enough to warrant deferral
    total_catalog_tokens = _estimate_tokens(
        "\n".join(f"{e.name}: {e.description}" for e in catalog)
    )
    # Don't defer if the catalog itself is small enough to just include
    if total_catalog_tokens < 2000:
        if is_trace_enabled():
            log.info("[TRACE] tool_search.assemble_tool_defs: took %.2fms (deferral active=False, catalog tokens %d < 2000)", (time.perf_counter() - _t0) * 1000.0, total_catalog_tokens)
        return tool_schemas, None

    # Build the listing within budget
    budget = _listing_token_budget(context_length, config)
    listing = build_catalog_listing(catalog, token_budget=budget)
    bridges = bridge_tool_schemas(listing)

    final_schemas, final_catalog = visible + bridges, catalog
    if is_trace_enabled():
        log.info(
            "[TRACE] tool_search.assemble_tool_defs: took %.2fms (deferral active=True, catalog=%d, visible=%d)",
            (time.perf_counter() - _t0) * 1000.0,
            len(final_catalog) if final_catalog else 0,
            len(final_schemas),
        )
    return final_schemas, final_catalog


# ---------------------------------------------------------------------------
# Dispatch: called by Director when the model invokes a bridge tool
# ---------------------------------------------------------------------------

async def dispatch_tool_search(
    queries: list[str] | str,
    catalog: list[CatalogEntry],
) -> dict[str, Any]:
    """BM25 search over the deferred catalog."""
    _t0 = time.perf_counter()
    if isinstance(queries, str):
        queries = [queries] if queries.strip() else []
    elif not isinstance(queries, list):
        queries = []
    queries = [str(q).strip() for q in queries if str(q).strip()][:_MAX_QUERIES_PER_CALL]
    stats = _corpus_stats(catalog)
    results = []
    for query in queries:
        matches = search_catalog(catalog, query, stats=stats, limit=3)
        results.append({
            "query": query,
            "matches": [
                {
                    "name": entry.name,
                    "source": entry.source_name,
                    "description": entry.description or "",
                    "parameters": entry.schema.get("function", {}).get("parameters", {}),
                }
                for entry, score in matches[:3]
            ],
        })
    res = {
        "queries": queries,
        "total_available": len(catalog),
        "results": results,
    }
    if is_trace_enabled():
        log.info("[TRACE] tool_search.dispatch_tool_search took %.2fms for queries=%s", (time.perf_counter() - _t0) * 1000.0, queries)
    return res


async def dispatch_tool_describe(
    names: list[str],
    catalog: list[CatalogEntry],
) -> dict[str, Any]:
    """Full schemas for named tools."""
    _t0 = time.perf_counter()
    names = names[:_MAX_DESCRIBE_NAMES_PER_CALL]
    catalog_by_name = {e.name: e for e in catalog}
    tools = {}
    not_found = []
    for name in names:
        entry = catalog_by_name.get(name)
        if entry is None:
            not_found.append(name)
        else:
            tools[name] = {
                "description": entry.description,
                "parameters": entry.schema.get("function", {}).get("parameters", {}),
            }
    res = {"tools": tools, "not_found": not_found}
    if is_trace_enabled():
        log.info("[TRACE] tool_search.dispatch_tool_describe took %.2fms for names=%s", (time.perf_counter() - _t0) * 1000.0, names)
    return res


async def dispatch_tool_call(
    calls: list[dict[str, Any]],
    catalog: list[CatalogEntry],
    registry,
    context,
) -> list[dict[str, Any]]:
    """Validate, coerce types, and re-dispatch deferred tool calls."""
    _t0 = time.perf_counter()
    catalog_by_name = {e.name: e for e in catalog}
    results = []

    for idx, call in enumerate(calls):
        if isinstance(call, str):
            try:
                call = json.loads(call)
            except Exception:
                results.append({
                    "name": "",
                    "result": {
                        "content": f"Tool call at index {idx} could not be parsed as JSON: {call!r}",
                        "is_error": True,
                    },
                })
                continue
        if not isinstance(call, dict):
            results.append({
                "name": "",
                "result": {
                    "content": (
                        f"Tool call at index {idx} is not an object; "
                        f"expected {{\"name\": \"...\", \"arguments\": {{...}}}}, received: {repr(call)}"
                    ),
                    "is_error": True,
                },
            })
            continue

        raw_name = call.get("name") or call.get("tool_slug") or call.get("tool_name") or ""
        name = str(raw_name).strip() if raw_name is not None else ""
        if not name:
            results.append({
                "name": "",
                "result": {
                    "content": (
                        f"Tool call at index {idx} has an empty or missing 'name'; "
                        f"expected {{\"name\": \"<tool_name>\", \"arguments\": {{...}}}}, "
                        f"received: {json.dumps(call) if isinstance(call, (dict, list)) else repr(call)}"
                    ),
                    "is_error": True,
                },
            })
            continue

        raw_args = call.get("arguments", {})
        if isinstance(raw_args, str):
            try:
                parsed_args = json.loads(raw_args)
                if isinstance(parsed_args, dict):
                    raw_args = parsed_args
            except Exception:
                pass
        arguments = raw_args

        entry = catalog_by_name.get(name)
        tool = registry.resolve_tool(name) if hasattr(registry, "resolve_tool") else registry.get(name)
        if entry is None and tool is None:
            results.append({
                "name": name,
                "result": {
                    "content": (
                        f"Tool '{name}' not found in deferred catalog. "
                        f"Received payload: {json.dumps(call) if isinstance(call, (dict, list)) else repr(call)}. "
                        "Use tool_search to discover available tools."
                    ),
                    "is_error": True,
                },
            })
            continue

        # Coerce/normalize arguments for Composio meta-tools before schema validation
        if "COMPOSIO_SEARCH_TOOLS" in name:
            arguments = normalize_composio_search_tools_args(arguments)
        elif "COMPOSIO_MULTI_EXECUTE_TOOL" in name:
            try:
                arguments = normalize_composio_multi_execute_args(arguments)
            except ValueError as val_err:
                results.append({
                    "name": name,
                    "result": {
                        "content": str(val_err),
                        "is_error": True,
                    },
                })
                continue
        elif "COMPOSIO_REMOTE_WORKBENCH" in name:
            arguments = normalize_composio_remote_workbench_args(arguments)

        if not isinstance(arguments, dict):
            arguments = {}

        params = {}
        if entry:
            params = entry.schema.get("function", {}).get("parameters", {})
        elif tool and isinstance(tool.parameters, dict):
            params = tool.parameters

        # Coerce argument types based on schema properties
        props = params.get("properties", {}) if isinstance(params, dict) else {}
        for prop_name, prop_def in props.items():
            if prop_name in arguments and isinstance(prop_def, dict):
                arguments[prop_name] = ToolRegistry.coerce_property_value(prop_def, arguments[prop_name])

        # Validate required parameters
        required = params.get("required", []) if isinstance(params, dict) else []
        missing = [r for r in required if r not in arguments]
        if missing:
            results.append({
                "name": name,
                "result": {
                    "content": f"Missing required arguments: {', '.join(missing)}",
                    "is_error": True,
                },
            })
            continue

        # Dispatch through registry to benefit from permissions, logs, caching, and fallbacks
        try:
            if hasattr(registry, "dispatch"):
                result = await registry.dispatch(name, arguments, context)
            elif tool:
                result = await tool.handler(arguments, context)
            else:
                results.append({
                    "name": name,
                    "result": {
                        "content": f"Tool '{name}' is registered but not available.",
                        "is_error": True,
                    },
                })
                continue

            results.append({
                "name": name,
                "result": {
                    "content": result.content,
                    "is_error": result.is_error,
                },
            })
        except Exception as exc:
            results.append({
                "name": name,
                "result": {
                    "content": f"Tool '{name}' failed: {type(exc).__name__}: {exc}",
                    "is_error": True,
                },
            })
    if is_trace_enabled():
        log.info("[TRACE] tool_search.dispatch_tool_call took %.2fms for %d calls", (time.perf_counter() - _t0) * 1000.0, len(calls))
    return results
