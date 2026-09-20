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
    assert pushed.json() == {"delivered": 0, "native": 0}


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

    assert main.control_push("palette") == {"delivered": 1, "native": 0}
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
    main.on_control("palette", lambda _body: raised.append("shown"))

    assert client.post("/api/control/palette").json() == {"delivered": 1, "native": 1}
    assert raised == ["shown"]


def test_a_window_that_cannot_be_raised_still_answers(client):
    """A listener that throws must not fail the request.

    The palette still reached every stream that was listening, and a compositor
    refusing to raise a window is not a reason to return an error to the hotkey.
    """
    from backend.api import main

    def _refuses(_body) -> None:
        raise RuntimeError("no display")

    main.on_control("palette", _refuses)
    assert client.post("/api/control/palette").status_code == 200


# --------------------------------------------------------------------- summon


def test_summon_starts_the_desktop_when_port_is_idle(monkeypatch):
    """A shortcut should bring up the daemon instead of opening a bare browser."""
    import socket
    import webbrowser

    started: list[int] = []
    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", opened.append)
    monkeypatch.setattr(
        desktop, "_launch_desktop_daemon", lambda port: started.append(port) or True
    )

    class _Sock:
        def __init__(self):
            self._count = 0

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def sendall(self, _request):
            pass

        def recv(self, _size):
            self._count += 1
            if self._count == 1:
                return b'{"delivered": 1}'
            return b''

    def fake_create_connection(addr, timeout):
        if not started:
            raise OSError("not listening")
        return _Sock()

    monkeypatch.setattr(socket, "create_connection", fake_create_connection)

    assert desktop.summon_palette(port=9, timeout=0.05) is True
    assert started == [9]
    assert opened == []


def test_summon_opens_a_window_when_nothing_answered(monkeypatch):
    """Nothing listening, or nothing serving: the user still asked for a palette."""
    import webbrowser

    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", opened.append)
    # Patched, and it matters: unpatched this spawns a real `amethyst desktop`
    # on port 9 that outlives the test run. Eight of them were found sitting on
    # this machine before anyone noticed the suite had been leaving one behind
    # every time it ran.
    monkeypatch.setattr(desktop, "_launch_desktop_daemon", lambda port: False)

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


# ------------------------------------------------- single instance / _control


def _one_shot_server(reply: bytes):
    """A socket that answers one request with `reply`, then closes.

    Returns (port, joiner). Real sockets rather than a patched client because
    `_control` writes and parses HTTP by hand -- that hand-written exchange is
    exactly the thing worth testing against something that has to read it.
    """
    import socket
    import threading

    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def serve_one() -> None:
        try:
            connection, _ = listener.accept()
            with connection:
                connection.recv(4096)
                connection.sendall(reply)
        except OSError:
            pass

    thread = threading.Thread(target=serve_one, daemon=True)
    thread.start()

    def done() -> None:
        thread.join(timeout=5)
        listener.close()

    return port, done


def _http(body: bytes) -> bytes:
    return (
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
    )


def test_control_raises_when_the_port_is_free():
    """A refused connection is the "nothing is running" answer, and must not be
    flattened into "no". It is what tells a launch that it is the one to boot."""
    import pytest as _pytest

    with _pytest.raises(OSError):
        # Port 9 is discard; nothing listens on loopback there.
        desktop._control(port=9, action="show", timeout=0.05)


def test_control_returns_none_for_a_server_that_is_not_amethyst():
    """Something else on the port answers HTTP but not our JSON.

    This is the case a port probe alone cannot tell from "AMETHYST is running",
    and getting it wrong means a launch either starts a doomed second server or
    silently does nothing.
    """
    port, done = _one_shot_server(_http(b"<html>not amethyst</html>"))
    try:
        assert desktop._control(port=port, action="show", timeout=5) is None
    finally:
        done()


def test_control_parses_what_amethyst_answered():
    """The three-way decision is a lookup on this dict; it has to arrive intact."""
    port, done = _one_shot_server(_http(b'{"delivered":1,"native":1}'))
    try:
        assert desktop._control(port=port, action="show", timeout=5) == {
            "delivered": 1,
            "native": 1,
        }
    finally:
        done()


