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
import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

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
MAX_FAILURES = 50
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

DEFAULT_PERMISSIONS: dict[str, bool] = {
    "terminal": True,
    "root": False,
    "screen": True,
    "webcam": True,
    "mic": True,
    "audio": True,
    "files": True,
    "input": True,
    "power": True,
    "agent": True,
}


@dataclass(frozen=True)
class Device:
    id: str
    name: str
    role: str
    revoked_at: str | None = None
    last_seen_at: str | None = None
    permissions: dict[str, bool] = field(default_factory=dict)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("ALTER TABLE devices ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'")
    except (sqlite3.OperationalError, sqlite3.DatabaseError):
        pass


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

def register(
    conn: sqlite3.Connection,
    name: str,
    role: str = "control",
    permissions: dict[str, bool] | None = None,
) -> tuple[Device, str]:
    """Add a device. Returns it and its token -- the only time the token exists."""
    if role not in ("host", "control"):
        raise ValueError(f"a device is a host or a control, not {role!r}")
    _ensure_schema(conn)
    perms = dict(DEFAULT_PERMISSIONS)
    if permissions:
        perms.update(permissions)
    token = stdlib_secrets.token_urlsafe(TOKEN_BYTES)
    device = Device(
        id=str(uuid.uuid4()),
        name=name.strip() or "unnamed device",
        role=role,
        permissions=perms,
    )
    conn.execute(
        "INSERT INTO devices (id, name, role, token_hash, permissions) VALUES (?,?,?,?,?)",
        (device.id, device.name, device.role, _hash(token), json.dumps(perms)),
    )
    conn.commit()
    return device, token


def authenticate(conn: sqlite3.Connection, token: str) -> Device | None:
    """The device presenting this token, or None.

    Compared against a hash, so the loop is over rows rather than a lookup: a
    token is not a key anybody can index by without storing the token itself.
    With a handful of devices that is a handful of `compare_digest` calls.
    """
    if not token or _rate_limited():
        return None
    _ensure_schema(conn)
    presented = _hash(token)
    for row in conn.execute(
        "SELECT id, name, role, revoked_at, last_seen_at, token_hash, permissions"
        " FROM devices WHERE revoked_at IS NULL"
    ):
        if hmac.compare_digest(presented, row[5]):
            conn.execute(
                "UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?", (row[0],)
            )
            conn.commit()
            perms = dict(DEFAULT_PERMISSIONS)
            try:
                if row[6]:
                    perms.update(json.loads(row[6]))
            except Exception:
                pass
            return Device(
                id=row[0],
                name=row[1],
                role=row[2],
                revoked_at=row[3],
                last_seen_at=row[4],
                permissions=perms,
            )
    _failures.append(time.monotonic())
    return None


def get_device(conn: sqlite3.Connection, device_id: str) -> Device | None:
    _ensure_schema(conn)
    row = conn.execute(
        "SELECT id, name, role, revoked_at, last_seen_at, permissions FROM devices WHERE id = ?",
        (device_id,),
    ).fetchone()
    if not row:
        return None
    perms = dict(DEFAULT_PERMISSIONS)
    try:
        if row[5]:
            perms.update(json.loads(row[5]))
    except Exception:
        pass
    return Device(
        id=row[0],
        name=row[1],
        role=row[2],
        revoked_at=row[3],
        last_seen_at=row[4],
        permissions=perms,
    )


def update_permissions(conn: sqlite3.Connection, device_id: str, permissions: dict[str, bool]) -> bool:
    _ensure_schema(conn)
    dev = get_device(conn, device_id)
    if not dev or dev.revoked_at is not None:
        return False
    perms = dict(dev.permissions)
    perms.update(permissions)
    conn.execute(
        "UPDATE devices SET permissions = ? WHERE id = ? AND revoked_at IS NULL",
        (json.dumps(perms), device_id),
    )
    conn.commit()
    return True


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
    conn.commit()
    return revoked


def live(conn: sqlite3.Connection) -> list[Device]:
    _ensure_schema(conn)
    result = []
    for row in conn.execute(
        "SELECT id, name, role, revoked_at, last_seen_at, permissions FROM devices"
        " WHERE revoked_at IS NULL ORDER BY created_at"
    ):
        perms = dict(DEFAULT_PERMISSIONS)
        try:
            if row[5]:
                perms.update(json.loads(row[5]))
        except Exception:
            pass
        result.append(
            Device(
                id=row[0],
                name=row[1],
                role=row[2],
                revoked_at=row[3],
                last_seen_at=row[4],
                permissions=perms,
            )
        )
    return result


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


