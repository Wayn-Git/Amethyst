"""Search routing layer.

Determines the optimal search strategy, research depth, and task-aware provider
dispatch (LangSearch, Exa, Firecrawl, Tavily) based on query semantics, extraction
needs, freshness requirements, and real-time provider health.
"""

from __future__ import annotations

import enum
import os
import re
from typing import Any

from backend.web.circuit_breaker import get_circuit_breaker
from backend.web.models import FreshnessWindow, ResearchDepth
from backend.web.query_planner import infer_freshness

_DEEP_SIGNALS = re.compile(
    r"\b(deep dive|deep research|comprehensive|thorough|in-depth|exhaustive|investigate thoroughly|detailed analysis|everything about|all about|tell me everything|complete overview|full breakdown)\b",
    re.IGNORECASE,
)
_VERIFICATION_SIGNALS = re.compile(
    r"\b(delayed|cancel|canceled|cancelled|cancelling|canceling|rumor|rumours|hoax|leak|leaked|alleged|is it true that|did .* really|debunk|dispute)\b",
    re.IGNORECASE,
)
_COMPARISON_SIGNALS = re.compile(
    r"\b(compare|versus| vs |difference between|which is better)\b",
    re.IGNORECASE,
)
_SIMPLE_FACTOID = re.compile(
    r"^(who (is|was)|what is the (capital|population|height|age|speed|formula)|when was .* born|when was .* invented|where is)\b",
    re.IGNORECASE,
)

_URL_AND_EXTRACTION_SIGNALS = re.compile(
    r"(https?://\S+|^(scrape|crawl|extract markdown|fetch|read page)\b|\b(full documentation for|scrape the full)\b)",
    re.IGNORECASE,
)

_SEMANTIC_SIGNALS = re.compile(
    r"\b(similar to|alternative to|alternatives to|libraries like|library like|packages like|tools like|deep research on|academic|papers? on|research on|distributed consensus|architecture of|trade-offs of)\b",
    re.IGNORECASE,
)


class SearchTaskType(str, enum.Enum):
    GENERAL_WEB = "general_web"
    SEMANTIC_RESEARCH = "semantic_research"
    DEEP_EXTRACTION = "deep_extraction"
    FACTUAL_VERIFICATION = "factual_verification"


_TASK_PREFERENCES: dict[SearchTaskType, list[str]] = {
    SearchTaskType.GENERAL_WEB: ["langsearch", "exa", "tavily", "firecrawl"],
    SearchTaskType.SEMANTIC_RESEARCH: ["exa", "langsearch", "tavily", "firecrawl"],
    SearchTaskType.DEEP_EXTRACTION: ["firecrawl", "langsearch", "exa", "tavily"],
    SearchTaskType.FACTUAL_VERIFICATION: ["tavily", "langsearch", "exa", "firecrawl"],
}


def classify_search_task(query: str, options: dict[str, Any] | None = None) -> SearchTaskType:
    """Classify a query into a specialized search task type."""
    q = query.strip()
    if not q:
        return SearchTaskType.GENERAL_WEB

    # 1. URL extraction, documentation scraping, or direct page crawls
    if _URL_AND_EXTRACTION_SIGNALS.search(q):
        return SearchTaskType.DEEP_EXTRACTION

    # 2. Fact-checking, rumors, cancellations, disputed claims
    if _VERIFICATION_SIGNALS.search(q):
        return SearchTaskType.FACTUAL_VERIFICATION

    # 3. Semantic / conceptual / technical research
    if _SEMANTIC_SIGNALS.search(q) or _COMPARISON_SIGNALS.search(q) or _DEEP_SIGNALS.search(q):
        return SearchTaskType.SEMANTIC_RESEARCH

    # 4. Default: General web search
    return SearchTaskType.GENERAL_WEB


def _is_provider_configured(name: str) -> bool:
    from backend.secrets import get_secret
    from backend.web.search_service import _SEARCH_APIS

    adapter = next((a for a in _SEARCH_APIS if a["name"] == name), None)
    if not adapter:
        return False
    try:
        key = get_secret(adapter["ref"]) or (os.environ.get(adapter["env"]) if "env" in adapter else None)
        return bool(key)
    except Exception:
        return False


def route_search_task(
    query: str,
    preferred: str | None = None,
    options: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """Determine the optimal primary provider and fallback chain for a search task."""
    task_type = classify_search_task(query, options)
    base_order = list(_TASK_PREFERENCES.get(task_type, ["langsearch", "exa", "firecrawl", "tavily"]))

    # Apply user or tool preference override if specified
    pref = (preferred or "").strip().lower()
    if pref and pref in ("langsearch", "exa", "firecrawl", "tavily"):
        ordered = [pref] + [p for p in base_order if p != pref]
    else:
        ordered = base_order

    cb = get_circuit_breaker()
    configured_and_healthy = [p for p in ordered if _is_provider_configured(p) and cb.is_available(p)]

    if configured_and_healthy:
        return configured_and_healthy[0], configured_and_healthy[1:]

    # If all configured providers are currently in cooldown, try the configured ones in order anyway
    configured = [p for p in ordered if _is_provider_configured(p)]
    if configured:
        return configured[0], configured[1:]

    # Zero keys configured: return top default preference
    return ordered[0], ordered[1:]


def route_search_strategy(
    query: str,
    explicit_depth: str | None = None,
) -> ResearchDepth:
    """Decide which search depth and strategy to use for a given query."""
    if explicit_depth:
        clean = explicit_depth.strip().lower()
        if clean in ("simple", "fast"):
            return ResearchDepth.SIMPLE
        if clean in ("current", "news"):
            return ResearchDepth.CURRENT
        if clean in ("research", "multi"):
            return ResearchDepth.RESEARCH
        if clean in ("deep", "deep_research", "exhaustive"):
            return ResearchDepth.DEEP_RESEARCH

    q = query.strip()

    # 1. User explicitly requests deep or comprehensive research
    if _DEEP_SIGNALS.search(q):
        return ResearchDepth.DEEP_RESEARCH

    # 2. Query requires cross-source claim verification
    if _VERIFICATION_SIGNALS.search(q):
        return ResearchDepth.RESEARCH

    # 3. Freshness requirement
    freshness = infer_freshness(q)
    if freshness in (FreshnessWindow.PAST_24H, FreshnessWindow.PAST_7D, FreshnessWindow.PAST_30D):
        return ResearchDepth.CURRENT

    # 4. Multi-entity comparison
    if _COMPARISON_SIGNALS.search(q):
        return ResearchDepth.RESEARCH

    # 5. Simple factoid lookup
    if _SIMPLE_FACTOID.search(q):
        return ResearchDepth.SIMPLE

    # 6. Entity or evolving topic
    from backend.web.query_planner import extract_entities
    if extract_entities(q):
        return ResearchDepth.RESEARCH

    # Default for general queries
    return ResearchDepth.SIMPLE
