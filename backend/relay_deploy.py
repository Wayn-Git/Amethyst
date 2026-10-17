"""Cloudflare Relay deployment and verification utilities.

Provides programmatic validation of Cloudflare API tokens, D1 database
resolution/creation, and deployment helpers for the amethyst-relay worker.
"""

from __future__ import annotations

import logging
from typing import Any
import httpx

logger = logging.getLogger(__name__)

CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"


async def verify_cloudflare_token(token: str) -> tuple[bool, str]:
    """Verify that a Cloudflare API token is valid and active."""
    if not token or not token.strip():
        return False, "Token cannot be empty"

    url = f"{CLOUDFLARE_API_BASE}/user/tokens/verify"
    headers = {"Authorization": f"Bearer {token.strip()}"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            data = resp.json()

            if resp.status_code == 200 and data.get("success"):
                status = data.get("result", {}).get("status", "")
                if status == "active":
                    return True, "Token is valid and active"
                return True, f"Token valid with status: {status}"

            errors = data.get("errors", [])
            msg = errors[0].get("message") if errors else f"HTTP {resp.status_code}"
            return False, f"Cloudflare token validation failed: {msg}"
    except Exception as e:
        logger.warning(f"Error verifying Cloudflare token: {e}")
        return False, f"Failed to contact Cloudflare: {e}"


async def check_or_create_d1(
    token: str,
    account_id: str,
    db_name: str = "amethyst-relay",
) -> dict[str, Any]:
    """Check if a D1 database exists on the Cloudflare account, creating it if absent."""
    if not token or not account_id:
        raise ValueError("Both token and account_id are required")

    url = f"{CLOUDFLARE_API_BASE}/accounts/{account_id}/d1/database"
    headers = {"Authorization": f"Bearer {token.strip()}"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. List databases
        resp = await client.get(url, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            for db in data.get("result", []):
                if db.get("name") == db_name:
                    return {
                        "database_id": db.get("uuid"),
                        "name": db_name,
                        "created": False,
                    }

        # 2. Not found, create it
        create_resp = await client.post(url, headers=headers, json={"name": db_name})
        create_data = create_resp.json()
        if create_resp.status_code in (200, 201) and create_data.get("success"):
            uuid = create_data.get("result", {}).get("uuid")
            return {
                "database_id": uuid,
                "name": db_name,
                "created": True,
            }

        errors = create_data.get("errors", [])
        msg = errors[0].get("message") if errors else f"HTTP {create_resp.status_code}"
        raise RuntimeError(f"Failed to create D1 database '{db_name}': {msg}")
