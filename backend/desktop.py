"""The tray process: AMETHYST with nothing that has to stay open.

The backend was always the daemon -- durable jobs run in it, the agent loop runs
in it, and the browser has only ever been a client that reads what it did. What
was missing was somewhere for that daemon to *live* when no window is open. A
terminal running `amethyst serve` is not that: closing it is indistinguishable
from quitting the application, so the machine treats AMETHYST as a website that
must be kept open rather than as something that is simply on.

This module is the smallest thing that fixes that, and deliberately not a
desktop framework:

* the API runs on a background thread, in this same process, so there is one
  thing to start and one thing to kill;
* a tray icon says it is on, and is where you quit it from;
* a global hotkey opens the command palette from anywhere, including when the
  browser is not focused or not running;
* an autostart entry makes it survive a reboot without being asked.

The interface owns the palette, so the hotkey cannot open it directly -- it asks
the daemon to nudge whatever window is listening (`POST /api/control/palette`),
and opens a window itself only when nothing answered.
"""

from __future__ import annotations

import contextlib
import os
import re
import sys
import threading

# Everything else -- shlex, shutil, signal, subprocess, webbrowser, pathlib --
# is imported inside the function that needs it, and none of them is on the path
# `amethyst-palette` takes. That command runs on a keystroke and does two
# milliseconds of work; importing webbrowser and shutil for it cost thirty times
# that each. Measured, not guessed: see main_palette.

#: Not `mod+k`: that is the in-window palette chord and belongs to the browser.
#: A global grab has to be one nothing else has taken, on three platforms.
DEFAULT_HOTKEY = "<ctrl>+<alt>+<space>"

DEFAULT_PORT = 8000

#: Set when the window may really close instead of hiding. Closing it is normally
#: "put AMETHYST away", not "quit"; this is how the one real quit gets through.
_QUITTING = threading.Event()

#: Whether the spotlight window is up. pywebview does not expose visibility,
#: and the process is the only one that shows or hides it, so it keeps the
#: flag itself and the hotkey becomes a toggle: summon while open puts it away.
_spotlight_up = threading.Event()


def url_for(port: int, path: str = "/") -> str:
    return f"http://127.0.0.1:{port}{path}"


