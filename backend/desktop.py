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
import logging
import os
import re
import sys
import threading
import time
from functools import lru_cache
from typing import Any

# Everything else -- shlex, shutil, signal, subprocess, webbrowser, pathlib --
# is imported inside the function that needs it, and none of them is on the path
# `amethyst-palette` takes. That command runs on a keystroke and does two
# milliseconds of work; importing webbrowser and shutil for it cost thirty times
# that each. Measured, not guessed: see main_palette.

log = logging.getLogger(__name__)

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


def _control(
    port: int = DEFAULT_PORT,
    action: str = "palette",
    timeout: float = 1.5,
    **body: Any,
) -> dict[str, Any] | None:
    """POST /api/control/<action> and return what AMETHYST answered.

    A socket and six lines of HTTP rather than a client library. This runs on a
    keystroke, in a process started for it, and the work it has to do takes two
    milliseconds. httpx costs 160ms to import and urllib.request 57ms -- both of
    them more than everything else on this path put together, for a fixed POST
    to a known local port that answers a small JSON object. Measured end to end,
    the summons went from 308ms to about 45.

    Three outcomes, and the caller needs all three kept apart -- they are the
    whole single-instance decision (see `run_tray`):

    * **raises `OSError`** -- nothing is listening on the port. It is free.
    * **returns `None`** -- something answered, but not with JSON we understand.
      That is somebody else's server sitting on our port, not AMETHYST.
    * **returns a dict** -- AMETHYST answered. `native` says whether a desktop
      shell with real windows heard it, or only browser tabs.
    """
    import json
    import socket

    payload = json.dumps(body).encode() if body else b""
    request = (
        f"POST /api/control/{action} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(payload)}\r\n"
        "Connection: close\r\n\r\n"
    ).encode() + payload

    # Deliberately outside the try: a refused connection is the "port is free"
    # answer and must reach the caller, not be flattened into "no".
    sock = socket.create_connection(("127.0.0.1", port), timeout)
    try:
        with sock:
            sock.sendall(request)
            reply = b""
            while chunk := sock.recv(4096):
                reply += chunk
    except Exception:
        return None
    try:
        parsed = json.loads(reply.rsplit(b"\r\n\r\n", 1)[-1])
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _control_or_none(port: int, action: str, timeout: float = 1.5, **body: Any):
    """`_control`, with a free port folded into the same `None` as a stranger.

    For the callers that only want "did AMETHYST take it" and have their own
    fallback either way.
    """
    try:
        return _control(port, action, timeout, **body)
    except OSError:
        return None


def _activation_token() -> dict[str, Any]:
    """The compositor's permission to raise a window, if this process has one.

    GNOME grants focus to the window whose activation token it issued, and that
    token belongs to the process the keyboard shortcut launched -- this one --
    rather than to the daemon that owns the window. Forwarding it is what makes
    the difference between a window that appears in front and one that appears
    behind what you were looking at.
    """
    token = os.environ.get("XDG_ACTIVATION_TOKEN") or os.environ.get("DESKTOP_STARTUP_ID")
    return {"token": token} if token else {}


def _summon(port: int, action: str, fallback_path: str, timeout: float = 1.5) -> bool:
    """Ask the running AMETHYST for a window; start one if there is none.

    Shared by the palette and the show paths, which differ only in which verb
    they send and where they land if nothing is running.

    Returns True when a running AMETHYST took it.
    """
    body = _activation_token()
    try:
        answer = _control(port, action, timeout, **body)
        if answer and answer.get("delivered"):
            return True
        if answer is None:
            # Something that is not AMETHYST holds the port. Launching the daemon
            # would only fail to bind, so go straight to the fallback.
            answer = None
    except OSError:
        # Nothing is serving. This is the case where the keyboard shortcut is the
        # only thing alive; start the daemon and retry rather than opening the
        # browser as the first action.
        if _launch_desktop_daemon(port):
            import time

            for _ in range(60):
                time.sleep(0.15)
                with contextlib.suppress(OSError):
                    if (_control(port, action, timeout, **body) or {}).get("delivered"):
                        return True

    import webbrowser

    webbrowser.open(url_for(port, fallback_path))
    return False