@dataclass
class PendingPairing:
    request_id: str
    name: str
    role: str
    key: bytes
    opened_at: float
    ip_address: str = ""
    user_agent: str = ""

    @property
    def expired(self) -> bool:
        return time.monotonic() - self.opened_at > PAIRING_TTL_SECONDS


_pending_pairings: dict[str, PendingPairing] = {}
_pairing_listeners: list[Any] = []


def add_pairing_listener(listener: Any) -> None:
    if listener not in _pairing_listeners:
        _pairing_listeners.append(listener)


def remove_pairing_listener(listener: Any) -> None:
    if listener in _pairing_listeners:
        _pairing_listeners.remove(listener)


def notify_pending_pairing(pending: PendingPairing) -> None:
    event = {
        "type": "pairing_request",
        "request_id": pending.request_id,
        "name": pending.name,
        "role": pending.role,
        "opened_at": pending.opened_at,
        "ip_address": pending.ip_address,
    }
    for listener in list(_pairing_listeners):
        try:
            listener(event)
        except Exception:
            log.exception("error in pairing listener")


#: Where the interface this machine's phone loads is hosted, in `app_settings`.
#: Unset on a machine nobody has published a frontend for, which is the case the
#: `amethyst://` fallback below exists for.
APP_URL_KEY = "sync.app_url"


def app_url(conn: sqlite3.Connection | None = None) -> str:
    """The address a phone opens this app at, or "" if there is none."""
    from_env = os.environ.get("AMETHYST_APP_URL", "").strip()
    if from_env:
        return from_env.rstrip("/")
    if conn is None:
        return ""
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key = ?", (APP_URL_KEY,)
    ).fetchone()
    return str(row[0]).strip().rstrip("/") if row and row[0] else ""


def lan_address() -> str:
    """This machine's address on the network, for diagnostics only."""
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.2)
            probe.connect(("192.0.2.1", 9))  # reserved, unroutable, never dialled
            return str(probe.getsockname()[0])
    except OSError:
        return ""


def host_url() -> str:
    lan = lan_address()
    port = os.environ.get("AMETHYST_BIND_PORT", "8000").strip() or "8000"
    if lan:
        return f"http://{lan}:{port}"
    return ""


def pairing_payload(
    secret: str,
    *,
    app: str = "",
    relay: str = "",
    host: str = "",
    prefer_lan: bool = False,
) -> str:
    """What the QR code encodes."""
    fields = {"s": secret}
    if relay:
        fields["r"] = relay.rstrip("/")
    if host:
        fields["h"] = host.rstrip("/")
    query = urlencode(fields)
    if prefer_lan and host:
        return f"{host.rstrip('/')}/pair#{query}"
    if app:
        return f"{app.rstrip('/')}/pair#{query}"
    if host:
        return f"{host.rstrip('/')}/pair#{query}"
    return f"amethyst://pair?{query}"


def open_pairing(name_hint: str = "", *, conn: sqlite3.Connection | None = None) -> tuple[str, str]:
    """Start pairing. Returns the secret to show, and the QR payload.

    One at a time: a second call replaces the first, so a code left on screen
    stops working the moment the user asks for another.
    """
    global _open_pairing
    secret = crypto.new_pair_secret()
    _open_pairing = Pairing(secret=secret, opened_at=time.monotonic(), name_hint=name_hint)
    relay = ""
    try:
        from backend.config import load_instagram

        relay = (load_instagram().relay_url or "").strip()
    except Exception:
        log.debug("could not read the relay address for the pairing payload")
    app = app_url(conn)
    host = host_url()
    return secret, pairing_payload(secret, app=app, relay=relay, host=host)


def close_pairing() -> None:
    global _open_pairing
    _open_pairing = None
    _pending_pairings.clear()
    _approved_answers.clear()
    _approved_answers_map.clear()


def has_peers(conn: sqlite3.Connection) -> bool:
    """Is there anybody to sync with?"""
    if live(conn):
        return True
    from backend.secrets import get_secret

    return bool(get_secret(TOKEN_REF))


def pairing_open() -> bool:
    """Is a code on screen right now, waiting to be scanned?"""
    return _open_pairing is not None and not _open_pairing.expired


