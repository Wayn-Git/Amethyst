"""OpenRouter OAuth 2.0 PKCE flow with localhost callback handler.

Implements OpenRouter PKCE authorization:
1. Client generates code_verifier and S256 code_challenge.
2. Redirects user to https://openrouter.ai/auth?callback_url=...&code_challenge=...&code_challenge_method=S256
3. Local callback route /api/auth/openrouter/callback receives ?code=...&state=...
4. Exchanges code at https://openrouter.ai/api/v1/auth/keys
5. Saves API key into vault and providers config.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

# In-memory pending PKCE states: state -> (code_verifier, created_at, status, key, error)
_PENDING_STATES: dict[str, dict[str, Any]] = {}
STATE_TTL_SECONDS = 600.0


def _clean_expired_states() -> None:
    now = time.monotonic()
    expired = [s for s, data in _PENDING_STATES.items() if now - data["created_at"] > STATE_TTL_SECONDS]
    for s in expired:
        _PENDING_STATES.pop(s, None)


def _generate_pkce_pair() -> tuple[str, str]:
    """Generate high-entropy code_verifier and S256 code_challenge."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def create_auth_url(callback_url: str) -> dict[str, str]:
    """Start an OpenRouter PKCE flow, returning the authorization URL and state token."""
    _clean_expired_states()
    state = secrets.token_urlsafe(24)
    verifier, challenge = _generate_pkce_pair()

    _PENDING_STATES[state] = {
        "verifier": verifier,
        "created_at": time.monotonic(),
        "status": "pending",
        "api_key": None,
        "error": None,
    }

    auth_url = (
        f"https://openrouter.ai/auth"
        f"?callback_url={callback_url}"
        f"&code_challenge={challenge}"
        f"&code_challenge_method=S256"
        f"&state={state}"
    )
    return {"auth_url": auth_url, "state": state}


async def exchange_code_for_key(code: str, state: str) -> str:
    """Exchange single-use authorization code with OpenRouter for an API key."""
    _clean_expired_states()
    entry = _PENDING_STATES.get(state)
    if not entry:
        raise ValueError("Invalid or expired OAuth state parameter. Please try again.")

    verifier = entry["verifier"]

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/auth/keys",
            json={
                "code": code,
                "code_challenge_method": "S256",
                "code_verifier": verifier,
            },
        )
        if resp.status_code != 200:
            err_msg = f"Failed to exchange OpenRouter code ({resp.status_code}): {resp.text[:200]}"
            entry["status"] = "failed"
            entry["error"] = err_msg
            raise RuntimeError(err_msg)

        data = resp.json()
        key = data.get("key")
        if not key:
            err_msg = "OpenRouter response did not contain an API key"
            entry["status"] = "failed"
            entry["error"] = err_msg
            raise RuntimeError(err_msg)

        entry["status"] = "completed"
        entry["api_key"] = key
        return str(key)


def get_auth_state(state: str) -> dict[str, Any]:
    """Poll current status of an ongoing OpenRouter authorization."""
    _clean_expired_states()
    entry = _PENDING_STATES.get(state)
    if not entry:
        return {"status": "expired", "connected": False}
    return {
        "status": entry["status"],
        "connected": entry["status"] == "completed",
        "error": entry.get("error"),
    }