def _launch_desktop_daemon(port: int = DEFAULT_PORT) -> bool:
    """Bring up the tray app when the palette shortcut is the only thing alive.

    This is the direct path for `amethyst-palette`: if no server is listening on
    the usual port, the user did not ask for a website tab but for the floating
    palette itself. Starting the daemon and retrying once is the intended action;
    only a final failure opens the browser as an emergency fallback.
    """
    import pathlib
    import shutil
    import subprocess

    venv_exe = pathlib.Path(sys.executable).parent / "amethyst"
    exe = shutil.which("amethyst") or (str(venv_exe) if venv_exe.exists() else None)
    argv = [exe, "desktop", "--port", str(port)] if exe else [
        sys.executable,
        "-m",
        "backend.cli",
        "desktop",
        "--port",
        str(port),
    ]

    repo_root = pathlib.Path(__file__).resolve().parent.parent

    try:
        subprocess.Popen(
            argv,
            cwd=str(repo_root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True
    except Exception:
        return False


# --------------------------------------------------------------------- summon


def summon_palette(port: int = DEFAULT_PORT, timeout: float = 1.5) -> bool:
    """Show the command palette, from wherever it has to come from.

    Two cases, and the daemon is the one that can tell them apart. If a window
    is open it is already listening on the control stream, and a nudge puts the
    palette up in the window the user is looking at. If none is, nothing hears
    the nudge and a window is opened on the palette instead.

    Returns True when an existing window took it. Shared by the hotkey, the tray
    menu and `amethyst palette`, so all three behave identically.
    """
    # A socket and six lines of HTTP rather than a client library.
    #
    # This runs on a keystroke, in a process started for it, and the work it has
    # to do takes two milliseconds. httpx costs 160ms to import and
    # urllib.request 57ms -- both of them more than everything else on this path
    # put together, for a fixed POST to a known local port that answers a small
    # JSON object. Measured end to end, the summons went from 308ms to about 45.
    import json
    import socket

    request = (
        "POST /api/control/palette HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Content-Length: 0\r\n"
        "Connection: close\r\n\r\n"
    ).encode()
    try:
        with socket.create_connection(("127.0.0.1", port), timeout) as sock:
            sock.sendall(request)
            reply = b""
            while chunk := sock.recv(4096):
                reply += chunk
        body = reply.rsplit(b"\r\n\r\n", 1)[-1]
        if json.loads(body).get("delivered"):
            return True
    except Exception:
        # Nothing is serving, it did not answer in time, or it answered with
        # something this cannot read. This is the case where the keyboard shortcut
        # is the only thing alive; start the daemon and retry once instead of
        # opening the browser as the first action.
        pass

    if _launch_desktop_daemon(port):
        import time

        for _ in range(30):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout) as sock:
                    sock.sendall(request)
                    reply = b""
                    while chunk := sock.recv(4096):
                        reply += chunk
                body = reply.rsplit(b"\r\n\r\n", 1)[-1]
                if json.loads(body).get("delivered"):
                    return True
                time.sleep(0.15)
            except Exception:
                time.sleep(0.15)
                continue

    import webbrowser

    webbrowser.open(url_for(port, "/?cmd=palette"))
    return False


def main_palette(argv: list[str] | None = None) -> int:
    """`amethyst-palette`: the keyboard shortcut's entry point.

    Its own console script rather than a subcommand of `amethyst`, because
    `backend.cli` imports the director, the tool registry and the database layer
    at module scope -- about a quarter of a second, paid on every press of a key
    whose whole job takes two milliseconds. Nothing here imports more than the
    standard library.
    """
    import sys as _sys

    port = DEFAULT_PORT
    args = _sys.argv[1:] if argv is None else argv
    for i, arg in enumerate(args):
        if arg == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
        elif arg.startswith("--port="):
            port = int(arg.split("=", 1)[1])
    summon_palette(port)
    return 0


# --------------------------------------------------------------------- server


def _serve_in_thread(host: str, port: int, log_level: str):
    """Run the API on a daemon thread and hand back the server to stop it with.

    uvicorn only installs signal handlers on the main thread and returns early
    otherwise, which is what lets the tray keep the main thread for itself --
    pystray requires it on macOS.
    """
    import uvicorn

    config = uvicorn.Config(
        "backend.api.main:app",
        host=host,
        port=port,
        log_level=log_level,
        # A graceful shutdown waits for open connections to close, and the control
        # stream is an SSE response that never closes itself -- so without a bound
        # here the server never finished shutting down, and the MCP subprocesses it
        # owns were never closed.
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="amethyst-api", daemon=True)
    thread.start()
    return server, thread


def _wait_until_serving(server, thread, seconds: float = 30.0) -> bool:
    """Block until uvicorn reports it is up, or the thread dies trying."""
    import time

    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if getattr(server, "started", False):
            return True
        if not thread.is_alive():
            return False
        time.sleep(0.05)
    return False


# ------------------------------------------------------------------- autostart

_WIN_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_WIN_VALUE = "AMETHYST"


def _autostart_path():
    """The `Path` login reads, or None on Windows, where it is a registry value.

    Resolved per call rather than at import: `Path.home()` is the answer to a
    question about the environment, and a module constant would freeze it.
    """
    from pathlib import Path

    if sys.platform == "win32":
        return None
    if sys.platform == "darwin":
        return Path.home() / "Library" / "LaunchAgents" / "com.amethyst.desktop.plist"
    return Path.home() / ".config" / "autostart" / "amethyst.desktop"


def _autostart_argv() -> list[str]:
    """What login should run. The installed console script where there is one.

    The fallback runs the module, which only works from a checkout -- true of a
    machine that never installed the package, and the same place its `run.sh`
    lives.
    """
    import shutil

    exe = shutil.which("amethyst")
    if exe:
        return [exe, "desktop"]
    return [sys.executable, "-m", "backend.cli", "desktop"]


def install_autostart() -> str:
    """Start the tray at login. Returns what was written, for printing."""
    import shlex
    import subprocess

    argv = _autostart_argv()
    if sys.platform == "win32":
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _WIN_RUN_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(
                key, _WIN_VALUE, 0, winreg.REG_SZ, subprocess.list2cmdline(argv)
            )
        return rf"HKCU\{_WIN_RUN_KEY}\{_WIN_VALUE}"

    entry = _autostart_path()
    assert entry is not None  # only win32 has none, and it returned above
    entry.parent.mkdir(parents=True, exist_ok=True)

    if sys.platform == "darwin":
        args = "".join(f"    <string>{a}</string>\n" for a in argv)
        entry.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"'
            ' "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0">\n'
            "<dict>\n"
            "  <key>Label</key><string>com.amethyst.desktop</string>\n"
            "  <key>ProgramArguments</key>\n"
            f"  <array>\n{args}  </array>\n"
            "  <key>RunAtLoad</key><true/>\n"
            "</dict>\n"
            "</plist>\n"
        )
        return str(entry)

    entry.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=AMETHYST\n"
        "Comment=Personal operating system, running in the background\n"
        f"Exec={shlex.join(argv)}\n"
        "Terminal=false\n"
        "X-GNOME-Autostart-enabled=true\n"
    )
    return str(entry)


