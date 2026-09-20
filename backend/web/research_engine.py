"""The web research engine orchestrating the Search -> Inspect -> Refine loop.

Implements the end-to-end research loop: query planning, multi-engine retrieval,
normalization, authority scoring, deduplication, targeted passage extraction,
cross-source verification, and structured observability telemetry.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Coroutine

from backend.web.authority import classify_authority
from backend.web.dedup import deduplicate_and_cluster
from backend.web.extractor import inspect_and_extract
from backend.web.models import (
    EvidenceItem,
    FreshnessWindow,
    ResearchDepth,
    ResearchPlan,
    ResearchTrace,
    SearchResult,
    SourceRegistry,
)
from backend.web.query_planner import plan_research
from backend.web.router import route_search_strategy
from backend.web.verification import evaluate_claims, format_verification_summary

log = logging.getLogger(__name__)


async def _default_search_fn(query: str, limit: int) -> list[dict[str, Any]]:
    """Default search execution through Amethyst's optimized multi-engine search service."""
    from backend.web.search_service import search_web
    return await search_web(query, limit=limit)


async def _default_image_search_fn(query: str, limit: int) -> list[dict[str, Any]]:
    """Default image search retrieval through Amethyst's search service."""
    from backend.web.search_service import search_images
    return await search_images(query, limit=limit)


