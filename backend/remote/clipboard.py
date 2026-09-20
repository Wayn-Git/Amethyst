"""System clipboard synchronization via GTK Clipboard with Wayland/X11 fallbacks."""

from __future__ import annotations

import logging
import subprocess
from typing import Any

log = logging.getLogger(__name__)


def get_clipboard() -> dict[str, Any]:
    """Retrieve current text content from the PC clipboard."""
    # 1. Try GTK Clipboard via PyGObject (most reliable on Linux desktop sessions)
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk, Gdk
        cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        text = cb.wait_for_text()
        if text is not None:
            return {"ok": True, "text": text}
    except Exception:
        pass

    # 2. Try wl-paste (Wayland)
    try:
        res = subprocess.run(["wl-paste", "--no-newline"], capture_output=True, text=True, timeout=2)
        if res.returncode == 0:
            return {"ok": True, "text": res.stdout}
    except Exception:
        pass

    # 3. Try xclip / xsel (X11 / XWayland)
    for cmd in [["xclip", "-o", "-selection", "clipboard"], ["xsel", "--clipboard", "--output"]]:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
            if res.returncode == 0:
                return {"ok": True, "text": res.stdout}
        except Exception:
            continue

    return {"ok": True, "text": ""}


def set_clipboard(text: str) -> dict[str, Any]:
    """Set text content on the PC clipboard."""
    content = str(text)

    # 1. Try GTK Clipboard
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk, Gdk
        cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        cb.set_text(content, -1)
        cb.store()
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        return {"ok": True, "length": len(content)}
    except Exception:
        pass

    # 2. Try wl-copy (Wayland)
    try:
        p = subprocess.run(["wl-copy"], input=content, text=True, timeout=2)
        if p.returncode == 0:
            return {"ok": True, "length": len(content)}
    except Exception:
        pass

    # 3. Try xclip / xsel
    for cmd in [["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]:
        try:
            p = subprocess.run(cmd, input=content, text=True, timeout=2)
            if p.returncode == 0:
                return {"ok": True, "length": len(content)}
        except Exception:
            continue

    return {"ok": False, "error": "Could not access system clipboard"}