def uninstall_autostart() -> str | None:
    """Undo it. Returns what was removed, or None if there was nothing."""
    if sys.platform == "win32":
        import winreg

        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, _WIN_RUN_KEY, 0, winreg.KEY_SET_VALUE
            ) as key:
                winreg.DeleteValue(key, _WIN_VALUE)
            return rf"HKCU\{_WIN_RUN_KEY}\{_WIN_VALUE}"
        except FileNotFoundError:
            return None

    entry = _autostart_path()
    if entry is not None and entry.exists():
        entry.unlink()
        return str(entry)
    return None


# ------------------------------------------------------------------ the hotkey


def _hotkey_unavailable_reason() -> str | None:
    """Why a global grab cannot work here, if it cannot.

    Checked before pynput is asked, because on Wayland pynput does not fail: its
    X11 backend attaches to XWayland, where it sees only what X clients type, so
    the grab appears to succeed and then never fires. Promising a hotkey that
    silently does nothing is worse than saying there is not one.
    """
    if sys.platform.startswith("linux") and os.environ.get("WAYLAND_DISPLAY"):
        return "Wayland does not let applications grab keys"
    return None


def _start_hotkey(hotkey: str, fire) -> str | None:
    """Listen for the global chord. Returns why it could not, or None.

    Never raises: a machine where the grab is refused is still a machine that
    can run the daemon and the tray, and saying so once is more use than
    refusing to start.

    ponytail: pynput global grab. X11, Windows and macOS take it; Wayland
    refuses by design, and macOS needs Accessibility permission. The upgrade
    path for both is the same and already here -- bind `amethyst palette` to a
    key in the desktop environment's own shortcut settings.
    """
    try:
        from pynput import keyboard
    except Exception as exc:
        return f"pynput is not available ({exc})"
    try:
        listener = keyboard.GlobalHotKeys({hotkey: fire})
        listener.daemon = True
        listener.start()
    except Exception as exc:
        return str(exc)
    return None


# --------------------------------------------------------------------- the app


def _block_signals():
    """Take SIGTERM/SIGINT off every thread, so one of ours can wait for them.

    Must run before any other thread starts: a signal blocked only in the main
    thread is delivered to whichever thread has not blocked it, and the default
    action there kills the process.

    Returns the blocked set, or None on Windows, which has neither call.
    """
    import signal

    if not hasattr(signal, "pthread_sigmask"):
        return None
    signals = {signal.SIGTERM, signal.SIGINT}
    signal.pthread_sigmask(signal.SIG_BLOCK, signals)
    return signals


def _stop_on_signal(signals, shutdown) -> None:
    """Run `shutdown` when the machine asks this process to stop.

    Not `signal.signal`: CPython runs a handler on the main thread at its next
    bytecode, and a GUI loop sitting idle in C code executes none -- so the
    handler never ran and SIGTERM left the daemon alive with its MCP children.
    A thread blocked in `sigwait` has no such dependency.
    """
    import signal

    if signals is None:  # Windows
        signal.signal(signal.SIGTERM, lambda *_: shutdown())
        return

    def wait() -> None:
        signal.sigwait(signals)
        shutdown()

    threading.Thread(target=wait, name="amethyst-signals", daemon=True).start()


def _logo_path() -> "pathlib.Path | None":
    """Absolute path to the amethyst logo SVG shipped with the frontend.

    Resolves relative to this file's location so it works regardless of
    working directory.  Returns None when the file cannot be found.
    """
    from pathlib import Path

    candidate = Path(__file__).parent.parent / "frontend" / "public" / "favicon.svg"
    return candidate if candidate.exists() else None


