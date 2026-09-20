"""Amethyst Remote Subsystem for secure phone companion interaction."""

from backend.remote.system import (
    get_system_status,
    list_processes,
    kill_process,
    list_applications,
    launch_application,
    run_terminal_command,
)
from backend.remote.media import (
    get_volume,
    set_volume,
    get_mute,
    set_mute,
    list_sinks,
    set_default_sink,
    media_control,
    get_media_status,
)
from backend.remote.power import (
    lock_screen,
    suspend_pc,
    reboot_pc,
    poweroff_pc,
    get_wake_info,
)
from backend.remote.input import (
    mouse_move,
    mouse_click,
    mouse_scroll,
    keyboard_type,
    keyboard_press,
    keyboard_combo,
)
from backend.remote.clipboard import (
    get_clipboard,
    set_clipboard,
)
from backend.remote.screen import (
    capture_screenshot,
    screen_stream_generator,
)
from backend.remote.camera import (
    list_cameras,
    capture_camera_frame,
    camera_stream_generator,
    stop_camera,
    is_camera_active,
)
from backend.remote.audio import (
    get_audio_state,
    set_mic_active,
    is_mic_active,
)
from backend.remote.files import (
    list_transfer_files,
    save_transfer_file,
    get_transfer_path,
    delete_transfer_file,
)
from backend.remote.router import router

__all__ = [
    "get_system_status",
    "list_processes",
    "kill_process",
    "list_applications",
    "launch_application",
    "run_terminal_command",
    "get_volume",
    "set_volume",
    "get_mute",
    "set_mute",
    "list_sinks",
    "set_default_sink",
    "media_control",
    "get_media_status",
    "lock_screen",
    "suspend_pc",
    "reboot_pc",
    "poweroff_pc",
    "get_wake_info",
    "mouse_move",
    "mouse_click",
    "mouse_scroll",
    "keyboard_type",
    "keyboard_press",
    "keyboard_combo",
    "get_clipboard",
    "set_clipboard",
    "capture_screenshot",
    "screen_stream_generator",
    "list_cameras",
    "capture_camera_frame",
    "camera_stream_generator",
    "stop_camera",
    "is_camera_active",
    "get_audio_state",
    "set_mic_active",
    "is_mic_active",
    "list_transfer_files",
    "save_transfer_file",
    "get_transfer_path",
    "delete_transfer_file",
    "router",
]
