"""Reading the sites that refuse anonymous readers.

Reddit, X and their neighbours are not readable the way an article is. Measured
on 2026-09-05, on this machine: a direct fetch of a Reddit permalink returns
**403**, `r.jina.ai` in front of it returns **403**, and every user agent --
an honest one, curl, a real Firefox string -- is refused once the IP is seen.
Agent-Reach's own Reddit module reaches the same conclusion independently:
"there is NO zero-config path. Anonymous .json endpoints are blocked (403
anti-bot, all variants), and the official API closed self-service registration
in 2025-11."

So the only thing that reads them is a logged-in session, and the tools that
hold one already exist: `rdt-cli` for Reddit, `twitter-cli` for X. **AMETHYST routes
to them rather than reimplementing them.** Writing a Reddit client here would
mean owning an arms race against an anti-bot team, and losing it quietly some
Tuesday.

What this module is, therefore, is a **dispatch table and a contract** --
`convert.py`'s arrangement, for the same reasons. One signature, a table saying
which reader owns which host, credentials injected through the environment
rather than argv, and a **named** failure when a reader is absent: "reading
reddit.com needs rdt-cli, which is not installed here" is a sentence somebody
can act on, and a FileNotFoundError is not.

Two rules that are not negotiable and are enforced below:

* **A host must be on the allowlist.** These readers act as the signed-in user.
  A tool that does that for any URL it is handed is a tool that browses as you
  wherever a link leads, so the site has to be one the user named.
* **Credentials never appear in argv.** `/proc` is world-readable on Linux and
  every process on the machine can read another's command line. They go in the
  environment of the one subprocess that needs them.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shlex
import shutil
from dataclasses import dataclass
from urllib.parse import urlparse

from backend.security.sandbox import SandboxPolicy, wrap_command

log = logging.getLogger(__name__)

#: Long enough for a thread with a thousand comments, short enough that a reader
#: waiting on a login prompt is noticed rather than hanging the turn.
DEFAULT_TIMEOUT_S = 90

#: Truncation guard. A busy subreddit thread is genuinely enormous, and the
#: model pays for every character of it.
MAX_OUTPUT_CHARS = 60_000


class SocialError(RuntimeError):
    """The site could not be read. Carries a sentence fit to show someone."""


@dataclass(frozen=True)
class Reader:
    """One upstream CLI, and everything needed to call it or explain its absence."""

    source: str
    #: The executable, looked up on PATH. Absence is a named failure, not a crash.
    binary: str
    hosts: tuple[str, ...]
    #: argv builders. `read` takes the URL; `search` takes the query and a limit.
    read: tuple[str, ...]
    search: tuple[str, ...]
    #: The package to install, and what it is called to pip-style installers.
    #: The command is composed by `install_line` rather than stored, so the
    #: sentence names an installer this machine actually has.
    package: str
    #: How it is signed in, said plainly, because "not installed" and "installed
    #: but signed out" need different actions from the user.
    sign_in: str
    #: Keychain refs whose values are exported into the subprocess environment.
    #: Empty when the reader keeps its own session on disk, as rdt-cli does.
    credentials: tuple[tuple[str, str], ...] = ()


READERS: tuple[Reader, ...] = (
    Reader(
        source="reddit",
        binary="rdt",
        hosts=("reddit.com", "redd.it"),
        # `rdt read` wants the post id, not the URL. `_post_id` below pulls it
        # out of the permalink, which is the form anybody actually has.
        read=("rdt", "read", "{id}"),
        search=("rdt", "search", "{query}", "-n", "{limit}"),
        # PyPI's rdt-cli lags the git tree; the guide installs from git for
        # that reason, and so does this.
        package="git+https://github.com/public-clis/rdt-cli.git",
        sign_in="rdt login",
    ),
    Reader(
        source="x",
        binary="twitter",
        hosts=("x.com", "twitter.com", "mobile.twitter.com"),
        # twitter-cli 0.8.5 has no `thread` command -- `tweet` takes a URL or
        # a bare id and prints the post with its replies, which is the same
        # thing under the name it actually shipped with. `--compact` is the
        # LLM-friendly output its own help recommends.
        read=("twitter", "--compact", "tweet", "{url}"),
        search=("twitter", "--compact", "search", "{query}", "-n", "{limit}"),
        package="twitter-cli",
        sign_in=(
            "store the two cookies from a signed-in browser with:"
            " amethyst social credentials --x-auth-token ... --x-ct0 ..."
        ),
        # twitter-cli reads only the environment -- its own guide says so
        # explicitly, and warns against relying on it to read a browser.
        credentials=(
            ("TWITTER_AUTH_TOKEN", "amethyst/x_auth_token"),
            ("TWITTER_CT0", "amethyst/x_ct0"),
        ),
    ),
)

_BY_SOURCE = {reader.source: reader for reader in READERS}


def _host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def reader_for(url: str) -> Reader | None:
    """Which reader owns this URL, or None when an ordinary fetch will do."""
    host = _host(url)
    for reader in READERS:
        if any(host == h or host.endswith(f".{h}") for h in reader.hosts):
            return reader
    return None


def reader_named(source: str) -> Reader:
    reader = _BY_SOURCE.get((source or "").strip().lower())
    if reader is None:
        raise SocialError(
            f"unknown source {source!r}. This reads: {', '.join(sorted(_BY_SOURCE))}."
        )
    return reader


def _post_id(url: str) -> str | None:
    """The id out of a Reddit permalink -- `/r/webdev/comments/143acrg/slug/`."""
    parts = [p for p in urlparse(url).path.split("/") if p]
    if "comments" in parts:
        index = parts.index("comments")
        if index + 1 < len(parts):
            return parts[index + 1]
    return None


def install_line(reader: Reader) -> str:
    """How to install this reader, naming an installer this machine has.

    `convert.py` says install lines should be "the honest common denominator" --
    the command somebody would actually type. Telling a machine with `uv` and no
    `pipx` to run pipx is one more thing for them to work out, so the sentence
    names whichever is here and falls back to the documented one.
    """
    if shutil.which("uv"):
        return f"uv tool install {shlex.quote(reader.package)}"
    if shutil.which("pipx"):
        return f"pipx install {shlex.quote(reader.package)}"
    return f"pipx install {shlex.quote(reader.package)}  (pipx is not installed here either)"


def missing(reader: Reader) -> str | None:
    """Why this reader cannot run, or None. Checked before any work."""
    if shutil.which(reader.binary) is None:
        return (
            f"reading {reader.hosts[0]} needs {reader.binary}, which is not installed here."
            f" Install it with: {install_line(reader)}"
        )
    if reader.credentials and not _credentials(reader):
        return (
            f"{reader.binary} is installed but has no signed-in session, and"
            f" {reader.hosts[0]} does not answer anonymous readers. To sign in: {reader.sign_in}"
        )
    return None


def _credentials(reader: Reader) -> dict[str, str]:
    """The reader's secrets, from the keychain. Empty when any is missing."""
    from backend.secrets import get_secret

    found: dict[str, str] = {}
    for variable, ref in reader.credentials:
        value = get_secret(ref)
        if not value:
            return {}
        found[variable] = value
    return found


