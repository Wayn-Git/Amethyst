"""Mouse and keyboard input synthesis via pynput."""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

# Initialize controllers
_mouse = None
_keyboard = None


def _get_mouse():
    global _mouse
    if _mouse is None:
        try:
            import pynput.mouse
            _mouse = pynput.mouse.Controller()
        except Exception as e:
            log.warning("Could not initialize pynput mouse controller: %s", e)
    return _mouse


def _get_keyboard():
    global _keyboard
    if _keyboard is None:
        try:
            import pynput.keyboard
            _keyboard = pynput.keyboard.Controller()
        except Exception as e:
            log.warning("Could not initialize pynput keyboard controller: %s", e)
    return _keyboard


def mouse_move(
    dx: float = 0.0,
    dy: float = 0.0,
    absolute: bool = False,
    x: float | None = None,
    y: float | None = None,
    screen_width: int = 1920,
    screen_height: int = 1080,
) -> dict[str, Any]:
    """Move the mouse cursor relatively or absolutely."""
    mouse = _get_mouse()
    if not mouse:
        return {"ok": False, "error": "Mouse controller unavailable"}
    try:
        if absolute and x is not None and y is not None:
            # If coordinates are ratios (0.0 - 1.0)
            target_x = int(x * screen_width) if 0.0 <= x <= 1.0 else int(x)
            target_y = int(y * screen_height) if 0.0 <= y <= 1.0 else int(y)
            mouse.position = (target_x, target_y)
        else:
            mouse.move(int(dx), int(dy))
        return {"ok": True, "position": mouse.position}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def mouse_click(button: str = "left", double: bool = False) -> dict[str, Any]:
    """Click mouse button (left, right, middle)."""
    mouse = _get_mouse()
    if not mouse:
        return {"ok": False, "error": "Mouse controller unavailable"}
    try:
        import pynput.mouse
        btn_map = {
            "left": pynput.mouse.Button.left,
            "right": pynput.mouse.Button.right,
            "middle": pynput.mouse.Button.middle,
        }
        btn = btn_map.get(button.lower(), pynput.mouse.Button.left)
        count = 2 if double else 1
        mouse.click(btn, count)
        return {"ok": True, "button": button, "double": double}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def mouse_scroll(dx: int = 0, dy: int = 0) -> dict[str, Any]:
    """Scroll mouse wheel."""
    mouse = _get_mouse()
    if not mouse:
        return {"ok": False, "error": "Mouse controller unavailable"}
    try:
        mouse.scroll(dx, dy)
        return {"ok": True, "dx": dx, "dy": dy}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def keyboard_type(text: str) -> dict[str, Any]:
    """Type a string of text directly into the focused window on PC."""
    kb = _get_keyboard()
    if not kb:
        return {"ok": False, "error": "Keyboard controller unavailable"}
    try:
        kb.type(text)
        return {"ok": True, "length": len(text)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _resolve_key(name: str):
    import pynput.keyboard
    k = name.lower().replace("-", "_").strip()
    special = {
        "enter": pynput.keyboard.Key.enter,
        "return": pynput.keyboard.Key.enter,
        "backspace": pynput.keyboard.Key.backspace,
        "tab": pynput.keyboard.Key.tab,
        "esc": pynput.keyboard.Key.esc,
        "escape": pynput.keyboard.Key.esc,
        "space": pynput.keyboard.Key.space,
        "ctrl": pynput.keyboard.Key.ctrl,
        "control": pynput.keyboard.Key.ctrl,
        "alt": pynput.keyboard.Key.alt,
        "shift": pynput.keyboard.Key.shift,
        "super": pynput.keyboard.Key.cmd,
        "cmd": pynput.keyboard.Key.cmd,
        "win": pynput.keyboard.Key.cmd,
        "up": pynput.keyboard.Key.up,
        "arrowup": pynput.keyboard.Key.up,
        "down": pynput.keyboard.Key.down,
        "arrowdown": pynput.keyboard.Key.down,
        "left": pynput.keyboard.Key.left,
        "arrowleft": pynput.keyboard.Key.left,
        "right": pynput.keyboard.Key.right,
        "arrowright": pynput.keyboard.Key.right,
        "delete": pynput.keyboard.Key.delete,
        "home": pynput.keyboard.Key.home,
        "end": pynput.keyboard.Key.end,
        "pageup": pynput.keyboard.Key.page_up,
        "pagedown": pynput.keyboard.Key.page_down,
    }
    if k in special:
        return special[k]
    if len(name) == 1:
        return name
    return None


def keyboard_press(key: str) -> dict[str, Any]:
    """Press and release a single key."""
    kb = _get_keyboard()
    if not kb:
        return {"ok": False, "error": "Keyboard controller unavailable"}
    resolved = _resolve_key(key)
    if resolved is None:
        return {"ok": False, "error": f"Unknown key: {key}"}
    try:
        kb.press(resolved)
        kb.release(resolved)
        return {"ok": True, "key": key}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def keyboard_combo(keys: list[str]) -> dict[str, Any]:
    """Press a key combination simultaneously (e.g. Ctrl+C, Alt+Tab)."""
    kb = _get_keyboard()
    if not kb:
        return {"ok": False, "error": "Keyboard controller unavailable"}
    resolved_keys = [_resolve_key(k) for k in keys]
    if any(k is None for k in resolved_keys):
        return {"ok": False, "error": f"One or more keys unrecognized in {keys}"}
    try:
        # Press in forward order
        for k in resolved_keys:
            kb.press(k)
        # Release in reverse order
        for k in reversed(resolved_keys):
            kb.release(k)
        return {"ok": True, "combo": keys}
    except Exception as e:
        return {"ok": False, "error": str(e)}
