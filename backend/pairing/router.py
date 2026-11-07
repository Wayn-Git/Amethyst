"""FastAPI Router for CONTRACT v2 PC Pairing and Phone LLM Settings."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.pairing.config import (
    clear_phone_llm_config,
    get_phone_llm_config,
    set_phone_llm_config,
)
from backend.pairing.service import pairing_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pairing/v2", tags=["pairing-v2"])
settings_router = APIRouter(prefix="/api/settings/phone-llm", tags=["pairing-v2-settings"])


class PhoneLLMConfigRequest(BaseModel):
    provider: str
    model: str
    api_key: str | None = None


class ApprovePairingRequest(BaseModel):
    device_label: str | None = None


# --- Pairing Endpoints ---


@router.post("/start")
def start_pairing() -> dict[str, Any]:
    """Start an ephemeral CONTRACT v2 pairing session."""
    try:
        return pairing_service.start_pairing()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.exception("Error starting pairing v2")
        raise HTTPException(status_code=500, detail=f"Failed to start pairing: {exc}")


@router.get("/status")
def get_pairing_status() -> dict[str, Any]:
    """Poll status of the active pairing server."""
    return pairing_service.get_status()


@router.post("/approve")
def approve_pairing(body: ApprovePairingRequest | None = None) -> dict[str, Any]:
    """Approve a connected phone and deliver bundle."""
    try:
        device_label = body.device_label if body else None
        return pairing_service.approve_pairing(device_label=device_label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.exception("Error approving pairing v2")
        raise HTTPException(status_code=500, detail=f"Failed to approve pairing: {exc}")


@router.post("/deny")
def deny_pairing() -> dict[str, Any]:
    """Deny a connected phone."""
    return pairing_service.deny_pairing()


@router.post("/cancel")
def cancel_pairing() -> dict[str, Any]:
    """Cancel pairing and close server."""
    return pairing_service.cancel_pairing()


@router.delete("/devices/{device_id}")
def revoke_device(device_id: str) -> dict[str, Any]:
    """Revoke and forget a device locally."""
    return pairing_service.revoke_device(device_id)


# --- Phone-only LLM Settings Endpoints ---


@settings_router.get("")
def get_phone_llm_settings() -> dict[str, Any]:
    """Get current phone-only LLM configuration."""
    cfg = get_phone_llm_config()
    return {
        "provider": cfg["provider"],
        "model": cfg["model"],
        "has_key": cfg["has_key"],
    }


@settings_router.post("")
def update_phone_llm_settings(body: PhoneLLMConfigRequest) -> dict[str, Any]:
    """Save phone-only LLM configuration and key."""
    try:
        cfg = set_phone_llm_config(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
        )
        return {
            "ok": True,
            "provider": cfg["provider"],
            "model": cfg["model"],
            "has_key": cfg["has_key"],
        }
    except Exception as exc:
        log.exception("Error saving phone LLM settings")
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {exc}")


@settings_router.delete("")
def delete_phone_llm_settings() -> dict[str, Any]:
    """Clear phone-only LLM configuration and key."""
    clear_phone_llm_config()
    return {"ok": True}
