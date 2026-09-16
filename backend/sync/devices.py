"""Which devices are paired, and what a device has to present to be one.

ADR-0011 declined to build authentication, and was right to: the boundary was the
machine's own user account, and there was nothing to authenticate *to*. It closed
with the condition this module satisfies -- "revisit this decision entirely if and
when AMETHYST gains a networked or multi-device remote-access mode."

The shape follows `backend/share.py`, which is the closest thing that already
existed: a token minted with `secrets`, shown once, compared in constant time,
rate limited on failure. Two things are different, and both matter once there is
more than one holder.

**A token per device, not one token shared.** A shared secret cannot be revoked
without revoking everyone, so in practice it never is. Here `amethyst device
revoke` takes one phone out and leaves the laptop alone.

**Only a hash is stored.** `share.py` keeps its token in the keychain because it
has to reproduce it for the user; these are only ever *checked*, so the database
holds sha256 and the token itself exists exactly once, in the QR code shown at
pairing. A stolen database therefore authenticates as nobody.

This table is the authority. The relay holds a mirror, refreshed on every poll
exactly as `share_token` already is, so revoking here revokes there within one
poll rather than whenever somebody remembers to redeploy.

Pairing never shows Cloudflare the group key. The secret in the QR code derives
a key that wraps it, the relay carries the wrapped bytes without being able to
open them, and AEAD authentication is what proves each side knew the secret --
so there is no separate challenge-response to get wrong. The secret is 160 bits
precisely so this works without a PAKE: the reason protocols like SPAKE2 exist is
a code short enough to guess, and a QR code has no reason to be short.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass

import secrets as stdlib_secrets

from backend.secrets import SERVICE, set_secret
from backend.sync import crypto

log = logging.getLogger(__name__)

TOKEN_BYTES = 32

#: How long a pairing stays open. Short because the secret is displayed on a
#: screen, and a QR code left on a monitor over lunch is the realistic threat
#: here -- not brute force, which 160 bits already settles.
PAIRING_TTL_SECONDS = 300.0

#: The same process-global window `backend/share.py` uses, and the same
#: deliberate simplification: an address is not trustworthy behind a proxy, and
#: the protected action is one pairing.
MAX_FAILURES = 10
FAILURE_WINDOW_SECONDS = 300.0

_failures: list[float] = []

#: This device's own identity, in `app_settings`. Deliberately not on the sync
#: allowlist in `registry.py`: two devices answering to one id is the one piece
#: of state that must never converge.
DEVICE_ID_KEY = "sync.device_id"
DEVICE_NAME_KEY = "sync.device_name"

#: The bearer a device that is not the host presents at /ops. A host does not
#: need one -- it already holds RELAY_TOKEN and syncs through /sync.
TOKEN_REF = f"{SERVICE}/sync-device-token"


@dataclass(frozen=True)
class Device:
    id: str
    name: str
    role: str
    revoked_at: str | None = None
    last_seen_at: str | None = None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _rate_limited() -> bool:
    now = time.monotonic()
    _failures[:] = [t for t in _failures if now - t < FAILURE_WINDOW_SECONDS]
    return len(_failures) >= MAX_FAILURES


# -- this device ---------------------------------------------------------

def local_id(conn: sqlite3.Connection, *, name: str | None = None) -> str:
    """This machine's device id, minted on first use.

    Every HLC stamp carries it, so it has to exist before the first synced write
    and must never change -- a device that forgets its id would emit stamps that
    tie-break against its own earlier ones as if it were somebody else.
    """
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key = ?", (DEVICE_ID_KEY,)
    ).fetchone()
    if row and row[0]:
        return row[0]
    minted = str(uuid.uuid4())
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (DEVICE_ID_KEY, minted),
    )
    if name:
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (DEVICE_NAME_KEY, name),
        )
    log.info("this device is %s", minted)
    return minted


# -- the registry --------------------------------------------------------

def register(conn: sqlite3.Connection, name: str, role: str = "control") -> tuple[Device, str]:
    """Add a device. Returns it and its token -- the only time the token exists."""
    if role not in ("host", "control"):
        raise ValueError(f"a device is a host or a control, not {role!r}")
    token = stdlib_secrets.token_urlsafe(TOKEN_BYTES)
    device = Device(id=str(uuid.uuid4()), name=name.strip() or "unnamed device", role=role)
    conn.execute(
        "INSERT INTO devices (id, name, role, token_hash) VALUES (?,?,?,?)",
        (device.id, device.name, device.role, _hash(token)),
    )
    return device, token


def authenticate(conn: sqlite3.Connection, token: str) -> Device | None:
    """The device presenting this token, or None.

    Compared against a hash, so the loop is over rows rather than a lookup: a
    token is not a key anybody can index by without storing the token itself.
    With a handful of devices that is a handful of `compare_digest` calls.
    """
    if not token or _rate_limited():
        return None
    presented = _hash(token)
    for row in conn.execute(
        "SELECT id, name, role, revoked_at, last_seen_at, token_hash"
        " FROM devices WHERE revoked_at IS NULL"
    ):
        if hmac.compare_digest(presented, row[5]):
            conn.execute(
                "UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?", (row[0],)
            )
            return Device(*row[:5])
    _failures.append(time.monotonic())
    return None


def revoke(conn: sqlite3.Connection, device_id: str) -> bool:
    """Tombstone rather than delete, so the log keeps answering "which device
    was that?" after the device is gone.

    Anything that device had already asked for and this machine had not yet
    acted on is refused in the same transaction. Revoking a phone that is out of
    your hands and leaving its queued requests to run a minute later would make
    the button a lie -- the whole reason to press it is that you no longer trust
    what that device asked for.
    """
    revoked = conn.execute(
        "UPDATE devices SET revoked_at = datetime('now')"
        " WHERE id = ? AND revoked_at IS NULL",
        (device_id,),
    ).rowcount > 0
    if revoked:
        dropped = conn.execute(
            "UPDATE sync_intents SET state = 'refused', note = 'this device was revoked',"
            " updated_at = datetime('now')"
            " WHERE device_id = ? AND state = 'pending'",
            (device_id,),
        ).rowcount
        if dropped:
            log.info("refused %d queued request(s) from the revoked device %s",
                     dropped, device_id)
    return revoked


def live(conn: sqlite3.Connection) -> list[Device]:
    return [Device(*row) for row in conn.execute(
        "SELECT id, name, role, revoked_at, last_seen_at FROM devices"
        " WHERE revoked_at IS NULL ORDER BY created_at"
    )]


def mirror(conn: sqlite3.Connection) -> list[dict]:
    """What the relay is told on each poll: who may speak, and as what.

    Token *hashes*, not tokens. The relay has to recognise a device without being
    able to impersonate one, which is the same reason it is given Meta's exact
    bytes rather than a parsed object -- it is a participant, not a trusted one.
    """
    return [
        {"id": row[0], "role": row[1], "token_hash": row[2]}
        for row in conn.execute(
            "SELECT id, role, token_hash FROM devices WHERE revoked_at IS NULL"
        )
    ]


# -- pairing -------------------------------------------------------------

@dataclass
class Pairing:
    """An open invitation. Held in memory on purpose: it lives five minutes, and
    a restart mid-pairing should invalidate it rather than resume it."""

    secret: str
    opened_at: float
    name_hint: str = ""

    @property
    def expired(self) -> bool:
        return time.monotonic() - self.opened_at > PAIRING_TTL_SECONDS


_open_pairing: Pairing | None = None


def open_pairing(name_hint: str = "") -> tuple[str, str]:
    """Start pairing. Returns the secret to show, and the QR payload.

    One at a time: a second call replaces the first, so a code left on screen
    stops working the moment the user asks for another.
    """
    global _open_pairing
    secret = crypto.new_pair_secret()
    _open_pairing = Pairing(secret=secret, opened_at=time.monotonic(), name_hint=name_hint)
    return secret, f"amethyst://pair?s={secret}"


def close_pairing() -> None:
    global _open_pairing
    _open_pairing = None


def accept(conn: sqlite3.Connection, sealed: dict) -> dict | None:
    """Complete a pairing from the request the relay carried across.

    The request opening under the pairing key *is* the proof the far side knew
    the secret -- that is what an AEAD tag is -- so there is no second round
    trip. Returns what to seal and send back, or None if this was not a pairing
    we opened.
    """
    global _open_pairing
    pairing = _open_pairing
    if pairing is None or pairing.expired:
        if pairing is not None:
            log.info("a pairing request arrived after the code had expired")
            _open_pairing = None
        return None

    key = crypto.pair_key(pairing.secret)
    request_id = str(sealed.get("request_id") or "")
    try:
        opened = crypto.unseal(
            sealed["nonce"], sealed["ciphertext"],
            op_id=request_id, device_id="pairing", key=key,
        )
    except (crypto.SealError, KeyError, TypeError):
        # An offer sealed under something other than the code on this screen.
        #
        # Deliberately NOT counted toward the failure window that `authenticate`
        # uses. That window defends a credential somebody could plausibly guess;
        # a pairing secret is 160 bits and cannot be. Counting these instead
        # created a remotely triggerable lockout -- the relay accepts offers from
        # anyone, so ten pieces of junk posted by a stranger would have shut
        # pairing for everyone for five minutes, which is a denial of service
        # bought for the price of ten HTTP requests.
        #
        # What bounds the cost of junk is MAX_PENDING_PAIRINGS at the relay: at
        # most a handful of offers exist at once, and opening one is a single
        # AEAD attempt.
        log.debug("a pairing offer did not open under this code; ignoring it")
        return None

    group = crypto.group_key() or crypto.create_group_key()
    device, token = register(
        conn,
        name=str(opened.get("name") or pairing.name_hint or "paired device"),
        role=str(opened.get("role") or "control"),
    )
    _open_pairing = None  # single use

    nonce, ciphertext = crypto.seal(
        {
            "device_id": device.id,
            "token": token,
            "group_key": crypto.b64(group),
        },
        op_id=request_id, device_id="pairing", key=key,
    )
    log.info("paired %s (%s)", device.name, device.id)
    return {"request_id": request_id, "nonce": nonce, "ciphertext": ciphertext}


def build_request(pair_secret: str, name: str, role: str = "control") -> dict:
    """The control device's half: what it sends through the relay.

    Here rather than in a client so both halves of the handshake are read
    together -- a pairing protocol split across two files is one that drifts.
    """
    request_id = str(uuid.uuid4())
    nonce, ciphertext = crypto.seal(
        {"name": name, "role": role},
        op_id=request_id, device_id="pairing", key=crypto.pair_key(pair_secret),
    )
    return {"request_id": request_id, "nonce": nonce, "ciphertext": ciphertext}


def read_response(pair_secret: str, response: dict) -> dict:
    """The control device opening what came back. Raises SealError if the relay
    tampered with it or the secret was wrong."""
    return crypto.unseal(
        response["nonce"], response["ciphertext"],
        op_id=str(response.get("request_id") or ""), device_id="pairing",
        key=crypto.pair_key(pair_secret),
    )


# -- joining, from the other side ----------------------------------------

def adopt_identity(conn: sqlite3.Connection, device_id: str) -> None:
    """Take the id the host assigned instead of the one minted locally.

    A machine mints an id the first time anything needs one, which is usually
    before it has ever been paired. The host's registry is the authority -- it is
    what the relay's fan-out and its device authentication both key on -- so on
    joining, the locally minted id is replaced.

    Ops already sitting in the outbox keep stamps carrying the old id. That is
    harmless: the id inside a stamp is a tie-break, not an address, and it only
    has to be stable and distinct, which a retired id still is.
    """
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (DEVICE_ID_KEY, device_id),
    )


async def join(relay_url: str, pair_secret: str, name: str, *,
               role: str = "host", timeout: float = 120.0) -> dict:
    """Complete a pairing from the joining side.

    Offer, then wait. The host answers on its next relay poll, so the wait is up
    to one poll interval plus however long the machine takes to notice -- which
    is why this polls rather than expecting an answer in the first response.

    Nothing secret goes to the relay: the offer and the answer are both sealed
    under a key derived from `pair_secret`, which was read off the host's screen.
    """
    import httpx

    from backend.db.connection import get_connection, transaction

    base = relay_url.rstrip("/")
    request = build_request(pair_secret, name=name, role=role)

    async with httpx.AsyncClient(timeout=20.0) as client:
        offered = await client.post(f"{base}/pair", json=request)
        if offered.status_code >= 400:
            raise RuntimeError(
                f"the relay would not take the pairing offer (HTTP {offered.status_code})"
            )

        deadline = time.monotonic() + timeout
        answer = None
        while time.monotonic() < deadline:
            got = await client.get(f"{base}/pair", params={"request_id": request["request_id"]})
            if got.status_code == 200:
                answer = got.json()
                break
            await asyncio.sleep(3.0)

    if answer is None:
        raise RuntimeError(
            "the other machine never answered. It completes the handshake on its"
            " next relay poll, so check that it is running and that its relay is on."
        )

    opened = read_response(pair_secret, answer)
    conn = get_connection()
    with transaction(conn):
        adopt_identity(conn, opened["device_id"])
    crypto.adopt_group_key(crypto.unb64(opened["group_key"]))
    set_secret(TOKEN_REF, opened["token"])

    from backend.sync import service

    service.reset_clock()   # the id this device stamps with has just changed
    return {"device_id": opened["device_id"], "name": name}
