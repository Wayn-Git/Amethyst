import json
import os
import socket
import tempfile
import threading
import time
from pathlib import Path
import pytest

from backend.desktop import (
    acquire_instance_lock,
    listen_instance_socket,
    _SpotlightBridge,
    _spotlight_up,
)


def test_acquire_instance_lock_primary_and_secondary():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = Path(tmpdir) / "desktop.sock"

        # 1. First instance acquires lock
        server_sock, is_primary = acquire_instance_lock(sock_path)
        assert is_primary is True
        assert server_sock is not None

        received = []
        stop_event = threading.Event()

        def on_command(cmd):
            received.append(cmd)

        thread = threading.Thread(
            target=listen_instance_socket,
            args=(server_sock, on_command, stop_event),
            daemon=True,
        )
        thread.start()

        try:
            # 2. Second instance attempts acquire -> signals running instance
            second_sock, second_primary = acquire_instance_lock(
                sock_path, action="palette"
            )
            assert second_primary is False
            assert second_sock is None

            # Verify primary received command
            for _ in range(50):
                if received:
                    break
                time.sleep(0.02)

            assert len(received) == 1
            assert received[0].get("action") == "palette"
        finally:
            stop_event.set()
            server_sock.close()
            thread.join(timeout=1.0)


def test_acquire_instance_lock_stale_file_recovery():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = Path(tmpdir) / "desktop.sock"

        # Create a dummy stale socket/file that is not listening
        sock_path.touch()

        # Should detect stale file, remove it, and become primary
        server_sock, is_primary = acquire_instance_lock(sock_path)
        assert is_primary is True
        assert server_sock is not None
        server_sock.close()


def test_spotlight_bridge_hide():
    bridge = _SpotlightBridge()
    _spotlight_up.set()

    class DummyWindow:
        def __init__(self):
            self.hidden = False

        def hide(self):
            self.hidden = True

    dummy = DummyWindow()
    bridge._spotlight = dummy

    bridge.hide()
    assert dummy.hidden is True
    assert not _spotlight_up.is_set()