def _icon_image():
    """The tray glyph — renders the real SVG logo when possible.

    GdkPixbuf (present on Linux with GTK) can rasterise SVG directly, so this
    gives us a crisp 256 × 256 RGBA image from the same source the browser
    favicon uses.  Falls back to the hand-drawn diamond on macOS / Windows or
    when the SVG is missing, so nothing breaks there.
    """
    from PIL import Image

    svg = _logo_path()
    if svg is not None:
        try:
            import gi

            gi.require_version("GdkPixbuf", "2.0")
            from gi.repository import GdkPixbuf

            pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(svg), 256, 256, True)
            raw = pb.get_pixels()
            mode = "RGBA" if pb.get_has_alpha() else "RGB"
            img = Image.frombytes(mode, (pb.get_width(), pb.get_height()), raw, "raw", mode, pb.get_rowstride())
            return img.convert("RGBA")
        except Exception:
            pass

    # Fallback: draw a simple amethyst-coloured diamond
    from PIL import ImageDraw

    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(128, 12), (244, 104), (128, 244), (12, 104)], fill=(139, 92, 246, 255))
    draw.polygon([(128, 12), (244, 104), (128, 104)], fill=(167, 139, 250, 255))
    return image


def _icon_png_path() -> "str | None":
    """Write the icon image to a temp file and return its path.

    ``webview.start(icon=...)`` and GTK's ``set_icon_from_file`` both need a
    file path, not a PIL Image.  We write once per process; the file is cleaned
    up when the process exits.
    """
    import atexit
    import tempfile

    try:
        img = _icon_image()
        fd, path = tempfile.mkstemp(suffix=".png", prefix="amethyst_icon_")
        import os

        os.close(fd)
        img.save(path, "PNG")
        atexit.register(lambda p=path: __import__("os").unlink(p) if __import__("os").path.exists(p) else None)
        return path
    except Exception:
        return None


def _install_xdg_assets() -> None:
    """Write the icon + .desktop file so GNOME Wayland shows the right icon.

    On Wayland (GNOME Shell), ``set_icon_from_file`` on the GTK window is
    ignored for the dock and the alt-tab switcher.  The compositor resolves the
    icon by matching the window's ``app_id`` (= WM_CLASS on X11, which GTK
    derives from ``argv[0]`` stem = ``amethyst``) to a ``.desktop`` file, and
    then reads the ``Icon=`` field from it.

    This function:
      1. Writes a 256 × 256 PNG into the hicolor icon theme directory so the
         name ``amethyst`` resolves to the gem mark.
      2. Writes / updates ``~/.local/share/applications/amethyst.desktop``
         with ``Icon=amethyst`` and ``StartupWMClass=amethyst``.

    It is idempotent and silently does nothing when it cannot write.
    """
    import os
    import shlex
    import sys
    from pathlib import Path

    try:
        # 1. Icon PNG --------------------------------------------------------
        icon_dir = Path.home() / ".local" / "share" / "icons" / "hicolor" / "256x256" / "apps"
        icon_dir.mkdir(parents=True, exist_ok=True)
        icon_dest = icon_dir / "amethyst.png"
        try:
            img = _icon_image()
            img.save(str(icon_dest), "PNG")
        except Exception:
            pass  # fall back: no icon but desktop entry still lands

        # 2. .desktop entry --------------------------------------------------
        app_dir = Path.home() / ".local" / "share" / "applications"
        app_dir.mkdir(parents=True, exist_ok=True)

        exe = sys.argv[0]  # full path to the amethyst console script
        if not os.path.isabs(exe):
            import shutil

            exe = shutil.which(exe) or exe

        entry = app_dir / "amethyst.desktop"
        entry.write_text(
            "[Desktop Entry]\n"
            "Type=Application\n"
            "Name=AMETHYST\n"
            "GenericName=Personal OS\n"
            "Comment=Personal operating system — one agent over your files, tasks and services\n"
            f"Exec={shlex.quote(exe)} desktop\n"
            "Terminal=false\n"
            "Icon=amethyst\n"
            "StartupWMClass=amethyst\n"
            "Categories=Utility;Office;\n"
            "Keywords=AI;assistant;agent;notes;\n"
        )

        # 3. Refresh icon cache (best-effort) --------------------------------
        import subprocess

        with contextlib.suppress(Exception):
            subprocess.run(
                ["gtk-update-icon-cache", "-f", "-t", str(icon_dir.parent.parent.parent)],
                timeout=3,
                capture_output=True,
            )
    except Exception:
        pass


