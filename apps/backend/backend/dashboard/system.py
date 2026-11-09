"""Local system projections using existing storage and model settings."""

import shutil
from dataclasses import asdict

from fastapi import HTTPException
from pydantic import Field

from backend.config import paths
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection


async def provide(widget_id):
    if widget_id == "sys.connectors":
        from backend.dashboard.connectors import health

        return await health()
    if widget_id == "sys.model":
        from backend.config import configured_providers, load_tiers
        from backend.runtime.router import RouteRequest, is_local, route

        providers = configured_providers()
        tier = load_tiers().get("default")
        head = tier or route(RouteRequest()).head
        active = asdict(head) if head else None
        if active:
            config = providers.get(active["provider"])
            active["location"] = "local" if config and is_local(config) else "cloud"
        return {
            "active": active,
            "providers": [
                {
                    "name": name,
                    "model": config.default_model or "",
                    "location": "local" if is_local(config) else "cloud",
                }
                for name, config in providers.items()
                if config.enabled
            ],
        }
    if widget_id == "sys.notify":
        return {
            "items": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "detail": f"{row['created_at']} · {row['body']}",
                }
                for row in get_connection().execute(
                    "SELECT * FROM notifications ORDER BY id DESC LIMIT 50"
                )
            ]
        }
    if widget_id == "sys.vault":
        conn = get_connection()
        row = conn.execute(
            "SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes),0) AS bytes "
            "FROM documents WHERE source='vault'"
        ).fetchone()
        saved = conn.execute("SELECT COUNT(*) FROM library_items").fetchone()[0]
        disk = shutil.disk_usage(paths().home)
        return {
            "items": [
                {
                    "id": "vault",
                    "title": "Indexed vault",
                    "detail": f"{row['files']} files · {row['bytes']} bytes",
                },
                {
                    "id": "library",
                    "title": "Library",
                    "detail": f"{saved} saved items",
                },
                {
                    "id": "disk",
                    "title": "Storage volume",
                    "detail": f"{disk.free} bytes free of {disk.total} bytes",
                },
            ]
        }
    raise ValueError("Unknown system widget")


class ModelInput(StrictModel):
    provider: str = Field(min_length=1, max_length=200)
    model: str = Field(min_length=1, max_length=200)


def model_draft(action, body):
    from backend.config import configured_providers, load_tiers
    from backend.dashboard.items import save_draft

    if action != "switch":
        raise HTTPException(404, "Unknown model action")
    config = configured_providers().get(body.provider)
    if not config or not config.enabled or not body.model.strip():
        raise HTTPException(422, "Choose a configured provider and model")
    tier = load_tiers().get("default")
    return save_draft(
        "sys.model",
        action,
        body,
        {
            **body.model_dump(),
            "expected": asdict(tier) if tier else None,
        },
    )


def apply_model(body):
    from backend.config import configured_providers, load_tiers, set_tier

    tier = load_tiers().get("default")
    if (asdict(tier) if tier else None) != body["expected"]:
        raise HTTPException(409, "Default model changed. Review a new draft.")
    config = configured_providers().get(body["provider"])
    if not config or not config.enabled:
        raise HTTPException(409, "Provider is no longer configured")
    set_tier("default", body["provider"], body["model"])
