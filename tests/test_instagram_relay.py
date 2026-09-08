"""The relay: what this machine takes from it, and what it refuses to take.

The relay is a Worker on the internet holding a queue. It is always on and it is
never trusted, and almost everything asserted here is about the second half of
that sentence -- the signature is verified again on this side, the share token is
checked again on this side, and a row that fails either is dropped rather than
believed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import pytest

from backend.config import load_instagram, save_instagram
from backend.instagram import relay, signature
from backend.instagram.store import InstagramEventStore

APP_SECRET = "an-app-secret"
RELAY_URL = "https://amethyst-relay.example.workers.dev"
RELAY_TOKEN = "a-relay-token"


def reel_body(*, mid: str = "m_abc", sender: str = "555", when: int | None = None) -> bytes:
    stamp = int(when if when is not None else time.time())
    return json.dumps(
        {
            "object": "instagram",
            "entry": [
                {
                    "id": "17841400000000000",
                    "time": stamp,
                    "messaging": [
                        {
                            "sender": {"id": sender},
                            "recipient": {"id": "17841400000000000"},
                            "timestamp": stamp * 1000,
                            "message": {
                                "mid": mid,
                                "attachments": [
                                    {
                                        "type": "ig_reel",
                                        "payload": {"title": "pour over", "video_id": "9"},
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
        }
    ).encode()


def signed(raw: bytes, secret: str = APP_SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def row(raw: bytes, *, row_id: int = 1, sig: str | None = None, kind: str = "instagram") -> dict:
    return {
        "id": row_id,
        "kind": kind,
        "body": base64.b64encode(raw).decode(),
        "signature": signed(raw) if sig is None else sig,
        "sender_id": "555",
        "received_at": int(time.time()),
    }


class FakeRelay:
    """Stands in for the Worker. Records what was sent, answers what it was given."""

    def __init__(self, *batches: dict):
        self.batches = list(batches)
        self.calls: list[dict] = []
        self.url = RELAY_URL
        self.token = RELAY_TOKEN

    async def sync(self, *, ack, config, limit=25):
        self.calls.append({"ack": list(ack), "config": config, "limit": limit})
        if not self.batches:
            return {"deliveries": [], "queued": 0}
        return self.batches.pop(0)


@pytest.fixture
def wired(amethyst_home):
    """Credentials stored and the relay switched on, which is the working state."""
    signature.set_credentials(
        app_secret=APP_SECRET, verify_token="v", access_token="an-access-token"
    )
    relay.set_token(RELAY_TOKEN)
    save_instagram({"relay_url": RELAY_URL, "relay_enabled": True, "enabled": True})
    return amethyst_home


# -- the check that makes the relay untrusted ----------------------------


@pytest.mark.asyncio
async def test_a_signed_row_reaches_the_queue(wired):
    raw = reel_body()
    poller = relay.RelayPoller(FakeRelay({"deliveries": [row(raw)], "queued": 0}))

    result = await poller.sync()

    assert result["pulled"] == 1
    rows = InstagramEventStore().recent()
    assert [r["route"] for r in rows] == ["dm_reel"]
    assert rows[0]["delivery_key"] == "dm:m_abc"


@pytest.mark.asyncio
async def test_a_forged_row_is_dropped(wired):
    """Mutation check: delete the verify_signature call in `_take_delivery` and
    this passes with the row in the library queue -- which is a relay that can
    write to the library, the one thing this design refuses."""
    raw = reel_body()
    poller = relay.RelayPoller(
        FakeRelay({"deliveries": [row(raw, sig=signed(raw, "a-different-secret"))], "queued": 0})
    )

    result = await poller.sync()

    assert result["pulled"] == 0
    assert InstagramEventStore().recent() == []


@pytest.mark.asyncio
async def test_an_unsigned_row_is_dropped(wired):
    raw = reel_body()
    poller = relay.RelayPoller(FakeRelay({"deliveries": [row(raw, sig="")]}))

    assert (await poller.sync())["pulled"] == 0
    assert InstagramEventStore().recent() == []


@pytest.mark.asyncio
async def test_a_dropped_row_is_still_acknowledged(wired):
    """A row nobody can verify is garbage, not work being deferred. Leaving it at
    the relay would put it at the head of every future batch, forever."""
    raw = reel_body()
    fake = FakeRelay({"deliveries": [row(raw, row_id=7, sig="sha256=nope")]}, {"deliveries": []})
    poller = relay.RelayPoller(fake)

    await poller.sync()
    await poller.sync()

    assert fake.calls[1]["ack"] == [7]


# -- staleness, which must not be re-applied here ------------------------


@pytest.mark.asyncio
async def test_a_delivery_caught_two_days_ago_is_still_taken(wired):
    """Mutation check: add `signature.is_stale` to `_take_delivery` and this
    fails -- and with it the entire feature, whose whole purpose is a delivery
    that arrived while the machine was off."""
    raw = reel_body(when=int(time.time()) - 2 * 24 * 3600)
    poller = relay.RelayPoller(FakeRelay({"deliveries": [row(raw)]}))

    assert (await poller.sync())["pulled"] == 1


# -- acknowledging ------------------------------------------------------


@pytest.mark.asyncio
async def test_rows_are_acknowledged_on_the_next_call_not_this_one(wired):
    raw = reel_body()
    fake = FakeRelay({"deliveries": [row(raw, row_id=4)]}, {"deliveries": []})
    poller = relay.RelayPoller(fake)

    await poller.sync()
    assert fake.calls[0]["ack"] == []
    await poller.sync()
    assert fake.calls[1]["ack"] == [4]


@pytest.mark.asyncio
async def test_a_failed_call_keeps_what_it_owed(wired):
    """Mutation check: clear `_pending_ack` before the call instead of restoring
    it on failure, and a relay hiccup silently leaves rows there forever."""
    raw = reel_body()

    class Flaky(FakeRelay):
        def __init__(self):
            super().__init__({"deliveries": [row(raw, row_id=9)]}, {"deliveries": []})
            self.fail_next = False

        async def sync(self, *, ack, config, limit=25):
            if self.fail_next:
                self.calls.append({"ack": list(ack), "config": config, "limit": limit})
                raise relay.RelayError("down")
            return await super().sync(ack=ack, config=config, limit=limit)

    fake = Flaky()
    poller = relay.RelayPoller(fake)
    await poller.sync()
    fake.fail_next = True
    result = await poller.sync()
    assert result["synced"] is False
    fake.fail_next = False
    await poller.sync()

    assert fake.calls[-1]["ack"] == [9]


@pytest.mark.asyncio
async def test_the_same_delivery_twice_becomes_one_event(wired):
    """The relay dedupes on the body hash and this side dedupes on the delivery
    key. Both are needed: they collide on different things."""
    raw = reel_body()
    poller = relay.RelayPoller(
        FakeRelay({"deliveries": [row(raw, row_id=1)]}, {"deliveries": [row(raw, row_id=2)]})
    )

    await poller.sync()
    await poller.sync()

    assert len(InstagramEventStore().recent()) == 1


# -- what is mirrored up -------------------------------------------------


@pytest.mark.asyncio
async def test_the_allowlist_is_pushed_so_the_relay_does_not_reply_to_strangers(wired):
    """Mutation check: drop `allow_senders` from `_config` and the relay answers
    "got it" to anyone who messages the account, for a reel it then discards."""
    from backend.config import allow_sender

    allow_sender("555")
    fake = FakeRelay()
    await relay.RelayPoller(fake).sync()

    assert fake.calls[0]["config"]["allow_senders"] == ["555"]


@pytest.mark.asyncio
async def test_the_access_token_is_pushed(wired):
    fake = FakeRelay()
    await relay.RelayPoller(fake).sync()

    assert fake.calls[0]["config"]["access_token"] == "an-access-token"


@pytest.mark.asyncio
async def test_a_rotated_token_is_stored_and_dated(wired):
    """The relay's cron is the only thing awake when the 60 days run out, so it
    is the thing that refreshes -- and this is the only way the new token gets
    into the keychain."""
    fake = FakeRelay(
        {"deliveries": [], "access_token": "a-fresher-token", "token_expires_on": "2026-12-01"}
    )

    await relay.RelayPoller(fake).sync()

    assert signature.access_token() == "a-fresher-token"
    assert load_instagram().token_expires_on == "2026-12-01"


@pytest.mark.asyncio
async def test_no_rotation_leaves_the_token_alone(wired):
    await relay.RelayPoller(FakeRelay({"deliveries": [], "access_token": None})).sync()

    assert signature.access_token() == "an-access-token"


# -- shares --------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_relayed_share_is_checked_against_this_machines_token(wired, monkeypatch):
    """Mutation check: take the relay's word for the token and a compromised
    relay can put anything it likes into the library."""
    from backend import share

    real = share.rotate()
    captured: list[str] = []

    class FakeLibrary:
        async def capture_url(self, url, *, kind=None, notes=None):
            captured.append(url)

    def share_row(token: str, row_id: int) -> dict:
        body = json.dumps({"url": "https://example.com/a", "kind": None,
                           "note": None, "token": token}).encode()
        return row(body, row_id=row_id, sig=None, kind="share")

    poller = relay.RelayPoller(
        FakeRelay({"deliveries": [share_row("not-the-token", 1), share_row(real, 2)]}),
        library=FakeLibrary(),
    )
    result = await poller.sync()

    assert captured == ["https://example.com/a"]
    assert result["pulled"] == 1


# -- when it should not run at all ---------------------------------------


@pytest.mark.asyncio
async def test_nothing_happens_when_the_relay_is_switched_off(amethyst_home):
    fake = FakeRelay()
    result = await relay.RelayPoller(fake).sync()

    assert result["synced"] is False
    assert fake.calls == []


@pytest.mark.asyncio
async def test_a_delivery_without_instagram_credentials_is_held_not_dropped(amethyst_home):
    """The old contract refused the whole sync when the Instagram credentials
    were incomplete, which held phone *shares* hostage to a setup they have
    nothing to do with -- the "it never arrived" bug. The new one: the sync
    runs, a share still lands, and only the delivery that needs the app secret
    waits at the relay for a sync that can verify it."""
    relay.set_token(RELAY_TOKEN)
    save_instagram({"relay_url": RELAY_URL, "relay_enabled": True})

    from backend import share as share_module

    real_share_token = share_module.rotate()
    body = json.dumps({"url": "https://example.com/a", "kind": None,
                       "note": None, "token": real_share_token}).encode()
    share_row = row(body, row_id=1, sig=None, kind="share")
    delivery_row = row(b"not-signed-by-anyone", row_id=2, sig="sha=bad", kind="delivery")
    captured: list[str] = []

    class FakeLibrary:
        async def capture_url(self, url, **_):
            captured.append(url)

    fake = FakeRelay({"deliveries": [delivery_row, share_row]})
    poller = relay.RelayPoller(fake, library=FakeLibrary())
    result = await poller.sync()

    assert result["synced"] is True
    assert captured == ["https://example.com/a"]
    # The delivery is held, so it is not in the poller's next ack -- the row
    # survives at the relay, which is what "held, not dropped" means in code.
    assert poller._pending_ack == [1]
    assert result["pulled"] == 1


def test_configured_needs_both_a_url_and_a_token(amethyst_home):
    assert relay.configured() is False
    save_instagram({"relay_url": RELAY_URL})
    assert relay.configured() is False
    relay.set_token(RELAY_TOKEN)
    assert relay.configured() is True


# -- the routes ----------------------------------------------------------


def test_the_relay_url_must_be_https(wired):
    """It carries the access token in both directions. Mutation check: drop the
    scheme check and a typo publishes a credential over plain HTTP."""
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as client:
        response = client.put("/api/instagram/relay", json={"url": "http://amethyst.example.com"})

    assert response.status_code == 400
    assert "https" in response.json()["detail"]


def test_switching_the_relay_on_without_a_token_is_refused(amethyst_home):
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as client:
        response = client.put(
            "/api/instagram/relay", json={"url": RELAY_URL, "enabled": True}
        )

    assert response.status_code == 400


def test_the_status_says_whether_capture_survives_this_machine_being_off(wired):
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as client:
        body = client.get("/api/instagram").json()

    assert body["relay"] == {
        "url": RELAY_URL,
        "enabled": True,
        "token": True,
        "ready": True,
    }


def test_the_status_never_returns_the_relay_token(wired):
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as client:
        body = client.get("/api/instagram").text

    assert RELAY_TOKEN not in body


def test_forgetting_the_relay_clears_both_halves(wired):
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as client:
        body = client.delete("/api/instagram/relay").json()

    assert body["relay"] == {"url": "", "enabled": False, "token": False, "ready": False}
    assert relay.token() is None
