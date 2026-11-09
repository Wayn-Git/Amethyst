"""Tool-less LLM completion client for Amethyst Notifier.

Designed to use free-tier model providers (Groq, Gemini, Cerebras, OpenRouter)
via standard OpenAI-compatible endpoints with a minimal token footprint.
Includes deterministic fallback if LLM is unavailable.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger("amethyst.notifier.llm")

# Preset endpoints and default models
PROVIDER_CONFIGS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
        "env_key": "GROQ_API_KEY",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "default_model": "gemini-2.0-flash",
        "env_key": "GEMINI_API_KEY",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "default_model": "llama-3.3-70b",
        "env_key": "CEREBRAS_API_KEY",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "meta-llama/llama-3.3-70b-instruct:free",
        "env_key": "OPENROUTER_API_KEY",
    },
    "opencode": {
        "base_url": "https://opencode.ai/zen/v1",
        "default_model": "mimo-v2.6-flash-free",
        "env_key": "OPENCODE_API_KEY",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "env_key": "OPENAI_API_KEY",
    },
}


def resolve_llm_config() -> tuple[str, str, str]:
    """Resolve (base_url, api_key, model) from environment variables."""
    explicit_base = os.getenv("NOTIFIER_LLM_BASE_URL")
    explicit_key = os.getenv("NOTIFIER_LLM_API_KEY")
    explicit_model = os.getenv("NOTIFIER_LLM_MODEL")
    provider_name = (os.getenv("NOTIFIER_LLM_PROVIDER") or "auto").lower().strip()

    if provider_name in PROVIDER_CONFIGS:
        cfg = PROVIDER_CONFIGS[provider_name]
        key = explicit_key or os.getenv(cfg["env_key"]) or ""
        base_url = explicit_base or cfg["base_url"]
        model = explicit_model or cfg["default_model"]
        return base_url, key, model

    # Auto-detection across free providers in order of speed and stability
    candidates = ["groq", "gemini", "cerebras", "openrouter", "opencode", "openai"]
    for cand in candidates:
        cfg = PROVIDER_CONFIGS[cand]
        found_key = os.getenv(cfg["env_key"])
        if found_key:
            return (
                explicit_base or cfg["base_url"],
                explicit_key or found_key,
                explicit_model or cfg["default_model"],
            )

    # Fallback to whatever was explicitly provided, or groq defaults
    fallback_cfg = PROVIDER_CONFIGS["groq"]
    return (
        explicit_base or fallback_cfg["base_url"],
        explicit_key or "",
        explicit_model or fallback_cfg["default_model"],
    )


def generate_completion(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 800,
    temperature: float = 0.3,
) -> str | None:
    """Make one tool-less LLM completion call via HTTP.

    Returns the assistant's reply text, or None if unavailable/failed.
    """
    base_url, api_key, model = resolve_llm_config()
    if not api_key:
        log.warning("No LLM API key detected. Using deterministic fallback.")
        return None

    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices", [])
            if choices and "message" in choices[0]:
                return choices[0]["message"].get("content", "").strip()
    except Exception as exc:
        log.error("LLM completion failed (%s): %s", model, exc)

    return None
