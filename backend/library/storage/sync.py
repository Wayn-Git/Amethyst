"""Auto-sync orchestrator for Library cloud storage.

Handles automatic detection, manifest enqueueing, and background uploading
of newly added or updated library items to Google Drive when auto-upload is enabled.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.library.storage.config import StorageConfigStore

log = logging.getLogger(__name__)


def is_auto_sync_enabled() -> bool:
    """Check if auto-upload is enabled in storage configuration."""
    cfg = StorageConfigStore().get_config()
    return cfg.get("auto_upload_new") == 1 or cfg.get("active_provider") == "google_drive"


async def auto_sync_item(item_id: int) -> dict[str, Any]:
    """Enqueue unmigrated files for item_id and upload them to Google Drive."""
    from backend.library.storage.gdrive_bridge import GoogleDriveBridge
    from backend.library.storage.migration import MigrationEngine

    bridge = GoogleDriveBridge()
    if not bridge.is_connected():
        log.info("Auto-sync skipped for item %s: Google Drive not connected", item_id)
        return {"synced": False, "reason": "not_connected"}

    engine = MigrationEngine()
    return await engine.sync_item(item_id)


def trigger_auto_sync(item_id: int) -> None:
    """Trigger background auto-sync for item_id if enabled."""
    try:
        from backend.library.storage.sync_engine import schedule_catalog_export
        schedule_catalog_export()
    except Exception:
        pass

    if not is_auto_sync_enabled():
        return

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(auto_sync_item(item_id))
    except RuntimeError:
        # No running event loop in current thread; run in background thread
        import threading

        def _run():
            try:
                asyncio.run(auto_sync_item(item_id))
            except Exception as exc:
                log.warning("Background auto-sync failed for item %s: %s", item_id, exc)

        threading.Thread(target=_run, daemon=True).start()
