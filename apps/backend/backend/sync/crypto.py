"""Sealing an op so the relay carries what it cannot read.

`relay/README.md` states the relay's security property as "a compromised relay
can lose a reel, it cannot invent one" -- authenticity without confidentiality,
which was right when the payload was Meta's own bytes arriving over a signed
webhook. Sync payloads are different: they are the user's settings, task titles
and conversation names, and a queue on someone else's computer should not be
able to read those. So ops are sealed before they leave the machine and the
relay stores opaque bytes.

One symmetric key shared by the paired devices (the "group key"), AES-256-GCM,
fresh 96-bit nonce per op. Not a ratchet and not per-pair keys: the threat here
is a compromised relay and a network observer, not one of the user's own devices
turning on another -- they are all the same person, all holding the same data
already. Forward secrecy against a stolen device is what full-disk encryption and
`amethyst device revoke` are for.

The nonce is random rather than a counter because ops are emitted from more than
one thread and a counter would have to be durably reserved before use to stay
unique across a crash. Random 96-bit nonces collide at around 2^32 messages under
one key; a personal device emits a few thousand ops a day, so the key would need
rotating in roughly a million years.

Each op is bound to its own envelope through the AEAD's associated data. The
relay stores `op_id` and `from_device` in the clear so it can dedup and route,
and binding them means a relay that moves a ciphertext onto a different op row
produces a decryption failure rather than a plausible-looking op from the wrong
device. See `docs/architecture/decisions/0024-multi-device-sync.md`.
"""

from __future__ import annotations

import base64
import json
import os
import secrets as stdlib_secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from backend.secrets import SERVICE, get_secret, set_secret

#: The keychain reference for the group key, alongside every other secret here
#: (ADR-0012). Never the config file, never the database.
GROUP_KEY_REF = f"{SERVICE}/sync-group-key"

KEY_BYTES = 32
NONCE_BYTES = 12

#: 160 bits. Long enough that the pairing secret needs no password-hardening KDF
#: and no PAKE -- the reason those exist is a secret short enough to guess, and
#: this one is carried by QR rather than typed. A six-digit code would have made
#: the relay's copy of the handshake brute-forceable offline in seconds.
PAIR_SECRET_BYTES = 20

_PAIR_INFO = b"amethyst-pair-v1"


class SealError(Exception):
    """A sealed payload did not open. Wrong key, wrong envelope, or tampering --
    deliberately not distinguished, because the caller's response to all three is
    to drop the op."""


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


# -- the group key -------------------------------------------------------

def group_key() -> bytes | None:
    """The key this device's paired group shares, or None before pairing."""
    stored = get_secret(GROUP_KEY_REF)
    if not stored:
        return None
    key = unb64(stored)
    if len(key) != KEY_BYTES:
        raise SealError(f"the stored group key is {len(key)} bytes, not {KEY_BYTES}")
    return key


def create_group_key() -> bytes:
    """Mint the group key. Called once, by the first host to enable sync."""
    key = AESGCM.generate_key(bit_length=KEY_BYTES * 8)
    set_secret(GROUP_KEY_REF, b64(key))
    return key


def adopt_group_key(key: bytes) -> None:
    """Store a key handed over during pairing."""
    if len(key) != KEY_BYTES:
        raise SealError(f"a group key is {KEY_BYTES} bytes, not {len(key)}")
    set_secret(GROUP_KEY_REF, b64(key))


# -- sealing -------------------------------------------------------------

def aad(op_id: str, device_id: str) -> bytes:
    """What the ciphertext is bound to: its own row at the relay."""
    return f"{op_id}\x00{device_id}".encode()


def seal(payload: dict, *, op_id: str, device_id: str, key: bytes) -> tuple[str, str]:
    """Returns (nonce, ciphertext), both base64. Compact JSON so the bytes a
    given payload produces do not depend on how it was formatted."""
    nonce = os.urandom(NONCE_BYTES)
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ct = AESGCM(key).encrypt(nonce, raw, aad(op_id, device_id))
    return b64(nonce), b64(ct)


def unseal(nonce: str, ciphertext: str, *, op_id: str, device_id: str, key: bytes) -> dict:
    try:
        raw = AESGCM(key).decrypt(unb64(nonce), unb64(ciphertext), aad(op_id, device_id))
    except (InvalidTag, ValueError, TypeError) as exc:
        raise SealError("this payload did not open under the group key") from exc
    try:
        opened = json.loads(raw)
    except ValueError as exc:
        raise SealError("a sealed payload opened but was not JSON") from exc
    if not isinstance(opened, dict):
        raise SealError("a sealed payload opened but was not an object")
    return opened


# -- pairing -------------------------------------------------------------

def new_pair_secret() -> str:
    """The secret a QR code carries. Base32 because it survives being read
    aloud and retyped when a camera will not focus."""
    return base64.b32encode(stdlib_secrets.token_bytes(PAIR_SECRET_BYTES)).decode("ascii").rstrip("=")


def pair_key(pair_secret: str) -> bytes:
    """The key both sides of a pairing derive from the shared secret.

    HKDF rather than PBKDF2 or scrypt on purpose: those exist to slow an attacker
    guessing a *low-entropy* secret, and this one has 160 bits. Stretching it
    would cost a second of phone battery and buy nothing.

    No salt, because there is nothing to salt against -- the secret is single
    use, lives five minutes, and is never stored.
    """
    return HKDF(
        algorithm=hashes.SHA256(), length=KEY_BYTES, salt=None, info=_PAIR_INFO
    ).derive(pair_secret.encode())
