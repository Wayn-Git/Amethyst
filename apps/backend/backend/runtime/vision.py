"""Visual extraction through a Vision-capable chat provider."""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

from backend.config import configured_providers
from backend.runtime.providers.openai_compat import is_vision_model
from backend.runtime.registry import default_chain, resolve

log = logging.getLogger(__name__)

KNOWN_VISION_MODELS: dict[str, list[str]] = {
    "nvidia": [
        "meta/llama-3.2-11b-vision-instruct",
        "meta/llama-3.2-90b-vision-instruct",
        "microsoft/phi-3-vision-128k-instruct",
    ],
    "google": [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-2.0-flash",
    ],
    "mistral": [
        "mistral-ocr-latest",
        "pixtral-12b-2409",
        "pixtral-large-latest",
    ],
    "opencode-zen": [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gpt-5.4-mini",
    ],
    "groq": [
        "llama-3.2-11b-vision-preview",
        "llama-3.2-90b-vision-preview",
    ],
}


def get_vision_candidates() -> list[tuple[str, str | None]]:
    """Build candidate list of (provider, model) pairs that support vision."""
    candidates: list[tuple[str, str | None]] = []
    seen: set[tuple[str, str | None]] = set()

    def add(p: str, m: str | None):
        pair = (p, m)
        if pair not in seen:
            candidates.append(pair)
            seen.add(pair)

    # 1. Default chain links if vision-capable
    try:
        for link in default_chain():
            if is_vision_model(link.model or ""):
                add(link.provider, link.model)
    except Exception:
        pass

    # 2. Configured providers
    cfg_providers = configured_providers()

    # Prioritize providers known to be fast and verified for vision
    priority_order = ["nvidia", "google", "mistral", "opencode-zen", "groq", "kilocode"]
    ordered_names = [p for p in priority_order if p in cfg_providers] + [
        p for p in cfg_providers if p not in priority_order
    ]

    for name in ordered_names:
        p_cfg = cfg_providers[name]
        # Known vision models for this provider
        for km in KNOWN_VISION_MODELS.get(name, []):
            add(name, km)

        # Default model if vision capable
        if p_cfg.default_model and is_vision_model(p_cfg.default_model):
            add(name, p_cfg.default_model)

        # Other models in provider's configured model list
        for m in getattr(p_cfg, "models", []) or []:
            if isinstance(m, str) and is_vision_model(m):
                add(name, m)

    return candidates


async def _extract_single_image(resolved: Any, img_bytes: bytes, prompt: str) -> str | None:
    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image",
            "media_type": "image/jpeg",
            "data": base64.b64encode(img_bytes).decode("utf-8"),
        },
    ]
    messages = [{"role": "user", "content": content}]
    res = await resolved.client.complete(messages)
    return res.text.strip() if res.text and res.text.strip() else None


async def extract_visual_text(
    images: list[bytes],
    prompt: str = (
        "Extract all readable text, titles, headings, tool/product names, component libraries, "
        "UI kits, website names, URLs/domains, taglines, and key features shown on this slide or frame. "
        "Be concise, factual, and include all named tools and links."
    ),
) -> str | None:
    """Pass image bytes (video frames or carousel slides) to a Vision-capable LLM."""
    if not images:
        return None

    candidates = get_vision_candidates()
    if not candidates:
        log.warning("no vision-capable models configured")
        return None

    # Cap to max 10 images to prevent excessive resource usage
    sampled_images = (
        images[:10]
        if len(images) <= 10
        else [images[int(i * (len(images) - 1) / 9)] for i in range(10)]
    )

    for provider, model in candidates:
        try:
            resolved = resolve(provider, model)
        except Exception:
            continue

        if not resolved.capabilities.vision:
            continue

        # If only 1 image:
        if len(sampled_images) == 1:
            try:
                text = await _extract_single_image(resolved, sampled_images[0], prompt)
                if text:
                    return text
            except Exception as exc:
                log.debug("single image vision failed for %s/%s: %s", provider, model, exc)
                continue

        # If multiple images: process per-image in parallel with concurrency limit
        try:
            sem = asyncio.Semaphore(4)

            async def sem_extract(img, idx):
                async with sem:
                    return await _extract_single_image(
                        resolved,
                        img,
                        f"Slide/Frame {idx + 1}:\n{prompt}",
                    )

            tasks = [sem_extract(img, i) for i, img in enumerate(sampled_images)]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            valid_results = [
                f"Slide/Frame {i + 1}:\n{r}"
                for i, r in enumerate(results)
                if isinstance(r, str) and r.strip()
            ]
            if valid_results:
                return "\n\n".join(valid_results)
        except Exception as exc:
            log.debug("multi-image vision failed for %s/%s: %s", provider, model, exc)
            continue

    return None
