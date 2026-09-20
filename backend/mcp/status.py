"""Authoritative MCP state and reliability model.

Defines unambiguous connection, authentication, account identity, and health
states. The application must never claim an MCP is connected unless the backend
has authoritative evidence that the MCP is actually connected, authenticated
when authentication is required, and usable.
"""

from __future__ import annotations

import enum
from dataclasses import asdict, dataclass, field
from typing import Any


class MCPState(enum.StrEnum):
    """Explicit, mutually exclusive operational states for an MCP integration."""

    #: Not configured in mcp.yaml
    NOT_CONFIGURED = "not_configured"
    #: Configured, but disabled/switched off by user or policy
    OFF = "off"
    #: Subprocess or connection task is spawning
    STARTING = "starting"
    #: Transport is opening / session is initializing
    CONNECTING = "connecting"
    #: Requires credentials or sign-in before it can be used
    AUTH_REQUIRED = "auth_required"
    #: Interactive or background authentication in flight
    AUTHENTICATING = "authenticating"
    #: Verified connected, authenticated (if required), healthy, and tools usable
    CONNECTED = "connected"
    #: Configured and enabled, but not currently running/connected
    DISCONNECTED = "disconnected"
    #: Authenticated account does not match the configured expected account
    ACCOUNT_MISMATCH = "account_mismatch"
    #: Authentication failed, invalid credentials, or access revoked
    AUTH_ERROR = "auth_error"
    #: Access token expired and refresh failed or not available
    TOKEN_EXPIRED = "token_expired"
    #: Subprocess crashed, 5xx server error, or unrecoverable transport failure
    SERVER_ERROR = "server_error"
    #: Endpoint unreachable, command not found, or network unavailable
    UNAVAILABLE = "unavailable"
    #: Connected over transport but failed liveness ping/probe
    HEALTH_CHECK_FAILED = "health_check_failed"
    #: Connected, but runtime tool execution failed due to server/tool error
    TOOL_EXECUTION_ERROR = "tool_execution_error"


class HealthStatus(enum.StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class AuthoritativeMCPStatus:
    """The single authoritative truth for an MCP integration."""

    name: str
    state: MCPState
    detail: str
    action: str | None = None
    #: Strictly True ONLY when transport connection is confirmed live right now
    is_connected: bool = False
    #: Strictly True ONLY when credentials are valid (or auth not required)
    is_authenticated: bool = False
    #: Strictly True ONLY when connected + authenticated + healthy + account matches
    is_usable: bool = False
    health: HealthStatus = HealthStatus.UNKNOWN
    account: str | None = None
    expected_account: str | None = None
    account_mismatch: bool = False
    tools_count: int = 0
    tools: list[str] = field(default_factory=list)
    last_verified: float | None = None
    error: str | None = None
    retry_in: int = 0

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["state"] = str(self.state)
        data["health"] = str(self.health)
        return data
