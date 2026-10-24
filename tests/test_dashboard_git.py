"""Real disposable Git repositories; all remote probes are local files."""

import subprocess

import pytest

from backend.dashboard import git
from backend.dashboard.store import settings_write


def command(path, *args):
    return (
        subprocess.check_output(["git", *args], cwd=path, stderr=subprocess.DEVNULL)
        .decode()
        .strip()
    )


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repository"
    root.mkdir()
    command(root, "init", "-b", "main")
    command(root, "config", "user.name", "Fixture")
    command(root, "config", "user.email", "fixture@example.invalid")
    (root / "fixture.txt").write_text("fixture")
    command(root, "add", ".")
    command(root, "commit", "-m", "fixture")
    remote = tmp_path / "remote.git"
    command(tmp_path, "init", "--bare", str(remote))
    command(root, "remote", "add", "origin", str(remote))
    command(root, "push", "-u", "origin", "main")
    return root


async def test_backup_real_remote_push_evidence_missing_and_empty(db, repo):
    assert await git.provide("dev.backup") == {"items": [], "repos": []}
    settings_write("dev.backup", {"repos": [str(repo), str(repo / "missing")]})
    data = await git.provide("dev.backup")
    item, missing = data["items"]
    assert item["local_clone"] and item["remotes"][0]["reachable"] is True
    assert item["remotes"][0]["last_push"] is not None
    assert "Only one remote" in item["warnings"]
    assert not missing["local_clone"]
    assert "No readable local clone" in missing["warnings"]


def test_paths_and_remote_redaction():
    with pytest.raises(ValueError):
        git.RepoSettings(repos=["relative"])
    with pytest.raises(ValueError):
        git.RepoSettings(repos=["/tmp/one\n/tmp/two"])
    assert (
        git.public_remote("https://user:password@example.invalid/r.git?token=secret")
        == "https://example.invalid/r.git"
    )
