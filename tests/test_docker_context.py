"""The invariant behind the container image: no personal state in a layer, and
no secret in the repository.

These run rather than being remembered because both failure modes are silent.
A file that slips past `.dockerignore` ships inside the image for as long as the
image exists; a client secret pasted into `catalogue.py` is published to the
world the moment it is pushed. Neither shows up in a review diff as anything
unusual.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from backend.mcp import catalogue as cat

ROOT = Path(__file__).resolve().parents[1]

# The `.dockerignore` patterns this test asserts. Anything personal that can
# exist inside the repo directory during a build must appear here or it will
# ride along in the context.
REQUIRED_PATTERNS = [
    ".env",
    "data/",
    ".amethyst/",
    "**/secrets.json",
    "**/amethyst.db",
    "**/amethyst.db-*",
    "**/providers.yaml",
    "**/mcp.yaml",
    "**/.google_workspace_mcp/",
    "**/.spotify-mcp/",
    "**/.linkedin-mcp/",
    "**/token-cache.json",
    "**/credentials/",
    "*.pem",
    "*.key",
    ".venv/",
    ".git/",
    "frontend/dist/",
]

# Files that must never be tracked, wherever they appear in the tree. The names
# match the `.dockerignore` safety block on purpose: one list for two doors,
# because git and docker are two ways the same file leaves this machine.
UNTRACKABLE = [
    "amethyst.db",
    "amethyst.db-wal",
    "amethyst.db-shm",
    "secrets.json",
    "providers.yaml",
    "mcp.yaml",
    "token-cache.json",
    "credentials",
]

# Fixture trees and the test database legitimately carry these names.
NOT_REALLY_PERSONAL = re.compile(r"^(tests/|\.venv/|\.git/)")


def test_dockerignore_has_every_safety_pattern():
    text = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    lines = {
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    }
    missing = [p for p in REQUIRED_PATTERNS if p not in lines]
    assert not missing, f".dockerignore is missing: {missing}"


def test_personal_files_are_git_ignored():
    """Every match in the tree is ignored by git or the pattern list is wrong.

    Walks the whole tree, so a `amethyst.db` copied in to debug something fails
    here rather than in an image built a week later.
    """
    leaked = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if NOT_REALLY_PERSONAL.match(rel):
            continue
        name = path.name
        if name in UNTRACKABLE or (name.endswith(".pem") or name.endswith(".key")):
            ignored = subprocess.run(
                ["git", "check-ignore", "-q", rel], cwd=ROOT
            ).returncode
            tracked = subprocess.run(
                ["git", "ls-files", "--error-unmatch", rel],
                cwd=ROOT,
                capture_output=True,
            ).returncode
            if ignored != 0 or tracked == 0:
                leaked.append(rel)
    assert not leaked, f"personal state is not ignored: {leaked}"


def test_default_client_fields_carry_names_not_values():
    """A default is the NAME of an environment variable, never a credential.

    A literal client id pasted into the catalogue would pass every other check:
    it imports, it resolves, and it works -- right up until the repository is
    pushed and the registration is public. The pattern is the rule, because a
    reviewer cannot tell a real client id from a placeholder.
    """
    for entry in cat.CATALOGUE:
        if entry.default_client_id_env:
            assert re.fullmatch(
                r"AMETHYST_DEFAULT_[A-Z0-9_]+", entry.default_client_id_env
            ), f"{entry.id}: {entry.default_client_id_env} is not an env-var name"
            if entry.default_client_secret_env:
                assert re.fullmatch(
                    r"AMETHYST_DEFAULT_[A-Z0-9_]+", entry.default_client_secret_env
                ), f"{entry.id}: {entry.default_client_secret_env} is not an env-var name"
            # An api_key_ref connector is metered per user; a shared one spends
            # the owner's quota, and defaulting it is not sharing, it is
            # donating.
            assert entry.api_key_ref is None, f"{entry.id}: defaults and API keys do not mix"
        else:
            assert entry.default_client_secret_env is None, (
                f"{entry.id}: a default secret with no id cannot exist"
            )


def test_default_client_absent_when_environment_empty(monkeypatch):
    for var in (
        "AMETHYST_DEFAULT_GOOGLE_CLIENT_ID",
        "AMETHYST_DEFAULT_GOOGLE_CLIENT_SECRET",
    ):
        monkeypatch.delenv(var, raising=False)
    entry = cat.get("google-workspace")
    if entry is None:
        pytest.skip("no google-workspace entry in this catalogue")
    assert cat.default_client(entry) == (None, None)


def test_default_client_needs_an_id(monkeypatch):
    """A secret alone is not a default. Half a credential that cannot work is
    worse than a missing one, because the failure appears at the provider as a
    message about an unknown client rather than about the missing half."""
    monkeypatch.setenv("AMETHYST_DEFAULT_GOOGLE_CLIENT_SECRET", "a-secret")
    monkeypatch.delenv("AMETHYST_DEFAULT_GOOGLE_CLIENT_ID", raising=False)
    entry = cat.get("google-workspace")
    if entry is None:
        pytest.skip("no google-workspace entry in this catalogue")
    assert cat.default_client(entry) == (None, None)