def summon_palette(port: int = DEFAULT_PORT, timeout: float = 1.5) -> bool:
    """Show the command palette, from wherever it has to come from.

    Two cases, and the daemon is the one that can tell them apart. If a window
    is open it is already listening on the control stream, and a nudge puts the
    palette up in the window the user is looking at. If none is, nothing hears
    the nudge and a window is opened on the palette instead.

    Returns True when an existing window took it. Shared by the hotkey, the tray
    menu and `amethyst palette`, so all three behave identically.
    """
    return _summon(port, "palette", "/?cmd=palette", timeout)


def summon_window(port: int = DEFAULT_PORT, timeout: float = 1.5) -> bool:
    """Raise the application window. The other half of the palette's summons.

    This is what a global "open AMETHYST" shortcut and a second launch from the
    application icon both do. The palette is for doing one thing without going
    anywhere; this is for going there.
    """
    return _summon(port, "show", "/", timeout)


def _port_from_argv(argv: list[str] | None) -> int:
    import sys as _sys

    port = DEFAULT_PORT
    args = _sys.argv[1:] if argv is None else argv
    for i, arg in enumerate(args):
        if arg == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
        elif arg.startswith("--port="):
            port = int(arg.split("=", 1)[1])
    return port


def main_palette(argv: list[str] | None = None) -> int:
    """`amethyst-palette`: the palette shortcut's entry point.

    Its own console script rather than a subcommand of `amethyst`, because
    `backend.cli` imports the director, the tool registry and the database layer
    at module scope -- about a quarter of a second, paid on every press of a key
    whose whole job takes two milliseconds. Nothing here imports more than the
    standard library.
    """
    summon_palette(_port_from_argv(argv))
    return 0


def main_show(argv: list[str] | None = None) -> int:
    """`amethyst-show`: bring AMETHYST's window up, starting it if it is not on.

    The twin of `amethyst-palette`, and the thing a desktop environment's own
    shortcut settings should be pointed at -- on Wayland that is the only route
    to a global chord, because the compositor refuses the grab `run_tray` would
    otherwise take. Same stdlib-only budget, for the same reason.
    """
    summon_window(_port_from_argv(argv))
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


def _api_answers(port: int, timeout: float = 5.0) -> bool:
    """Whether /api/ping answers with the JSON it is supposed to.

    `server.started` says uvicorn finished its startup, which is a claim about
    this process. This is the claim the *interface* depends on: that a request
    goes in over a socket, through routing, and comes back as the right JSON. It
    is the same probe the Docker healthcheck and the frontend's own cold-start
    wake already use, deliberately -- a third idea of what "ready" means is a
    third thing to keep true.

    Cheap enough to be worth doing properly: /api/ping touches no database, no
    provider and no connector.
    """
    import json
    import socket

    request = (
        "GET /api/ping HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Connection: close\r\n\r\n"
    ).encode()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), 2.0) as sock:
                sock.sendall(request)
                reply = b""
                while chunk := sock.recv(4096):
                    reply += chunk
            body = json.loads(reply.rsplit(b"\r\n\r\n", 1)[-1])
            if body.get("status") == "ok":
                return True
        except Exception:
            pass
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


def _launcher_command() -> str:
    """An absolute path to the `amethyst` console script, for a .desktop Exec.

    It has to be absolute. A desktop entry is run by the session with an
    arbitrary working directory, so `Exec=.venv/bin/amethyst desktop` -- which is
    what `sys.argv[0]` gives when the app was started as `.venv/bin/amethyst` --
    is a launcher icon that silently does nothing. That is the one thing the
    entry exists to make work.

    PATH first, because an installed console script is the stable name; the
    running program's own path second, absolutised, which covers a venv that is
    not on PATH.
    """
    import shutil

    found = shutil.which("amethyst")
    if found:
        return found
    argv0 = sys.argv[0]
    if os.sep in argv0 or not shutil.which(argv0):
        return os.path.abspath(argv0)
    return shutil.which(argv0) or os.path.abspath(argv0)