class _SpotlightBridge:
    """What the palette page may ask of the process that owns its window.

    Three things, and all of them are about windows rather than data: put me
    away, open the full application, and open this link outside of me.
    Everything the palette actually *does* -- asking, logging, resuming a job
    -- it does over the API like any other client, so this stays a window
    manager and not a second back door into AMETHYST.
    """

    def __init__(self) -> None:
        self.spotlight = None
        self.main = None

    def hide(self) -> None:
        if self.spotlight is not None:
            with contextlib.suppress(Exception):
                self.spotlight.hide()
            # The toggle flag tracks this window, and the bridge is one of the
            # two things that ever hides it (Esc from the page is the other,
            # and it comes through here).
            _spotlight_up.clear()

    def open_main(self, path: str = "") -> None:
        """For the commands that are a place rather than an action."""
        if self.main is not None:
            if path:
                clean_path = "/" + path.lstrip("/")
                with contextlib.suppress(Exception):
                    self.main.evaluate_js(
                        f"window.__amethyst_navigate && window.__amethyst_navigate('{clean_path}')"
                    )
            _present(self.main)
        self.hide()

    def open_external(self, url: str) -> None:
        """Open a link in the browser the machine uses for links.

        `window.open` inside a frameless pywebview window is a no-op: there is
        no tab to open into and no new-window decision for WebKitGTK to make,
        so a result clicked in the bar silently did nothing. The OS browser is
        where a link from a floating bar was always going to end up.
        """
        if not re.match(r"^https?://", url or ""):
            return
        import webbrowser

        webbrowser.open(url)



def _hide_rather_than_close(window) -> None:
    """Closing a window is "put AMETHYST away", never "quit it".

    The jobs, the schedules and the agent loop belong to the daemon and go on
    without any window at all, so the close button hides. Quitting is the tray's
    Quit, or a signal.
    """

    def _closing() -> bool:
        return bool(_QUITTING.is_set())  # False cancels the close

    window.events.closing += _closing


def _corners_are_free() -> bool:
    """Whether a transparent spotlight window costs anything here.

    The spotlight is a frameless window with a rounded card inside it. If the
    window itself is an opaque rectangle, its corners are square and the card's
    rounded ones sit inside a visible band -- which is the "squared corners"
    everyone sees and nobody can point at.

    Making the window transparent fixes it, and whether that is free depends
    entirely on the display server:

    * **Wayland** -- every surface is ARGB already and the compositor does the
      blending. The flag costs nothing, so the corners are real.
    * **X11** -- asking for an RGBA visual drops WebKitGTK off its accelerated
      compositing path and everything after it is painted in software. That is
      a stuttering window in exchange for two corners, which is the wrong
      trade, so the band stays and `background_color` paints it.

    Anything that is not clearly Wayland is treated as X11. The failure of a
    wrong guess is one-directional on purpose: guessing X11 costs a cosmetic
    band, guessing Wayland costs a window that stutters.
    """
    return bool(os.environ.get("WAYLAND_DISPLAY")) or (
        os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
    )


def _build_windows(port: int):
    """The full application, and the bar that floats over everything else.

    Two windows rather than one because they answer different questions. The
    application is where you go to read and work. The bar is what the hotkey
    summons: it is small, it is on top, it has no frame, and using it is meant
    to leave you exactly where you were -- which is the whole difference between
    an assistant and a website you keep open.

    Both start hidden. This is a daemon; a window appearing at login is not what
    "runs in the background" means.

    Returns (main, spotlight, bridge), all None where pywebview is not installed.
    """
    try:
        import webview
    except Exception:
        return None, None, None

    bridge = _SpotlightBridge()
    main = webview.create_window(
        "AMETHYST", url_for(port, "/?native=1"), width=1180, height=800, hidden=True
    )
    spotlight = webview.create_window(
        "AMETHYST",
        url_for(port, "/?spotlight=1&native=1"),
        width=760,
        height=520,
        frameless=True,
        easy_drag=True,
        on_top=True,
        hidden=True,
        # The card inside paints its own rounded corners; this is the colour
        # behind them when the window cannot be transparent.
        background_color="#131317",
        # True corners where they are free, a painted band where they are not.
        # See `_corners_are_free` -- on X11 an RGBA visual costs WebKitGTK its
        # accelerated compositing path and everything after that is drawn in
        # software, which is what "laggy" was. On Wayland every surface is
        # already ARGB and the compositor does the blending, so the same flag
        # costs nothing and the window's corners become the card's corners.
        transparent=_corners_are_free(),
        js_api=bridge,
    )
    bridge.spotlight, bridge.main = spotlight, main
    for window in (main, spotlight):
        _hide_rather_than_close(window)

    # `shown` fires on every reveal, not only the first -- `_present` calls
    # `show()` again each summon -- which makes it the one hook that covers both
    # the window's first appearance and every hide/show cycle after it. The
    # page does the focusing; all this does is tell it that it is visible, the
    # one thing a page cannot know about its own window.
    def _spotlight_shown():
        with contextlib.suppress(Exception):
            spotlight.evaluate_js(
                "window.__amethyst_spotlight_shown && window.__amethyst_spotlight_shown()"
            )

    spotlight.events.shown += _spotlight_shown
    return main, spotlight, bridge


