from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from backend.library.enrich import URL_PATTERN, normalize_url

if TYPE_CHECKING:
    from backend.library.service import LibraryService
    from backend.library.store import LibraryStore

log = logging.getLogger(__name__)

MARKDOWN_LINK_PATTERN = re.compile(r'\[([^\]]+)\]\(((?:https?://|[a-z0-9-]+\.[a-z]{2,})[^\s\)]+)\)', re.IGNORECASE)

TRACKING_PARAMS = {
    "igsh", "xtok", "mdxt", "cplk", "vrfl", "dlrf", "psln",
    "fbclid", "gclid", "dpr", "ref", "ref_src", "source", "obrf",
    "t", "s", "si", "feature", "context", "mibextid", "sender_device"
}


def clean_and_normalize_url(raw: str) -> str:
    """Normalize URL, remove tracking query params, and canonicalize path."""
    url = normalize_url(raw)
    if not url:
        return ""
    try:
        from urllib.parse import parse_qsl, urlencode, urlunparse
        parsed = urlparse(url)
        clean_query = [
            (k, v)
            for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if not k.startswith("utm_") and k.lower() not in TRACKING_PARAMS
        ]
        path = parsed.path.rstrip("/") if parsed.path != "/" else "/"
        cleaned = parsed._replace(
            netloc=parsed.netloc.lower().replace("www.", ""),
            path=path,
            query=urlencode(clean_query) if clean_query else "",
            fragment="",
        )
        return urlunparse(cleaned)
    except Exception:
        return url


def harvest_and_store_links(
    store: LibraryStore,
    item_id: int,
    text: str | None = None,
    resources: list[dict] | None = None,
) -> list[dict]:
    """Extract, normalize, deduplicate, and persist outbound links for an item."""
    if not item_id:
        return []

    discovered: dict[str, dict] = {}

    # 1. Markdown link format: [title](url)
    if text:
        for match in MARKDOWN_LINK_PATTERN.finditer(text):
            title, raw_url = match.group(1).strip(), match.group(2).strip()
            norm = clean_and_normalize_url(raw_url)
            if norm and norm.startswith("http"):
                parsed = urlparse(norm)
                domain = parsed.netloc.lower()
                if domain and domain not in ("localhost", "127.0.0.1"):
                    discovered[norm.lower()] = {
                        "url": norm,
                        "normalized_url": norm,
                        "domain": domain,
                        "title": title[:200] if title else None,
                    }

        # 2. Plain text URLs
        for m in URL_PATTERN.finditer(text):
            raw = m.group(0)
            norm = clean_and_normalize_url(raw)
            if norm and norm.startswith("http") and norm.lower() not in discovered:
                parsed = urlparse(norm)
                domain = parsed.netloc.lower()
                if domain and domain not in ("localhost", "127.0.0.1"):
                    discovered[norm.lower()] = {
                        "url": norm,
                        "normalized_url": norm,
                        "domain": domain,
                        "title": None,
                    }

    # 3. Resources list
    if resources:
        for res in resources:
            if not isinstance(res, dict):
                continue
            for k in ("url", "remote_url"):
                u = res.get(k)
                if u and isinstance(u, str) and u.startswith("http"):
                    norm = clean_and_normalize_url(u)
                    if norm and norm.lower() not in discovered:
                        parsed = urlparse(norm)
                        domain = parsed.netloc.lower()
                        if domain and domain not in ("localhost", "127.0.0.1"):
                            discovered[norm.lower()] = {
                                "url": norm,
                                "normalized_url": norm,
                                "domain": domain,
                                "title": str(res.get("name") or "")[:200] or None,
                            }

    stored: list[dict] = []
    for entry in discovered.values():
        try:
            link_id = store.save_extracted_link(
                source_item_id=item_id,
                url=entry["url"],
                normalized_url=entry["normalized_url"],
                domain=entry["domain"],
                title=entry["title"],
            )
            if link_id:
                stored.append({**entry, "id": link_id, "source_item_id": item_id})
        except Exception as exc:
            log.debug("could not save extracted link %s: %s", entry["url"][:60], exc)

    return stored


def backfill_all_links(service: LibraryService) -> dict[str, int]:
    """Harvest outbound links from all existing library items."""
    from pathlib import Path
    import json as _json

    rows = service.store.list(limit=100000)
    items_processed = 0
    links_harvested = 0

    for row in rows:
        item_id = row["id"]
        text = ""
        if row["text_path"] and Path(row["text_path"]).is_file():
            try:
                text = Path(row["text_path"]).read_text(encoding="utf-8")
            except Exception:
                text = ""

        resources = None
        if row["resources"]:
            try:
                resources = _json.loads(row["resources"])
            except Exception:
                resources = None

        links = harvest_and_store_links(service.store, item_id, text, resources)
        items_processed += 1
        links_harvested += len(links)

    return {"items_processed": items_processed, "links_harvested": links_harvested}
