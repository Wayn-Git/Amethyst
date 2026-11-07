"""Configuration and secret storage for phone-only LLM settings.

The phone-only key is kept isolated from desktop LLM keys so it can be revoked
or capped independently at the provider without impacting the desktop host.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.db.connection import get_connection
from backend.secrets import delete_secret, get_secret, set_secret

log = logging.getLogger(__name__)

PHONE_LLM_KEY_REF = "amethyst/phone_llm_api_key"
PROVIDER_SETTING = "phone_llm.provider"
MODEL_SETTING = "phone_llm.model"

DEFAULT_PHONE_PROVIDER = "anthropic"
DEFAULT_PHONE_MODEL = "claude-3-5-haiku-20241022"


def get_phone_llm_config() -> dict[str, Any]:
    """Retrieve the phone-only LLM configuration."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
        (PROVIDER_SETTING, MODEL_SETTING),
    ).fetchall()
    stored = {row["key"]: row["value"] for row in rows}

    provider = stored.get(PROVIDER_SETTING) or DEFAULT_PHONE_PROVIDER
    model = stored.get(MODEL_SETTING) or DEFAULT_PHONE_MODEL

    raw_key = get_secret(PHONE_LLM_KEY_REF)
    api_key = raw_key.strip() if raw_key else ""

    return {
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "has_key": bool(api_key),
    }


def set_phone_llm_config(
    provider: str,
    model: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Persist phone-only LLM provider, model, and optional API key."""
    conn = get_connection()
    cleaned_provider = provider.strip() or DEFAULT_PHONE_PROVIDER
    cleaned_model = model.strip() or DEFAULT_PHONE_MODEL

    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        (PROVIDER_SETTING, cleaned_provider),
    )
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        (MODEL_SETTING, cleaned_model),
    )
    conn.commit()

    if api_key is not None:
        cleaned_key = api_key.strip()
        if cleaned_key:
            set_secret(PHONE_LLM_KEY_REF, cleaned_key)
        else:
            try:
                delete_secret(PHONE_LLM_KEY_REF)
            except Exception:
                pass

    return get_phone_llm_config()


def clear_phone_llm_config() -> None:
    """Clear phone-only LLM settings and secret."""
    try:
        delete_secret(PHONE_LLM_KEY_REF)
    except Exception:
        pass

    conn = get_connection()
    conn.execute(
        "DELETE FROM app_settings WHERE key IN (?, ?)",
        (PROVIDER_SETTING, MODEL_SETTING),
    )
    conn.commit()


def has_phone_llm_key() -> bool:
    """Check if a separate phone-only LLM key is configured."""
    raw_key = get_secret(PHONE_LLM_KEY_REF)
    return bool(raw_key and raw_key.strip())
