"""System status, hardware telemetry, process management, and app launching."""

from __future__ import annotations

import glob
import os
import platform
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

# Cache for CPU delta calculations
_prev_cpu_times: tuple[int, int] | None = None  # (idle, total)


def _get_cpu_usage() -> float:
    global _prev_cpu_times
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
        fields = [int(x) for x in line.split()[1:]]
        idle = fields[3] + fields[4]  # idle + iowait
        total = sum(fields)

        if _prev_cpu_times is None:
            _prev_cpu_times = (idle, total)
            time.sleep(0.05)
            with open("/proc/stat", "r") as f:
                line = f.readline()
            fields = [int(x) for x in line.split()[1:]]
            idle = fields[3] + fields[4]
            total = sum(fields)

        prev_idle, prev_total = _prev_cpu_times
        _prev_cpu_times = (idle, total)

        idle_delta = idle - prev_idle
        total_delta = total - prev_total
        if total_delta > 0:
            usage = 100.0 * (1.0 - (idle_delta / total_delta))
            return max(0.0, min(100.0, round(usage, 1)))
    except Exception:
        pass
    return 0.0


def _get_cpu_info() -> dict[str, Any]:
    info = {"model": "", "cores": os.cpu_count() or 1}
    try:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if "model name" in line:
                    info["model"] = line.split(":", 1)[1].strip()
                    break
    except Exception:
        pass
    return info


def _get_memory_info() -> dict[str, Any]:
    mem: dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    val = parts[1].strip().split()[0]
                    mem[parts[0].strip()] = int(val)
        total_kb = mem.get("MemTotal", 0)
        avail_kb = mem.get("MemAvailable", mem.get("MemFree", 0))
        used_kb = total_kb - avail_kb
        return {
            "total_mb": round(total_kb / 1024, 1),
            "used_mb": round(used_kb / 1024, 1),
            "free_mb": round(avail_kb / 1024, 1),
            "percent": round((used_kb / total_kb) * 100, 1) if total_kb > 0 else 0.0,
        }
    except Exception:
        return {"total_mb": 0.0, "used_mb": 0.0, "free_mb": 0.0, "percent": 0.0}


def _get_disk_info() -> dict[str, Any]:
    try:
        total, used, free = shutil.disk_usage("/")
        return {
            "total_gb": round(total / (1024**3), 1),
            "used_gb": round(used / (1024**3), 1),
            "free_gb": round(free / (1024**3), 1),
            "percent": round((used / total) * 100, 1) if total > 0 else 0.0,
        }
    except Exception:
        return {"total_gb": 0.0, "used_gb": 0.0, "free_gb": 0.0, "percent": 0.0}


def _get_battery_info() -> dict[str, Any] | None:
    batteries = glob.glob("/sys/class/power_supply/BAT*")
    if not batteries:
        return None
    try:
        bat_dir = batteries[0]
        capacity_file = os.path.join(bat_dir, "capacity")
        status_file = os.path.join(bat_dir, "status")
        capacity = 100
        status = "Unknown"
        if os.path.exists(capacity_file):
            with open(capacity_file, "r") as f:
                capacity = int(f.read().strip())
        if os.path.exists(status_file):
            with open(status_file, "r") as f:
                status = f.read().strip()
        return {
            "capacity": capacity,
            "status": status,
            "is_charging": status.lower() in ("charging", "full"),
        }
    except Exception:
        return None


def _get_thermal_info() -> dict[str, Any]:
    temps: list[float] = []
    try:
        for p in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
            try:
                with open(p, "r") as f:
                    val = int(f.read().strip()) / 1000.0
                    if 0 < val < 120:
                        temps.append(val)
            except Exception:
                continue
    except Exception:
        pass
    current_temp = round(max(temps), 1) if temps else None
    return {"cpu_temp_c": current_temp}


