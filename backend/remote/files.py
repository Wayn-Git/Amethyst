"""Secure phone-to-PC file transfer area scoped to ~/Downloads/Amethyst Transfers."""

from __future__ import annotations

import datetime
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

TRANSFER_DIR = Path(os.path.expanduser("~/Downloads/Amethyst Transfers")).resolve()


def _ensure_dir() -> Path:
    TRANSFER_DIR.mkdir(parents=True, exist_ok=True)
    return TRANSFER_DIR


def list_transfer_files() -> list[dict[str, Any]]:
    """List all files in the Amethyst transfer directory."""
    d = _ensure_dir()
    files = []
    try:
        for p in sorted(d.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if p.name.startswith("."):
                continue
            st = p.stat()
            mod_time = datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")
            files.append({
                "name": p.name,
                "size_bytes": st.st_size,
                "size_human": _human_size(st.st_size),
                "modified_at": mod_time,
                "is_dir": p.is_dir(),
            })
    except Exception as e:
        log.error("Could not list transfer directory: %s", e)
    return files


def _human_size(bytes_val: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_val < 1024.0:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.1f} TB"


def save_transfer_file(filename: str, content: bytes) -> dict[str, Any]:
    """Save an uploaded file safely inside the transfer directory."""
    d = _ensure_dir()
    # Strip any directory path components to prevent path traversal
    safe_name = Path(filename).name
    if not safe_name:
        safe_name = "transfer_file.bin"

    target = d / safe_name
    # Avoid accidental overwrites by renaming if duplicate exists
    counter = 1
    base_stem = target.stem
    base_suffix = target.suffix
    while target.exists():
        target = d / f"{base_stem} ({counter}){base_suffix}"
        counter += 1

    target.write_bytes(content)
    st = target.stat()
    return {
        "ok": True,
        "name": target.name,
        "size_bytes": st.st_size,
        "size_human": _human_size(st.st_size),
        "path": str(target),
    }


def get_transfer_path(filename: str) -> Path | None:
    """Resolve and validate a file path within the transfer area."""
    d = _ensure_dir()
    safe_name = Path(filename).name
    target = (d / safe_name).resolve()
    if target.is_file() and target.is_relative_to(d):
        return target
    return None


def delete_transfer_file(filename: str) -> bool:
    """Delete a file in the transfer directory."""
    target = get_transfer_path(filename)
    if target and target.is_file():
        try:
            target.unlink()
            return True
        except Exception:
            pass
    return False
