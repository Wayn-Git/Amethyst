"""Taking what the relay caught while this machine was off.

`docs/archive/superpowers/specs/2026-09-04-instagram-relay-design.md` has the
why. The short version: a closed laptop is a *down* webhook endpoint, and Meta
responds to a down endpoint by retrying and then disabling the subscription.
So a small always-on Worker answers Meta's 200 and holds the delivery in a free
SQLite queue, and this module is the half that goes and gets it.

**The relay is always on and it is never trusted.** It stores the exact bytes
Meta sent and the exact `X-Hub-Signature-256` header, and `_accept` verifies that
signature again here before a single row reaches `InstagramEventStore`. A
compromised Worker can lose a reel; it cannot invent one. That is the whole
reason the raw bytes are relayed rather than a tidy parsed object -- a parsed
object cannot be checked.

One thing is deliberately *not* re-checked: `signature.is_stale`. A delivery that
sat at the relay for two days is exactly what this feature is for, and the skew
window exists to stop a captured body being replayed. Replay is already
impossible twice over -- the relay's `body_hash` is UNIQUE and
`instagram_events.delivery_key` is UNIQUE -- so applying a fifteen-minute clock
to a queue built to survive a weekend would silently discard everything it caught.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from typing import Any

import httpx

from backend.config import load_instagram, save_instagram
from backend.instagram import signature
from backend.instagram.store import MAX_QUEUED, InstagramEventStore
from backend.instagram.webhook import WebhookBody, parse
from backend.runtime.http import _client
from backend.secrets import SERVICE, delete_secret, get_secret, set_secret

log = logging.getLogger(__name__)

TOKEN_REF = f"{SERVICE}/instagram-relay-token"

#: How often the runner asks the relay for anything. Its own interval, well
#: above the drain's five seconds: the drain is cheap and local, this is a
#: round trip over the internet, and 100k requests a day is the free ceiling.
POLL_SECONDS = 15.0

#: Rows per sync. The relay caps at 500; this keeps one poll's work bounded.
BATCH = 25

REQUEST_TIMEOUT = 20.0


class RelayError(RuntimeError):
    """The relay could not be reached or refused. Never fatal -- the next tick retries."""


# -- the credential ------------------------------------------------------

def token() -> str | None:
    """What this machine presents to the relay, or None because it is not set up."""
    try:
        return get_secret(TOKEN_REF)
    except Exception as exc:  # a container with no keychain and no file store
        log.warning("relay token unavailable: %s", exc)
        return None


def set_token(value: str) -> None:
    set_secret(TOKEN_REF, value.strip())


def clear_token() -> None:
    try:
        delete_secret(TOKEN_REF)
    except Exception as exc:
        log.warning("could not delete the relay token: %s", exc)


def configured() -> bool:
    """A URL and a token. Either alone cannot complete a single sync."""
    settings = load_instagram()
    return bool(settings.relay_url and token())


# -- the client ----------------------------------------------------------

class RelayClient:
    """One call: acknowledge, push config, take the next batch."""

    def __init__(self, url: str | None = None, tok: str | None = None,
                 *, timeout: float = REQUEST_TIMEOUT):
        self.url = (url if url is not None else load_instagram().relay_url).rstrip("/")
        self.token = tok if tok is not None else token()
        self.timeout = timeout

    async def sync(self, *, ack: list[int], config: dict[str, Any],
                   limit: int = BATCH) -> dict[str, Any]:
        if not self.url or not self.token:
            raise RelayError("the relay has no URL or no token stored")
        try:
            response = await _client(self.timeout).post(
                f"{self.url}/sync",
                headers={"Authorization": f"Bearer {self.token}"},
                json={"ack": ack, "config": config, "limit": limit},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise RelayError(f"the relay could not be reached: {exc}") from exc
        if response.status_code == 401:
            raise RelayError("the relay refused this token. Re-run: psok instagram relay --token …")
        if response.status_code >= 400:
            raise RelayError(f"the relay returned HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise RelayError("the relay returned something that was not JSON") from exc


# -- the poller ----------------------------------------------------------

class RelayPoller:
    """Owns the one piece of state a sync needs: what to acknowledge next time.

    Acknowledging *after* the next successful call rather than immediately is
    deliberate. A crash between taking a row and acknowledging it leaves the row
    at the relay, which re-delivers it, which `store.enqueue` drops on the UNIQUE
    delivery key. Losing a reel is unrecoverable; taking one twice costs nothing.
    """

    def __init__(self, client: RelayClient | None = None, *, library=None):
        self._client = client
        self._library = library
        self._pending_ack: list[int] = []

    @property
    def client(self) -> RelayClient:
        return self._client if self._client is not None else RelayClient()

    def _config(self) -> dict[str, Any]:
        """What the relay needs to act on its own while this machine is away.

        Every one of these is owned here and mirrored there, refreshed on each
        poll rather than set once and left to rot. The allowlist matters most:
        without it the relay would answer "got it" to a stranger whose reel is
        then discarded, which is both a lie and a write to a social account on
        their behalf.
        """
        from backend import share

        settings = load_instagram()
        return {
            "access_token": signature.access_token(),
            "token_expires_on": settings.token_expires_on,
            "share_token": share.current(),
            "allow_senders": list(settings.allow_senders),
            "reply_on_save": settings.reply_on_save,
        }

    async def sync(self, *, store: InstagramEventStore | None = None) -> dict[str, Any]:
        """One round trip. Returns what happened, and never raises."""
        settings = load_instagram()
        if not (settings.relay_enabled and settings.relay_url and token()):
            return {"synced": False, "pulled": 0, "queued": 0, "acked": 0}
        # The Instagram credentials are NOT a precondition for the sync. A
        # `kind='share'` row -- a link from a phone -- is verified by the share
        # token it echoes, not by Meta's app secret, and it is the entire reason
        # someone runs the relay without running Instagram. Holding *every*
        # row back because a delivery cannot be verified would leave phone
        # shares sitting in D1 until the daily cron prunes them after eight
        # days -- the exact "it never arrived" bug the relay exists to prevent.
        # The per-row check lives in `_take`.

        ack, self._pending_ack = self._pending_ack, []
        try:
            payload = await self.client.sync(ack=ack, config=self._config())
        except RelayError as exc:
            # Put them back: nothing was deleted at the relay, so they still need
            # acknowledging, and re-acknowledging one twice is a no-op there.
            self._pending_ack = ack + self._pending_ack
            log.warning("relay sync failed: %s", exc)
            return {"synced": False, "pulled": 0, "queued": 0, "acked": 0, "error": str(exc)}

        self._apply_rotated_token(payload)

        store = store or InstagramEventStore()
        pulled = 0
        for row in payload.get("deliveries") or []:
            row_id = row.get("id")
            taken = await self._take(row, store)
            if taken is None:
                # Held, not dropped: the row is one a future sync can process,
                # so acknowledging it now would be discarding it. The batch is
                # FIFO, which means everything behind it waits too -- the
                # cheaper alternative, acking past it, loses a reel for good.
                continue
            if taken:
                pulled += 1
            # Acknowledged either way. A row that cannot be verified is not a
            # delivery being held back for later, it is garbage, and leaving it
            # in place would block every row behind it forever.
            if isinstance(row_id, int):
                self._pending_ack.append(row_id)

        return {
            "synced": True,
            "pulled": pulled,
            "queued": int(payload.get("queued") or 0),
            "acked": len(ack),
        }

    def _apply_rotated_token(self, payload: dict[str, Any]) -> None:
        """The relay's cron refreshes the 60-day token; this is how it comes home.

        It answers with a token only when it differs from the one just pushed, so
        the common poll carries no credential in either direction.
        """
        rotated = payload.get("access_token")
        if not rotated or not isinstance(rotated, str):
            return
        signature.set_credentials(access_token=rotated)
        expires = payload.get("token_expires_on")
        if isinstance(expires, str) and expires:
            save_instagram({"token_expires_on": expires})
        log.info("the relay refreshed the Instagram token; it is now good until %s", expires)

    async def _take(self, row: dict[str, Any], store: InstagramEventStore) -> bool | None:
        """Take one row: True pulled, False dropped, None held for a later sync.

        None is the only answer that leaves the row alive at the relay, and is
        reserved for a row that is *temporarily* unprocessable -- one whose
        verification needs a credential this machine has not been given yet.
        Everything else is dropped and acknowledged, because a row nobody will
        ever be able to process must not block the queue behind it.
        """
        kind = row.get("kind")
        try:
            raw = base64.b64decode(row.get("body") or "", validate=True)
        except (binascii.Error, ValueError):
            log.error("relay row %s did not decode; dropping it", row.get("id"))
            return False
        if kind == "share":
            return await self._take_share(raw, row)
        if not signature.configured():
            # A delivery verifies against the app secret, and without the full
            # Instagram credential set there is no app secret to verify with.
            # Held rather than dropped: the next sync after the credentials
            # arrive takes it, and acknowledging it now would make this the
            # sync that threw the reel away. The relay holds it; the daily cron
            # is the eight-day deadline.
            log.info(
                "relay row %s is a delivery but the Instagram credentials are"
                " not all set; leaving it at the relay",
                row.get("id"),
            )
            return None
        return self._take_delivery(raw, row, store)

    def _take_delivery(self, raw: bytes, row: dict[str, Any],
                       store: InstagramEventStore) -> bool:
        # The check that makes the relay untrusted infrastructure rather than a
        # trusted one. Over the bytes as they arrived at the relay, which is why
        # they were relayed as bytes.
        if not signature.verify_signature(row.get("signature"), raw):
            log.error(
                "relay row %s did not verify against the app secret and was dropped."
                " Either the relay is not the one this machine set up, or the app"
                " secret has changed since that delivery arrived.",
                row.get("id"),
            )
            return False
        try:
            body = WebhookBody.model_validate_json(raw)
        except Exception:
            log.warning("relay row %s carried a signed body that did not parse", row.get("id"))
            return False

        if store.queued_count() >= MAX_QUEUED:
            log.warning("the local queue is full at %d; leaving the rest at the relay", MAX_QUEUED)
            return False

        queued = 0
        for inbound in parse(body):
            # No staleness check here on purpose -- see the module docstring.
            if store.enqueue(inbound) is not None:
                queued += 1
        return queued > 0

    async def _take_share(self, raw: bytes, row: dict[str, Any]) -> bool:
        """A link from a phone, checked here rather than taken on the relay's word.

        The relay echoes back the token it verified, so this re-runs the same
        check `POST /api/share/capture` runs. That costs nothing in exposure --
        the relay cannot check a token it does not hold -- and it keeps the rule
        that nothing out there is authoritative about what enters the library.
        """
        from backend import share
        from backend.library.service import LibraryError, LibraryService

        try:
            payload = json.loads(raw)
        except ValueError:
            log.error("relay share row %s was not JSON", row.get("id"))
            return False
        if not share.check(payload.get("token")):
            log.error("relay share row %s carried a token this machine does not hold",
                      row.get("id"))
            return False
        url = (payload.get("url") or "").strip()
        if not url:
            return False
        try:
            await (self._library or LibraryService()).capture_url(
                url, kind=payload.get("kind"), notes=payload.get("note")
            )
        except LibraryError as exc:
            # The same rule the rest of capture holds to: a fetch that went wrong
            # is not a reason to lose the fact that something was sent. The row is
            # still acknowledged; the library says what happened.
            log.warning("a relayed share could not be logged: %s", exc)
            return False
        return True
