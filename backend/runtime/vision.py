"""Visual extraction through a Vision-capable chat provider."""

from __future__ import annotations

import base64
import logging
from typing import Any

from backend.config import configured_providers
from backend.runtime.registry import default_chain, resolve

log = logging.getLogger(__name__)


async def extract_visual_text(
    images: list[bytes],
    prompt: str = (
        "Extract all readable on-screen text, headings, bullet points, and key details "
        "from these slides/frames. Provide a brief visual summary of what is shown."
    ),
) -> str | None:
    """Pass image bytes (video frames or carousel slides) to a Vision-capable LLM."""
    if not images:
        return None

    # 1. Build candidate list: starting with default chain, then any configured provider
    candidates: list[tuple[str, str | None]] = []
    seen: set[tuple[str, str | None]] = set()

    try:
        for link in default_chain():
            pair = (link.provider, link.model)
            if pair not in seen:
                candidates.append(pair)
                seen.add(pair)
    except Exception:
        pass

    # Add other configured providers
    for name, p_cfg in configured_providers().items():
        # Specifically for google, gemini-2.5-flash is extremely reliable for vision
        if name in ("google", "gemini"):
            for m in ("gemini-2.5-flash", p_cfg.default_model, "gemini-flash-latest"):
                if m and (name, m) not in seen:
                    candidates.append((name, m))
                    seen.add((name, m))
        else:
            pair = (name, p_cfg.default_model)
            if pair not in seen:
                candidates.append(pair)
                seen.add(pair)

    # 2. Build user message content with images
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    # Limit to max 6 images to stay within payload limits
    for img_bytes in images[:6]:
        content.append(
            {
                "type": "image",
                "media_type": "image/jpeg",
                "data": base64.b64encode(img_bytes).decode("utf-8"),
            }
        )

    messages = [{"role": "user", "content": content}]

    # 3. Try candidates until one succeeds
    for provider, model in candidates:
        try:
            resolved = resolve(provider, model)
        except Exception:
            continue

        if not resolved.capabilities.vision:
            continue

        try:
            response = await resolved.client.complete(messages)
            if response.text and response.text.strip():
                return response.text.strip()
        except Exception as exc:
            log.debug("vision extraction failed for %s/%s: %s", provider, model, exc)
            continue

    return None