def test_a_second_launch_hands_over_to_the_window_that_exists():
    """The single-instance path: a desktop shell answered, so this launch is done.

    Returning 0 rather than an error is the whole behaviour -- the user pressed
    an application icon and a window came up, which is all they asked for.
    """
    port, done = _one_shot_server(_http(b'{"delivered":1,"native":1}'))
    try:
        assert desktop._already_running(port) == 0
    finally:
        done()


def test_a_second_launch_opens_a_browser_when_serve_owns_the_port(monkeypatch):
    """A bare `amethyst serve` has no window to raise, so the interface opens."""
    import webbrowser

    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", opened.append)
    port, done = _one_shot_server(_http(b'{"delivered":0,"native":0}'))
    try:
        assert desktop._already_running(port) == 0
    finally:
        done()
    assert opened == [f"http://127.0.0.1:{port}/"]


def test_a_stranger_on_the_port_is_an_error_not_a_silent_launch():
    """Starting a second server that could only fail to bind helps nobody."""
    port, done = _one_shot_server(_http(b"<html>not amethyst</html>"))
    try:
        assert desktop._already_running(port) == 1
    finally:
        done()


def test_a_free_port_means_this_launch_boots():
    assert desktop._already_running(9) is None


def test_unknown_control_actions_are_refused(client):
    """The endpoint is reachable by anything that can open a loopback socket,
    so "whatever the caller typed" is not a set worth dispatching on."""
    assert client.post("/api/control/quit").status_code == 404
    assert client.post("/api/control/palette").status_code == 200
    assert client.post("/api/control/show").status_code == 200


def test_show_reaches_a_native_window_with_its_activation_token(client):
    """The token is what makes a summoned window come up in front rather than
    behind: GNOME grants focus to the window whose token it issued."""
    from backend.api import main

    got: list[dict] = []
    main.on_control("show", got.append)

    answer = client.post("/api/control/show", json={"token": "tok-1"}).json()
    assert answer == {"delivered": 1, "native": 1}
    assert got == [{"token": "tok-1"}]


def test_the_palette_and_the_window_are_separate_listeners(client):
    """Registering for one action must not fire on the other."""
    from backend.api import main

    fired: list[str] = []
    main.on_control("palette", lambda _b: fired.append("palette"))
    main.on_control("show", lambda _b: fired.append("show"))

    client.post("/api/control/show")
    assert fired == ["show"]


def test_the_js_bridge_exposes_only_its_own_methods():
    """What the page may call, and nothing else.

    pywebview builds the JS API by walking `dir()` of the js_api object and
    recursing into every public attribute that is a non-callable object
    (`webview/util.py`, `get_functions`). The bridge holds two Window objects
    and a threading.Event, so before those names were made private this handed
    the page the entire Window API -- `destroy`, `load_url`, `evaluate_js` --
    and the GTK widget beneath it. It also produced a ~300KB `_createApi` call
    that failed outright, which is how it was noticed.

    This asserts the rule that walker applies: a public attribute is either one
    of the bridge's own methods, or it is something the page gets to reach into.
    """
    import inspect

    bridge = desktop._SpotlightBridge()
    bridge._spotlight = object()
    bridge._main = object()

    public = {n for n in dir(bridge) if not n.startswith("_")}
    methods = {n for n in public if inspect.ismethod(getattr(bridge, n))}

    assert methods == {"hide", "open_main", "open_external", "ready"}
    # Anything public that is NOT a method is recursed into by pywebview.
    assert public - methods == set(), (
        f"these would be exposed to the page wholesale: {public - methods}"
    )


