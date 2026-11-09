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
from pathlib import Path
import secrets
import time
from typing import Any

import httpx

from backend.secrets import delete_secret, get_secret, set_secret

log = logging.getLogger(__name__)

VAULT_KEY = "amethyst/microsoft-todo.tokens"
DEFAULT_CLIENT_ID = "a7c42b18-1137-4d78-8d4c-91cd6be3acff"
AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
DEVICE_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode"
TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
DEFAULT_SCOPES = "Tasks.ReadWrite offline_access User.Read"


def get_token_cache_path() -> Path:
    """Location of connector token cache."""
    try:
        from backend.mcp.catalogue import get as cat_get
        entry = cat_get("microsoft-todo")
        if entry and entry.credentials_path:
            return Path(entry.credentials_path).expanduser()
    except Exception:
        pass
    return Path("~/.config/microsoft-todo-mcp/token-cache.json").expanduser()


def sync_token_cache_from_vault(tokens: dict[str, Any] | str | None = None) -> None:
    """Sync credentials from vault to connector cache with strict 0600 permissions."""
    if tokens is None:
        raw = get_secret(VAULT_KEY)
        try:
            tokens = json.loads(raw) if raw else None
        except Exception:
            tokens = None
    elif isinstance(tokens, str):
        try:
            tokens = json.loads(tokens)
        except Exception:
            tokens = None

    if not tokens or not isinstance(tokens, dict):
        remove_token_cache()
        return

    path = get_token_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(path.parent, 0o700)
        except OSError:
            pass

        cache_data = {
            "accessToken": tokens.get("access_token"),
            "refreshToken": tokens.get("refresh_token"),
            "access_token": tokens.get("access_token"),
            "refresh_token": tokens.get("refresh_token"),
            "expires_at": tokens.get("expires_at"),
            "scope": tokens.get("scope", DEFAULT_SCOPES),
            "client_id": tokens.get("client_id") or get_client_id(),
            "updated_at": tokens.get("updated_at") or time.time(),
        }

        tmp = path.with_name(f"{path.name}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cache_data, f)
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except Exception as exc:
        log.warning("Could not sync token cache for microsoft-todo: %s", exc)


def remove_token_cache() -> None:
    """Remove connector token cache file on disconnect or logout."""
    try:
        path = get_token_cache_path()
        if path.is_file():
            path.unlink()
    except Exception as exc:
        log.warning("Could not remove token cache: %s", exc)


def migrate_token_cache_to_vault() -> bool:
    """Migrate legacy or filesystem token-cache.json into encrypted vault."""
    path = get_token_cache_path()
    if not path.is_file():
        return False

    try:
        os.chmod(path, 0o600)
    except OSError:
        pass

    if get_secret(VAULT_KEY):
        return False

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        at = data.get("access_token") or data.get("accessToken")
        rt = data.get("refresh_token") or data.get("refreshToken")
        if not (at or rt):
            return False

        record = {
            "access_token": at or "",
            "refresh_token": rt,
            "expires_at": data.get("expires_at") or (time.time() + 3600),
            "scope": data.get("scope") or DEFAULT_SCOPES,
            "client_id": data.get("client_id") or get_client_id(),
            "updated_at": time.time(),
        }
        set_secret(VAULT_KEY, json.dumps(record))
        record_credential_change(record)
        return True
    except Exception as exc:
        log.warning("Could not migrate token cache to vault: %s", exc)
        return False


def _extract_jwt_claims(token: str | None) -> dict[str, Any]:
    """Safely decode JWT payload without verification (for metadata claims only)."""
    if not token or not isinstance(token, str) or token.count(".") < 2:
        return {}
    try:
        payload_part = token.split(".")[1]
        rem = len(payload_part) % 4
        if rem > 0:
            payload_part += "=" * (4 - rem)
        decoded = base64.urlsafe_b64decode(payload_part.encode("ascii")).decode("utf-8")
        parsed = json.loads(decoded)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def get_token_bundle_for_handoff() -> dict[str, Any] | None:
    """Build bundle for mobile pairing handoff containing refresh token, account metadata, scopes, expiry."""
    raw = get_secret(VAULT_KEY)
    if not raw:
        return None
    try:
        tokens = json.loads(raw)
        if not isinstance(tokens, dict):
            return None
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return None

        access_token = tokens.get("access_token") or ""
        claims = _extract_jwt_claims(access_token) or _extract_jwt_claims(tokens.get("id_token"))

        account_id = (
            tokens.get("account_id")
            or claims.get("oid")
            or claims.get("sub")
            or ""
        )
        email = (
            tokens.get("email")
            or claims.get("upn")
            or claims.get("email")
            or claims.get("preferred_username")
            or ""
        )

        return {
            "refresh_token": refresh_token,
            "access_token": access_token,
            "account_id": account_id,
            "email": email,
            "scopes": tokens.get("scope") or DEFAULT_SCOPES,
            "expires_at": tokens.get("expires_at") or (time.time() + 3600),
        }
    except Exception as exc:
        log.warning("Failed to prepare Microsoft token bundle for handoff: %s", exc)
        return None


def relinquish_refresh_token_after_handoff() -> None:
    """Relinquish PC copy of the refresh token after pairing handoff to the phone.

    The phone now owns the token and refreshes directly against login.microsoftonline.com.
    The PC stops using the refresh token to prevent rotation conflicts (invalid_grant).
    The PC re-authenticates itself when it next needs Graph access.
    """
    raw = get_secret(VAULT_KEY)
    if not raw:
        return
    try:
        tokens = json.loads(raw)
        if isinstance(tokens, dict):
            tokens["refresh_token"] = None
            tokens["access_token"] = None
            tokens["handed_off"] = True
            tokens["handed_off_at"] = time.time()
            set_secret(VAULT_KEY, json.dumps(tokens))
            remove_token_cache()
    except Exception as exc:
        log.warning("Failed to update vault when relinquishing refresh token: %s", exc)


def record_credential_change(tokens: dict[str, Any] | None = None, conn: Any = None) -> None:
    """Mark credential changed for peer multi-device sync."""
    try:
        from backend.db.connection import get_connection
        c = conn or get_connection()
        c.execute(
            "INSERT INTO synced_credentials (key, updated_at) VALUES ('microsoft-todo', datetime('now'))"
            " ON CONFLICT(key) DO UPDATE SET updated_at = datetime('now')"
        )
        c.commit()
    except Exception as exc:
        log.debug("Could not record credential change in synced_credentials: %s", exc)

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
    sync_token_cache_from_vault(token_record)
    record_credential_change(token_record)

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
    sync_token_cache_from_vault(updated_record)
    record_credential_change(updated_record)
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
    migrate_token_cache_to_vault()
    raw = get_secret(VAULT_KEY)
    if not raw:
        return {"connected": False}

    try:
        tokens = json.loads(raw)
        is_handed_off = bool(tokens.get("handed_off"))
        if is_handed_off:
            has_token = bool(tokens.get("refresh_token"))
        else:
            has_token = bool(tokens.get("access_token") or tokens.get("refresh_token"))

        res: dict[str, Any] = {
            "connected": has_token,
            "expires_at": tokens.get("expires_at"),
            "scope": tokens.get("scope"),
        }
        if is_handed_off and not has_token:
            res["handed_off"] = True
        return res
    except Exception:
        return {"connected": False}


def disconnect() -> bool:
    """Clear Microsoft To Do credentials from the vault."""
    try:
        delete_secret(VAULT_KEY)
        remove_token_cache()
        record_credential_change(None)
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


async def start_device_flow(client_id: str | None = None) -> dict[str, Any]:
    """Start Microsoft device authorization flow, returning code and verification url."""
    cid = client_id or get_client_id()
    data = {
        "client_id": cid,
        "scope": DEFAULT_SCOPES,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(DEVICE_ENDPOINT, data=data)
        if resp.status_code != 200:
            raise RuntimeError(f"Microsoft device auth request failed ({resp.status_code}): {resp.text[:200]}")
        payload = resp.json()

    return {
        "device_code": payload["device_code"],
        "user_code": payload["user_code"],
        "verification_uri": payload.get("verification_uri") or "https://microsoft.com/devicelogin",
        "expires_in": payload.get("expires_in", 900),
        "interval": payload.get("interval", 5),
        "message": payload.get("message", ""),
    }


async def poll_device_flow(device_code: str, client_id: str | None = None) -> dict[str, Any]:
    """Poll Microsoft token endpoint for device code authorization."""
    cid = client_id or get_client_id()
    data = {
        "client_id": cid,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(TOKEN_ENDPOINT, data=data)
        if resp.status_code == 200:
            payload = resp.json()
            access_token = payload.get("access_token")
            expires_in = int(payload.get("expires_in", 3600))
            token_record = {
                "access_token": access_token,
                "refresh_token": payload.get("refresh_token"),
                "expires_at": time.time() + expires_in,
                "scope": payload.get("scope", DEFAULT_SCOPES),
                "client_id": cid,
                "updated_at": time.time(),
            }
            set_secret(VAULT_KEY, json.dumps(token_record))
            sync_token_cache_from_vault(token_record)
            record_credential_change(token_record)
            return {"connected": True, "status": "completed"}

        try:
            err_payload = resp.json()
        except Exception:
            err_payload = {}
        if not isinstance(err_payload, dict):
            err_payload = {}

        err = err_payload.get("error", "")
        if err in ("authorization_pending", "slow_down"):
            return {"connected": False, "status": "pending"}
        if err in ("expired_token", "code_expired"):
            return {"connected": False, "status": "expired", "error": "Code expired. Please request a new code."}
        return {"connected": False, "status": "failed", "error": err_payload.get("error_description", f"Login failed: {err}")}

