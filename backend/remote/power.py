"""Power state management: lock, suspend, reboot, poweroff, and Wake-on-LAN."""

from __future__ import annotations

import glob
import os
import subprocess
from typing import Any


def lock_screen() -> dict[str, Any]:
    """Lock the computer session."""
    try:
        res = subprocess.run(["loginctl", "lock-session"], capture_output=True, text=True, timeout=3)
        if res.returncode == 0:
            return {"ok": True, "action": "lock"}
        # Fallback to xdg-screensaver
        res = subprocess.run(["xdg-screensaver", "lock"], capture_output=True, text=True, timeout=3)
        return {"ok": res.returncode == 0, "action": "lock"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def suspend_pc() -> dict[str, Any]:
    """Put PC to sleep / suspend."""
    try:
        subprocess.Popen(["systemctl", "suspend"])
        return {"ok": True, "action": "suspend"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def reboot_pc() -> dict[str, Any]:
    """Reboot the PC."""
    try:
        subprocess.Popen(["systemctl", "reboot"])
        return {"ok": True, "action": "reboot"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def poweroff_pc() -> dict[str, Any]:
    """Shut down the PC."""
    try:
        subprocess.Popen(["systemctl", "poweroff"])
        return {"ok": True, "action": "poweroff"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_wake_info() -> dict[str, Any]:
    """Return MAC addresses and interface names for Wake-on-LAN configuration."""
    interfaces = []
    for iface_path in glob.glob("/sys/class/net/*"):
        iface = os.path.basename(iface_path)
        if iface == "lo" or iface.startswith("docker") or iface.startswith("veth"):
            continue
        mac_path = os.path.join(iface_path, "address")
        if os.path.exists(mac_path):
            try:
                with open(mac_path, "r") as f:
                    mac = f.read().strip()
                if mac and mac != "00:00:00:00:00:00":
                    interfaces.append({"interface": iface, "mac": mac})
            except Exception:
                continue
    return {"wake_interfaces": interfaces}
