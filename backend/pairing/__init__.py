"""CONTRACT v2 PC-Side Pairing Package."""

from backend.pairing.router import router as pairing_v2_router, settings_router as phone_llm_settings_router
from backend.pairing.service import pairing_service

__all__ = ["pairing_v2_router", "phone_llm_settings_router", "pairing_service"]
