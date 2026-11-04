from __future__ import annotations

import collections
import json
import logging
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from backend.library.service import LibraryService

log = logging.getLogger(__name__)

STOPWORDS = {
    "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "with",
    "by", "from", "of", "is", "it", "this", "that", "how", "what", "why",
}


def _tokenize_title(title: str | None) -> set[str]:
    if not title:
        return set()
    words = re.findall(r"\b[a-zA-Z]{3,}\b", title.lower())
    return {w for w in words if w not in STOPWORDS}


def auto_cluster_library_items(
    service: LibraryService,
    similarity_threshold: float = 0.30,
) -> dict[str, Any]:
    """Group closely related library items and extracted links into themed smart lists without duplicates."""
    store = service.store
    items = store.list(limit=2000)
    if len(items) < 2:
        return {"clusters_created": 0, "lists": []}

    # 1. Extract feature sets for items
    item_features: dict[int, dict[str, Any]] = {}
    for raw_it in items:
        it = dict(raw_it)
        tags: list[str] = []
        if it.get("tags"):
            try:
                raw = json.loads(it["tags"]) if isinstance(it["tags"], str) else it["tags"]
                if isinstance(raw, list):
                    tags = [t.strip().lstrip("#").lower() for t in raw if isinstance(t, str) and t.strip()]
            except Exception:
                tags = []

        domain = ""
        if it.get("url"):
            from urllib.parse import urlparse
            try:
                domain = urlparse(it["url"]).netloc.lower().replace("www.", "")
            except Exception:
                domain = ""

        tokens = _tokenize_title(it.get("title"))
        category = (it.get("category") or "").strip().lower()

        item_features[it["id"]] = {
            "tags": set(tags),
            "tokens": tokens,
            "domain": domain,
            "category": category,
            "title": it.get("title") or "",
        }

    # 2. Pairwise similarity & clustering
    item_ids = list(item_features.keys())
    clusters: list[list[int]] = []
    visited: set[int] = set()

    for i in range(len(item_ids)):
        id_a = item_ids[i]
        if id_a in visited:
            continue
        feat_a = item_features[id_a]
        current_cluster = [id_a]

        for j in range(i + 1, len(item_ids)):
            id_b = item_ids[j]
            if id_b in visited:
                continue
            feat_b = item_features[id_b]

            # Jaccard on tags
            tag_union = feat_a["tags"] | feat_b["tags"]
            tag_sim = (len(feat_a["tags"] & feat_b["tags"]) / len(tag_union)) if tag_union else 0.0

            # Token overlap
            tok_union = feat_a["tokens"] | feat_b["tokens"]
            tok_sim = (len(feat_a["tokens"] & feat_b["tokens"]) / len(tok_union)) if tok_union else 0.0

            # Domain / category match
            domain_match = 1.0 if feat_a["domain"] and feat_a["domain"] == feat_b["domain"] else 0.0
            cat_match = 1.0 if feat_a["category"] and feat_a["category"] == feat_b["category"] else 0.0

            score = (tag_sim * 0.5) + (tok_sim * 0.3) + (domain_match * 0.1) + (cat_match * 0.1)

            if score >= similarity_threshold or len(feat_a["tags"] & feat_b["tags"]) >= 2:
                current_cluster.append(id_b)

        if len(current_cluster) >= 2:
            for cid in current_cluster:
                visited.add(cid)
            clusters.append(current_cluster)

    # 3. Create or update smart lists for each cluster
    created_lists: list[dict[str, Any]] = []
    for cluster_item_ids in clusters:
        # Determine theme title from top shared tags or tokens
        all_cluster_tags = []
        all_cluster_tokens = []
        for cid in cluster_item_ids:
            all_cluster_tags.extend(item_features[cid]["tags"])
            all_cluster_tokens.extend(item_features[cid]["tokens"])

        tag_counts = collections.Counter(all_cluster_tags)
        token_counts = collections.Counter(all_cluster_tokens)

        title_parts = [t.title() for t, _ in tag_counts.most_common(2)]
        if not title_parts:
            title_parts = [tok.title() for tok, _ in token_counts.most_common(2)]
        if not title_parts:
            title_parts = ["Curated Collection"]

        list_title = " & ".join(title_parts)

        # Check existing smart lists to reuse or create new
        existing_lists = store.get_lists()
        matching_list = next((l for l in existing_lists if l["title"].lower() == list_title.lower()), None)

        if matching_list:
            list_id = matching_list["id"]
        else:
            list_id = store.create_list(
                title=list_title,
                description=f"Auto-clustered collection of {len(cluster_item_ids)} related resources.",
                icon="spark",
                is_smart=True,
            )

        # Add items and their extracted links (UNIQUE constraint handles deduplication automatically)
        for cid in cluster_item_ids:
            store.add_list_member(list_id=list_id, item_id=cid)
            item_links = store.get_extracted_links(item_id=cid)
            for link in item_links:
                store.add_list_member(list_id=list_id, link_id=link["id"])

        created_lists.append({
            "id": list_id,
            "title": list_title,
            "item_count": len(cluster_item_ids),
        })

    return {
        "clusters_created": len(created_lists),
        "lists": created_lists,
    }