def _autostart_argv() -> list[str]:
    """What login should run. The installed console script where there is one.

    The fallback runs the module, which only works from a checkout -- true of a
    machine that never installed the package, and the same place its `run.sh`
    lives.
    """
    import shutil

    # `--background`: login means "be available", not "put a window on screen".
    # Clicking the application icon is the other entry point and it presents.
    exe = shutil.which("amethyst")
    if exe:
        return [exe, "desktop", "--background"]
    return [sys.executable, "-m", "backend.cli", "desktop", "--background"]


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
        "Icon=amethyst\n"
        "StartupWMClass=amethyst\n"
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


# --------------------------------------------------------- the desktop shortcut

#: Where GNOME keeps user-defined chords. A list of paths in one key, and a
#: name/command/binding triple at each path.
_GNOME_MEDIA_KEYS = "org.gnome.settings-daemon.plugins.media-keys"
_GNOME_CUSTOM = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding"
_GNOME_PATH = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/amethyst/"


def _gnome_chord(hotkey: str) -> str:
    """pynput's chord spelling, in GNOME's.

    `<ctrl>+<alt>+<space>` -> `<Control><Alt>space`. The two notations agree on
    almost nothing: pynput joins with `+` and lowercases, GNOME concatenates and
    capitalises, and they disagree about the name of the control key.
    """
    names = {"ctrl": "Control", "control": "Control", "alt": "Alt", "shift": "Shift",
             "super": "Super", "cmd": "Super", "win": "Super"}
    mods, key = [], ""
    for part in hotkey.split("+"):
        bare = part.strip().strip("<>").lower()
        if bare in names:
            mods.append(f"<{names[bare]}>")
        else:
            key = bare
    return "".join(mods) + key


