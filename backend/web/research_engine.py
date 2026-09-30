"""The web research engine orchestrating the Search -> Inspect -> Refine loop.

Implements the end-to-end research loop: query planning, multi-engine retrieval,
normalization, authority scoring, deduplication, targeted passage extraction,
cross-source verification, and structured observability telemetry.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from collections.abc import Callable, Coroutine
from typing import Any
from urllib.parse import urlparse

from backend.web.authority import classify_authority
from backend.web.dedup import deduplicate_and_cluster
from backend.web.extractor import inspect_and_extract
from backend.web.models import (
    FreshnessWindow,
    ResearchDepth,
    ResearchTrace,
    SearchResult,
    SourceRegistry,
)
from backend.web.query_planner import plan_research
from backend.web.router import route_search_strategy
from backend.web.verification import evaluate_claims, format_verification_summary

log = logging.getLogger(__name__)

SearchFn = Callable[[str, int], Coroutine[Any, Any, list[dict[str, Any]]]]


async def _default_search_fn(query: str, limit: int) -> list[dict[str, Any]]:
    """Default search execution through Amethyst's optimized multi-engine search service."""
    from backend.web.search_service import search_web
    return await search_web(query, limit=limit)


async def _default_image_search_fn(query: str, limit: int) -> list[dict[str, Any]]:
    """Default image search retrieval through Amethyst's search service."""
    from backend.web.search_service import search_images
    return await search_images(query, limit=limit)


def _extract_slug_subject(img_url: str, entities: list[str] | None = None) -> str:
    """Extract semantic sub-topic or location from image URL slug or filename.

    Generically parses filename stems across any domain, splitting CamelCase and
    letter-digit boundaries, stripping standard image scaling/resolution tags,
    and stripping known query entities so only the specific sub-topic remains.
    """
    if not img_url:
        return ""
    path = urlparse(img_url).path
    filename = os.path.basename(path)
    stem, _ = os.path.splitext(filename)

    # 1. Expand CamelCase and separate letter/digit boundaries (e.g. gta6 -> gta 6, f80 -> f 80)
    clean = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)
    clean = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", clean)
    clean = re.sub(r"(\d)([a-zA-Z])", r"\1 \2", clean)

    # 2. Strip resolution, dimension, and scaling artifacts
    clean = re.sub(
        r"[-_](?:1080p?|720p?|1440p?|2160p?|4k|8k|uhd|fhd|hd|thumb|thumbnail|preview|"
        r"small|medium|large|scaled|\d{2,4}x\d{2,4}|\d+w|\d+h)",
        "",
        clean,
        flags=re.IGNORECASE,
    )

    # 3. Strip trailing numerical counters or index suffixes (e.g. -01, _05_0)
    clean = re.sub(r"[-_]\d{1,4}(?:_\d+)?$", "", clean)

    # 4. Strip generic media asset descriptors
    clean = re.sub(
        r"\b(?:image\d*|screenshot\d*|screencap\d*|screen\d*|photo\d*|pic\d*|"
        r"clip\d*|trailer\d*|wallpaper\d*|render\d*|artwork\d*)\b",
        "",
        clean,
        flags=re.IGNORECASE,
    )

    # 5. Strip known entity tokens dynamically if provided
    if entities:
        for ent in entities:
            ent_norm = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", ent)
            ent_norm = re.sub(r"(\d)([a-zA-Z])", r"\1 \2", ent_norm)
            for tok in re.findall(r"\b[a-zA-Z0-9]+\b", f"{ent} {ent_norm}".lower()):
                clean = re.sub(rf"\b{re.escape(tok)}\b", "", clean, flags=re.IGNORECASE)

    tokens = [w for w in re.split(r"[-_\s]+", clean) if w and not w.isdigit()]
    if not tokens:
        return ""

    generic_words = {
        "default", "hero", "header", "banner", "main", "cover", "art",
        "screenshot", "screenshots", "wallpaper", "image", "photo", "pic",
        "thumb", "thumbnail", "preview", "trailer", "screen", "media", "asset",
        "gallery", "upload", "download",
    }
    if all(t.lower() in generic_words for t in tokens):
        return ""

    return " ".join(tokens).title().strip()


