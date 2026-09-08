"""Features that switch themselves on when their inputs already exist.

The contract worth pinning: auto-setup enables only what can actually work,
says what it changed, and touches nothing it has no objective existence test
for. Mutation checks name the exact way back in for each half.
"""

from __future__ import annotations

from pathlib import Path

from backend.runtime.autostart import auto_setup


def _profile(tmp_path: Path) -> Path:
    """A Firefox-shaped profile directory, with the places file it is found by."""
    root = tmp_path / "profiles" / "Default"
    root.mkdir(parents=True)
    (root / "places.sqlite").write_bytes(b"")
    return root.parent


def test_the_bookmark_watcher_switches_on_when_a_profile_exists(
    amethyst_home, monkeypatch, tmp_path
):
    from backend.browser import places
    from backend.config import load_browser

    monkeypatch.setattr(places, "PROFILE_ROOTS", [str(_profile(tmp_path))])

    changed = auto_setup()

    assert load_browser().enabled, "a profile on disk should switch the watcher on"
    assert any("browser capture on" in c for c in changed)


def test_no_profile_means_no_watcher(amethyst_home, monkeypatch, tmp_path):
    """Mutation check: flip the existence test and this enables it anyway,
    which would put a never-firing loop on machines with nothing to read."""
    from backend.config import load_browser, save_browser

    save_browser({"enabled": False})
    empty = tmp_path / "nothing"
    empty.mkdir()
    monkeypatch.setattr("backend.browser.places.PROFILE_ROOTS", [str(empty)])

    auto_setup()

    assert not load_browser().enabled


def test_a_disabled_watcher_survives_a_reboot(amethyst_home, monkeypatch, tmp_path):
    """The user's off wins. Auto-setup enables only where no opinion exists;
    mutation check: read `enabled` instead of the settings row and this
    re-enables on every boot, taking back the user's choice."""
    from backend.browser import places
    from backend.config import load_browser, save_browser

    monkeypatch.setattr(places, "PROFILE_ROOTS", [str(_profile(tmp_path))])
    save_browser({"enabled": True})
    save_browser({"enabled": False})  # the user's explicit off

    changed = auto_setup()

    assert not load_browser().enabled, "a reboot must not re-enable a choice"
    assert not any("browser capture" in c for c in changed)


def test_the_x_reader_needs_both_the_binary_and_the_cookies(amethyst_home, monkeypatch):
    """Mutation check: drop the `missing(reader)` guard and this allows x on a
    machine with nothing but the catalogue entry, putting a broken rung at the
    top of the capture ladder."""
    from backend.config import load_social

    # No twitter binary on PATH in a test environment, and no cookies stored.
    monkeypatch.delenv("TWITTER_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWITTER_CT0", raising=False)

    auto_setup()

    assert not load_social().allows("x"), "allowing without credentials would be a lie"


def test_a_denied_reader_survives_a_reboot(amethyst_home, monkeypatch):
    """`amethyst social deny x` is a refusal, not merely an empty allowlist.
    Mutation check: drop the `source_denied` check and the next boot re-allows
    exactly what the user refused."""
    from backend.config import allow_source, load_social
    from backend.secrets import set_secret

    monkeypatch.setattr("backend.web.social.missing", lambda r: None)
    monkeypatch.setattr("backend.web.social.shutil.which", lambda b: "/usr/bin/twitter")
    set_secret("amethyst/x_auth_token", "a-cookie")
    set_secret("amethyst/x_ct0", "another-cookie")

    allow_source("x", allowed=True)
    allow_source("x", allowed=False)  # the user's refusal

    changed = auto_setup()

    assert not load_social().allows("x"), "a deny must survive the next boot"
    assert not any("x reader" in c for c in changed)


def test_auto_setup_is_idempotent(amethyst_home, monkeypatch, tmp_path):
    """Second run finds everything settled and says nothing. Mutation check:
    make a step unconditionally enable and this fails on the second pass."""
    from backend.browser import places

    monkeypatch.setattr(places, "PROFILE_ROOTS", [str(_profile(tmp_path))])

    first = auto_setup()
    second = auto_setup()

    assert second == [], f"second boot should change nothing, changed: {second}"
    assert first  # and the first one did do the work
