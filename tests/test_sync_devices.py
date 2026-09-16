"""Device registration and pairing.

ADR-0011 left this deliberately unbuilt, so there is no prior behaviour to
preserve -- what these tests pin down is the two properties the design claims:
a device can be revoked without disturbing the others, and the relay never sees
anything it could pair with or impersonate.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.sync import crypto, devices

SCHEMA = Path(__file__).resolve().parents[1] / "backend" / "db" / "schema.sql"


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _clean_module_state(monkeypatch, tmp_path):
    """Pairing state and the failure window are process globals, and the group
    key lives in the keychain -- which a test must not touch."""
    devices.close_pairing()
    devices._failures.clear()
    store = {}
    monkeypatch.setattr(crypto, "get_secret", lambda ref: store.get(ref))
    monkeypatch.setattr(crypto, "set_secret", lambda ref, value: store.__setitem__(ref, value))
    yield
    devices.close_pairing()
    devices._failures.clear()


# -- identity ------------------------------------------------------------

def test_this_device_keeps_one_id_across_calls(conn):
    """Every HLC stamp carries this id. A device that reminted it would
    tie-break against its own earlier writes as if it were another device."""
    first = devices.local_id(conn, name="laptop")
    assert first and devices.local_id(conn) == first


def test_the_device_id_is_not_on_the_sync_allowlist():
    from backend.sync import registry
    assert not registry.syncable(registry.ENTITIES["settings"], devices.DEVICE_ID_KEY)


# -- the registry --------------------------------------------------------

def test_a_registered_device_authenticates_with_its_token(conn):
    device, token = devices.register(conn, "phone")
    got = devices.authenticate(conn, token)
    assert got is not None and got.id == device.id


def test_the_token_itself_is_never_stored(conn):
    """A stolen database must authenticate as nobody."""
    _, token = devices.register(conn, "phone")
    stored = conn.execute("SELECT token_hash FROM devices").fetchone()[0]
    assert token not in stored
    assert stored == devices._hash(token)


def test_revoking_one_device_leaves_the_others(conn):
    phone, phone_token = devices.register(conn, "phone")
    laptop, laptop_token = devices.register(conn, "laptop", role="host")

    assert devices.revoke(conn, phone.id) is True
    assert devices.authenticate(conn, phone_token) is None
    assert devices.authenticate(conn, laptop_token) is not None
    assert [d.id for d in devices.live(conn)] == [laptop.id]


def test_revoking_twice_reports_that_it_did_nothing(conn):
    phone, _ = devices.register(conn, "phone")
    assert devices.revoke(conn, phone.id) is True
    assert devices.revoke(conn, phone.id) is False


def test_a_revoked_device_is_kept_as_a_tombstone(conn):
    phone, _ = devices.register(conn, "phone")
    devices.revoke(conn, phone.id)
    assert conn.execute("SELECT count(*) FROM devices").fetchone()[0] == 1


def test_an_unknown_token_authenticates_as_nobody(conn):
    devices.register(conn, "phone")
    assert devices.authenticate(conn, "not-a-real-token") is None
    assert devices.authenticate(conn, "") is None


def test_guessing_is_rate_limited(conn):
    _, token = devices.register(conn, "phone")
    for _ in range(devices.MAX_FAILURES):
        devices.authenticate(conn, "wrong")
    assert devices.authenticate(conn, token) is None, "the window shuts for everyone"


def test_the_relay_mirror_carries_hashes_not_tokens(conn):
    """The relay must recognise a device without being able to become one."""
    _, token = devices.register(conn, "phone")
    mirrored = devices.mirror(conn)
    assert len(mirrored) == 1
    assert token not in repr(mirrored)
    assert mirrored[0]["token_hash"] == devices._hash(token)


def test_a_revoked_device_leaves_the_mirror(conn):
    phone, _ = devices.register(conn, "phone")
    devices.revoke(conn, phone.id)
    assert devices.mirror(conn) == []


def test_a_role_that_is_not_a_role_is_refused(conn):
    with pytest.raises(ValueError):
        devices.register(conn, "phone", role="admin")


# -- pairing -------------------------------------------------------------

def test_a_pairing_round_trip_hands_over_the_group_key(conn):
    secret, payload = devices.open_pairing()
    assert secret in payload

    request = devices.build_request(secret, name="my phone")
    response = devices.accept(conn, request)
    assert response is not None

    opened = devices.read_response(secret, response)
    assert opened["device_id"] == devices.live(conn)[0].id
    assert crypto.unb64(opened["group_key"]) == crypto.group_key()
    assert devices.authenticate(conn, opened["token"]) is not None


def test_the_relay_sees_nothing_it_could_pair_with(conn):
    """Everything crossing the wire is sealed under a key derived from a secret
    that only the two devices ever hold."""
    secret, _ = devices.open_pairing()
    request = devices.build_request(secret, name="my phone")
    assert secret not in repr(request)

    response = devices.accept(conn, request)
    token = devices.read_response(secret, response)["token"]
    assert secret not in repr(response) and token not in repr(response)


def test_the_wrong_secret_pairs_nothing(conn):
    devices.open_pairing()
    assert devices.accept(conn, devices.build_request(crypto.new_pair_secret(), "attacker")) is None
    assert devices.live(conn) == []


def test_a_code_is_single_use(conn):
    secret, _ = devices.open_pairing()
    assert devices.accept(conn, devices.build_request(secret, "first")) is not None
    assert devices.accept(conn, devices.build_request(secret, "second")) is None
    assert len(devices.live(conn)) == 1


def test_an_expired_code_pairs_nothing(conn):
    secret, _ = devices.open_pairing()
    devices._open_pairing.opened_at -= devices.PAIRING_TTL_SECONDS + 1
    assert devices.accept(conn, devices.build_request(secret, "late")) is None
    assert devices.live(conn) == []


def test_asking_for_a_new_code_retires_the_old_one(conn):
    stale, _ = devices.open_pairing()
    devices.open_pairing()
    assert devices.accept(conn, devices.build_request(stale, "stale")) is None


def test_pairing_with_no_code_open_does_nothing(conn):
    assert devices.accept(conn, devices.build_request(crypto.new_pair_secret(), "x")) is None


def test_a_tampered_pairing_request_is_refused(conn):
    """The envelope is bound to its own request id, so a relay that edits the
    routing cannot leave the payload usable."""
    secret, _ = devices.open_pairing()
    request = devices.build_request(secret, name="my phone")
    request["request_id"] = "a-different-request"
    assert devices.accept(conn, request) is None


def test_junk_offers_do_not_lock_out_a_real_one(conn):
    """The relay takes an offer from anyone, so a stranger can post whatever they
    like. If that counted toward the failure window, ten HTTP requests would shut
    pairing for everyone for five minutes -- a denial of service for the price of
    a loop. A 160-bit secret does not need guess-rate limiting."""
    secret, _ = devices.open_pairing()
    for _ in range(devices.MAX_FAILURES * 2):
        assert devices.accept(conn, devices.build_request(crypto.new_pair_secret(), "junk")) is None

    answer = devices.accept(conn, devices.build_request(secret, "the real one"))
    assert answer is not None, "the legitimate offer must still be accepted"
    assert devices.read_response(secret, answer)["device_id"] == devices.live(conn)[0].id


def test_token_guessing_is_still_rate_limited(conn):
    """The window stays where a guess is actually conceivable."""
    _, token = devices.register(conn, "phone")
    for _ in range(devices.MAX_FAILURES):
        devices.authenticate(conn, "wrong")
    assert devices.authenticate(conn, token) is None


def test_a_second_device_joins_the_same_group(conn):
    """The point of the group key: both paired devices can open each other's
    ops, so a third pairing does not fork the group."""
    first_secret, _ = devices.open_pairing()
    first = devices.read_response(first_secret, devices.accept(conn, devices.build_request(first_secret, "phone")))
    second_secret, _ = devices.open_pairing()
    second = devices.read_response(second_secret, devices.accept(conn, devices.build_request(second_secret, "tablet")))
    assert first["group_key"] == second["group_key"]
    assert first["device_id"] != second["device_id"]
    assert first["token"] != second["token"]