def _present(window, *, pinned: bool = False) -> None:
    """Put the window in front, from whichever thread asked for it.

    `on_top` is pinned for a moment rather than left on. A compositor that
    prevents focus stealing will otherwise raise a summoned window *behind* the
    one the user was looking at, which is indistinguishable from not showing it;
    and leaving it pinned would mean using AMETHYST as an ordinary window meant one
    that floats over everything else forever.

    ponytail: this buys visibility, not keyboard focus. GNOME grants focus to a
    window whose activation token it issued, and that token belongs to the process
    its shortcut launched -- `amethyst palette` -- rather than to this one.
    Forwarding the token through the POST is the fix if one click to type is one
    click too many.
    """
    with contextlib.suppress(Exception):
        window.restore()  # no-op unless it was minimised
    with contextlib.suppress(Exception):
        window.show()
    with contextlib.suppress(Exception):
        window.on_top = True
        if not pinned:
            threading.Timer(1.0, lambda: _release_on_top(window)).start()


def _release_on_top(window) -> None:
    with contextlib.suppress(Exception):
        window.on_top = False


def _close_windows(windows) -> bool:
    """Take the windows down from the thread that owns them. For `GLib.idle_add`.

    GTK and WebKit must be driven from the thread running their loop. Destroying
    the window from the one that took the signal left glibc reporting a corrupted
    heap on the way out, and letting the loop end on its own is what makes the
    difference between a process that exits and one that is shot.
    """
    _QUITTING.set()
    for window in windows:
        with contextlib.suppress(Exception):
            window.destroy()
    return False  # do not run this idle callback again


