"""Tool search catalog: BM25-indexed tool registry for progressive disclosure.

When Amethyst has too many tools (178+ across connectors), sending all schemas
to the model wastes tokens and overwhelms selection. The catalog indexes the
deferrable subset so the model can search, describe, and call tools on demand
via bridge tools (tool_search, tool_describe, tool_call).
"""

from __future__ import annotations

import json
import math
import re
import threading
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

CHARS_PER_TOKEN = 4


@dataclass
class CatalogEntry:
    """One tool in the searchable catalog."""

    name: str
    description: str
    schema: dict[str, Any]  # full {"type":"function", "function": {...}}
    source: str  # "mcp" | "builtin" | "integration"
    source_name: str  # server or module name
    _tokens: list[str] = field(default_factory=list, repr=False)


# Thread-local Snowball stemmer (mutable state on the stemmer object).
_stemmer_local = threading.local()


def _get_stemmer():
    """Lazy Snowball stemmer, one per thread."""
    stemmer = getattr(_stemmer_local, "stemmer", None)
    if stemmer is None:
        try:
            from snowballstemmer import stemmer as _stemmer

            stemmer = _stemmer("english")
        except ImportError:
            stemmer = None
        _stemmer_local.stemmer = stemmer
    return stemmer


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric tokens, optionally stemmed."""
    tokens = _TOKEN_RE.findall(text.lower())
    stemmer = _get_stemmer()
    if stemmer is not None:
        return stemmer.stemWords(tokens)
    return tokens


def _entry_search_text(entry: CatalogEntry) -> str:
    """Text blob to tokenize for BM25: name words + source + description + param names."""
    parts = [
        entry.name.replace("_", " ").replace("-", " "),
        entry.source_name,
        entry.description,
    ]
    params = entry.schema.get("function", {}).get("parameters", {})
    if isinstance(params, dict):
        props = params.get("properties", {})
        if isinstance(props, dict):
            parts.extend(props.keys())
    return " ".join(parts)


def _classify_source(tool_name: str, server_name: str | None) -> tuple[str, str]:
    """Classify a tool's source type and display name."""
    if server_name:
        return "mcp", server_name
    if tool_name.startswith("mcp_") or "__mcp__" in tool_name:
        return "mcp", "mcp"
    return "builtin", "core"


def build_catalog(
    tool_schemas: list[Any],
    *,
    registry=None,
) -> list[CatalogEntry]:
    """Build a searchable catalog from tool schemas.

    `tool_schemas` are the full ToolSchema or Tool objects. If `registry` is
    provided, we can look up server_name for MCP tools.
    """
    entries: list[CatalogEntry] = []
    for schema in tool_schemas:
        name = schema.name if hasattr(schema, "name") else schema.get("name", "")
        desc = schema.description if hasattr(schema, "description") else schema.get("description", "")
        params = schema.parameters if hasattr(schema, "parameters") else schema.get("parameters", {})
        # Build the OpenAI-style function block
        function_block = {
            "name": name,
            "description": desc,
            "parameters": params or {"type": "object", "properties": {}},
        }
        schema_dict = {"type": "function", "function": function_block}

        # Determine source
        server_name = None
        if registry:
            tool_obj = registry.get(name)
            if tool_obj and hasattr(tool_obj, "server_name"):
                server_name = tool_obj.server_name
        source, source_name = _classify_source(name, server_name)

        entry = CatalogEntry(
            name=name,
            description=desc,
            schema=schema_dict,
            source=source,
            source_name=source_name,
        )
        entry._tokens = _tokenize(_entry_search_text(entry))
        entries.append(entry)
    return entries


def _corpus_stats(entries: list[CatalogEntry]) -> dict:
    """BM25 corpus statistics: doc lengths, avg_dl, doc frequency."""
    doc_lengths = [len(e._tokens) for e in entries]
    avg_dl = sum(doc_lengths) / max(len(doc_lengths), 1)
    doc_freq: dict[str, int] = Counter()
    for entry in entries:
        unique = set(entry._tokens)
        for token in unique:
            doc_freq[token] += 1
    return {
        "n_docs": len(entries),
        "avg_dl": avg_dl,
        "doc_lengths": doc_lengths,
        "doc_freq": doc_freq,
    }