def _argv(template: tuple[str, ...], **values: str) -> list[str]:
    return [part.format(**values) for part in template]


async def _run(reader: Reader, argv: list[str], *, workspace: str) -> str:
    """One reader, through the sandbox, with its credentials in the environment.

    argv is joined by shlex exactly once, here, so a query containing a quote is
    an argument rather than a second command -- `convert.py`'s arrangement, and
    the reason a search for `"; rm -rf ~"` is a search.
    """
    command = shlex.join(argv)
    wrapped, _backend = wrap_command(command, SandboxPolicy.load(), workspace)

    environment = {**os.environ, "AMETHYST": "1", **_credentials(reader)}
    try:
        process = await asyncio.create_subprocess_exec(
            *wrapped,
            cwd=workspace,
            env=environment,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise SocialError(f"could not start {reader.binary}: {exc}") from exc

    try:
        out, err = await asyncio.wait_for(process.communicate(), timeout=DEFAULT_TIMEOUT_S)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise SocialError(
            f"{reader.binary} did not answer within {DEFAULT_TIMEOUT_S}s and was stopped."
            " These readers open a real session; if it is waiting on a login, run"
            f" `{reader.sign_in}` yourself once."
        ) from exc
    except asyncio.CancelledError:
        process.kill()
        with contextlib.suppress(Exception):
            await process.wait()
        raise

    text = out.decode("utf-8", errors="replace").strip()
    if process.returncode != 0:
        detail = (err.decode(errors="replace") or "").strip().splitlines()
        reason = detail[-1] if detail else f"{reader.binary} exited {process.returncode}"
        raise SocialError(f"{reader.binary} could not read that: {reason}")
    if not text:
        raise SocialError(f"{reader.binary} returned nothing for that request")

    if len(text) > MAX_OUTPUT_CHARS:
        text = text[:MAX_OUTPUT_CHARS] + f"\n\n[truncated at {MAX_OUTPUT_CHARS:,} characters]"
    return text


async def read(url: str, *, workspace: str, allowed: tuple[str, ...]) -> tuple[str, Reader]:
    """One post or thread, as the reader prints it."""
    reader = reader_for(url)
    if reader is None:
        raise SocialError(
            f"{_host(url) or 'that'} is not one of the sites this reads. It reads:"
            f" {', '.join(sorted(_BY_SOURCE))}. Ordinary pages go through fetch_url."
        )
    _require_allowed(reader, allowed)

    # What the link is gets asked before what the machine has. The other order
    # tells someone to install rdt-cli when the real answer is that they handed
    # over a subreddit rather than a post -- a true sentence about the wrong
    # thing, and `convert.py` rejected that ordering for the same reason.
    values = {"url": url}
    if "{id}" in "".join(reader.read):
        post = _post_id(url)
        if not post:
            raise SocialError(
                f"that is a {reader.source} link but not a post -- there is no post id in it."
                f" Give the permalink of a post, or search {reader.source} instead."
            )
        values["id"] = post

    refusal = missing(reader)
    if refusal:
        raise SocialError(refusal)
    return await _run(reader, _argv(reader.read, **values), workspace=workspace), reader


async def search(
    source: str, query: str, *, limit: int, workspace: str, allowed: tuple[str, ...]
) -> tuple[str, Reader]:
    reader = reader_named(source)
    _require_allowed(reader, allowed)

    query = (query or "").strip()
    if not query:
        raise SocialError("searching needs something to search for")

    refusal = missing(reader)
    if refusal:
        raise SocialError(refusal)
    argv = _argv(reader.search, query=query, limit=str(max(1, min(int(limit), 50))))
    return await _run(reader, argv, workspace=workspace), reader


def _require_allowed(reader: Reader, allowed: tuple[str, ...]) -> None:
    """These readers act as the signed-in user, so the user names the sites.

    Not a setting with a sensible default: the difference between "read this
    subreddit" and "read anything anywhere as me" is the whole question, and it
    is not one to answer on somebody's behalf.
    """
    if reader.source not in allowed:
        raise SocialError(
            f"{reader.source} is not on the allowed list. These readers act as the"
            " signed-in you, so each site is turned on deliberately:"
            f" amethyst social allow {reader.source}"
        )