def accept(conn: sqlite3.Connection, sealed: dict, auto_approve: bool = True) -> dict | None:
    """Complete a pairing from the request the relay carried across."""
    global _open_pairing
    request_id = str(sealed.get("request_id") or "")
    if request_id in _pending_pairings:
        return {"request_id": request_id, "refused": "pending_approval"}
    if request_id in _approved_answers_map:
        return _approved_answers_map[request_id]

    pairing = _open_pairing
    if pairing is None or pairing.expired:
        if pairing is not None:
            log.info("a pairing request arrived after the code had expired")
            _open_pairing = None
        if not request_id:
            return None
        return {"request_id": request_id, "refused": "expired"}

    key = crypto.pair_key(pairing.secret)
    try:
        opened = crypto.unseal(
            sealed["nonce"], sealed["ciphertext"],
            op_id=request_id, device_id="pairing", key=key,
        )
    except (crypto.SealError, KeyError, TypeError):
        log.debug("a pairing offer did not open under this code; ignoring it")
        return None

    # The pairing code is single-use once unsealed under a valid key
    _open_pairing = None

    pp = PendingPairing(
        request_id=request_id,
        name=str(opened.get("name") or pairing.name_hint or "paired device"),
        role=str(opened.get("role") or "control"),
        key=key,
        opened_at=time.monotonic(),
        ip_address=str(sealed.get("client_ip") or ""),
        user_agent=str(sealed.get("user_agent") or ""),
    )
    _pending_pairings[request_id] = pp
    notify_pending_pairing(pp)

    if auto_approve:
        return approve_pending(conn, request_id)

    return {"request_id": request_id, "refused": "pending_approval"}


_approved_answers: list[dict] = []
_approved_answers_map: dict[str, dict] = {}


def has_pending_pairings() -> bool:
    return any(not p.expired for p in _pending_pairings.values())


def has_approved_answers() -> bool:
    return bool(_approved_answers)


def list_pending() -> list[dict[str, Any]]:
    return [
        {
            "request_id": p.request_id,
            "name": p.name,
            "role": p.role,
            "opened_at": p.opened_at,
            "ip_address": p.ip_address,
        }
        for p in _pending_pairings.values()
        if not p.expired
    ]


def consume_approved() -> list[dict]:
    global _approved_answers
    ans, _approved_answers = _approved_answers, []
    return ans


def get_pairing_status(request_id: str) -> dict | None:
    if request_id in _approved_answers_map:
        return _approved_answers_map[request_id]
    if request_id in _pending_pairings:
        p = _pending_pairings[request_id]
        if p.expired:
            _pending_pairings.pop(request_id, None)
            return {"request_id": request_id, "refused": "expired"}
        return {"request_id": request_id, "refused": "pending_approval"}
    return None


def approve_pending(
    conn: sqlite3.Connection,
    request_id: str,
    permissions: dict[str, bool] | None = None,
) -> dict | None:
    if request_id in _approved_answers_map:
        return _approved_answers_map[request_id]
    pending = _pending_pairings.pop(request_id, None)
    if pending is None or pending.expired:
        return None

    try:
        from backend.sync import project

        project.rewind(conn)
    except Exception:
        log.exception("could not rewind the publish watermarks for a new device")

    perms = dict(DEFAULT_PERMISSIONS)
    if permissions:
        perms.update(permissions)

    device, token = register(
        conn,
        name=pending.name,
        role=pending.role,
        permissions=perms,
    )
    global _open_pairing
    _open_pairing = None  # single use

    group = crypto.group_key() or crypto.create_group_key()
    nonce, ciphertext = crypto.seal(
        {
            "device_id": device.id,
            "token": token,
            "group_key": crypto.b64(group),
            "permissions": perms,
        },
        op_id=request_id, device_id="pairing", key=pending.key,
    )
    log.info("paired %s (%s) with permissions %s", device.name, device.id, perms)
    ans = {
        "request_id": request_id,
        "device_id": device.id,
        "nonce": nonce,
        "ciphertext": ciphertext,
    }
    _approved_answers.append(ans)
    _approved_answers_map[request_id] = ans
    return ans


def reject_pending(request_id: str) -> dict | None:
    if request_id in _approved_answers_map:
        return _approved_answers_map[request_id]
    pending = _pending_pairings.pop(request_id, None)
    ans = {"request_id": request_id, "refused": "rejected"}
    _approved_answers.append(ans)
    _approved_answers_map[request_id] = ans
    return ans



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
