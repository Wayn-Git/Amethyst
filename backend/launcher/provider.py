from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass
class LauncherAction:
    id: str
    title: str
    shortcut: str | None = None
    is_primary: bool = False
    handler_payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "shortcut": self.shortcut,
            "is_primary": self.is_primary,
            "handler_payload": self.handler_payload,
        }


@dataclass
class LauncherResult:
    id: str
    provider_id: str
    title: str
    subtitle: str | None = None
    icon: str = "search"
    badge: str | None = None
    score: float = 0.0
    preview_type: str = "none"  # "none" | "app_info" | "markdown" | "image" | "agent"
    preview_data: dict[str, Any] = field(default_factory=dict)
    actions: list[LauncherAction] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "title": self.title,
            "subtitle": self.subtitle,
            "icon": self.icon,
            "badge": self.badge,
            "score": self.score,
            "preview_type": self.preview_type,
            "preview_data": self.preview_data,
            "actions": [a.to_dict() for a in self.actions],
        }


class BaseLauncherProvider(ABC):
    id: str
    name: str
    priority: int = 50

    @abstractmethod
    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        """Yield results matching query incrementally."""
        ...

    @abstractmethod
    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute selected action."""
        ...
