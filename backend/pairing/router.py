"""FastAPI Router for CONTRACT v2 PC Pairing and Phone LLM Settings."""

from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.pairing.config import (
    clear_phone_composio_config,
    clear_phone_llm_config,
    get_phone_composio_config,
    get_phone_llm_config,
    get_use_separate_keys,
    set_phone_composio_config,
    set_phone_llm_config,
    set_use_separate_keys,
)
from backend.pairing.service import pairing_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pairing/v2", tags=["pairing-v2"])
settings_router = APIRouter(prefix="/api/settings/phone-llm", tags=["pairing-v2-settings"])
composio_settings_router = APIRouter(prefix="/api/settings/phone-composio", tags=["pairing-v2-composio-settings"])
pairing_settings_router = APIRouter(prefix="/api/settings/phone-pairing", tags=["pairing-v2-settings"])


class PhonePairingSettingsRequest(BaseModel):
    use_separate_keys: bool


class PhoneLLMConfigRequest(BaseModel):
    provider: str
    model: str
    api_key: str | None = None


class PhoneComposioConfigRequest(BaseModel):
    api_key: str | None = None
    user_id: str | None = None
    phone_composio_api_key: str | None = None
    phone_composio_user_id: str | None = None


class ApprovePairingRequest(BaseModel):
    device_label: str | None = None


class ConfirmPairingRequest(BaseModel):
    token: str | None = None
    device_id: str | None = None


class ClaimCodeRequest(BaseModel):
    code: str
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


@router.post("/ack")
def acknowledge_pairing(body: ConfirmPairingRequest | None = None) -> dict[str, Any]:
    """Phone companion confirms receipt and storage of pairing bundle."""
    try:
        token = body.token if body else None
        device_id = body.device_id if body else None
        return pairing_service.confirm_pairing(device_id=device_id, token=token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.exception("Error acknowledging pairing v2")
        raise HTTPException(status_code=500, detail=f"Failed to acknowledge pairing: {exc}")


@router.post("/claim-code")
def claim_code(body: ClaimCodeRequest) -> dict[str, Any]:
    """Claim active pairing session using 6-digit numeric code."""
    try:
        return pairing_service.claim_code(code=body.code, device_label=body.device_label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.exception("Error claiming pairing code")
        raise HTTPException(status_code=500, detail=f"Failed to claim code: {exc}")


@router.get("/claim-code-status")
def get_code_status(code: str) -> dict[str, Any]:
    """Poll status of claimed 6-digit pairing code."""
    return pairing_service.get_code_status(code=code)


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


# --- Phone-only Composio Settings Endpoints ---


@composio_settings_router.get("")
def get_phone_composio_settings() -> dict[str, Any]:
    """Get current phone-only Composio configuration."""
    cfg = get_phone_composio_config()
    return {
        "user_id": cfg["user_id"],
        "phone_composio_user_id": cfg["user_id"],
        "has_key": cfg["has_key"],
        "has_user_id": cfg["has_user_id"],
    }


@composio_settings_router.post("")
def update_phone_composio_settings(body: PhoneComposioConfigRequest) -> dict[str, Any]:
    """Save phone-only Composio configuration and credentials."""
    try:
        api_key = body.api_key if body.api_key is not None else body.phone_composio_api_key
        user_id = body.user_id if body.user_id is not None else body.phone_composio_user_id
        cfg = set_phone_composio_config(
            api_key=api_key,
            user_id=user_id,
        )
        return {
            "ok": True,
            "user_id": cfg["user_id"],
            "phone_composio_user_id": cfg["user_id"],
            "has_key": cfg["has_key"],
            "has_user_id": cfg["has_user_id"],
        }
    except Exception as exc:
        log.exception("Error saving phone Composio settings")
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {exc}")


@composio_settings_router.delete("")
def delete_phone_composio_settings() -> dict[str, Any]:
    """Clear phone-only Composio configuration and credentials."""
    clear_phone_composio_config()
    return {"ok": True}


# --- Phone Pairing General Settings ---


@pairing_settings_router.get("")
def get_phone_pairing_settings() -> dict[str, Any]:
    """Get phone pairing configuration."""
    return {"use_separate_keys": get_use_separate_keys()}


@pairing_settings_router.post("")
def update_phone_pairing_settings(body: PhonePairingSettingsRequest) -> dict[str, Any]:
    """Update phone pairing configuration."""
    val = set_use_separate_keys(body.use_separate_keys)
    return {"ok": True, "use_separate_keys": val}

