"""The explicit API surface granted to paired companion devices.

Local administration is deliberately absent. New routes do not automatically
become reachable by a phone holding an otherwise valid token.
"""

import re

from backend.db.connection import get_connection
from backend.sync import devices


def capability(path: str, method: str) -> str | None:
    rules = (
        ("GET", r"/api/mobile/update(?:/apk)?", "paired"),
        ("GET", r"/api/remote/capabilities", "paired"),
        ("POST", r"/api/remote/actions/[^/]+/decision", "paired"),
        ("GET", r"/api/remote/status", "paired"),
        ("GET", r"/api/remote/processes", "system"),
        ("GET", r"/api/remote/applications(?:/icon)?", "system"),
        ("POST", r"/api/remote/(?:command|applications/launch)", "terminal"),
        ("POST", r"/api/remote/processes/kill", "terminal"),
        ("GET|POST", r"/api/remote/power(?:/[^/]+)?", "power"),
        ("GET|POST", r"/api/remote/media(?:/(?:volume|mute|action|sink))?", "audio"),
        ("GET", r"/api/remote/(?:screenshot|screen/stream)", "screen"),
        ("GET|POST", r"/api/remote/camera/(?:list|snapshot|frame|stream|stop)", "webcam"),
        ("POST", r"/api/remote/input/(?:mouse|keyboard)", "input"),
        ("GET|POST", r"/api/remote/clipboard", "clipboard"),
        ("GET|POST|DELETE", r"/api/remote/files(?:/(?:upload|download/[^/]+|[^/]+))?", "files"),
        ("WS", r"/api/remote/ws", "paired"),
        ("GET", r"/api/terminal/(?:shells|sessions)", "terminal"),
        ("POST", r"/api/terminal/sessions", "terminal"),
        ("DELETE", r"/api/terminal/sessions/[^/]+", "terminal"),
        ("WS", r"/api/terminal/ws", "terminal"),
        ("GET|POST", r"/api/conversations", "agent"),
        ("GET", r"/api/conversations/[^/]+/(?:messages|run)", "agent"),
        ("POST", r"/api/conversations/[^/]+/turn(?:/stop)?", "agent"),
        ("GET", r"/api/confirmations", "agent"),
        ("POST", r"/api/confirmations/[^/]+", "agent"),
        ("GET", r"/api/jobs(?:/[^/]+)?", "agent"),
        ("POST", r"/api/jobs/[^/]+/(?:retry|cancel|pause|resume)", "agent"),
        ("GET", r"/api/library(?:/[^/]+(?:/(?:thumbnail|media|slides/\d+))?)?", "library"),
        ("POST", r"/api/mobile/captures", "library"),
        ("GET", r"/api/widgets(?:/[^/]+/(?:data|settings))?", "dashboard"),
        ("POST", r"/api/widgets/[^/]+/refresh", "dashboard"),
        ("GET|PUT", r"/api/layout", "dashboard"),
    )
    for methods, pattern, permission in rules:
        if method in methods.split("|") and re.fullmatch(pattern, path.rstrip("/")):
            return permission
    return None


def allowed(device, permission: str | None) -> bool:
    return bool(
        device and device.revoked_at is None and device.role == "control"
        and permission is not None
        and (permission == "paired" or device.permissions.get(permission) is True)
    )


def current_device(scope):
    """Re-read grants so an open socket does not retain revoked permissions."""
    device = scope.get("device")
    return devices.get_device(get_connection(), device.id) if device else None


def socket_allowed(scope, permission: str) -> bool:
    # Local sockets have no device principal; the outer guard authenticates
    # remote connections before accepting them.
    return "device" not in scope or allowed(current_device(scope), permission)


def frame_capability(payload) -> str | None:
    if isinstance(payload, bytes):
        return "mic"
    if not isinstance(payload, dict):
        return None
    kind = payload.get("type")
    if kind in {"ping", "get_status"}:
        return "paired"
    if kind in {"mouse_move", "mouse_click", "mouse_scroll", "keyboard_type", "keyboard_press", "keyboard_combo"}:
        return "input"
    if kind == "mic_stop":
        return "mic"
    return None