def _build_icon(port: int, window, on_quit):
    """The tray icon, or None where there is nothing to put one in.

    GNOME on Wayland has no legacy tray, so this is routinely None on this
    machine -- which is why it is never the only way to reach anything.
    """
    import webbrowser

    try:
        import pystray
    except Exception as exc:
        print(f"! no tray icon ({exc})")
        print('  install one with:  pip install -e ".[desktop]"')
        return None

    show = (
        (lambda *_: _present(window))
        if window is not None
        else (lambda *_: webbrowser.open(url_for(port)))
    )
    try:
        return pystray.Icon(
            "amethyst",
            icon=_icon_image(),
            title="AMETHYST",
            menu=pystray.Menu(
                pystray.MenuItem("Open AMETHYST", show, default=True),
                pystray.MenuItem("Command palette", lambda *_: summon_palette(port)),
                pystray.MenuItem(
                    "Running jobs",
                    lambda *_: webbrowser.open(url_for(port, "/automations")),
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit", lambda *_: on_quit()),
            ),
        )
    except Exception as exc:
        print(f"! no tray icon ({exc})")
        return None


def run_tray(
    host: str = "127.0.0.1",
    port: int = DEFAULT_PORT,
    hotkey: str = DEFAULT_HOTKEY,
    log_level: str = "warning",
    open_browser: bool = False,
    native_window: bool = True,
) -> int:
    """Serve, sit in the background, and show the palette when asked."""
    signals = _block_signals()  # before any thread exists; see the docstring
    server, thread = _serve_in_thread(host, port, log_level)
    if not _wait_until_serving(server, thread):
        print(f"! the API did not come up on {url_for(port)}", file=sys.stderr)
        return 1
    print(f"AMETHYST is running at {url_for(port)}")

    # Register icon + .desktop file so GNOME Wayland resolves the gem icon in
    # the dock and the alt-tab switcher.  Idempotent; safe to call every boot.
    _install_xdg_assets()

    problem = _hotkey_unavailable_reason() or _start_hotkey(
        hotkey, lambda: summon_palette(port)
    )
    if problem:
        print(f"! no global hotkey: {problem}")
        print("  bind a key to `amethyst-palette` in your desktop settings instead")
    else:
        print(f"press {hotkey} anywhere for the command palette")

    def stop() -> None:
        # The control streams go first, and before `should_exit` rather than from
        # the application's own shutdown: uvicorn waits for open responses *and
        # then* runs the lifespan, so a stream closed in there is closed too late.
        # The grace period had already expired and cancelled it mid-request.
        with contextlib.suppress(Exception):
            from backend.api.main import close_control_streams

            close_control_streams()
        server.should_exit = True
        thread.join(timeout=10)

    # Three shapes, in order of how much of a desktop application this is: a
    # window of our own with a tray icon beside it, a tray icon alone opening the
    # browser, or neither and just serving. Each falls back to the next, because
    # which of them a machine can manage is not something to fail over.
    main, spotlight, _bridge = (
        _build_windows(port) if native_window else (None, None, None)
    )
    # Everything below that only asks "is there a GUI at all" asks about this
    # one; the two windows are created and destroyed together.
    window = main

    def shutdown() -> None:
        """Stop the server, then let whichever loop is running end by itself.

        The server goes first: its shutdown is what closes the MCP subprocesses,
        and taking the window down before it left twelve of them running.

        Then the loop is ended from the thread that owns it, so WebKit tears down
        properly rather than being interrupted mid-flight. The timer is the
        guarantee behind all of it -- an exit that depends on a loop still turning
        is not one -- and it is a daemon thread so it never holds the process open
        by itself.
        """
        stop()
        backstop = threading.Timer(5.0, lambda: os._exit(0))
        backstop.daemon = True
        backstop.start()
        if icon is not None:
            with contextlib.suppress(Exception):
                icon.stop()
        if window is not None:
            with contextlib.suppress(Exception):
                from gi.repository import GLib

                GLib.idle_add(_close_windows, [w for w in (main, spotlight) if w])

    icon = _build_icon(port, window, shutdown)

    # SIGTERM is how a session manager ends this at logout, and uvicorn installs
    # its own handlers only on the main thread -- which it is not on here. Without
    # this the process would be killed outright, before the shutdown that closes
    # the MCP subprocesses it started, leaving them orphaned.
    _stop_on_signal(signals, shutdown)

    if open_browser:
        if window is not None:
            _present(window)
        else:
            import webbrowser

            webbrowser.open(url_for(port))

    if window is not None:
        import webview

        from backend.api import main as api

        # This is what makes the hotkey feel like part of the machine rather than
        # a bookmark: the palette opens over whatever the user was doing, in a
        # window this process can raise, instead of somewhere behind the browser.
        # The bar, not the application: a hotkey is for doing one thing without
        # going anywhere, and opening a full window over what somebody was doing
        # is the behaviour they asked to be rid of.
        #
        # A hotkey is a toggle, not a doorbell. pywebview does not expose
        # visibility, but this process is the only one that shows or hides the
        # spotlight, so a flag it keeps itself is the truth -- and pressing the
        # summon again while the bar is up puts it away, the way every other
        # spotlight on the machine behaves.
        def _toggle_spotlight():
            if _spotlight_up.is_set():
                with contextlib.suppress(Exception):
                    spotlight.hide()
                _spotlight_up.clear()
                return
            _spotlight_up.set()
            _present(spotlight, pinned=True)

        api.on_palette(_toggle_spotlight)
        if icon is not None:
            # The GTK loop webview is about to start is the one it hooks into.
            with contextlib.suppress(Exception):
                icon.run_detached()
        print("its window stays hidden until you ask for it")
        icon_path = _icon_png_path()
        try:
            webview.start(icon=icon_path)  # blocks the main thread, which GTK requires
        except KeyboardInterrupt:
            pass
        finally:
            stop()
        return 0

    if icon is not None:
        try:
            icon.run()  # blocks the main thread; macOS requires it is this one
        except KeyboardInterrupt:
            pass
        finally:
            stop()
        return 0

    # Nothing to show it in. The daemon is the point and a window is the
    # convenience, so this serves until something stops it.
    print("  serving until interrupted")
    try:
        thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        stop()
    return 0
