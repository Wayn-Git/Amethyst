"""Reading the sites that refuse anonymous readers, and rendering the ones that stall.

Every test names the mutation that makes it fail.

No reader CLI is run here, and none needs to be installed for this to pass --
`test_convert.py` set that precedent explicitly ("The engines are not run
here"). What is worth locking down is the routing, the order the checks happen
in, the fact that credentials never reach a command line, and the sentence a
missing reader produces.
"""

from __future__ import annotations

import pytest

from backend.config import allow_source, load_social, save_social
from backend.web import social
from backend.web.jina import _split, fetch_rendered
from backend.web.social import READERS, SocialError, install_line, read, reader_for, search

ALL = tuple(reader.source for reader in READERS)


@pytest.fixture
def ready(monkeypatch):
    """Both readers installed and signed in, so the tests past the gate can run."""
    monkeypatch.setattr(social.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(social, "_credentials", lambda reader: {"TWITTER_AUTH_TOKEN": "t"})
    return True


# ------------------------------------------------------------------ routing


@pytest.mark.parametrize(
    ("url", "source"),
    [
        ("https://www.reddit.com/r/webdev/comments/143acrg/x/", "reddit"),
        ("https://old.reddit.com/r/webdev/comments/143acrg/x/", "reddit"),
        ("https://redd.it/143acrg", "reddit"),
        ("https://x.com/someone/status/123", "x"),
        ("https://twitter.com/someone/status/123", "x"),
    ],
)
def test_each_host_routes_to_the_reader_that_owns_it(url, source):
    """Routing by host, not by a list of URL shapes: a site changes its paths far
    more often than it changes its domain.

    Mutation check: match on the full hostname without the subdomain rule.
    """
    assert reader_for(url).source == source


def test_an_ordinary_page_has_no_reader():
    """The absence is what tells `fetch_url` this is still its job.

    Mutation check: return the first reader when nothing matches.
    """
    assert reader_for("https://example.com/an-article") is None


def test_a_lookalike_domain_does_not_match():
    """`notreddit.com` ends with the same letters and is not Reddit. Sending a
    session there is the failure this prevents.

    Mutation check: use `host.endswith(h)` without the leading dot.
    """
    assert reader_for("https://notreddit.com/r/x/comments/1/y/") is None


def test_the_post_id_comes_out_of_a_permalink():
    """`rdt read` wants an id; a permalink is what anybody actually has.

    Mutation check: take the last path segment instead of the one after
    'comments'.
    """
    assert social._post_id("https://www.reddit.com/r/webdev/comments/143acrg/slug/") == "143acrg"
    assert social._post_id("https://www.reddit.com/r/webdev/") is None


# -------------------------------------------------------------- permission


async def test_a_site_must_be_allowed_before_it_is_read(db, ready):
    """These readers carry a real session, so "read this subreddit" and "browse
    anywhere as me" are different permissions and only the user separates them.

    Mutation check: drop the `_require_allowed` call.
    """
    with pytest.raises(SocialError) as raised:
        await read(
            "https://www.reddit.com/r/webdev/comments/143acrg/x/", workspace="/tmp", allowed=()
        )
    assert "not on the allowed list" in str(raised.value)
    assert "psok social allow reddit" in str(raised.value)


async def test_allowing_one_site_does_not_allow_the_other(db, ready):
    """Mutation check: treat a non-empty allowlist as "everything"."""
    allow_source("reddit")
    assert load_social().allow == ("reddit",)
    with pytest.raises(SocialError) as raised:
        await search("x", "rust", limit=3, workspace="/tmp", allowed=load_social().allow)
    assert "not on the allowed list" in str(raised.value)


async def test_a_link_that_is_not_a_post_is_named_before_a_missing_reader(db, monkeypatch):
    """Asked in this order deliberately. Telling somebody to install rdt-cli when
    they handed over a subreddit rather than a post is a true sentence about the
    wrong thing -- `convert.py` rejected that ordering for the same reason.

    Mutation check: run the `missing` check before the post-id check.
    """
    monkeypatch.setattr(social.shutil, "which", lambda _: None)
    with pytest.raises(SocialError) as raised:
        await read("https://www.reddit.com/r/webdev/", workspace="/tmp", allowed=("reddit",))
    assert "not a post" in str(raised.value)
    assert "install" not in str(raised.value).lower()


# ------------------------------------------------------------ named failures


def test_a_missing_reader_names_an_installer_this_machine_has(monkeypatch):
    """"Install it with pipx" on a machine with uv and no pipx is one more thing
    to work out. The sentence names what is here.

    Mutation check: hard-code pipx.
    """
    monkeypatch.setattr(
        social.shutil, "which", lambda name: "/usr/bin/uv" if name == "uv" else None
    )
    assert install_line(READERS[0]).startswith("uv tool install")

    monkeypatch.setattr(
        social.shutil, "which", lambda name: "/usr/bin/pipx" if name == "pipx" else None
    )
    assert install_line(READERS[0]).startswith("pipx install")


def test_installed_but_signed_out_says_something_different(monkeypatch):
    """"Not installed" and "installed but signed out" need different actions, so
    they are different sentences.

    Mutation check: return the install sentence for both.
    """
    monkeypatch.setattr(social.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(social, "_credentials", lambda reader: {})
    x = next(r for r in READERS if r.source == "x")
    message = social.missing(x)
    assert "no signed-in session" in message
    assert "not installed" not in message


async def test_an_unreadable_host_points_at_the_tool_that_does_read_it(db, ready):
    """Mutation check: refuse without naming fetch_url."""
    with pytest.raises(SocialError) as raised:
        await read("https://example.com/a", workspace="/tmp", allowed=ALL)
    assert "fetch_url" in str(raised.value)


# ------------------------------------------------------------- credentials


async def test_credentials_never_reach_the_command_line(db, monkeypatch, ready):
    """`/proc` is world-readable: every process on this machine can read another's
    argv. A token there is a token given away.

    Mutation check: pass the token as an argument in the Reader's argv template.
    """
    seen = {}

    async def fake_exec(*argv, **kwargs):
        seen["argv"] = argv
        seen["env"] = kwargs.get("env") or {}
        raise OSError("not really running anything")

    monkeypatch.setattr(social.asyncio, "create_subprocess_exec", fake_exec)
    allow_source("x")
    with pytest.raises(SocialError):
        await search("x", "rust", limit=3, workspace="/tmp", allowed=("x",))

    joined = " ".join(seen["argv"])
    assert "TWITTER_AUTH_TOKEN" not in joined
    assert "t" == seen["env"]["TWITTER_AUTH_TOKEN"], "the token must reach the env instead"


async def test_a_query_with_a_quote_in_it_stays_one_argument(db, monkeypatch, ready):
    """The query is user text arriving from a model. Joined by shlex exactly once,
    so a search for `"; rm -rf ~` is a search.

    Mutation check: build the command by f-string instead of shlex.join.
    """
    seen = {}

    async def fake_exec(*argv, **kwargs):
        seen["argv"] = argv
        raise OSError("stop here")

    monkeypatch.setattr(social.asyncio, "create_subprocess_exec", fake_exec)
    with pytest.raises(SocialError):
        await search("x", '"; rm -rf ~', limit=3, workspace="/tmp", allowed=("x",))
    joined = " ".join(seen["argv"])
    assert "rm -rf ~" not in joined or "'" in joined, joined


# ----------------------------------------------------------------- renderer


def test_the_renderers_preamble_is_split_from_its_markdown():
    """Jina puts `Title:` and `URL Source:` above the content. Filing those as the
    article's first paragraph is how a summary starts "Title: ...".

    Mutation check: return the whole payload as the body.
    """
    meta, body = _split(
        "Title: A page\nURL Source: https://example.com/\nMarkdown Content:\nThe actual words.\n"
    )
    assert meta["title"] == "A page"
    assert body == "The actual words."


async def test_a_blocked_page_is_not_filed_as_the_article(monkeypatch):
    """The renderer answers 200 and puts the failure in the body. Reading only the
    status code files "You've been blocked by network security" as the page --
    measured against Reddit on 2026-09-05, which does exactly this.

    Mutation check: return the body whenever the status is 200.
    """

    class Response:
        status_code = 200
        text = (
            "Title: \nURL Source: https://www.reddit.com/r/webdev/\n"
            "Warning: Target URL returned error 403: Forbidden\n"
            "Markdown Content:\nYou've been blocked by network security.\n"
        )

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def get(self, *_, **__):
            return Response()

    monkeypatch.setattr("backend.web.jina.httpx.AsyncClient", lambda **_: Client())
    assert await fetch_rendered("https://www.reddit.com/r/webdev/") is None


async def test_the_renderer_is_a_setting_the_user_can_switch_off(db):
    """It is a third party: the URL, and the fact this machine read it, leaves
    here. That has to be visible and reversible.

    Mutation check: ignore the setting.
    """
    assert load_social().reader_fallback is True
    assert save_social({"reader_fallback": False}).reader_fallback is False
    assert load_social().reader_fallback is False