def _clean_image_caption(
    title: str,
    entities: list[str] | None = None,
    slug_subject: str = "",
) -> str:
    """Clean a noisy search title into a natural, editorial image caption."""
    if not title:
        ent = entities[0] if entities else "Visual"
        return f"{ent} {slug_subject}".strip() if slug_subject else f"{ent} visual"

    # Remove typical separator tails (e.g. "Title - Domain", "Title | Domain", "Title — Domain")
    cap = re.split(r"\s+[-–—|]\s+", title)[0].strip()

    # Strip noisy review / clickbait prefixes
    cap = re.sub(
        r"^(?:review|first look|hands-on|watch|exclusive|photos?|"
        r"gallery|breaking news|breaking):\s*",
        "",
        cap,
        flags=re.IGNORECASE,
    ).strip()

    # Strip resolution, numbering, or wallpaper noise
    cap = re.sub(
        r"\s*[\(\[](?:picture|photo|gallery|\d+x\d+|\d+k)[^\)\]]*[\)\]]",
        "",
        cap,
        flags=re.IGNORECASE,
    ).strip()
    cap = re.sub(
        r"\b(?:\d+x\d+|4k|8k|hd|ultra hd|uhd|fhd|wallpaper|official website)\b",
        "",
        cap,
        flags=re.IGNORECASE,
    ).strip()

    # Collapse repeated whitespace
    cap = re.sub(r"\s+", " ", cap).strip()

    # If title is generic gallery/announcement but we have a concrete slug subject, use it
    is_generic = any(
        g in cap.lower()
        for g in (
            "all official screenshots", "lots of new", "screenshots",
            "screenshot gallery", "images gallery",
        )
    )
    if slug_subject:
        if is_generic or len(cap) < 5 or slug_subject.lower() not in cap.lower():
            primary = entities[0] if entities else ""
            if primary and primary.lower() not in slug_subject.lower():
                return f"{primary} {slug_subject}"
            return slug_subject

    # If the caption got wiped or is trivially short, use entity fallback
    if len(cap) < 4:
        ent = entities[0] if entities else "Visual"
        return f"{ent} {slug_subject}".strip() if slug_subject else f"{ent} visual"

    # Truncate cleanly at word boundary if overly long (> 65 chars)
    if len(cap) > 65:
        truncated = cap[:65].rsplit(" ", 1)[0].strip()
        if len(truncated) >= 10:
            cap = truncated

    return cap


