"""Outbound mailer using AgentMail Python SDK.

Enforces:
1. Hardcoded recipient strictly from env (NOTIFIER_RECIPIENT_EMAIL) - LLM never sets recipients.
2. Hard daily cap (default 80 sends/day) counted in Turso across stateless CI runs.
3. Quiet hours check (default 23:00 - 07:00 IST); non-urgent mails queue in Turso until quiet hours end.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from notifier.db import TursoDB

log = logging.getLogger("amethyst.notifier.mailer")

DEFAULT_QUIET_HOURS_START = "23:00"
DEFAULT_QUIET_HOURS_END = "07:00"
DEFAULT_TIMEZONE = "Asia/Kolkata"
DEFAULT_DAILY_CAP = 80


def _load_dotenv_if_needed() -> None:
    try:
        from pathlib import Path
        dotenv_path = Path(__file__).resolve().parent.parent / ".env"
        if dotenv_path.is_file():
            try:
                from dotenv import load_dotenv
                load_dotenv(dotenv_path, override=False)
            except Exception:
                pass
            for line in dotenv_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and v and k not in os.environ:
                        os.environ[k] = v
    except Exception:
        pass


_load_dotenv_if_needed()


@dataclass
class SendResult:
    sent: bool
    status: str
    message_id: str | None = None
    reason: str | None = None


def get_configured_timezone() -> ZoneInfo:
    tz_name = os.getenv("NOTIFIER_TIMEZONE", DEFAULT_TIMEZONE).strip()
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        log.warning("Invalid timezone %r; falling back to UTC", tz_name)
        return ZoneInfo("UTC")


def parse_hhmm(val: str, default: time) -> time:
    try:
        parts = [int(p) for p in val.strip().split(":")]
        return time(parts[0], parts[1])
    except Exception:
        return default


def is_quiet_hours(moment: datetime | None = None) -> bool:
    """True if moment (or current time in NOTIFIER_TIMEZONE) falls in quiet hours."""
    tz = get_configured_timezone()
    now = (moment or datetime.now(tz)).astimezone(tz)
    current_time = now.time()

    start_str = os.getenv("NOTIFIER_QUIET_HOURS_START", DEFAULT_QUIET_HOURS_START)
    end_str = os.getenv("NOTIFIER_QUIET_HOURS_END", DEFAULT_QUIET_HOURS_END)

    start_t = parse_hhmm(start_str, time(23, 0))
    end_t = parse_hhmm(end_str, time(7, 0))

    if start_t > end_t:
        # e.g., 23:00 to 07:00
        return current_time >= start_t or current_time < end_t
    else:
        # e.g., 01:00 to 06:00
        return start_t <= current_time < end_t


class Mailer:
    """AgentMail sender with Turso-backed send quota and quiet hours gating."""

    def __init__(
        self,
        api_key: str | None = None,
        inbox_id: str | None = None,
        recipient: str | None = None,
        daily_cap: int | None = None,
        db: TursoDB | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("AGENTMAIL_API_KEY") or ""
        self.inbox_id = inbox_id or os.getenv("AGENTMAIL_INBOX_ID") or ""
        self.recipient = (recipient or os.getenv("NOTIFIER_RECIPIENT_EMAIL") or "").strip()

        cap_env = os.getenv("NOTIFIER_DAILY_CAP")
        try:
            self.daily_cap = daily_cap if daily_cap is not None else (int(cap_env) if cap_env else DEFAULT_DAILY_CAP)
        except ValueError:
            self.daily_cap = DEFAULT_DAILY_CAP

        self.db = db or TursoDB()
        self._ensure_queue_table()

    def _ensure_queue_table(self) -> None:
        try:
            self.db.execute("""
                CREATE TABLE IF NOT EXISTS queued_emails (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recipient TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    text TEXT,
                    html TEXT,
                    queued_at TEXT NOT NULL
                );
            """)
        except Exception as exc:
            log.warning("Could not ensure queued_emails table: %s", exc)

    def _send_agentmail(
        self,
        to_email: str,
        subject: str,
        text: str,
        html: str | None = None,
        attachments: list[Any] | None = None,
    ) -> str | None:
        """Raw send call through AgentMail Python SDK."""
        from agentmail import AgentMail

        client = AgentMail(api_key=self.api_key)
        if not self.inbox_id:
            try:
                resp_inboxes = client.inboxes.list()
                inbox_list = getattr(resp_inboxes, "inboxes", resp_inboxes)
                if inbox_list:
                    first = inbox_list[0]
                    self.inbox_id = getattr(first, "inbox_id", None) or getattr(first, "id", None) or (first.get("inbox_id") if isinstance(first, dict) else "")
            except Exception as e:
                log.warning("AgentMail inbox auto-discovery failed: %s", e)

        kwargs: dict[str, Any] = {
            "inbox_id": self.inbox_id,
            "to": to_email,
            "subject": subject,
            "text": text,
        }
        if html:
            kwargs["html"] = html
        if attachments:
            kwargs["attachments"] = attachments

        resp = client.inboxes.messages.send(**kwargs)
        # Extract message ID from response
        return getattr(resp, "message_id", None) or getattr(resp, "id", None) or str(resp)

    def flush_queued_emails(self) -> int:
        """Send all emails queued during quiet hours (if quiet hours are over)."""
        if is_quiet_hours():
            log.info("Still in quiet hours; skipping queue flush")
            return 0

        rows = self.db.execute("SELECT id, recipient, subject, text, html FROM queued_emails ORDER BY id")
        if not rows:
            return 0

        flushed = 0
        tz = get_configured_timezone()
        today_str = datetime.now(tz).strftime("%Y-%m-%d")

        for r in rows:
            current_count = self.db.get_daily_send_count(today_str)
            if current_count >= self.daily_cap:
                log.warning("Daily send cap (%d) reached while flushing queue", self.daily_cap)
                break

            try:
                self._send_agentmail(
                    to_email=r["recipient"],
                    subject=r["subject"],
                    text=r["text"] or "",
                    html=r.get("html"),
                )
                self.db.increment_daily_send_count(today_str, 1)
                self.db.execute("DELETE FROM queued_emails WHERE id = ?", [r["id"]])
                flushed += 1
            except Exception as exc:
                log.error("Failed to send queued email #%s: %s", r["id"], exc)

        return flushed

    def send_email(
        self,
        subject: str,
        text: str,
        html: str | None = None,
        attachments: list[Any] | None = None,
        urgent: bool = False,
    ) -> SendResult:
        """Send an email to the hardcoded recipient.

        Respects daily cap (80/day) and quiet hours.
        """
        if not self.recipient:
            msg = "NOTIFIER_RECIPIENT_EMAIL environment variable is not configured."
            log.error(msg)
            return SendResult(sent=False, status="error", reason=msg)

        tz = get_configured_timezone()
        now = datetime.now(tz)
        today_str = now.strftime("%Y-%m-%d")

        # 1. Quiet Hours check
        if not urgent and is_quiet_hours(now):
            log.info("Quiet hours active; queuing email: %s", subject)
            try:
                now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()
                self.db.execute(
                    "INSERT INTO queued_emails (recipient, subject, text, html, queued_at) VALUES (?, ?, ?, ?, ?)",
                    [self.recipient, subject, text, html or "", now_iso],
                )
                return SendResult(
                    sent=False,
                    status="queued_quiet_hours",
                    reason="Quiet hours active. Message queued for delivery.",
                )
            except Exception as exc:
                log.error("Failed to queue email in Turso: %s", exc)
                return SendResult(
                    sent=False,
                    status="error",
                    reason=f"Failed to queue email: {exc}",
                )

        # 2. Daily Send Cap check
        current_count = self.db.get_daily_send_count(today_str)
        if current_count >= self.daily_cap:
            msg = f"Daily send cap ({self.daily_cap}) reached for {today_str}. Send aborted."
            log.warning(msg)
            return SendResult(sent=False, status="daily_cap_exceeded", reason=msg)

        # 3. Attempt Delivery
        try:
            msg_id = self._send_agentmail(
                to_email=self.recipient,
                subject=subject,
                text=text,
                html=html,
                attachments=attachments,
            )
            # Increment daily send counter
            new_count = self.db.increment_daily_send_count(today_str, 1)
            log.info("Email sent successfully (msg_id: %s, daily count: %d/%d)", msg_id, new_count, self.daily_cap)

            # Opportunistically flush any earlier queued items
            if not is_quiet_hours(now):
                self.flush_queued_emails()

            return SendResult(sent=True, status="sent", message_id=msg_id)
        except Exception as exc:
            log.exception("AgentMail delivery failed: %s", exc)
            return SendResult(sent=False, status="error", reason=str(exc))