def _bm25_score(
    query_tokens: list[str],
    doc_idx: int,
    stats: dict,
    k1: float = 1.5,
    b: float = 0.75,
) -> float:
    """BM25 score for one document."""
    n = stats["n_docs"]
    avg_dl = stats["avg_dl"]
    dl = stats["doc_lengths"][doc_idx]
    doc_freq = stats["doc_freq"]
    score = 0.0
    for token in query_tokens:
        df = doc_freq.get(token, 0)
        if df == 0:
            continue
        idf = math.log((n - df + 0.5) / (df + 0.5) + 1.0)
        tf = query_tokens.count(token)
        numerator = tf * (k1 + 1)
        denominator = tf + k1 * (1 - b + b * dl / max(avg_dl, 1))
        score += idf * numerator / denominator
    return score


def _rarest_token_gate(
    query_tokens: list[str],
    entry: CatalogEntry,
    stats: dict,
) -> bool:
    """Every admitted document must carry the query token with the highest IDF."""
    if not query_tokens:
        return True
    n = stats["n_docs"]
    doc_freq = stats["doc_freq"]
    # Find the rarest query token (highest IDF = lowest DF)
    rarest = min(query_tokens, key=lambda t: doc_freq.get(t, n + 1))
    return rarest in entry._tokens


def _term_coverage_gate(
    query_tokens: list[str],
    entry: CatalogEntry,
    stats: dict,
) -> bool:
    """For queries with 4+ answerable terms, doc must match 50% of them."""
    doc_freq = stats["doc_freq"]
    answerable = [t for t in query_tokens if doc_freq.get(t, 0) > 0]
    if len(answerable) < 4:
        return True  # short queries need only 1 match
    matched = sum(1 for t in answerable if t in entry._tokens)
    return matched >= len(answerable) * 0.5


def search_catalog(
    catalog: list[CatalogEntry],
    query: str,
    stats: dict | None = None,
    limit: int = 10,
) -> list[tuple[CatalogEntry, float]]:
    """BM25 search over the catalog with quality gates."""
    if not catalog or not query.strip():
        return []

    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    if stats is None:
        stats = _corpus_stats(catalog)

    results: list[tuple[CatalogEntry, float]] = []
    for idx, entry in enumerate(catalog):
        # Exact name match always passes
        if query.lower().replace(" ", "_") == entry.name.lower():
            results.append((entry, float("inf")))
            continue

        if not _rarest_token_gate(query_tokens, entry, stats):
            continue
        if not _term_coverage_gate(query_tokens, entry, stats):
            continue

        score = _bm25_score(query_tokens, idx, stats)
        if score > 0:
            results.append((entry, score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:limit]


def build_catalog_listing(
    catalog: list[CatalogEntry],
    token_budget: int = 4000,
) -> str:
    """Render a compact listing of the catalog for embedding in bridge tool descriptions.

    Degradation tiers (largest first):
    1. full — names + short descriptions, grouped by source
    2. names — names only, grouped by source
    3. groups — one summary line per source (name + tool count)
    """
    if not catalog:
        return ""

    # Group by source
    groups: dict[str, list[CatalogEntry]] = {}
    for entry in catalog:
        groups.setdefault(entry.source_name, []).append(entry)

    # Try full listing
    lines: list[str] = []
    for source_name in sorted(groups.keys()):
        entries = groups[source_name]
        lines.append(f"\n## {source_name}")
        for e in sorted(entries, key=lambda x: x.name):
            short_desc = (e.description or "")[:80]
            lines.append(f"- {e.name}: {short_desc}")

    full_text = "\n".join(lines)
    if _estimate_tokens(full_text) <= token_budget:
        return full_text

    # Try names-only
    lines = []
    for source_name in sorted(groups.keys()):
        entries = groups[source_name]
        names = ", ".join(sorted(e.name for e in entries))
        lines.append(f"\n## {source_name}\n{names}")

    names_text = "\n".join(lines)
    if _estimate_tokens(names_text) <= token_budget:
        return names_text

    # Fall back to groups
    lines = []
    for source_name in sorted(groups.keys()):
        count = len(groups[source_name])
        lines.append(f"- {source_name}: {count} tools (use tool_search to find specific tools)")

    return "\n".join(lines)


def _estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN
