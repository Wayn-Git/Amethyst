"""The tray daemon, and the nudge that opens the palette from outside a window.

The interesting part is not the icon -- it is that a keystroke pressed while no
window is focused has to reach a palette that lives in the window. Two paths do
it, and which one runs is decided by whether anything was listening: these tests
are about that decision, because getting it wrong means either a hotkey that
silently does nothing or a second browser window on every press.
"""

from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from backend import desktop
from backend.api.main import app

pytestmark = pytest.mark.usefixtures("amethyst_home")


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def no_stray_subscribers():
    """Both are module state; a leak would make the next delivered count lie."""
    from backend.api import main

    main._control_subscribers.clear()
    main._control_listeners.clear()
    yield
    main._control_subscribers.clear()
    main._control_listeners.clear()


# -------------------------------------------------------------- control channel


def test_palette_push_reports_that_nobody_heard_it(client):
    """With no window open there is nothing to nudge, and the daemon says so.

    This is the signal `summon_palette` needs: a truthful zero is what makes it
    open a window instead of assuming one appeared.
    """
    pushed = client.post("/api/control/palette")
    assert pushed.status_code == 200
    assert pushed.json() == {"delivered": 0}


@pytest.mark.asyncio
async def test_palette_push_reaches_an_open_window():
    """A window on the stream gets the frame, and the count says it was taken.

    Driven as the generator rather than over HTTP on purpose: TestClient runs the
    app on one portal thread, so holding a stream open while posting to it
    deadlocks the test rather than the code. The subscribe/push/discard cycle is
    the whole of the logic, and it is all here.
    """
    from backend.api import main

    response = await main.control_stream()
    frames = response.body_iterator
    # Subscribed when the response was built, before a byte was read: a hotkey
    # pressed in that window must not be told nobody was listening.
    assert len(main._control_subscribers) == 1
    assert await frames.__anext__() == 'data: {"type": "ready"}\n\n'

    assert main.open_palette() == {"delivered": 1}
    assert await frames.__anext__() == 'data: {"type": "palette"}\n\n'

    # A window that closed is not somewhere to deliver. Leaving it subscribed
    # would have the daemon believe a palette can still be opened in it, and the
    # hotkey would stop opening one anywhere.
    await frames.aclose()
    assert main._control_subscribers == set()


def test_a_window_the_daemon_owns_is_called_and_counted(client):
    """The tray's own window is not on a stream -- it is called in this process.

    It has to be counted, because that count is what stops the hotkey opening a
    browser when there is already a native window sitting there to be raised.
    """
    from backend.api import main

    raised: list[str] = []
    main.on_palette(lambda: raised.append("shown"))

    assert client.post("/api/control/palette").json() == {"delivered": 1}
    assert raised == ["shown"]


def test_a_window_that_cannot_be_raised_still_answers(client):
    """A listener that throws must not fail the request.

    The palette still reached every stream that was listening, and a compositor
    refusing to raise a window is not a reason to return an error to the hotkey.
    """
    from backend.api import main

    def _refuses() -> None:
        raise RuntimeError("no display")

    main.on_palette(_refuses)
    assert client.post("/api/control/palette").status_code == 200


# --------------------------------------------------------------------- summon


def test_summon_opens_a_window_when_nothing_answered(monkeypatch):
    """Nothing listening, or nothing serving: the user still asked for a palette."""
    import webbrowser

    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", opened.append)

    # No server on this port, so the request fails rather than being delivered.
    assert desktop.summon_palette(port=9, timeout=0.05) is False
    assert opened == ["http://127.0.0.1:9/?cmd=palette"]


def test_summon_leaves_the_browser_alone_when_a_window_took_it(monkeypatch):
    """The whole point: the palette opens where the user is already looking.

    Answered by a real socket rather than a patched client, because the summons
    speaks HTTP itself now -- a hand-written request is exactly the thing worth
    testing against something that has to parse it.
    """
    import socket
    import threading
    import webbrowser

    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", opened.append)

    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    seen: list[bytes] = []

    def serve_one() -> None:
        connection, _ = listener.accept()
        with connection:
            seen.append(connection.recv(4096))
            body = b'{"delivered":1}'
            connection.sendall(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
            )

    thread = threading.Thread(target=serve_one, daemon=True)
    thread.start()
    try:
        assert desktop.summon_palette(port=port, timeout=5) is True
    finally:
        thread.join(timeout=5)
        listener.close()

    assert opened == [], "a window took it; nothing should have opened a browser"
    assert seen and seen[0].startswith(b"POST /api/control/palette HTTP/1.1")


# ---------------------------------------------------------- "the agent is done"


async def test_a_long_turn_says_so_when_it_finishes(monkeypatch):
    """The point of a daemon: work outlives the window it was started from.

    A question asked from the bar and then walked away from has nowhere to land,
    so it lands on the desktop.
    """
    from backend.api import main

    said: list[tuple[str, str]] = []

    async def _notify(title, body):
        said.append((title, body))
        return True

    monkeypatch.setattr("backend.notify.notify", _notify)

    class _Done:
        type = "done"
        data: dict = {}

    await main._say_the_agent_is_done("nope", _Done(), main.NOTIFY_AFTER_SECONDS + 1)
    assert len(said) == 1
    assert "ready" in said[0][1]


async def test_a_turn_the_user_watched_happen_stays_quiet(monkeypatch):
    """Telling somebody what they just saw is noise, and noise gets switched off."""
    from backend.api import main

    said: list[tuple[str, str]] = []

    async def _notify(title, body):
        said.append((title, body))
        return True

    monkeypatch.setattr("backend.notify.notify", _notify)

    class _Done:
        type = "done"
        data: dict = {}

    await main._say_the_agent_is_done("nope", _Done(), 2.0)
    assert said == []


# ------------------------------------------------------------------ autostart


@pytest.mark.skipif(sys.platform == "win32", reason="the registry path has no file")
def test_autostart_writes_then_removes_a_login_entry(tmp_path, monkeypatch):
    """Installing is reversible, and names what it touched both times."""
    monkeypatch.setenv("HOME", str(tmp_path))
    entry = desktop._autostart_path()
    assert entry is not None and not entry.exists()

    written = desktop.install_autostart()
    assert written == str(entry)
    assert entry.is_file()
    assert "desktop" in entry.read_text()  # it starts the tray, not `serve`

    assert desktop.uninstall_autostart() == str(entry)
    assert not entry.exists()
    # Removing what is not there is not an error, and says nothing was removed.
    assert desktop.uninstall_autostart() is None