def install_shortcut(hotkey: str = DEFAULT_HOTKEY) -> tuple[bool, str]:
    """Bind the chord in the desktop environment's own shortcut settings.

    This exists because of Wayland. A global key grab is refused there by
    design, so `_start_hotkey` cannot work and the only route to a global chord
    is to ask the desktop environment to run a command -- which is exactly what
    `amethyst-show` is for.

    Deliberately an explicit command and not something a launch does by itself:
    this writes into a list of the user's own keybindings, it can collide with a
    chord they already use, and doing it on every start would silently put back
    one they had deliberately removed.

    GNOME only for now. KDE's equivalent lives in `kglobalshortcutsrc` and needs
    a `kglobalaccel` reload to take effect, which is a lot of machinery for a
    second desktop; there, and everywhere else, this says what to bind by hand.
    """
    import shutil
    import subprocess

    exe = shutil.which("amethyst-show") or "amethyst-show"
    chord = _gnome_chord(hotkey)

    if not shutil.which("gsettings"):
        return False, (
            f"bind this command to {hotkey} in your desktop's keyboard settings:\n"
            f"  {exe}"
        )

    def gset(*argv: str) -> None:
        subprocess.run(["gsettings", *argv], check=True, capture_output=True, timeout=5)

    try:
        listed = subprocess.run(
            ["gsettings", "get", _GNOME_MEDIA_KEYS, "custom-keybindings"],
            check=True, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        # "@as []" is how GNOME spells an empty list of strings.
        paths = [] if "[]" in listed else [
            piece.strip().strip("'\"") for piece in listed.strip("[]").split(",") if piece.strip()
        ]
        if _GNOME_PATH not in paths:
            paths.append(_GNOME_PATH)
            gset("set", _GNOME_MEDIA_KEYS, "custom-keybindings",
                 "[" + ", ".join(f"'{q}'" for q in paths) + "]")
        base = f"{_GNOME_CUSTOM}:{_GNOME_PATH}"
        gset("set", base, "name", "AMETHYST")
        gset("set", base, "command", exe)
        gset("set", base, "binding", chord)
    except Exception as exc:
        return False, (
            f"could not set the shortcut ({exc}).\n"
            f"bind this command to {hotkey} by hand in your keyboard settings:\n  {exe}"
        )
    return True, f"{hotkey} now opens AMETHYST (runs {exe})"


def uninstall_shortcut() -> tuple[bool, str]:
    """Take the binding back out of the desktop environment's list."""
    import shutil
    import subprocess

    if not shutil.which("gsettings"):
        return True, "nothing to remove (no gsettings on this machine)"
    try:
        listed = subprocess.run(
            ["gsettings", "get", _GNOME_MEDIA_KEYS, "custom-keybindings"],
            check=True, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        paths = [] if "[]" in listed else [
            piece.strip().strip("'\"") for piece in listed.strip("[]").split(",") if piece.strip()
        ]
        if _GNOME_PATH not in paths:
            return True, "nothing was bound"
        paths.remove(_GNOME_PATH)
        value = "@as []" if not paths else "[" + ", ".join(f"'{q}'" for q in paths) + "]"
        subprocess.run(
            ["gsettings", "set", _GNOME_MEDIA_KEYS, "custom-keybindings", value],
            check=True, capture_output=True, timeout=5,
        )
    except Exception as exc:
        return False, f"could not remove the shortcut ({exc})"
    return True, "the AMETHYST shortcut was removed"


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


#: The application icon, best first.
#:
#: `icon.png` is the real one: a purpose-made 512x512 app icon, the crystal on
#: its rounded tile, drawn to be seen at dock size. `logo.png` is the same mark
#: without the tile. The SVGs are last and `favicon.svg` is last of all -- it is
#: a different drawing entirely, made for a browser tab, and using it meant the
#: desktop application wore a logo that appears nowhere else in the product.
_ICON_CANDIDATES = ("icon.png", "logo.png", "logo.svg", "favicon.svg")


def _logo_path() -> "pathlib.Path | None":
    """Absolute path to the best available application icon, or None.

    Resolves relative to this file's location so it works regardless of
    working directory.
    """
    from pathlib import Path

    public = Path(__file__).parent.parent / "frontend" / "public"
    for name in _ICON_CANDIDATES:
        candidate = public / name
        if candidate.exists():
            return candidate
    return None


@lru_cache(maxsize=1)
def _icon_image():
    """The application icon: the real mark, at 256x256 RGBA.

    Cached: `_install_xdg_assets`, `_build_icon` and `_icon_png_path` each ask
    for it on every boot, and each ask was a fresh rasterisation of the same
    file at the same size.

    A PNG is opened directly by Pillow, which is the usual case and needs no
    GTK. An SVG is rasterised by GdkPixbuf, which is present wherever the GTK
    backend is; that path does not exist on macOS or Windows, which is one
    reason a ready-made PNG is preferred. See `_ICON_CANDIDATES` for the order.

    Falls back to a hand-drawn diamond only when there is no usable file at
    all, so the tray always has something to show.
    """
    from PIL import Image

    source = _logo_path()
    if source is not None:
        if source.suffix.lower() == ".png":
            try:
                return Image.open(source).convert("RGBA").resize((256, 256), Image.LANCZOS)
            except Exception:
                pass
        else:
            try:
                import gi

                gi.require_version("GdkPixbuf", "2.0")
                from gi.repository import GdkPixbuf

                pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(source), 256, 256, True)
                raw = pb.get_pixels()
                mode = "RGBA" if pb.get_has_alpha() else "RGB"
                img = Image.frombytes(
                    mode, (pb.get_width(), pb.get_height()), raw, "raw", mode, pb.get_rowstride()
                )
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
    import shlex
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

        exe = _launcher_command()

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

    # Every attribute here is underscore-prefixed, and that is load-bearing
    # rather than style. pywebview builds the JavaScript API by walking `dir()`
    # of this object and *recursing into any public attribute that is a
    # non-callable object* (`webview/util.py`, `get_functions`) -- so a plain
    # `self.main = <Window>` exposed the entire Window API, and the GTK widget
    # underneath it, to any script running in the page. That is a 300KB
    # `_createApi` payload that crashed the bridge outright, and a back door
    # into the process for anything the page loads. Names starting with `_` are
    # skipped, which is the whole fix.
    def __init__(self) -> None:
        self._spotlight = None
        self._main = None
        #: Set by the page itself, once, when React has committed a tree.
        #: This is the difference between "the window has a URL" and "there is
        #: an interface in it", and it is the last gate before the window is
        #: shown.
        #:
        #: Mount rather than paint, and that is forced: a hidden window is not
        #: composited, so WebKit never runs a requestAnimationFrame callback in
        #: one. Waiting for a paint deadlocked -- the window was not shown until
        #: it painted, and could not paint until it was shown.
        self._painted = threading.Event()

    def ready(self, which: str = "main") -> None:
        """Called by the page once it has mounted. See `frontend/src/main.jsx`.

        Everything the shell can check by itself -- the server answering, the
        URL loading -- says the application *should* come up. This is the page
        saying it *has*.
        """
        if which == "main":
            self._painted.set()

    def hide(self) -> None:
        if self._spotlight is not None:
            with contextlib.suppress(Exception):
                self._spotlight.hide()
            # The toggle flag tracks this window, and the bridge is one of the
            # two things that ever hides it (Esc from the page is the other,
            # and it comes through here).
            _spotlight_up.clear()

    def open_main(self, path: str = "", prompt: str = "") -> None:
        """For the commands that are a place rather than an action.

        `prompt` carries a question the bar was asked but cannot answer: the
        spotlight is its own window with its own React tree, so it has no Chat
        to hand one to. Without this, "Ask AMETHYST" from the bar flashed
        "Done", closed, opened the main window on an empty composer, and lost
        the question.

        `evaluate_js` on a window pywebview has not finished creating blocks the
        caller for twenty seconds and then raises (see `webview/window.py`), so
        the navigation is only attempted once the page has said it painted.
        """
        if self._main is not None:
            if path and self._painted.is_set():
                clean_path = "/" + path.lstrip("/")
                # json.dumps, not an f-string quote: `prompt` is whatever the
                # user typed into the bar, and a lone apostrophe in it ("what's
                # a monad") would otherwise end the JS string literal and throw
                # away the rest of the question.
                import json

                with contextlib.suppress(Exception):
                    self._main.evaluate_js(
                        "window.__amethyst_navigate && window.__amethyst_navigate("
                        f"{json.dumps(clean_path)}, {json.dumps(prompt or None)})"
                    )
            _present(self._main)
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

    Returning False is what cancels the close. That reads backwards and is worth
    stating once: pywebview's `Event.set` collects every handler's return value
    and cancels if any of them is exactly `False` (`webview/event.py`), so False
    means "no, do not close" rather than "no, do not cancel".

    Cancelling was all this used to do, and that is why the close button
    appeared dead: the destroy was refused and nothing hid the window, so
    clicking X left it exactly where it was. The hide has to happen here.
    """

    def _closing() -> bool:
        if _QUITTING.is_set():
            return True  # a real quit: nothing is False, so the close proceeds
        with contextlib.suppress(Exception):
            window.hide()
        # The spotlight is the window whose visibility this process tracks, and
        # Esc is not the only way it gets put away.
        _spotlight_up.clear()
        return False  # cancel the destroy; it is hidden, not gone

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
    # Created blank and navigated later, by `_gate`, once the server answers.
    #
    # Two things fall out of that. GTK and WebKit initialise while the backend is
    # still importing and booting -- a few hundred milliseconds that used to be
    # spent one after the other and are now spent at the same time. And a window
    # that exists before there is anything to put in it is also the window an
    # unrecoverable startup failure can be *reported* in, with `load_html`,
    # instead of the user getting a silent process and no clue.
    #
    # Both windows are created here, before `webview.start()`, and that is not
    # optional: pywebview's GTK backend only honours `hidden=True` while the GTK
    # loop is not yet running (`platforms/gtk.py`), so a window created later
    # appears on screen whatever the flag says. Creating the spotlight lazily is
    # therefore off the table.
    main = webview.create_window(
        "AMETHYST", html="", width=1180, height=800, hidden=True, js_api=bridge
    )
    spotlight = webview.create_window(
        "AMETHYST",
        html="",
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
    bridge._spotlight, bridge._main = spotlight, main
    for window in (main, spotlight):
        _hide_rather_than_close(window)

    # Telling the page it is visible, which is the one thing a page cannot work
    # out for itself here.
    #
    # `shown` is NOT enough on its own, though it long claimed to be. It is
    # bound to `notify::visible` on the *webview widget* (`platforms/gtk.py`,
    # `on_webview_ready`), and hiding the window does not change that widget's
    # visible property -- so it fires once, on the first reveal, and never
    # again. Measured: three hide/show cycles produced one event. Everything
    # hung on it was therefore first-summon-only, including refocusing the
    # input and replaying the open animation.
    #
    # So the event covers the first reveal and `notify_spotlight_shown` is
    # called explicitly by whoever shows the window after that. Calling it twice
    # would be harmless; never calling it is what was wrong.
    spotlight.events.shown += lambda: notify_spotlight_shown(spotlight)
    return main, spotlight, bridge


def notify_spotlight_shown(window) -> None:
    """Tell the spotlight page it has just been put on screen.

    The bar is one permanently-mounted page whose window is hidden and shown
    around it, so "it appeared" is not something the page can observe: nothing
    re-mounts, no CSS animation restarts, and focus stays wherever it was.
    """
    with contextlib.suppress(Exception):
        window.evaluate_js(
            "window.__amethyst_spotlight_shown && window.__amethyst_spotlight_shown()"
        )


def _present(window, *, pinned: bool = False, token: str | None = None) -> None:
    """Put the window in front, from whichever thread asked for it.

    `on_top` is pinned for a moment rather than left on. A compositor that
    prevents focus stealing will otherwise raise a summoned window *behind* the
    one the user was looking at, which is indistinguishable from not showing it;
    and leaving it pinned would mean using AMETHYST as an ordinary window meant one
    that floats over everything else forever.

    `token` is the compositor's permission to raise a window, forwarded from the
    process the shortcut actually launched (`amethyst-show`, `amethyst-palette`).
    GNOME grants focus to the window whose activation token it issued, and that
    token belongs to *that* process rather than to this one -- so without it the
    window comes up behind whatever the user was looking at, which is
    indistinguishable from not showing it. Best-effort: a compositor that does
    not do activation tokens simply has none to forward, and the window still
    shows.
    """
    if token:
        with contextlib.suppress(Exception):
            window.native.set_startup_id(token)
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


#: What the window says when the backend genuinely could not start. Deliberately
#: plain: no retry button that would need a working backend to mean anything, and
#: no spinner pretending something is still happening. The person who sees this
#: launched from an application icon and has no terminal to read.
_ERROR_HTML = """<!doctype html><html><head><meta charset="utf-8">
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; height: 100vh; display: flex; align-items: center;
         justify-content: center; background: #131317; color: #e8e8ec;
         font: 15px/1.6 system-ui, -apple-system, Segoe UI, sans-serif; }}
  main {{ max-width: 34rem; padding: 2rem; }}
  h1 {{ font-size: 1.15rem; margin: 0 0 .75rem; font-weight: 600; }}
  p {{ margin: 0 0 .75rem; color: #a5a5b0; }}
  code {{ background: #1e1e24; padding: .15rem .4rem; border-radius: 4px;
          font-size: .9em; color: #c4b5fd; }}
</style></head><body><main>
<h1>AMETHYST could not start</h1>
<p>{msg}</p>
<p>Run <code>amethyst doctor</code> in a terminal to see what is wrong, or
   <code>amethyst serve</code> to watch it start with the log in front of you.</p>
</main></body></html>"""


def _already_running(port: int) -> int | None:
    """Hand the running AMETHYST this launch, if there is one. Returns an exit code.

    The listening socket is the lock, and the reply is what disambiguates it.
    Binding the port is already an atomic, kernel-held mutex that is released on
    crash and cannot go stale -- and it is the actual contended resource, since
    two servers on one SQLite file is the thing that must never happen. What a
    port alone cannot tell you is *who* holds it, and that is what the control
    reply answers:

    * nothing listening -> None, and the caller boots normally;
    * AMETHYST with windows -> it raised them, and this launch is done;
    * AMETHYST with no windows (a bare `amethyst serve`) -> nothing to raise, so
      open the interface in a browser rather than starting a second server that
      could only fail to bind;
    * anything else -> someone else's server is on our port, and that is a real
      error with a readable cause rather than a confusing bind failure.
    """
    try:
        answer = _control(port, "show", timeout=2.0, **_activation_token())
    except OSError:
        return None  # the port is free; this launch is the one that boots

    if answer is None:
        print(
            f"! something that is not AMETHYST is already listening on port {port}.",
            file=sys.stderr,
        )
        print("! stop it, or start AMETHYST on another port:  amethyst desktop --port 8001",
              file=sys.stderr)
        return 1

    if answer.get("native"):
        # A desktop shell owns the windows and has just raised them. Nothing to
        # say -- the user pressed an icon and a window came up, which is the
        # whole of what they asked for.
        return 0

    print(f"AMETHYST is already running at {url_for(port)} without a window.")
    import webbrowser

    webbrowser.open(url_for(port))
    return 0


def run_tray(
    host: str = "127.0.0.1",
    port: int = DEFAULT_PORT,
    hotkey: str = DEFAULT_HOTKEY,
    log_level: str = "warning",
    open_browser: bool = False,
    native_window: bool = True,
    present: bool = True,
) -> int:
    """Serve, sit in the background, and show the window when asked.

    `present` is what separates the two ways this is started. Clicking the
    application icon means "open AMETHYST", so the window is shown as soon as
    there is something in it to show. Starting at login means "be available",
    so it stays hidden until something asks for it -- a window appearing on its
    own at login is not what running in the background means.
    """
    # Single instance, before anything is started. See `_already_running`.
    existing = _already_running(port)
    if existing is not None:
        return existing

    signals = _block_signals()  # before any thread exists; see the docstring

    # What the remote-caller guard in backend/api/main.py reads. `amethyst serve`
    # has always set this (see cli.py) and this path never did, which meant
    # `amethyst desktop --host 0.0.0.0` published the entire API to the network
    # with the guard reading the loopback default and standing down. Now that the
    # desktop command is how the application is started, that is the door.
    from backend.api.main import BIND_HOST_ENV, BIND_PORT_ENV

    os.environ[BIND_HOST_ENV] = str(host)
    os.environ[BIND_PORT_ENV] = str(port)

    server, thread = _serve_in_thread(host, port, log_level)

    # Neither of these gates anything, and both are slow enough to be worth not
    # waiting for: the icon install rasterises an SVG and shells out to
    # `gtk-update-icon-cache` with a three second timeout, and the hotkey grab
    # talks to the display server. They run while uvicorn boots.
    def _background_setup() -> None:
        _install_xdg_assets()
        problem = _hotkey_unavailable_reason() or _start_hotkey(
            hotkey, lambda: summon_palette(port)
        )
        if problem:
            print(f"! no global hotkey: {problem}")
            print("  bind a key to `amethyst-show` (and `amethyst-palette`) in your")
            print("  desktop's own shortcut settings:  amethyst desktop --install-shortcut")
        else:
            print(f"press {hotkey} anywhere for the command palette")

    threading.Thread(target=_background_setup, name="amethyst-setup", daemon=True).start()

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

    if window is None:
        # No GUI to gate. The readiness wait is still the thing that decides
        # whether this process is worth keeping, so it happens here instead.
        if not _wait_until_serving(server, thread):
            if _already_running(port) == 0:
                return 0  # lost the race to another launch; it has the window
            print(f"! the API did not come up on {url_for(port)}", file=sys.stderr)
            return 1
        print(f"AMETHYST is running at {url_for(port)}")
        if open_browser or present:
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
        def _toggle_spotlight(_body=None):
            if _spotlight_up.is_set():
                with contextlib.suppress(Exception):
                    spotlight.hide()
                _spotlight_up.clear()
                return
            _spotlight_up.set()
            _present(spotlight, pinned=True)
            notify_spotlight_shown(spotlight)

        def _show_main(body=None):
            """Raise the application window. The second launch and the shortcut."""
            _present(main, token=(body or {}).get("token"))

        api.on_control("palette", _toggle_spotlight)
        api.on_control("show", _show_main)
        api.on_control("pairing_request", _show_main)

        def _fail(message: str) -> None:
            """Say why, in the window, and let the close button mean quit.

            `_QUITTING` is set because `_hide_rather_than_close` would otherwise
            turn the close button on an error window into "hide" -- leaving a
            process the user cannot get rid of and cannot see.
            """
            print(f"! {message}", file=sys.stderr)
            _QUITTING.set()
            with contextlib.suppress(Exception):
                main.load_html(_ERROR_HTML.format(msg=message))
            _present(main)

        def _gate() -> None:
            """Bring the application up in order, then show it. Runs off the GTK loop.

            Every step here is a real check on a real thing. Nothing sleeps for a
            fixed time and nothing is presented on a guess:

            1. uvicorn reports started -- and because uvicorn only sets that flag
               after the lifespan's startup has returned, that already means every
               background runner is up and the database is open.
            2. /api/ping answers with the JSON it is supposed to, which proves
               routing works and not merely that a socket is open.
            3. the page is loaded, and says for itself that it has painted.

            Only then is the window shown. A failure in 1 or 2 is unrecoverable
            and is shown as such; a failure in 3 is not, because by then the
            interface owns the problem and has its own way of saying so.
            """
            began = time.monotonic()

            def mark(stage: str) -> None:
                """Say how long each stage took, on the stream the user can see.

                `log.info` alone was invisible here: uvicorn configures its own
                loggers and nothing configures `backend.desktop`, so the
                instrumentation that exists to explain a slow launch printed
                nothing at all. The log line stays for anyone capturing logs;
                the print is what makes it useful from a terminal.
                """
                elapsed = time.monotonic() - began
                log.info("startup: %s at +%.2fs", stage, elapsed)
                if log_level in ("debug", "info", "trace"):
                    print(f"  startup: {stage} at +{elapsed:.2f}s")

            if not _wait_until_serving(server, thread):
                # Losing a race to another launch looks exactly like failing to
                # start, because the symptom is the same: the port was taken. Ask
                # who has it before calling this a failure.
                if _already_running(port) == 0:
                    mark("another instance won the port")
                    shutdown()
                    return
                _fail("the backend did not start.")
                return
            mark("backend serving")

            if not _api_answers(port):
                _fail("the backend started but is not answering.")
                return
            mark("api answering")

            with contextlib.suppress(Exception):
                main.load_url(url_for(port, "/?native=1"))
            with contextlib.suppress(Exception):
                spotlight.load_url(url_for(port, "/?spotlight=1&native=1"))
            mark("interface loading")

            if icon is not None:
                # The GTK loop is running by now, which is the one it hooks into.
                with contextlib.suppress(Exception):
                    icon.run_detached()

            print(f"AMETHYST is running at {url_for(port)}")
            if not present:
                print("its window stays hidden until you ask for it")
                return

            # The last gate, and a soft one. If the page has not said it
            # mounted within a few seconds it is not coming up any faster for
            # being waited on, and the interface has its own "the backend is
            # down" state, which is a better thing to show than a window that
            # never appears.
            if not _bridge._painted.wait(8.0):
                log.warning("the interface did not report that it mounted; showing anyway")
            mark("interface mounted")
            _present(main)

        icon_path = _icon_png_path()
        try:
            # `func` runs on a worker thread as soon as the GUI loop is up, so the
            # readiness wait overlaps GTK and WebKit initialising rather than
            # following it.
            webview.start(func=_gate, icon=icon_path)  # blocks the main thread, which GTK requires
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