def _formulate_image_query(query: str, entities: list[str] | None = None) -> str:
    """Construct a clean, high-precision image search query targeting official/editorial assets."""
    if entities:
        subject = entities[0]
        if len(entities) > 1 and any(w in query.lower() for w in ("vs", "versus", "compare")):
            subject = f"{entities[0]} {entities[1]}"
    else:
        cleaned = query.strip()
        prefix_pattern = (
            r"^(?:can you|could you|please|tell me about|what is|what are|who is|where is|"
            r"latest on|show me|find|give me an overview of|what do we know about|"
            r"what's happening with)\s+"
        )
        while True:
            m = re.match(prefix_pattern, cleaned, flags=re.IGNORECASE)
            if not m:
                break
            cleaned = cleaned[m.end():].strip()

        cleaned = re.sub(
            r"^(?:pictures?|images?|photos?|screenshots?|visuals?)\s+of\s+",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(
            r"\b(?:pictures?|images?|photos?|screenshots?|visuals?)\b",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        subject = re.sub(r"^(?:the|a|an)\s+", "", cleaned.strip(), flags=re.IGNORECASE)
        subject = re.sub(r"[\?\.\!\:\;]+$", "", subject).strip()

    low = f"{subject} {query}".lower()

    if any(
        w in low
        for w in (
            "game", "gaming", "gameplay", "videogame", "video game", "playstation",
            "xbox", "nintendo", "steam", "rpg", "trailer", "esports",
        )
    ):
        qualifier = "official screenshots"
    elif any(
        w in low
        for w in (
            "car", "hypercar", "supercar", "auto", "ferrari", "porsche", "bmw", "mercedes",
            "audi", "vehicle", "truck", "motor",
        )
    ):
        qualifier = "official reveal press photo"
    elif any(
        w in low
        for w in (
            "phone", "iphone", "android", "samsung", "gpu", "nvidia", "rtx", "intel", "amd",
            "laptop", "macbook", "headset", "gadget",
        )
    ):
        qualifier = "official reveal photos"
    elif any(
        w in low
        for w in (
            "space", "nasa", "spacex", "telescope", "starship", "planet", "rocket", "mission",
            "satellite", "nebula", "mars", "moon",
        )
    ):
        qualifier = "official mission photo"
    elif any(
        w in low
        for w in ("movie", "film", "series", "season", "tv show", "actor", "actress", "director")
    ):
        qualifier = "official promotional still"
    elif any(
        w in low
        for w in (
            "president", "prime minister", "ceo", "founder",
            "senator", "chancellor", "leader",
        )
    ):
        qualifier = "official portrait press"
    else:
        qualifier = "official press photo"

    return f"{subject} {qualifier}".strip()


class ResearchEngine:
    """Orchestrates adaptive web research tasks."""

    def __init__(
        self,
        search_fn: SearchFn | None = None,
        image_search_fn: SearchFn | None = None,
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
        if (not explicit_queries or len(plan.queries) <= 1) and (
            plan.depth == ResearchDepth.SIMPLE or len(plan.queries) == 1
        ):
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
                out = (
                    f"No results found for query {query!r}. "
                    "All search engines returned nothing or are unavailable."
                )
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
            for phrase in (
                "do not use image", "no image", "without image", "no picture",
                "text only", "basic text research",
            )
        )
        is_visual = not no_images and bool(
            plan.entities
            or any(
                w in query.lower()
                for w in (
                    "image", "photo", "art", "screenshot", "visual",
                    "trailer", "release", "game", "hardware",
                )
            )
            or plan.depth in (
                ResearchDepth.CURRENT, ResearchDepth.RESEARCH, ResearchDepth.DEEP_RESEARCH
            )
        )
        image_task = None
        if is_visual and self.image_search_fn:
            img_q = _formulate_image_query(query, plan.entities)
            image_task = self._safe_image_search(img_q, limit=12)

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
        # If user requested 'latest only' or recency-focused, verify that results contain
        # current year (e.g. 2026). If stale, trigger a fast second-pass search.
        import datetime
        now = datetime.date.today()
        year_str = str(now.year)
        month_str = now.strftime("%B")
        is_strict_latest = (
            "latest only" in query.lower()
            or plan.freshness in (FreshnessWindow.PAST_24H, FreshnessWindow.PAST_7D)
        )

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
        for h in all_raw_hits:
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

        # Deduplicate and sanitize image hits:
        # Guarantee no repeated images, clean URLs, and unique basenames
        unique_images: list[dict[str, Any]] = []
        seen_img_urls = set()
        seen_basenames = set()

        for img in image_hits:
            img_url = (img.get("image") or img.get("thumbnail") or "").strip()
            if not img_url or img_url in seen_img_urls:
                continue

            path = urlparse(img_url).path
            base = os.path.basename(path).lower()
            # Clean common scale/size suffixes like _1920x1080, -thumb, @2x, etc.
            base_clean = re.sub(
                r"[-_](?:\d+x\d+|thumb|small|medium|large|preview|scaled|\d+w)",
                "",
                base,
            )
            if len(base_clean) > 5 and base_clean in seen_basenames:
                continue

            seen_img_urls.add(img_url)
            if len(base_clean) > 5:
                seen_basenames.add(base_clean)
            unique_images.append(img)

        # Visual assets block
        if unique_images:
            img_lines = [
                "### Visual Context Assets (Embed 2-3 inline across relevant sections):",
                "> Instructions: Each image must be embedded directly inside the narrative",
                "> section discussing its specific subject (e.g. location images under World/Map,",
                "> character images under Cast or Gameplay). Never cluster them together or",
                "> place under unrelated topics.",
            ]
            for img in unique_images[:4]:
                img_url = img.get("image") or img.get("thumbnail")
                if img_url:
                    raw_title = img.get("title") or (
                        f"{plan.entities[0]} visual" if plan.entities else "Context visual"
                    )
                    slug_subject = _extract_slug_subject(img_url, entities=plan.entities)
                    clean_cap = _clean_image_caption(
                        raw_title,
                        entities=plan.entities,
                        slug_subject=slug_subject,
                    )
                    subject_label = slug_subject or (
                        plan.entities[0] if plan.entities else "Overview"
                    )
                    img_lines.append(
                        f"- ![{clean_cap}]({img_url}) — *Subject: {subject_label}*"
                    )
            if len(img_lines) > 5:
                output_sections.append("\n".join(img_lines))

        # Header summary
        header = (
            f"### Research Plan Executed [{plan.depth.value.upper()} | "
            f"Freshness: {plan.freshness.value}]\n"
            f"- Questions addressed: {', '.join(plan.queries)}\n"
            f"- High-confidence sources evaluated: {len(top_sources)} "
            f"(clustered from {len(all_raw_hits)} hits)"
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
            syndicated = (
                f" (+{len(s.syndicated_urls)} corroborating outlets)"
                if s.syndicated_urls
                else ""
            )
            src_lines.append(
                f"- **[{s.ref_id}]** [{s.title}]({s.url}) — *{s.domain}*{date_info} "
                f"[Tier: {s.authority_tier.value.upper()}]{syndicated}\n"
                f"  {s.snippet}"
            )
        output_sections.append("\n".join(src_lines))

        # Attach visual thumbnails to top sources:
        # Guarantee EVERY card gets a distinct, non-repeating thumbnail!
        used_thumbs: set[str] = set()

        # 1. Respect page images already extracted and not yet used
        for s in top_sources:
            if s.image_url and s.image_url not in used_thumbs:
                used_thumbs.add(s.image_url)

        # 2. Match unique images by domain
        for s in top_sources:
            if not s.image_url:
                match = next(
                    (
                        img for img in unique_images
                        if (img.get("image") or img.get("thumbnail"))
                        and (img.get("image") or img.get("thumbnail")) not in used_thumbs
                        and (
                            s.domain in (img.get("source_url") or "")
                            or s.domain in (img.get("creator") or "")
                        )
                    ),
                    None,
                )
                if match:
                    thumb = match.get("image") or match.get("thumbnail")
                    s.image_url = thumb
                    used_thumbs.add(thumb)

        # 3. Fill any remaining sources with unused distinct images from the pool
        unused_imgs = [
            (img.get("image") or img.get("thumbnail"))
            for img in unique_images
            if (img.get("image") or img.get("thumbnail"))
            and (img.get("image") or img.get("thumbnail")) not in used_thumbs
        ]
        unused_iter = iter(unused_imgs)
        for s in top_sources:
            if not s.image_url:
                next_thumb = next(unused_iter, None)
                if next_thumb:
                    s.image_url = next_thumb
                    used_thumbs.add(next_thumb)

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
            "Comprehensive research has been gathered and verified across official and "
            "reputable sources above. You now have complete evidence. Do NOT perform any "
            "further search or tool calls. Proceed directly to synthesize your final response "
            "in natural, authoritative ChatGPT editorial style.\n"
            "- **Tone & Style**: Do NOT use emojis in headings (NO `## 📅 Headline` or "
            "`## 🔥 Story`). Write in clear, structured journalistic narrative.\n"
            "- **Opening**: 1-2 conversational sentences establishing what you checked "
            "and current status.\n"
            "- **Numbered Major Developments**: Organize key news into numbered sections "
            "(e.g., `1. Release date is confirmed: November 19, 2026`, "
            "`2. The biggest news today: ...`). Detail developer interviews, world details, "
            "and context.\n"
            "- **Visual Context Assets**: When Visual Context Assets are provided above, "
            "embed 2–3 of them inline directly under relevant story sections on their own "
            "standalone lines with a blank line before and after: `![Descriptive Caption](url)`. "
            "Distribute images contextually across sections rather than clustering them together. "
            "Never omit images when provided.\n"
            "- **Inline Source Citations**: Cite sources inline immediately after the sentence or "
            "claim they substantiate as clickable markdown links: `([Publisher Name](url))` "
            "(e.g., `([Rockstar Games](url))` or `([Game Informer](url))`). "
            "These render as sleek citation pills directly after the sentence.\n"
            "- **Clean Links**: For official portals, cover reveals, or media pages, "
            "provide a standalone link on its own line: `[Official Rockstar GTA VI page](url)`.\n"
            "- **Natural Comparison Table**: Include a clean markdown table for key facts or "
            "status (e.g., `The GTA 6 situation right now` with `Thing | Current status`). "
            "Table values must be plain text with natural casing (`Confirmed`, `Not announced`, "
            "`Out today`) and selective bolding on key figures. NEVER write all-caps words "
            "like `CONFIRMED` or `REPORTED`.\n"
            "- **Latest Coverage**: Conclude with `### Latest Coverage & Article Navigation:` "
            "listing key reading sources: `- [Article Title](url) — *Publisher* (Date)`."
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
