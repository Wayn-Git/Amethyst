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


#: Presence of the relay token, cached. The drain tick asks every five seconds,
#: and each ask was a keychain round trip -- D-Bus IPC on the event loop for a
#: value that changes only when someone runs the setup command.
_TOKEN_PRESENCE: tuple[bool, float] | None = None


def token_present() -> bool:
    """Whether the relay token exists, remembered for a short while."""
    global _TOKEN_PRESENCE
    import time as _time

    now = _time.monotonic()
    if _TOKEN_PRESENCE is not None and now < _TOKEN_PRESENCE[1]:
        return _TOKEN_PRESENCE[0]
    try:
        answer = get_secret(TOKEN_REF) is not None
    except Exception:
        answer = False
    _TOKEN_PRESENCE = (answer, now + 10.0)
    return answer


def set_token(value: str) -> None:
    global _TOKEN_PRESENCE
    _TOKEN_PRESENCE = None  # a set token must be visible to the next presence ask
    set_secret(TOKEN_REF, value.strip())


def clear_token() -> None:
    global _TOKEN_PRESENCE
    _TOKEN_PRESENCE = None
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
                   job_ack: list[str] | None = None,
                   worker_ack: list[str] | None = None,
                   ops: list[dict[str, Any]] | None = None,
                   op_ack: list[str] | None = None,
                   limit: int = BATCH) -> dict[str, Any]:
        if not self.url or not self.token:
            raise RelayError("the relay has no URL or no token stored")
        try:
            response = await _client(self.timeout).post(
                f"{self.url}/sync",
                headers={"Authorization": f"Bearer {self.token}"},
                json={
                    "ack": ack,
                    "job_ack": job_ack or [],
                    "worker_ack": worker_ack or [],
                    "ops": ops or [],
                    "op_ack": op_ack or [],
                    "config": config,
                    "limit": limit,
                },
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise RelayError(f"the relay could not be reached: {exc}") from exc
        if response.status_code == 401:
            raise RelayError("the relay refused this token. Re-run:"
                             " amethyst instagram relay --token …")
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
        #: Finished jobs taken last time. Same discipline as `_pending_ack`, and
        #: for the same reason: a job acknowledged before its result is applied
        #: is one a sync that died halfway would throw away.
        self._pending_job_ack: list[str] = []
        #: Worker reports taken last time. A third list rather than a shared one
        #: because they are acknowledged on a different route at the relay, and
        #: a failed sync must put each back where it came from.
        self._pending_worker_ack: list[str] = []
        #: Sync ops taken last time. A fourth list for the same reason as the
        #: third: it is a separate queue at the relay, so a failed sync has to
        #: put these back without disturbing the others.
        self._pending_op_ack: list[str] = []
        #: Sealed pairing answers this machine produced, waiting to go back to
        #: the device that asked. Produced while handling one poll's response and
        #: sent on the next, which costs a device one extra poll to finish
        #: pairing and keeps the round trip a single request.
        self._pending_pair_answers: list[dict[str, Any]] = []

    @property
    def client(self) -> RelayClient:
        return self._client if self._client is not None else RelayClient()

    def _config(self, pair_answers: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """What the relay needs to act on its own while this machine is away.

        Every one of these is owned here and mirrored there, refreshed on each
        poll rather than set once and left to rot. The allowlist matters most:
        without it the relay would answer "got it" to a stranger whose reel is
        then discarded, which is both a lie and a write to a social account on
        their behalf.
        """
        from backend import share

        settings = load_instagram()
        mirrored = {
            "access_token": signature.access_token(),
            "token_expires_on": settings.token_expires_on,
            "share_token": share.current(),
            "allow_senders": list(settings.allow_senders),
            "reply_on_save": settings.reply_on_save,
        }
        # Who this machine is and who is paired with it. Pushed on every poll
        # like everything else here, so revoking a device takes effect at the
        # relay within one poll rather than on the next deploy.
        try:
            from backend.sync import service as sync_service

            mirrored.update(sync_service.config())
            if pair_answers:
                mirrored["pair_answers"] = pair_answers
        except Exception:
            # Sync is not a precondition for Instagram capture, which is what
            # this poller was built for. A broken sync layer must not stop a
            # reel arriving.
            log.exception("could not build the sync config mirror")
        return mirrored

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
        job_ack, self._pending_job_ack = self._pending_job_ack, []
        worker_ack, self._pending_worker_ack = self._pending_worker_ack, []
        op_ack, self._pending_op_ack = self._pending_op_ack, []
        pair_answers, self._pending_pair_answers = self._pending_pair_answers, []
        outgoing_ops = self._outgoing_ops()
        try:
            payload = await self.client.sync(
                ack=ack, job_ack=job_ack, worker_ack=worker_ack,
                ops=outgoing_ops, op_ack=op_ack, config=self._config(pair_answers),
            )
        except RelayError as exc:
            # Put them back: nothing was deleted at the relay, so they still need
            # acknowledging, and re-acknowledging one twice is a no-op there.
            self._pending_ack = ack + self._pending_ack
            self._pending_job_ack = job_ack + self._pending_job_ack
            self._pending_op_ack = op_ack + self._pending_op_ack
            # A pairing answer that did not reach the relay is one the device
            # waiting for it will never see, and it cannot be produced again:
            # the code was single use and has already been spent.
            self._pending_pair_answers = pair_answers + self._pending_pair_answers
            self._pending_worker_ack = worker_ack + self._pending_worker_ack
            log.warning("relay sync failed: %s", exc)
            return {"synced": False, "pulled": 0, "queued": 0, "acked": 0,
                    "jobs": 0, "workers": 0, "error": str(exc)}

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
            "jobs": await self._collect_jobs(payload),
            "workers": self._collect_workers(payload),
            "ops": self._collect_ops(payload, sent=outgoing_ops),
        }

    # -- the sync layer's half of the round trip --------------------------

    def _outgoing_ops(self) -> list[dict[str, Any]]:
        """What this machine changed since the last poll, sealed.

        Never raises. The sync layer is a passenger on a round trip that exists
        for Instagram capture, and a bug here must cost a settings change
        reaching a phone rather than a reel reaching the library.
        """
        try:
            from backend.sync import service as sync_service

            return sync_service.outgoing()
        except Exception:
            log.exception("could not prepare the outgoing sync ops")
            return []

    def _collect_ops(self, payload: dict[str, Any], *, sent: list[dict[str, Any]]) -> int:
        """Apply what other devices changed, and clear what the relay took.

        The outbox is emptied here rather than before the call, and only for the
        ops the relay confirmed storing -- which is the same late acknowledgement
        the three lists above use. An op dropped before the handover is
        confirmed is one a failed sync loses for good.
        """
        try:
            from backend.db.connection import get_connection, transaction
            from backend.sync import ops as sync_ops
            from backend.sync import service as sync_service

            # A pairing is answered before the ops are applied: a device that
            # has just joined should be in the mirror pushed on the next poll.
            answers = sync_service.answer_pairings(payload)
            if answers:
                self._pending_pair_answers.extend(answers)

            if sent and payload.get("ops_stored") is not None:
                with transaction(get_connection()) as conn:
                    sync_ops.forget(conn, [op["op_id"] for op in sent])

            applied, acks = sync_service.incoming(payload)
            self._pending_op_ack.extend(acks)
            return applied
        except Exception:
            log.exception("could not apply the incoming sync ops")
            return 0

    # -- the worker mailbox's half of the round trip ----------------------

    def _collect_workers(self, payload: dict[str, Any]) -> int:
        """Take what workers said while this machine was elsewhere.

        A batch waiting on a remote node reads `worker_reports`, so this is the
        step that unblocks it -- see `backend/workers/batch.py`. Nothing is
        applied and nothing is interpreted here: the row is written down and the
        handler that asked for it decides what it means.

        Acknowledged on the *next* sync like everything else, so a crash between
        taking a result and writing it re-offers the result rather than losing
        it. Re-acknowledging one twice is a no-op at the relay.
        """
        rows = payload.get("workers") or []
        if not rows:
            return 0
        from backend.workers.reports import WorkerReportStore

        store = WorkerReportStore()
        taken = 0
        for row in rows:
            stored = store.apply(row)
            if stored is None:
                # Not a report. Acknowledged anyway: leaving it would block the
                # batch behind it forever, and it is garbage rather than work.
                job_id = row.get("job_id") if isinstance(row, dict) else None
                if isinstance(job_id, str) and job_id:
                    self._pending_worker_ack.append(job_id)
                continue
            taken += 1
            # Only a settled report is acknowledged: a `running` one is deleted
            # at the relay by nothing, but confirming it early would mark it
            # synced and the result still to come would be a second row race.
            if stored.terminal:
                self._pending_worker_ack.append(stored.job_id)
        return taken

    # -- the durable job layer's half of the round trip -------------------

    async def _collect_jobs(self, payload: dict[str, Any]) -> int:
        """Apply what the relay finished while this machine was off.

        `docs/architecture/jobs.md` has the why. The relay runs the work whose
        deadline a closed laptop cannot meet; this is where its result stops
        being a row in D1 and becomes something in the library. Nothing is
        acknowledged here -- an id goes on `_pending_job_ack` and is confirmed
        on the *next* sync, which is what makes a crash in the middle re-offer
        the job rather than lose it.
        """
        jobs_payload = payload.get("jobs") or {}
        jobs = jobs_payload.get("ready") or []
        pending = jobs_payload.get("pending") or []

        # Stage any in-flight url_ingest jobs immediately so the library displays
        # a progressive skeleton card as soon as the Cloudflare relay receives the link.
        from backend.library.store import LibraryStore
        store = LibraryStore()
        for p in pending:
            if isinstance(p, dict) and p.get("kind") == "url_ingest":
                params = p.get("params") or {}
                p_url = (params.get("url") or "").strip()
                if p_url and store.by_url(p_url) is None:
                    try:
                        from backend.library.store import app_tag_for_url
                        app_tag = app_tag_for_url(p_url)
                        item_id = store.create(
                            kind=params.get("kind") or "article",
                            title=p_url,
                            url=p_url,
                            notes=params.get("note"),
                        )
                        store.update(
                            item_id,
                            status="received",
                            tags=json.dumps([app_tag]) if app_tag else None,
                        )
                    except Exception as exc:
                        log.debug("could not stage pending relay url %s: %s", p_url, exc)

        taken = 0
        for job in jobs:
            job_id = job.get("id")
            if not isinstance(job_id, str) or not job_id:
                continue
            result = await self._collect(job)
            if result is None:
                # Held: something transient stopped it, and acknowledging now
                # would delete a result nothing has applied. The next sync is
                # offered it again; the relay's prune is the deadline.
                continue
            if result:
                taken += 1
            self._pending_job_ack.append(job_id)
        return taken

    async def _collect(self, job: dict[str, Any]) -> bool | None:
        """One finished job. True applied, False nothing to apply, None held."""
        from backend.library.service import KINDS, LibraryError, LibraryService

        kind = job.get("kind")
        if job.get("state") == "failed":
            # If the relay could not fetch the page (e.g. Cloudflare Worker IP blocked with 403
            # or login wall), the user still intentionally shared this link. Capture it on desktop!
            params = job.get("params") or {}
            fallback_url = (params.get("url") or "").strip() if isinstance(params.get("url"), str) else ""
            if kind == "url_ingest" and fallback_url:
                log.info(
                    "relay gave up on %s (%s); attempting direct capture on desktop",
                    fallback_url,
                    job.get("last_error") or "no reason given",
                )
                try:
                    wanted = params.get("kind")
                    await (self._library or LibraryService()).capture_url(
                        fallback_url,
                        kind=wanted if wanted in KINDS else None,
                        notes=params.get("note") or None,
                    )
                    return True
                except Exception as exc:
                    log.warning("direct capture for failed relay job %s failed: %s", fallback_url, exc)
                    return False
            log.warning(
                "the relay gave up on a %s job: %s",
                kind,
                job.get("last_error") or "no reason given",
            )
            return False
        if kind == "instagram_ack":
            # The receipt was the work, and it happened on the relay. There is
            # nothing to bring home but the fact that it is done.
            return False

        result = job.get("result") or {}
        url = (result.get("url") or "").strip() if isinstance(result.get("url"), str) else ""
        if kind not in ("url_ingest", "document_fetch", "media_fetch") or not url:
            # A kind this machine does not know, from a relay running ahead of
            # it. Acknowledged rather than held: a row nobody here will ever be
            # able to apply must not be re-offered on every poll forever.
            log.warning("the relay finished a %s job this machine has no use for", kind)
            return False

        # ponytail: the URL, not the staged bytes. R2 is commented out in
        # wrangler.jsonc, so `staged` is False on every deployment that has not
        # deliberately turned it on -- and the relay's own comment says the
        # machine fetches them itself in that case. Collecting an artifact from
        # `GET /jobs/{id}/artifact/{key}` is the upgrade path when it is on.
        # The relay takes any word as a kind; the library takes seven. A phone
        # that said "pdf" meant something about the link, not nothing, so the
        # capture happens without it rather than being refused for it.
        wanted = result.get("kind")
        try:
            await (self._library or LibraryService()).capture_url(
                url,
                kind=wanted if wanted in KINDS else None,
                notes=result.get("note") or None,
                title=result.get("title") or None,
            )
        except LibraryError as exc:
            # The same rule every other door into the library follows: a fetch
            # that went wrong is not a reason to keep asking for it.
            log.warning("a relayed %s job could not be logged: %s", kind, exc)
            return False
        except Exception as exc:  # a crash mid-capture is transient until proven otherwise
            log.warning("applying a relayed %s job failed: %s", kind, exc)
            return None
        return True

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
                       store: InstagramEventStore) -> bool | None:
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
            # Held, not dropped. The drain empties the local queue every few
            # seconds, so the next sync has room again -- but acknowledging now
            # would make this the sync that told the relay to delete the reel.
            # None leaves the row alive at the relay; the daily cron is the
            # eight-day deadline if this machine never drains.
            log.warning(
                "the local queue is full at %d; leaving the rest at the relay", MAX_QUEUED
            )
            return None

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
