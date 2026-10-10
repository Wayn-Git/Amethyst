"""Search for images across the web and return structured gallery representations."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.agent.widgets import to_envelope
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.web import search_service

log = logging.getLogger(__name__)


async def search_images(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Search for relevant, high-quality images and return an interactive gallery."""
    query = (args.get("query") or args.get("q") or "").strip()
    if not query:
        return ToolResult.error("search_images requires a query parameter")

    limit = max(1, min(int(args.get("limit") or 6), 20))
    layout = args.get("layout") or "carousel"
    if layout not in ("carousel", "grid"):
        layout = "carousel"

    try:
        results = await search_service.search_images(query, limit=limit)
    except Exception as exc:
        log.warning("Image search failed for %r: %s", query, exc)
        return ToolResult.error(f"Image search failed: {exc}")

    images: list[dict[str, Any]] = []
    text_lines: list[str] = []

    for r in (results or []):
        img_url = r.get("url") or ""
        if not img_url:
            continue
        thumb = r.get("thumbnail") or img_url
        title = r.get("title") or query
        source = r.get("source") or r.get("domain") or ""
        images.append({
            "url": img_url,
            "title": title,
            "thumbnail": thumb,
            "source": source,
        })
        text_lines.append(f"- [{title}]({img_url}) (Source: {source})")

    if not images:
        return ToolResult.ok(
            f"No images found for {query!r}.\n"
            "[Circuit Breaker Directive: 0 image results returned. DO NOT retry search variations of this query. "
            "If you need assets or images from a specific page or brand, navigate directly to or fetch the primary source URL "
            "(e.g. using browser evaluate or fetch_url) to extract media from the DOM payload rather than looping search queries.]"
        )

    text_lines.insert(0, f"Found {len(images)} images for **{query}**:")

    gallery_payload = {
        "title": f"Images: {query}",
        "images": images,
        "layout": layout,
    }

    envelope = to_envelope("image_gallery", gallery_payload)
    output = f"\n".join(text_lines) + f"\n\n{envelope}"
    return ToolResult.ok(output)


def tools() -> list[Tool]:
    return [
        Tool(
            name="search_images",
            description=(
                "Search the web for high-quality images matching a query. "
                "Returns an interactive image gallery widget with thumbnails and sources. "
                "Use whenever the user requests pictures, photos, or images."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query for the images to find",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of images to return (default 6, max 20)",
                    },
                    "layout": {
                        "type": "string",
                        "enum": ["carousel", "grid"],
                        "description": "Display format for the image gallery (default: carousel)",
                    },
                },
                "required": ["query"],
            },
            handler=search_images,
            risk=RiskLevel.LOW,
        )
    ]
