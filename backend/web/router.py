"""Search routing layer.

Determines the optimal search strategy and depth based on freshness requirements,
complexity, entity count, and verification needs, avoiding expensive multi-query
pipelines for questions that can be cleanly answered with one good search.
"""

from __future__ import annotations

import re

from backend.web.models import FreshnessWindow, ResearchDepth
from backend.web.query_planner import infer_freshness

_DEEP_SIGNALS = re.compile(
    r"\b(deep dive|deep research|comprehensive|thorough|in-depth|exhaustive|investigate thoroughly|detailed analysis)\b",
    re.IGNORECASE,
)
_VERIFICATION_SIGNALS = re.compile(
    r"\b(delayed|canceled|cancelled|rumor|rumours|hoax|leak|leaked|alleged|is it true that|did .* really)\b",
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
    if freshness in (FreshnessWindow.PAST_24H, FreshnessWindow.PAST_7D):
        return ResearchDepth.CURRENT

    # 4. Multi-entity comparison
    if _COMPARISON_SIGNALS.search(q):
        return ResearchDepth.RESEARCH

    # 5. Simple factoid lookup
    if _SIMPLE_FACTOID.search(q):
        return ResearchDepth.SIMPLE

    # Default for general queries
    return ResearchDepth.SIMPLE
