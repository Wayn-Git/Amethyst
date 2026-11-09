"""Network interface inspection for CONTRACT v2 LAN pairing.

Finds real LAN IPv4 addresses while skipping loopback, docker, and VPN interfaces.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Sequence

log = logging.getLogger(__name__)

# Prefix/substring blacklist for virtual/container/VPN interfaces
EXCLUDED_IFACE_PREFIXES = (
    "lo",
    "docker",
    "br-",
    "veth",
    "tun",
    "tap",
    "tailscale",
    "wg",
    "utun",
    "ppp",
    "dummy",
    "virbr",
    "vmnet",
    "vbox",
    "flannel",
    "cni",
)


def is_excluded_interface(name: str) -> bool:
    lower = name.lower()
    return any(lower.startswith(prefix) for prefix in EXCLUDED_IFACE_PREFIXES)


def is_lan_ipv4(addr: str) -> bool:
    try:
        ip = ipaddress.IPv4Address(addr)
    except (ipaddress.AddressValueError, ValueError):
        return False

    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
        return False
    return ip.is_private


def get_lan_ipv4_addresses() -> list[str]:
    """Return all valid LAN IPv4 addresses for the PC, sorted.

    Skips loopback, docker, and VPN interfaces.
    """
    hosts: set[str] = set()

    try:
        import psutil

        if_addrs = psutil.net_if_addrs()
        for iface_name, addrs in if_addrs.items():
            if is_excluded_interface(iface_name):
                continue
            for a in addrs:
                if a.family == socket.AF_INET and is_lan_ipv4(a.address):
                    hosts.add(a.address)
    except Exception as exc:
        log.warning("psutil interface discovery error: %s", exc)

    # Fallback probe if psutil returned no interfaces
    if not hosts:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.settimeout(0.2)
                # Unroutable address to probe default route without sending packets
                probe.connect(("192.0.2.1", 9))
                addr = str(probe.getsockname()[0])
                if is_lan_ipv4(addr):
                    hosts.add(addr)
        except OSError:
            pass

    return sorted(hosts)
