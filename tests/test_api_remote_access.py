"""What a caller that is not this machine can reach.

`amethyst serve --host 0.0.0.0` used to print a warning and then publish the
whole API -- the shell, the files, the mail -- on the local network. The reason
people pass that flag is that they want their phone to open Amethyst, which
means the warning was aimed squarely at the person with the best reason to
ignore it.

These pin the surface that answers a remote peer, and -- just as importantly --
that nothing changed for the loopback caller the desktop is.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import BIND_HOST_ENV, app
from backend.sync import devices

pytestmark = pytest.mark.usefixtures("amethyst_home")


@pytest.fixture
def bound_wide(monkeypatch):
    """`amethyst serve --host 0.0.0.0`, which is the only case the guard runs in.

    Bound to loopback the operating system is already the boundary and the guard
    stands down -- so a test of it has to say which server this is.
    """
    monkeypatch.setenv(BIND_HOST_ENV, "0.0.0.0")


@pytest.fixture
def local(bound_wide):
    """The desktop, on a machine that happens to be bound wide."""
    with TestClient(app, client=("127.0.0.1", 51234)) as c:
        yield c


@pytest.fixture
def remote(bound_wide):
    """A phone on the same network."""
    with TestClient(app, client=("192.168.1.50", 51234)) as c:
        yield c


def test_a_remote_caller_cannot_reach_the_api(remote):
    blocked = remote.get("/api/conversations")
    assert blocked.status_code == 403
    # 403 rather than 404: a misconfiguration should not read as a bug in the
    # client, and the message has to say what to do instead.
    assert "loopback" in blocked.json()["detail"]


def test_a_remote_caller_can_still_ask_whether_a_backend_exists(remote):
    """The interface decides whether to show the workbench or the pairing screen
    on this one call, so blocking it would make a phone unable to tell a machine
    that refuses it from one that is not there."""
    assert remote.get("/api/ping").status_code == 200


def test_loopback_is_untouched(local):
    """The desktop is the whole existing product. Nothing here may change it."""
    assert local.get("/api/conversations").status_code == 200
    assert local.get("/api/ping").status_code == 200


def test_a_loopback_bound_server_does_not_guard_at_all():
    """The default, and every other test in this suite. Nothing off-machine can
    open a socket to a loopback-bound port, so a guard here could only ever
    refuse a request that came from this machine."""
    with TestClient(app, client=("192.168.1.50", 51234)) as c:
        assert c.get("/api/conversations").status_code == 200


def test_a_remote_caller_may_complete_a_pairing_it_has_the_code_for(remote):
    """Unauthenticated by necessity -- a device with no credential is what this
    exists to give one to -- and safe because the 160-bit secret from the QR
    code is the only thing that opens the envelope."""
    secret, _ = devices.open_pairing(name_hint="a phone")
    answer = remote.post("/api/pair/claim", json=devices.build_request(secret, "a phone"))
    assert answer.status_code == 200
    opened = devices.read_response(secret, answer.json())
    assert opened["device_id"]
    assert opened["token"]
    assert opened["group_key"]


def test_a_remote_caller_with_the_wrong_code_pairs_nothing(remote):
    from backend.sync import crypto

    devices.open_pairing()
    refused = remote.post(
        "/api/pair/claim", json=devices.build_request(crypto.new_pair_secret(), "attacker")
    )
    assert refused.status_code == 404


def test_an_expired_code_says_so_rather_than_timing_out(remote):
    secret, _ = devices.open_pairing()
    devices._open_pairing.opened_at -= devices.PAIRING_TTL_SECONDS + 1
    gone = remote.post("/api/pair/claim", json=devices.build_request(secret, "late"))
    assert gone.status_code == 410


def test_a_claimed_code_is_single_use(remote):
    secret, _ = devices.open_pairing()
    first = remote.post("/api/pair/claim", json=devices.build_request(secret, "first"))
    assert first.status_code == 200
    second = remote.post("/api/pair/claim", json=devices.build_request(secret, "second"))
    assert second.status_code in (404, 410)


def test_a_remote_caller_cannot_open_the_terminal(remote):
    """The PTY is the sharpest thing on this surface. A WebSocket says no by
    closing before it accepts, which is what the client sees as a refusal
    rather than a shell."""
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with remote.websocket_connect("/api/terminal/ws"):
            pass


def test_the_desktop_can_still_open_the_terminal(local):
    with local.websocket_connect("/api/terminal/ws") as ws:
        # Whatever it says first, it accepted -- which is the difference being
        # asserted here.
        assert ws.receive_json() is not None