def test_the_launcher_entry_uses_an_absolute_command(monkeypatch, tmp_path):
    """A .desktop Exec must be absolute or the application icon does nothing.

    The session runs a desktop entry from an arbitrary working directory, and
    `sys.argv[0]` is whatever was typed -- `.venv/bin/amethyst` when started
    from a checkout. That produced `Exec=.venv/bin/amethyst desktop`, which is a
    launcher icon that silently fails everywhere except the one directory it was
    installed from.
    """
    import os
    import shutil

    monkeypatch.setattr(sys, "argv", [".venv/bin/amethyst"])
    monkeypatch.setattr(shutil, "which", lambda name: None)

    command = desktop._launcher_command()
    assert os.path.isabs(command), command
    assert command.endswith(".venv/bin/amethyst")


def test_the_launcher_entry_prefers_an_installed_console_script(monkeypatch):
    """When `amethyst` is on PATH that is the stable name to record."""
    import shutil

    monkeypatch.setattr(
        shutil, "which",
        lambda name: "/usr/local/bin/amethyst" if name == "amethyst" else None,
    )
    assert desktop._launcher_command() == "/usr/local/bin/amethyst"


class _FakeEvents:
    def __init__(self):
        self.closing = []

    class _Slot(list):
        def __iadd__(self, handler):
            self.append(handler)
            return self


class _FakeWindow:
    """Just enough window to wire a closing handler to and watch it hide."""

    def __init__(self):
        self.hidden = False
        self.events = type("E", (), {})()
        self.events.closing = _FakeEvents._Slot()

    def hide(self):
        self.hidden = True


def test_the_close_button_hides_rather_than_destroying():
    """Returning False is what cancels a close -- see `webview/event.py`.

    The window used to cancel and nothing more, so clicking X refused the
    destroy and left the window sitting there: a close button that did nothing
    at all. The hide is the half that was missing.
    """
    desktop._QUITTING.clear()
    window = _FakeWindow()
    desktop._hide_rather_than_close(window)
    handler = window.events.closing[0]

    assert handler() is False, "a normal close must be cancelled (False cancels)"
    assert window.hidden is True, "cancelling alone leaves the window on screen"


def test_a_real_quit_lets_the_window_close():
    """The one case that must get through, or the process cannot be quit."""
    window = _FakeWindow()
    desktop._hide_rather_than_close(window)
    handler = window.events.closing[0]

    desktop._QUITTING.set()
    try:
        assert handler() is True, "quitting must let the close through (not False)"
        assert window.hidden is False
    finally:
        desktop._QUITTING.clear()


def test_the_app_icon_is_the_product_mark_not_the_favicon():
    """The desktop icon must be the logo the product actually uses.

    `favicon.svg` is a different drawing, made for a browser tab; shipping it as
    the application icon meant the dock showed a mark that appears nowhere else.
    """
    source = desktop._logo_path()
    assert source is not None
    assert source.name == "icon.png", f"expected the purpose-made app icon, got {source.name}"


def test_the_spotlight_is_told_every_time_it_is_shown():
    """The bar is one permanently-mounted page whose window is hidden and shown
    around it, so nothing re-mounts and no CSS animation restarts by itself.

    This used to hang entirely on pywebview's `shown` event, which is bound to
    `notify::visible` on the *webview widget* -- hiding the window does not
    change that, so it fired once on the first reveal and never again. Measured:
    three hide/show cycles produced one event. Refocusing the input and
    replaying the open animation were both first-summon-only as a result.
    """
    evaluated = []

    class _Window:
        def evaluate_js(self, js):
            evaluated.append(js)

    desktop.notify_spotlight_shown(_Window())
    assert len(evaluated) == 1
    assert "__amethyst_spotlight_shown" in evaluated[0]


def test_telling_a_window_that_cannot_answer_is_not_an_error():
    """A window mid-teardown must not take the summon down with it."""

    class _Broken:
        def evaluate_js(self, js):
            raise RuntimeError("window is gone")

    desktop.notify_spotlight_shown(_Broken())  # must not raise


def test_gnome_chord_translates_pynput_spelling():
    """The two notations agree on almost nothing; a wrong chord binds silently."""
    assert desktop._gnome_chord("<ctrl>+<alt>+<space>") == "<Control><Alt>space"
    assert desktop._gnome_chord("<ctrl>+<shift>+a") == "<Control><Shift>a"
    assert desktop._gnome_chord("<super>+k") == "<Super>k"


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
