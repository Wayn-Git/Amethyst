"""Features that switch themselves on when their inputs already exist.

`amethyst serve` used to present a machine half-dark: the bookmark watcher and the
X reader sat off by default -- correctly, because both read a person's own
browser history and sessions -- so a fresh install answered with capture paths
that were configured but inert, and the user's first hour was spent hunting for
switches. The rule this module implements instead:

    enable what every input for is already here, say so once, never ask.

The two things it touches are deliberately the ones with an objective
existence test -- a Firefox-family profile on disk, a signed-in reader's
credentials in the keychain. No feature is enabled by wishing a requirement
into being: the watcher does not turn on where no profile was found, and the
reader does not turn on without both cookies.

What it deliberately does NOT touch:

* `social.reader_fallback` (r.jina.ai) -- a privacy choice. Sending every
  unreadable URL to a third party is not something to decide on somebody's
  behalf, even when it would make captures better.
* connectors -- `_start_after_add` and the boot reconcile already handle them.
* Instagram -- needs credentials only the user has, and `instagram.enabled`
  is the explicit statement they were given.

Every change is logged, and all of it is reversible from the same CLIs that
set it by hand: `amethyst bookmarks disable`, `amethyst social deny x`.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def auto_setup() -> list[str]:
    """Turn on what can work today. Returns what changed, as sentences.

    Idempotent: a second boot finds everything already on and returns nothing,
    which is also why it can run on every `amethyst serve` without a flag. Never
    raises -- a machine where auto-setup fails is a machine that still serves.
    """
    changed: list[str] = []
    for step in (_browser_watcher, _x_reader):
        try:
            note = step()
        except Exception:
            log.exception("auto-setup step %s failed", step.__name__)
            continue
        if note:
            changed.append(note)
    return changed


def _browser_watcher() -> str | None:
    """The bookmark watcher, on when consented in app_settings and a profile is found."""
    from backend.browser.places import find_profile
    from backend.config import load_browser, save_browser
    from backend.db.connection import get_connection

    settings = load_browser()
    if settings.enabled:
        return None

    # Browser history & bookmarks reading is a privacy choice that requires consent (R15, P19).
    # On fresh machines, row is None -> Do NOT auto-enable.
    # When user opts in during setup or settings, row is '1' -> Enable.
    try:
        row = get_connection().execute(
            "SELECT value FROM app_settings WHERE key = 'browser.enabled'"
        ).fetchone()
    except Exception:
        row = None

    if row is None or str(row[0]).strip().lower() not in ("1", "true"):
        return None

    try:
        find_profile(settings.profile_dir or None)
    except Exception:
        return None

    save_browser({"enabled": True})
    return "browser capture on: consented in settings and a Firefox-family profile is on this machine"


def _x_reader() -> str | None:
    """`amethyst social allow x`, when the reader could actually run today.

    Allow-without-credentials would be a silent lie: the capture ladder would
    take the reader rung, fail, and fall through with a note that names a
    problem the user never had a chance to fix. Enabling it only when it will
    work is what keeps the allowlist a promise rather than a wish. An explicit
    deny survives reboots -- `source_denied` records the refusal as its own
    fact, because absence from the allowlist is also the never-asked state.
    """
    from backend.config import allow_source, load_social, source_denied
    from backend.web.social import missing, reader_named

    if source_denied("x"):
        return None
    settings = load_social()
    if settings.allows("x"):
        return None
    try:
        reader = reader_named("x")
    except Exception:
        return None
    if missing(reader) is not None:
        return None  # no binary, or no cookies: enabling would claim readiness
    allow_source("x", allowed=True)
    return "x reader allowed: twitter is installed and the cookies are stored"