def _get_uptime_string() -> str:
    try:
        with open("/proc/uptime", "r") as f:
            total_seconds = int(float(f.readline().split()[0]))
        days, remainder = divmod(total_seconds, 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes, _ = divmod(remainder, 60)
        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0:
            parts.append(f"{hours}h")
        parts.append(f"{minutes}m")
        return " ".join(parts)
    except Exception:
        return "Unknown"


def _get_network_info() -> dict[str, Any]:
    active_interfaces = []
    total_rx = 0
    total_tx = 0
    try:
        with open("/proc/net/dev", "r") as f:
            lines = f.readlines()[2:]
        for line in lines:
            parts = line.split(":")
            if len(parts) == 2:
                iface = parts[0].strip()
                if iface == "lo" or iface.startswith("docker") or iface.startswith("veth"):
                    continue
                stats = parts[1].split()
                rx = int(stats[0])
                tx = int(stats[8])
                total_rx += rx
                total_tx += tx
                if rx > 0 or tx > 0:
                    active_interfaces.append(iface)
    except Exception:
        pass
    return {
        "interfaces": active_interfaces,
        "total_rx_mb": round(total_rx / (1024**2), 1),
        "total_tx_mb": round(total_tx / (1024**2), 1),
    }


def get_system_status() -> dict[str, Any]:
    """Return real-time PC telemetry for the mobile dashboard."""
    return {
        "cpu": {
            "percent": _get_cpu_usage(),
            **_get_cpu_info(),
        },
        "memory": _get_memory_info(),
        "disk": _get_disk_info(),
        "battery": _get_battery_info(),
        "thermal": _get_thermal_info(),
        "network": _get_network_info(),
        "host": {
            "hostname": platform.node(),
            "os": platform.system(),
            "kernel": platform.release(),
            "uptime": _get_uptime_string(),
            "user": os.environ.get("USER", "user"),
            "session_type": os.environ.get("XDG_SESSION_TYPE", "x11"),
            "desktop": os.environ.get("XDG_CURRENT_DESKTOP", "Desktop"),
        },
        "timestamp": time.time(),
    }


def list_processes(limit: int = 30) -> list[dict[str, Any]]:
    """List running processes sorted by CPU usage."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid,user,%cpu,%mem,comm,stat", "--sort=-%cpu"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
        lines = out.strip().split("\n")
        procs = []
        for line in lines[1 : limit + 1]:
            parts = line.split(None, 5)
            if len(parts) >= 6:
                try:
                    procs.append({
                        "pid": int(parts[0]),
                        "user": parts[1],
                        "cpu": float(parts[2]),
                        "mem": float(parts[3]),
                        "name": parts[4],
                        "stat": parts[5],
                    })
                except ValueError:
                    continue
        return procs
    except Exception as e:
        return []


def kill_process(pid: int, signal_type: str = "SIGTERM") -> dict[str, Any]:
    """Terminate or kill a process by PID."""
    if pid <= 1:
        return {"ok": False, "error": "Cannot kill system root processes"}
    try:
        sig = signal.SIGKILL if signal_type.upper() == "SIGKILL" else signal.SIGTERM
        os.kill(pid, sig)
        return {"ok": True, "pid": pid, "signal": signal_type}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def list_applications() -> list[dict[str, Any]]:
    """Scan and list common installed desktop applications."""
    app_dirs = [
        Path("/usr/share/applications"),
        Path(os.path.expanduser("~/.local/share/applications")),
    ]
    apps: list[dict[str, Any]] = []
    seen_names = set()

    for app_dir in app_dirs:
        if not app_dir.is_dir():
            continue
        for desktop_file in app_dir.glob("*.desktop"):
            try:
                content = desktop_file.read_text(encoding="utf-8", errors="ignore")
                if "NoDisplay=true" in content or "Hidden=true" in content:
                    continue
                name_match = re.search(r"^Name=(.+)$", content, re.MULTILINE)
                exec_match = re.search(r"^Exec=(.+)$", content, re.MULTILINE)
                icon_match = re.search(r"^Icon=(.+)$", content, re.MULTILINE)
                comment_match = re.search(r"^Comment=(.+)$", content, re.MULTILINE)

                if name_match and exec_match:
                    name = name_match.group(1).strip()
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    apps.append({
                        "id": desktop_file.name,
                        "name": name,
                        "exec": exec_match.group(1).strip(),
                        "icon": icon_match.group(1).strip() if icon_match else "",
                        "comment": comment_match.group(1).strip() if comment_match else "",
                    })
            except Exception:
                continue

    apps.sort(key=lambda a: a["name"].lower())
    return apps[:60]


def launch_application(target: str) -> dict[str, Any]:
    """Launch an application on the PC."""
    try:
        if target.endswith(".desktop"):
            # Try gtk-launch then gio launch
            if shutil.which("gtk-launch"):
                subprocess.Popen(["gtk-launch", target], start_new_session=True)
                return {"ok": True, "target": target}
            elif shutil.which("gio"):
                subprocess.Popen(["gio", "launch", target], start_new_session=True)
                return {"ok": True, "target": target}
        # Fallback to shell execution for commands
        subprocess.Popen(target, shell=True, start_new_session=True)
        return {"ok": True, "target": target}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def run_terminal_command(command: str, elevated: bool = False, timeout: float = 30.0) -> dict[str, Any]:
    """Execute a shell command remotely."""
    cmd = command.strip()
    if elevated:
        if shutil.which("pkexec"):
            cmd = f"pkexec {cmd}"
        elif shutil.which("sudo"):
            cmd = f"sudo -n {cmd}"

    t0 = time.monotonic()
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        duration_ms = int((time.monotonic() - t0) * 1000)
        return {
            "stdout": res.stdout,
            "stderr": res.stderr,
            "returncode": res.returncode,
            "duration_ms": duration_ms,
            "elevated": elevated,
        }
    except subprocess.TimeoutExpired:
        return {
            "error": f"Command timed out after {timeout}s",
            "returncode": -1,
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "elevated": elevated,
        }
    except Exception as e:
        return {
            "error": str(e),
            "returncode": -1,
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "elevated": elevated,
        }
