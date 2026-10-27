"""Microsoft Graph OAuth 2.0 PKCE flow as a public client (no client secret).

Flow:
1. Client generates code_verifier and S256 code_challenge.
2. User redirected to Microsoft identity platform:
   https://login.microsoftonline.com/common/oauth2/v2.0/authorize
   Scopes: Tasks.ReadWrite, offline_access, User.Read
3. Local callback route /api/auth/microsoft/callback receives code and state.
4. Token endpoint exchanges code + code_verifier for access_token and refresh_token.
5. Tokens are persisted in Amethyst vault ('amethyst/microsoft-todo.tokens').
6. Automatic refresh handled using refresh_token when access_token expires.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
from typing import Any

import httpx

from backend.secrets import delete_secret, get_secret, set_secret

log = logging.getLogger(__name__)

VAULT_KEY = "amethyst/microsoft-todo.tokens"
DEFAULT_CLIENT_ID = "d3590ed6-52b3-4102-aeff-aad2292ab01c"
AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
DEFAULT_SCOPES = "Tasks.ReadWrite offline_access User.Read"

# In-memory pending PKCE states: state -> dict
_PENDING_STATES: dict[str, dict[str, Any]] = {}
STATE_TTL_SECONDS = 600.0


def _clean_expired_states() -> None:
    now = time.monotonic()
    expired = [s for s, data in _PENDING_STATES.items() if now - data["created_at"] > STATE_TTL_SECONDS]
    for s in expired:
        _PENDING_STATES.pop(s, None)


def get_client_id() -> str:
    """Retrieve Microsoft OAuth client ID from environment or fallback default."""
    return (
        os.environ.get("MICROSOFT_TODO_CLIENT_ID", "").strip()
        or os.environ.get("MICROSOFT_CLIENT_ID", "").strip()
        or DEFAULT_CLIENT_ID
    )


def _generate_pkce_pair() -> tuple[str, str]:
    """Generate high-entropy code_verifier and S256 code_challenge."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def create_auth_url(redirect_uri: str, client_id: str | None = None) -> dict[str, str]:
    """Start Microsoft OAuth PKCE flow, returning auth URL and tracking state."""
    _clean_expired_states()
    cid = client_id or get_client_id()
    state = secrets.token_urlsafe(24)
    verifier, challenge = _generate_pkce_pair()

    _PENDING_STATES[state] = {
        "verifier": verifier,
        "redirect_uri": redirect_uri,
        "client_id": cid,
        "created_at": time.monotonic(),
        "status": "pending",
        "error": None,
    }

    params = {
        "client_id": cid,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": DEFAULT_SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    encoded_params = "&".join(f"{k}={httpx.URL('', params={k: v}).query.decode('utf-8')}" for k, v in params.items())
    auth_url = f"{AUTH_ENDPOINT}?{encoded_params}"
    return {"auth_url": auth_url, "state": state}


async def exchange_code_for_tokens(code: str, state: str) -> dict[str, Any]:
    """Exchange authorization code and verifier for access and refresh tokens."""
    _clean_expired_states()
    entry = _PENDING_STATES.get(state)
    if not entry:
        raise ValueError("Invalid or expired OAuth state parameter. Please try again.")

    verifier = entry["verifier"]
    redirect_uri = entry["redirect_uri"]
    client_id = entry["client_id"]

    data = {
        "client_id": client_id,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
        "scope": DEFAULT_SCOPES,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(TOKEN_ENDPOINT, data=data)
        if resp.status_code != 200:
            err_msg = f"Failed to exchange Microsoft code ({resp.status_code}): {resp.text[:200]}"
            entry["status"] = "failed"
            entry["error"] = err_msg
            raise RuntimeError(err_msg)

        payload = resp.json()

    access_token = payload.get("access_token")
    if not access_token:
        err_msg = "Microsoft token response missing access_token"
        entry["status"] = "failed"
        entry["error"] = err_msg
        raise RuntimeError(err_msg)

    expires_in = int(payload.get("expires_in", 3600))
    token_record = {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token"),
        "expires_at": time.time() + expires_in,
        "scope": payload.get("scope", DEFAULT_SCOPES),
        "client_id": client_id,
        "updated_at": time.time(),
    }

    # Store in vault
    set_secret(VAULT_KEY, json.dumps(token_record))

    entry["status"] = "completed"
    return token_record


async def refresh_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
    """Use refresh_token to obtain a fresh access token without user prompt."""
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        raise ValueError("No refresh token available to renew access")

    client_id = tokens.get("client_id") or get_client_id()
    data = {
        "client_id": client_id,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": DEFAULT_SCOPES,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(TOKEN_ENDPOINT, data=data)
        if resp.status_code != 200:
            raise RuntimeError(f"Microsoft token refresh failed ({resp.status_code}): {resp.text[:200]}")
        payload = resp.json()

    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError("Microsoft refresh response missing access_token")

    expires_in = int(payload.get("expires_in", 3600))
    updated_record = {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token") or refresh_token,
        "expires_at": time.time() + expires_in,
        "scope": payload.get("scope", DEFAULT_SCOPES),
        "client_id": client_id,
        "updated_at": time.time(),
    }

    set_secret(VAULT_KEY, json.dumps(updated_record))
    return updated_record


async def get_valid_access_token() -> str | None:
    """Return an active access token from vault, refreshing automatically if close to expiry."""
    raw = get_secret(VAULT_KEY)
    if not raw:
        return None

    try:
        tokens = json.loads(raw)
    except Exception:
        return None

    expires_at = float(tokens.get("expires_at", 0))
    # If valid for at least 60 more seconds, return current token
    if time.time() < (expires_at - 60):
        return tokens.get("access_token")

    # Refresh expired or expiring token
    try:
        refreshed = await refresh_tokens(tokens)
        return refreshed.get("access_token")
    except Exception as exc:
        log.warning("Failed refreshing Microsoft token: %s", exc)
        return None


def get_connection_status() -> dict[str, Any]:
    """Check if Microsoft To Do credentials exist in the vault."""
    raw = get_secret(VAULT_KEY)
    if not raw:
        return {"connected": False}

    try:
        tokens = json.loads(raw)
        has_token = bool(tokens.get("access_token") or tokens.get("refresh_token"))
        return {
            "connected": has_token,
            "expires_at": tokens.get("expires_at"),
            "scope": tokens.get("scope"),
        }
    except Exception:
        return {"connected": False}


def disconnect() -> bool:
    """Clear Microsoft To Do credentials from the vault."""
    try:
        delete_secret(VAULT_KEY)
        return True
    except Exception as exc:
        log.warning("Failed to delete Microsoft To Do secret: %s", exc)
        return False


def get_auth_state(state: str) -> dict[str, Any]:
    """Poll current state of an ongoing Microsoft PKCE authorization."""
    _clean_expired_states()
    entry = _PENDING_STATES.get(state)
    if not entry:
        return {"status": "expired", "connected": False}
    return {
        "status": entry["status"],
        "connected": entry["status"] == "completed",
        "error": entry.get("error"),
    }
