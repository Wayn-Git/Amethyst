"""Fetch and cache the models.dev catalog for reasoning effort metadata.

Downloads the full model catalog from models.dev on boot, caches it locally,
and serves lookups from the cache. Background refresh keeps it current.

Zero latency at request time — every lookup is a dict access.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from backend.config import paths

log = logging.getLogger(__name__)

MODELS_DEV_URL = "https://models.dev/api.json"
CACHE_FILE = "models_dev_catalog.json"
CACHE_MAX_AGE_SECONDS = 24 * 60 * 60  # 24 hours

#: In-memory cache of the parsed catalog. Populated at boot.
_catalog: dict[str, dict[str, Any]] | None = None
_lock = threading.Lock()
_refresh_thread: threading.Thread | None = None


def _cache_path() -> Path:
    return paths().config_dir / CACHE_FILE


def _load_cache() -> dict[str, dict[str, Any]]:
    """Load the cached catalog from disk."""
    global _catalog
    with _lock:
        if _catalog is not None:
            return _catalog

    f = _cache_path()
    if f.exists():
        try:
            data = json.loads(f.read_text())
            if isinstance(data, dict):
                with _lock:
                    _catalog = data
                return data
        except (json.JSONDecodeError, OSError):
            pass

    return {}


def _save_cache(data: dict[str, dict[str, Any]]) -> None:
    """Persist the catalog to disk."""
    f = _cache_path()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data))


def _parse_catalog(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract reasoning metadata from the models.dev API response.

    Returns a flat dict keyed by model ID (e.g., "openai/o3") with values:
    {
        "reasoning": true,
        "effort_levels": ["low", "high", "max"],
        "has_toggle": true,
        "has_budget_tokens": false,
        "budget_min": null,
        "budget_max": null,
    }
    """
    result: dict[str, dict[str, Any]] = {}

    for provider_id, provider_data in raw.items():
        if not isinstance(provider_data, dict):
            continue
        models = provider_data.get("models", {})
        if not isinstance(models, dict):
            continue

        for model_id, model in models.items():
            if not isinstance(model, dict):
                continue

            reasoning = model.get("reasoning", False)
            opts = model.get("reasoning_options", [])

            if not isinstance(opts, list):
                opts = []

            effort_levels: list[str] = []
            has_toggle = False
            has_budget = False
            budget_min = None
            budget_max = None

            for opt in opts:
                if not isinstance(opt, dict):
                    continue
                opt_type = opt.get("type")
                if opt_type == "toggle":
                    has_toggle = True
                elif opt_type == "effort":
                    vals = opt.get("values", [])
                    if isinstance(vals, list):
                        effort_levels = [v for v in vals if isinstance(v, str)]
                elif opt_type == "budget_tokens":
                    has_budget = True
                    budget_min = opt.get("min")
                    budget_max = opt.get("max")

            # Build the full model key: "provider/model_id"
            full_key = f"{provider_id}/{model_id}"

            result[full_key] = {
                "reasoning": bool(reasoning),
                "effort_levels": effort_levels,
                "has_toggle": has_toggle,
                "has_budget_tokens": has_budget,
                "budget_min": budget_min,
                "budget_max": budget_max,
            }

    return result


def _fetch_and_cache() -> dict[str, dict[str, Any]]:
    """Fetch the models.dev catalog and persist to cache."""
    try:
        import httpx
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(MODELS_DEV_URL)
            resp.raise_for_status()
            raw = resp.json()
    except Exception:
        log.warning("failed to fetch models.dev catalog, using stale cache")
        return _load_cache()

    catalog = _parse_catalog(raw)
    if catalog:
        _save_cache(catalog)
        # Publish it, not just persist it. Without this the first boot on a
        # machine with no cache went on answering every lookup from an empty
        # dict until the process restarted -- the fetch wrote a file nothing
        # read. `_load_cache` returns `_catalog` when it is set, so this is
        # what makes the background fetch visible to the running process.
        global _catalog
        with _lock:
            _catalog = catalog
        log.info("models.dev catalog updated: %d models", len(catalog))
    return catalog


def _background_refresh() -> None:
    """Periodically refresh the catalog in the background."""
    global _refresh_thread
    while True:
        time.sleep(CACHE_MAX_AGE_SECONDS)
        try:
            _fetch_and_cache()
        except Exception:
            log.exception("background models.dev refresh failed")


def init() -> dict[str, dict[str, Any]]:
    """Initialize the catalog: load cache, then fetch fresh data.

    Called once at boot. Returns the catalog immediately (from cache or
    fresh fetch). Kicks off background refresh thread.
    """
    global _refresh_thread

    # Load from cache first (instant)
    catalog = _load_cache()

    # Always in the background, cache or no cache.
    #
    # This used to fetch synchronously when there was no cache, and it runs
    # inside the application's lifespan -- so uvicorn did not start accepting
    # connections until models.dev answered, or until httpx's 30s timeout
    # expired. On a first launch behind a captive portal that is a thirty
    # second wait before anything at all, and `run_tray` gives up at thirty
    # seconds, so the desktop app reported "the API did not come up" about a
    # backend that was perfectly healthy and merely waiting on a web request
    # for reasoning-effort metadata.
    #
    # Nothing needs it to be there. `lookup_model` returns None on an empty
    # catalog and every caller already handles that, so the cost of not
    # waiting is that reasoning metadata is missing for the second or so the
    # fetch takes on a first run.
    threading.Thread(target=_fetch_and_cache, daemon=True).start()

    # Start background refresh thread
    if _refresh_thread is None or not _refresh_thread.is_alive():
        _refresh_thread = threading.Thread(target=_background_refresh, daemon=True)
        _refresh_thread.start()

    return catalog


def lookup_model(model_id: str) -> dict[str, Any] | None:
    """Look up a model in the cached catalog.

    Tries multiple key formats:
    1. Full key as-is (e.g., "openai/o3")
    2. Without provider prefix (e.g., "o3")
    3. With common provider prefixes tried

    Returns None if not found.
    """
    catalog = _load_cache()
    if not catalog:
        return None

    # 1. Exact match
    if model_id in catalog:
        return catalog[model_id]

    # 2. Try stripping and re-adding common prefixes
    # The catalog keys are "provider/model_id" format
    # Our model IDs might be just "model_id" or "provider/model_id"
    lower = model_id.lower()

    for key, entry in catalog.items():
        key_lower = key.lower()
        # Match on the model part after the slash
        if "/" in key_lower:
            _, key_model = key_lower.split("/", 1)
            if key_model == lower or key_lower == lower:
                return entry

    return None
