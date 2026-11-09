"""The drain.

A fourth runner beside automations, reminders and the journal, and for the same
stated reason each of those is separate: the work here is minutes long -- a
download, ffmpeg, a transcription, a model call -- and queueing a reminder or a
briefing behind it would make neither arrive when it should.

It waits on an event with a timeout rather than sleeping on a fixed tick. The
nudge is what matters: a delivery is acknowledged and drained within
microseconds, which is the difference between fetching a `lookaside` asset that
still exists and one that has expired. The timeout is what makes it durable --
a queue left behind by a crash is picked up on the next tick regardless of
whether anything nudges.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import date, datetime, timedelta

from backend.config import load_instagram, save_instagram
from backend.instagram import signature
from backend.instagram.client import InstagramClient, InstagramError
from backend.instagram.service import IngestService
from backend.instagram.store import InstagramEventStore
from backend.sync import devices as sync_devices

log = logging.getLogger(__name__)

#: The kind of durable job one delivery's processing is recorded as.
JOB_KIND = "instagram_ingest"

TICK_SECONDS = 5.0
PAIRING_TICK_SECONDS = 1.0
#: How many events one drain will take before yielding, so a large backlog does
#: not hold the lock for an hour.
DRAIN_LIMIT = 20
#: Refresh the access token this far ahead of expiry. A lapsed token cannot be
#: refreshed at all -- only replaced by hand -- so the margin is generous.
TOKEN_REFRESH_DAYS = 14
PRUNE_EVERY_SECONDS = 3600.0


class InstagramRunner:
    def __init__(self, service_factory=IngestService, drive_inbox: Any | None = None) -> None:
        self._task: asyncio.Task | None = None
        self._wake: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self._service_factory = service_factory
        self._next_prune = 0.0
        self._checked_token_on: str | None = None
        if drive_inbox is not None:
            self._drive_inbox = drive_inbox
        else:
            try:
                from backend.drive.inbox import DriveInboxPoller
                self._drive_inbox = DriveInboxPoller()
            except Exception:
                self._drive_inbox = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._wake = asyncio.Event()
            self._lock = asyncio.Lock()
            self._task = asyncio.create_task(self._loop(), name="instagram")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._wake = None
        self._lock = None

    def nudge(self) -> None:
        """Something arrived. Drain now rather than at the next tick.

        A no-op when nothing is running -- the delivery is already written down,
        and the next start drains it.
        """
        if self._drive_inbox is not None:
            self._drive_inbox.nudge()
        if self._wake is not None:
            self._wake.set()

    @staticmethod
    def _pairing_active() -> bool:
        return (
            sync_devices.pairing_open()
            or sync_devices.has_pending_pairings()
            or sync_devices.has_approved_answers()
        )

    @staticmethod
    def _tick_seconds() -> float:
        """How long to wait before the next tick."""
        return PAIRING_TICK_SECONDS if InstagramRunner._pairing_active() else TICK_SECONDS

    async def _loop(self) -> None:
        wake = self._wake
        while True:
            try:
                delay = self._tick_seconds()
                if wake is not None:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(wake.wait(), timeout=delay)
                    wake.clear()
                else:
                    await asyncio.sleep(delay)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("instagram tick failed")

    async def tick(self) -> list[int]:
        """Recover, drain, and keep the token alive. Returns the events handled."""
        # The cheapest possible no-op on a machine that has not set this up, and
        # it runs on every tick of every test's app lifespan.
        settings = load_instagram()
        drive_wanted = bool(self._drive_inbox is not None and self._drive_inbox.configured())
        if not settings.enabled and not drive_wanted:
            return []
        if drive_wanted:
            await self._drive_inbox.tick()
        if not settings.enabled:
            return []
        store = InstagramEventStore()
        store.reclaim_stale()
        handled = await self.drain(store=store)
        await self._housekeeping(store)
        return handled

    async def drain(self, *, store: InstagramEventStore | None = None) -> list[int]:
        """Work the queue, one event at a time.

        Serialised deliberately: two concurrent downloads plus two ffmpeg
        processes while a turn is streaming is not a machine anyone wants.
        """
        from backend.jobs import JobStore

        store = store or InstagramEventStore()
        jobs = JobStore()
        handled: list[int] = []
        lock = self._lock or asyncio.Lock()
        async with lock:
            service = self._service_factory(store=store)
            for _ in range(DRAIN_LIMIT):
                event = store.claim_next()
                if event is None:
                    break
                # The durable half. The event row is still the queue -- it is
                # where Meta's re-deliveries collide, and moving that claim into
                # `jobs` would leave two tables disagreeing about one reel. What
                # the job adds is the ledger: `reclaim_stale` requeues an event
                # whose process died, and without this that retry re-sent the
                # confirmation and skipped the transcript it had not finished.
                job = jobs.begin(
                    JOB_KIND,
                    f"{JOB_KIND}:{event['delivery_key']}",
                    payload={"event_id": event["id"], "route": event["route"]},
                )
                try:
                    status = await service.process(event, job=job, jobs=jobs)
                except Exception as exc:
                    log.exception("instagram event %s failed", event["id"])
                    store.finish(event["id"], status="failed", note=str(exc))
                    jobs.fail(job, f"{type(exc).__name__}: {exc}")
                else:
                    jobs.complete(job, {"status": status, "event_id": event["id"]})
                handled.append(event["id"])
        return handled

    async def _housekeeping(self, store: InstagramEventStore) -> None:
        now = asyncio.get_running_loop().time()
        if now >= self._next_prune:
            self._next_prune = now + PRUNE_EVERY_SECONDS
            store.prune()
            with contextlib.suppress(Exception):
                from backend.db.connection import get_connection
                from backend.sync import devices as sync_devices

                sync_devices.prune_stale_devices(get_connection())
        await self._maybe_refresh_token()

    async def _maybe_refresh_token(self) -> None:
        """Keep the access token alive, and say so loudly when it cannot be.

        A long-lived token refreshes only while it is still valid. Once it has
        lapsed there is no automatic recovery, so the check runs once a day and
        the margin is two weeks.
        """
        today = date.today().isoformat()
        if self._checked_token_on == today:
            return
        self._checked_token_on = today

        settings = load_instagram()
        if not settings.token_expires_on or not signature.access_token():
            return
        try:
            expires = date.fromisoformat(settings.token_expires_on)
        except ValueError:
            return

        remaining = (expires - date.today()).days
        if remaining > TOKEN_REFRESH_DAYS:
            return
        if remaining < 0:
            await self._warn_expired(expires)
            return

        try:
            token, expires_in = await InstagramClient().refresh_token()
        except InstagramError as exc:
            log.warning("could not refresh the Instagram token: %s", exc)
            return
        signature.set_credentials(access_token=token)
        renewed = datetime.now() + timedelta(seconds=expires_in or 60 * 24 * 3600)
        save_instagram({"token_expires_on": renewed.date().isoformat()})
        log.info("refreshed the Instagram token, now good until %s", renewed.date())

    async def _warn_expired(self, expires: date) -> None:
        from backend.notify import notify

        await notify(
            "Instagram needs reconnecting",
            f"The access token expired on {expires:%d %b}. Nothing is being saved"
            " until it is replaced in Settings.",
        )
