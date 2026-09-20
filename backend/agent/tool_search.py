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
from dataclasses import dataclass
from typing import Any

from backend.agent.tool_search_catalog import (
    CatalogEntry,
    build_catalog,
    build_catalog_listing,
    search_catalog,
    _corpus_stats,
    _estimate_tokens,
)
from backend.runtime.types import ToolSchema

log = logging.getLogger(__name__)

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
    if tool_name in CORE_TOOLS:
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
    """The three bridge tools that replace deferred tools in the model-visible array."""

    search_desc = (
        "Search for available tools by describing what you need. "
        "Returns matching tools with their names, sources, and short descriptions. "
        "Use this when you need a tool but are not sure which one is available."
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
            name="tool_describe",
            description=(
                "Get the full schema (description + parameters) for one or more tools. "
                "Call this after tool_search to see the complete interface before calling."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": f"Tool names to describe (max {_MAX_DESCRIBE_NAMES_PER_CALL}).",
                    },
                },
                "required": ["names"],
            },
        ),
        ToolSchema(
            name="tool_call",
            description=(
                "Invoke a deferred tool by name and arguments. "
                "The tool runs with the same permissions and validation as directly-listed tools."
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
    if config is None:
        config = ToolSearchConfig({})

    if config.enabled == "off":
        return tool_schemas, None

    visible, catalog = classify_tools(tool_schemas, registry=registry)

    if not catalog:
        # No deferrable tools — passthrough
        return tool_schemas, None

    # Check if the catalog is large enough to warrant deferral
    total_catalog_tokens = _estimate_tokens(
        "\n".join(f"{e.name}: {e.description}" for e in catalog)
    )
    # Don't defer if the catalog itself is small enough to just include
    if total_catalog_tokens < 2000:
        return tool_schemas, None

    # Build the listing within budget
    budget = _listing_token_budget(context_length, config)
    listing = build_catalog_listing(catalog, token_budget=budget)
    bridges = bridge_tool_schemas(listing)

    return visible + bridges, catalog


# ---------------------------------------------------------------------------
# Dispatch: called by Director when the model invokes a bridge tool
# ---------------------------------------------------------------------------

async def dispatch_tool_search(
    queries: list[str],
    catalog: list[CatalogEntry],
) -> dict[str, Any]:
    """BM25 search over the deferred catalog."""
    queries = queries[:_MAX_QUERIES_PER_CALL]
    stats = _corpus_stats(catalog)
    results = []
    for query in queries:
        matches = search_catalog(catalog, query, stats=stats, limit=5)
        results.append({
            "query": query,
            "matches": [
                {
                    "name": entry.name,
                    "source": entry.source_name,
                    "description": (entry.description or "")[:200],
                }
                for entry, score in matches
            ],
        })
    return {
        "queries": queries,
        "total_available": len(catalog),
        "results": results,
    }


async def dispatch_tool_describe(
    names: list[str],
    catalog: list[CatalogEntry],
) -> dict[str, Any]:
    """Full schemas for named tools."""
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
    return {"tools": tools, "not_found": not_found}


async def dispatch_tool_call(
    calls: list[dict[str, Any]],
    catalog: list[CatalogEntry],
    registry,
    context,
) -> list[dict[str, Any]]:
    """Validate and re-dispatch deferred tool calls to the real handlers."""
    catalog_by_name = {e.name: e for e in catalog}
    results = []
    for call in calls:
        name = call.get("name", "")
        arguments = call.get("arguments", {})
        entry = catalog_by_name.get(name)
        if entry is None:
            results.append({
                "name": name,
                "result": {
                    "content": f"Tool '{name}' not found in deferred catalog.",
                    "is_error": True,
                },
            })
            continue
        # Validate required parameters
        params = entry.schema.get("function", {}).get("parameters", {})
        required = params.get("required", [])
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
        # Dispatch to the real handler
        tool = registry.get(name)
        if tool is None:
            results.append({
                "name": name,
                "result": {
                    "content": f"Tool '{name}' is registered but not available.",
                    "is_error": True,
                },
            })
            continue
        try:
            result = await tool.handler(arguments, context)
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
    return results