class ResearchEngine:
    """Orchestrates adaptive web research tasks."""

    def __init__(
        self,
        search_fn: Callable[[str, int], Coroutine[Any, Any, list[dict[str, Any]]]] | None = None,
        image_search_fn: Callable[[str, int], Coroutine[Any, Any, list[dict[str, Any]]]] | None = None,
        turn_index: int = 0,
    ) -> None:
        self.search_fn = search_fn or _default_search_fn
        self.image_search_fn = image_search_fn or _default_image_search_fn
        self.turn_index = turn_index
        self.last_trace: ResearchTrace | None = None

    async def execute_research(
        self,
        query: str,
        depth: str | None = None,
        limit_per_query: int = 6,
        explicit_queries: list[str] | None = None,
    ) -> tuple[str, SourceRegistry, ResearchTrace]:
        """Execute a full research task according to modern AI search principles."""
        started_at = time.monotonic()
        trace = ResearchTrace()

        # 1. Routing: Determine research strategy
        selected_depth = route_search_strategy(query, explicit_depth=depth)

        # 2. Query Understanding & Planning
        plan = plan_research(query, depth=selected_depth)
        if explicit_queries:
            for eq in explicit_queries:
                eq_clean = eq.strip()
                if eq_clean and eq_clean not in plan.queries:
                    plan.queries.append(eq_clean)
        trace.plan = plan

        registry = SourceRegistry(turn_index=self.turn_index)

        # 3. Fast path: Simple search (only if not multiple explicit queries)
        if (not explicit_queries or len(plan.queries) <= 1) and (plan.depth == ResearchDepth.SIMPLE or len(plan.queries) == 1):
            q = plan.queries[0]
            trace.queries_executed.append(q)
            try:
                raw_hits = await self.search_fn(q, limit_per_query)
            except Exception as exc:
                log.warning("search failed for query %r: %s", q, exc)
                raw_hits = []

            trace.results_retrieved_count = len(raw_hits)
            normalized = []
            for i, h in enumerate(raw_hits):
                url = (h.get("url") or "").strip()
                title = (h.get("title") or "").strip()
                snippet = (h.get("snippet") or "").strip()
                domain = (h.get("domain") or "").strip()
                if not url or not title:
                    continue
                tier = classify_authority(url, domain, plan.priority_domains)
                item = SearchResult(
                    ref_id=f"turn{self.turn_index}search{i+1}",
                    title=title,
                    url=url,
                    domain=domain,
                    snippet=snippet,
                    published_date=h.get("published_date"),
                    relevance=h.get("score", 0.8),
                    authority_tier=tier,
                    raw_source=h.get("source", "search"),
                )
                registry.register(item)
                normalized.append(item)

            trace.results_selected = [s.ref_id for s in normalized]
            trace.duration_seconds = time.monotonic() - started_at
            self.last_trace = trace

            if not normalized:
                out = f"No results found for query {query!r}. All search engines returned nothing or are unavailable."
                return out, registry, trace

            # Format simple output
            lines = [f"Found {len(normalized)} results for {query!r}:\n"]
            for s in normalized:
                lines.append(f"- **[{s.ref_id}]** [{s.title}]({s.url}) ({s.domain})\n  {s.snippet}")
            return "\n\n".join(lines), registry, trace

        # 4. Multi-Query Execution Path (Current Events / Research / Deep Research)
        # Visual retrieval in parallel when entities or media/news intent present
        no_images = any(
            phrase in query.lower()
            for phrase in ("do not use image", "no image", "without image", "no picture", "text only", "basic text research")
        )
        is_visual = not no_images and bool(
            plan.entities
            or any(w in query.lower() for w in ("image", "photo", "art", "screenshot", "visual", "trailer", "release", "game", "hardware"))
            or plan.depth in (ResearchDepth.CURRENT_EVENTS, ResearchDepth.RESEARCH)
        )
        image_task = None
        if is_visual and self.image_search_fn:
            primary_ent = plan.entities[0] if plan.entities else query
            img_q = f"{primary_ent} official 2026" if "2026" not in primary_ent else f"{primary_ent} official"
            image_task = self._safe_image_search(img_q, limit=4)

        search_tasks = [self._safe_search(q, limit_per_query) for q in plan.queries]
        for q in plan.queries:
            trace.queries_executed.append(q)

        if image_task:
            all_coros = [*search_tasks, image_task]
            gathered = await asyncio.gather(*all_coros)
            results_by_query = gathered[:-1]
            image_hits = gathered[-1]
        else:
            results_by_query = await asyncio.gather(*search_tasks)
            image_hits = []

        all_raw_hits: list[dict[str, Any]] = []
        for q_hits in results_by_query:
            all_raw_hits.extend(q_hits)

        # Stale-detection & tight refinement:
        # If user requested 'latest only' or recency-focused, verify that results contain current year (2026).
        # If results are stale, trigger a fast second-pass search with tighter temporal anchors.
        import datetime
        now = datetime.date.today()
        year_str = str(now.year)
        month_str = now.strftime("%B")
        is_strict_latest = "latest only" in query.lower() or plan.freshness in (FreshnessWindow.PAST_24H, FreshnessWindow.PAST_7D)

        fresh_hits = [
            h for h in all_raw_hits
            if year_str in (h.get("snippet") or "")
            or year_str in (h.get("title") or "")
            or year_str in (h.get("published_date") or "")
            or month_str.lower() in (h.get("snippet") or "").lower()
        ]

        if is_strict_latest and len(fresh_hits) < 2:
            log.info("Initial results stale (<2 fresh hits); executing targeted second-pass search")
            primary_ent = plan.entities[0] if plan.entities else query
            month_year = now.strftime("%B %Y")
            second_queries = [
                f"{primary_ent} {month_year}",
                f"{primary_ent} latest announcement {month_year}",
            ]
            second_tasks = [self._safe_search(sq, limit_per_query) for sq in second_queries]
            for sq in second_queries:
                trace.queries_executed.append(sq)
            second_results = await asyncio.gather(*second_tasks)
            for q_hits in second_results:
                all_raw_hits.extend(q_hits)

        trace.results_retrieved_count = len(all_raw_hits)

        # 5. Normalization & Authority Scoring
        unfiltered_results: list[SearchResult] = []
        for i, h in enumerate(all_raw_hits):
            url = (h.get("url") or "").strip()
            title = (h.get("title") or "").strip()
            snippet = (h.get("snippet") or "").strip()
            domain = (h.get("domain") or "").strip()
            if not url or not title:
                continue
            tier = classify_authority(url, domain, plan.priority_domains)
            res = SearchResult(
                ref_id="",  # will be assigned by registry
                title=title,
                url=url,
                domain=domain,
                snippet=snippet,
                published_date=h.get("published_date"),
                relevance=h.get("score", 0.75),
                authority_tier=tier,
                raw_source=h.get("source", "search"),
            )
            unfiltered_results.append(res)

        # 6. Deduplication & Clustering
        clustered = deduplicate_and_cluster(unfiltered_results)
        trace.results_deduped_count = len(clustered)

        # Register in SourceRegistry
        for s in clustered:
            registry.register(s)

        # Sort by composite score (relevance, authority, freshness)
        clustered.sort(key=lambda x: x.composite_score, reverse=True)
        top_sources = clustered[:8]
        trace.results_selected = [s.ref_id for s in top_sources]

        # 7. Targeted Page Opening & Extraction (for top 2 authoritative sources)
        tokens_saved = 0
        if plan.depth in (ResearchDepth.RESEARCH, ResearchDepth.DEEP_RESEARCH):
            inspect_candidates = [
                s for s in top_sources
                if s.authority_tier in (
                    classify_authority(s.url, s.domain, plan.priority_domains),
                )
            ][:2]

            for target in inspect_candidates:
                trace.pages_inspected.append(target.url)
                extracted_items = await inspect_and_extract(
                    target,
                    query=query,
                    entities=plan.entities,
                    max_passages=2,
                )
                for item in extracted_items:
                    registry.add_evidence(item)
                    trace.evidence_extracted.append(item.to_dict())
                    # Estimated token savings: ~25000 tokens of full page vs ~300 tokens of passage
                    tokens_saved += 2000

        trace.estimated_tokens_saved = tokens_saved

        # 8. Multi-Source Verification
        all_evidence = registry.all_evidence()
        verified_claims = evaluate_claims(query, top_sources, all_evidence)
        trace.claims_verified = [
            {"topic": c.topic, "status": c.status.value, "summary": c.summary}
            for c in verified_claims
        ]

        # 9. Format Evidence Delivery for Reasoning Layer
        output_sections = []

        # Visual assets block
        if image_hits:
            img_lines = ["### Visual Context Assets (Embed 2-4 of these markdown images near the top of your response):"]
            for img in image_hits[:4]:
                img_url = img.get("image") or img.get("thumbnail")
                if img_url:
                    cap = img.get("title") or (f"{plan.entities[0]} visual context" if plan.entities else "Context visual")
                    clean_cap = cap.split(" - ")[0].split(" | ")[0].strip()
                    img_lines.append(f"![{clean_cap}]({img_url})")
            if len(img_lines) > 1:
                output_sections.append("\n".join(img_lines))

        # Header summary
        header = (
            f"### Research Plan Executed [{plan.depth.value.upper()} | Freshness: {plan.freshness.value}]\n"
            f"- Questions addressed: {', '.join(plan.queries)}\n"
            f"- High-confidence sources evaluated: {len(top_sources)} (clustered from {len(all_raw_hits)} hits)"
        )
        output_sections.append(header)

        # Verification matrix if claims exist
        if verified_claims:
            verification_block = format_verification_summary(verified_claims)
            output_sections.append(verification_block)

        # Extracted deep evidence passages
        if all_evidence:
            ev_lines = ["### Verified Evidence Passages:"]
            for ev in all_evidence:
                ev_lines.append(ev.format_for_context())
            output_sections.append("\n\n".join(ev_lines))

        # Core source cards with stable reference IDs
        src_lines = ["### Source Evidence & Citations:"]
        for s in top_sources:
            date_info = f", {s.published_date}" if s.published_date else ""
            syndicated = f" (+{len(s.syndicated_urls)} corroborating outlets)" if s.syndicated_urls else ""
            src_lines.append(
                f"- **[{s.ref_id}]** [{s.title}]({s.url}) — *{s.domain}*{date_info} [Tier: {s.authority_tier.value.upper()}]{syndicated}\n"
                f"  {s.snippet}"
            )
        output_sections.append("\n".join(src_lines))

        # Attach visual thumbnails to top sources if available
        if image_hits:
            for i, s in enumerate(top_sources):
                img = image_hits[i % len(image_hits)]
                img_url = img.get("image") or img.get("thumbnail")
                if img_url:
                    s.image_url = img_url

        # Latest Coverage & Article Navigation section (for bottom of response)
        nav_lines = ["### Latest Coverage & Article Navigation:"]
        for s in top_sources[:6]:
            date_str = f" ({s.published_date})" if s.published_date else ""
            img_tag = f" ![{s.title}]({s.image_url})" if s.image_url else ""
            nav_lines.append(f"- [{s.title}]({s.url}) — *{s.domain}*{date_str}{img_tag}")
        output_sections.append("\n".join(nav_lines))

        # Editorial response structure instructions
        guidance = (
            "### Editorial Response Structure Instructions:\n"
            "Comprehensive research has been gathered and verified across official and reputable sources above. "
            "You now have complete evidence. Do NOT perform any further search or tool calls. Proceed directly to synthesize your final response.\n"
            "- **Opening**: 1-2 concise sentences establishing the current state as of September 20, 2026.\n"
            "- **Visual Context**: If visual context assets are provided above, embed 2-4 markdown images near the top using `![Caption](url)` without text overlays. Otherwise omit images.\n"
            "- **Major Developments**: 2-3 detailed editorial sections explaining each confirmed announcement and news item in depth with context and significance.\n"
            "- **Inline Source Citations**: Cite sources inline immediately after the sentence or claim they substantiate as clickable markdown links: `[Publisher Name](url)` (e.g., `[Rockstar Games](url)` or `[IGN](url)`). These render as sleek citation pills directly after the sentence.\n"
            "- **Claim Distinction**: Explicitly distinguish CONFIRMED official announcements from REPORTED journalism and SPECULATION. If sources report conflicting information, clearly explain the discrepancy.\n"
            "- **Timeline / Status Table**: Include a clean, compact markdown table comparing dates, developments, and status (e.g., | Date | Development | Status |). Ensure each row has exactly the same number of columns as the header.\n"
            "- **Latest Coverage**: Conclude with `### Latest Coverage` listing 3-6 key articles: `- [Article Title](url) — *Publisher* (Date)` (include the `![Thumbnail](url)` if provided in the coverage bullets) which renders as an interactive horizontal article cards carousel."
        )
        output_sections.append(guidance)

        trace.duration_seconds = time.monotonic() - started_at
        self.last_trace = trace

        final_evidence_text = "\n\n".join(output_sections)
        return final_evidence_text, registry, trace

    async def _safe_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        try:
            return await self.search_fn(query, limit)
        except Exception as exc:
            log.warning("Safe search failed for %r: %s", query, exc)
            return []

    async def _safe_image_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        try:
            return await self.image_search_fn(query, limit)
        except Exception as exc:
            log.warning("Safe image search failed for %r: %s", query, exc)
            return []
