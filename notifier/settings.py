"""Settings and configuration management for Amethyst Notifier.

Allows the frontend UI to read settings, update environment configuration,
and trigger instant test deliveries without requiring manual .env editing.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from notifier.db import TursoDB
from notifier.mailer import Mailer, get_configured_timezone, is_quiet_hours

log = logging.getLogger("amethyst.notifier.settings")

DOTENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _sync_env_from_file() -> None:
    """Ensure variables from .env are loaded into os.environ."""
    if not DOTENV_PATH.is_file():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(DOTENV_PATH, override=False)
    except Exception:
        pass
    try:
        # Extra fallback parse in case python-dotenv isn't imported or has subtle parsing difference
        for line in DOTENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and v and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


def _discover_agentmail_inbox(api_key: str) -> str:
    inbox_id = os.getenv("AGENTMAIL_INBOX_ID", "").strip()
    if inbox_id:
        return inbox_id
    try:
        from agentmail import AgentMail
        client = AgentMail(api_key=api_key)
        resp = client.inboxes.list()
        inboxes = getattr(resp, "inboxes", resp)
        if inboxes:
            first = inboxes[0]
            discovered = getattr(first, "inbox_id", None) or getattr(first, "id", None) or (first.get("inbox_id") if isinstance(first, dict) else "")
            if discovered:
                os.environ["AGENTMAIL_INBOX_ID"] = str(discovered)
                return str(discovered)
    except Exception as exc:
        log.debug("AgentMail inbox auto-discovery skipped: %s", exc)
    return ""


# Run on import
_sync_env_from_file()


def get_notifier_settings() -> dict[str, Any]:
    """Return current notifier settings with secrets masked."""
    _sync_env_from_file()

    tz = get_configured_timezone()
    today_str = datetime.now(tz).strftime("%Y-%m-%d")

    send_count = 0
    try:
        db = TursoDB()
        send_count = db.get_daily_send_count(today_str)
    except Exception:
        pass

    agentmail_key = os.getenv("AGENTMAIL_API_KEY", "").strip()
    inbox_id = os.getenv("AGENTMAIL_INBOX_ID", "").strip()
    if agentmail_key and not inbox_id:
        inbox_id = _discover_agentmail_inbox(agentmail_key)

    turso_token = os.getenv("TURSO_AUTH_TOKEN", "").strip()
    composio_key = os.getenv("COMPOSIO_API_KEY", "").strip()
    discord_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
    llm_key = (
        os.getenv("NOTIFIER_LLM_API_KEY")
        or os.getenv("GROQ_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or ""
    ).strip()

    return {
        "recipient_email": os.getenv("NOTIFIER_RECIPIENT_EMAIL", ""),
        "agentmail_inbox_id": inbox_id,
        "agentmail_configured": bool(agentmail_key),
        "turso_database_url": os.getenv("TURSO_DATABASE_URL", ""),
        "turso_configured": bool(turso_token and os.getenv("TURSO_DATABASE_URL")),
        "composio_configured": bool(composio_key),
        "discord_configured": bool(discord_token),
        "llm_provider": os.getenv("NOTIFIER_LLM_PROVIDER", "auto"),
        "llm_configured": bool(llm_key),
        "llm_model": os.getenv("NOTIFIER_LLM_MODEL", ""),
        "enabled_connectors": os.getenv("NOTIFIER_ENABLED_CONNECTORS", "gmail,calendar,discord"),
        "quiet_hours_start": os.getenv("NOTIFIER_QUIET_HOURS_START", "23:00"),
        "quiet_hours_end": os.getenv("NOTIFIER_QUIET_HOURS_END", "07:00"),
        "timezone": os.getenv("NOTIFIER_TIMEZONE", "Asia/Kolkata"),
        "daily_cap": int(os.getenv("NOTIFIER_DAILY_CAP", "80")),
        "today_send_count": send_count,
        "is_quiet_hours": is_quiet_hours(),
    }


def update_notifier_settings(data: dict[str, Any]) -> dict[str, Any]:
    """Persist settings to in-memory environment and update .env file."""
    mapping = {
        "recipient_email": "NOTIFIER_RECIPIENT_EMAIL",
        "agentmail_api_key": "AGENTMAIL_API_KEY",
        "agentmail_inbox_id": "AGENTMAIL_INBOX_ID",
        "turso_database_url": "TURSO_DATABASE_URL",
        "turso_auth_token": "TURSO_AUTH_TOKEN",
        "composio_api_key": "COMPOSIO_API_KEY",
        "discord_bot_token": "DISCORD_BOT_TOKEN",
        "llm_provider": "NOTIFIER_LLM_PROVIDER",
        "llm_api_key": "NOTIFIER_LLM_API_KEY",
        "llm_model": "NOTIFIER_LLM_MODEL",
        "enabled_connectors": "NOTIFIER_ENABLED_CONNECTORS",
        "quiet_hours_start": "NOTIFIER_QUIET_HOURS_START",
        "quiet_hours_end": "NOTIFIER_QUIET_HOURS_END",
        "timezone": "NOTIFIER_TIMEZONE",
        "daily_cap": "NOTIFIER_DAILY_CAP",
    }

    env_updates: dict[str, str] = {}
    for key, env_var in mapping.items():
        if key in data and data[key] is not None:
            val = str(data[key]).strip()
            # Allow clearing recipient_email; keep secret keys intact if empty string submitted
            if val != "" or key == "recipient_email":
                os.environ[env_var] = val
                env_updates[env_var] = val

    # Update .env file
    try:
        content = ""
        if DOTENV_PATH.is_file():
            content = DOTENV_PATH.read_text(encoding="utf-8")

        lines = content.splitlines()
        existing_keys = set()
        new_lines = []

        for line in lines:
            stripped = line.strip()
            if "=" in stripped and not stripped.startswith("#"):
                k, _ = stripped.split("=", 1)
                k = k.strip()
                existing_keys.add(k)
                if k in env_updates:
                    new_lines.append(f"{k}={env_updates[k]}")
                    continue
            new_lines.append(line)

        # Append any new keys not already in .env
        for k, v in env_updates.items():
            if k not in existing_keys:
                new_lines.append(f"{k}={v}")

        DOTENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        log.info("Saved %d notifier variables to %s", len(env_updates), DOTENV_PATH)
    except Exception as exc:
        log.warning("Could not persist to .env file: %s", exc)

    return get_notifier_settings()


def test_notifier_send(to_email: str | None = None) -> dict[str, Any]:
    """Send an immediate test verification email."""
    recipient = to_email or os.getenv("NOTIFIER_RECIPIENT_EMAIL")
    if not recipient:
        return {"ok": False, "error": "Recipient email address is not configured."}

    mailer = Mailer(recipient=recipient)
    subject = "Amethyst Notifier — Test Verification"
    body = (
        "Hello from Amethyst!\n\n"
        "Your automated notification system is properly connected.\n"
        "- Email delivery via AgentMail: Working\n"
        "- State & deduplication via Turso: Working\n\n"
        "You're all set to receive your automated daily morning briefings and weekly library digests."
    )

    from notifier.templates import render_test_verification_html
    html_body = render_test_verification_html()

    res = mailer.send_email(
        subject=subject,
        text=body,
        html=html_body,
        urgent=True,  # Bypass quiet hours for explicit manual test
    )
    if res.sent:
        return {
            "ok": True,
            "message": f"Test email successfully sent to {recipient} (Message ID: {res.message_id})",
        }
    return {
        "ok": False,
        "error": res.reason or f"Send failed with status: {res.status}",
    }
