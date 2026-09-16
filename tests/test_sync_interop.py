"""The browser and the machine must seal for each other, exactly.

`frontend/src/lib/sync/crypto.js` and `backend/sync/crypto.py` are two
implementations of one format. Nothing else in either test suite would notice
them drifting apart: each is internally consistent, each round-trips its own
output, and the failure only appears as a phone that receives nothing and says
nothing about why.

The first version of the JavaScript half failed exactly like that. It used
`JSON.stringify(payload, Object.keys(payload).sort())` to sort keys, not knowing
that an array in that position is a recursive key *allowlist* -- so every op it
produced carried `"fields": {}`. It sealed, it opened, it looked perfect, and it
transmitted nothing. This file is what caught it.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.sync import crypto

BRIDGE = Path(__file__).parent / "support" / "sync_interop.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="the browser half needs node to run"
)

PAYLOAD = {
    "hlc": "0000000001000:000000:dev-a",
    "entity": "settings",
    "key": "ui.theme",
    # Nested and mixed on purpose: the bug this file exists for only showed up
    # below the top level.
    "fields": {"value": "nocturne", "nested": {"z": 1, "a": [1, "two", None]}},
}


def node(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(BRIDGE), *args], capture_output=True, text=True, timeout=60
    )


@pytest.fixture
def key() -> bytes:
    return os.urandom(crypto.KEY_BYTES)


def test_the_machine_seals_and_the_browser_opens(key):
    nonce, ciphertext = crypto.seal(PAYLOAD, op_id="op-1", device_id="phone", key=key)
    result = node("open", crypto.b64(key), nonce, ciphertext, "op-1", "phone")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == PAYLOAD


def test_the_browser_seals_and_the_machine_opens(key):
    result = node("seal", crypto.b64(key), json.dumps(PAYLOAD), "op-2", "laptop")
    assert result.returncode == 0, result.stderr
    sealed = json.loads(result.stdout)
    opened = crypto.unseal(
        sealed["nonce"], sealed["ciphertext"], op_id="op-2", device_id="laptop", key=key
    )
    assert opened == PAYLOAD


def test_both_sides_derive_the_same_pairing_key():
    """If these disagree, pairing does not fail -- it hangs, because each side is
    waiting for a message the other sealed under a key it does not have."""
    secret = crypto.new_pair_secret()
    result = node("pairkey", secret)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == crypto.b64(crypto.pair_key(secret))


def test_the_browser_refuses_an_op_bound_to_another_envelope(key):
    """The associated data has to be built identically too, or the binding is
    only enforced on one side."""
    nonce, ciphertext = crypto.seal(PAYLOAD, op_id="op-1", device_id="phone", key=key)
    assert node("open", crypto.b64(key), nonce, ciphertext, "op-WRONG", "phone").returncode != 0
    assert node("open", crypto.b64(key), nonce, ciphertext, "op-1", "somebody-else").returncode != 0


def test_the_browser_refuses_the_wrong_key(key):
    nonce, ciphertext = crypto.seal(PAYLOAD, op_id="op-1", device_id="phone", key=key)
    other = crypto.b64(os.urandom(crypto.KEY_BYTES))
    assert node("open", other, nonce, ciphertext, "op-1", "phone").returncode != 0
