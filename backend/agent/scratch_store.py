"""In-memory scratch store for large tool result payloads.

Offloads results exceeding `max_payload_chars` (4,000 chars) to prevent prompt
bloat while ensuring the full payload is accessible and the model receives a
coherent, validly-structured summary with an explicit handle.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any

from backend.agent.config import agent_config
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

log = logging.getLogger(__name__)


@dataclass
class ScratchEntry:
    handle: str
    tool_name: str
    content: str
    created_at: float
    char_count: int


class ScratchStore:
    def __init__(self) -> None:
        self._entries: dict[str, ScratchEntry] = {}

    def _cleanup(self) -> None:
        now = time.monotonic()
        ttl = agent_config.scratch_store_ttl
        expired = [h for h, e in self._entries.items() if (now - e.created_at) > ttl]
        for h in expired:
            self._entries.pop(h, None)

    def store(self, content: str, tool_name: str = "") -> str:
        self._cleanup()
        clean_name = (tool_name or "tool").lower().replace(" ", "_")
        handle = f"payload_{clean_name}_{uuid.uuid4().hex[:6]}"
        entry = ScratchEntry(
            handle=handle,
            tool_name=tool_name,
            content=content,
            created_at=time.monotonic(),
            char_count=len(content),
        )
        self._entries[handle] = entry
        return handle

    def get(self, handle: str) -> str | None:
        self._cleanup()
        entry = self._entries.get(handle)
        return entry.content if entry else None

    def compact_payload(
        self,
        content: str,
        tool_name: str = "",
        max_chars: int | None = None,
    ) -> tuple[str, str | None]:
        """Compact a payload exceeding max_chars into scratch storage.

        Returns (compacted_text, handle_or_none).
        """
        threshold = max_chars or agent_config.max_payload_chars
        if not content or len(content) <= threshold:
            return content, None

        handle = self.store(content, tool_name=tool_name)
        total_chars = len(content)

        # Attempt structured JSON parsing
        trimmed = content.strip()
        if (trimmed.startswith("{") and trimmed.endswith("}")) or (trimmed.startswith("[") and trimmed.endswith("]")):
            try:
                parsed = json.loads(trimmed)
                if isinstance(parsed, list):
                    total_items = len(parsed)
                    preview_items = parsed[:10]
                    preview_json = json.dumps(preview_items, indent=2, ensure_ascii=False)
                    notice = (
                        f"\n\n[Found {total_items} items total ({total_chars} chars). "
                        f"Showing first {len(preview_items)} above. Full payload stored under handle '{handle}'.]"
                    )
                    return preview_json + notice, handle
                elif isinstance(parsed, dict):
                    # Check if dict wraps a list
                    for k in ("items", "events", "messages", "threads", "results", "response_data", "data"):
                        if isinstance(parsed.get(k), list):
                            items = parsed[k]
                            total_items = len(items)
                            preview_dict = dict(parsed)
                            preview_dict[k] = items[:10]
                            preview_json = json.dumps(preview_dict, indent=2, ensure_ascii=False)
                            notice = (
                                f"\n\n[Found {total_items} items in '{k}' ({total_chars} chars). "
                                f"Showing first {len(preview_dict[k])} above. Full payload stored under handle '{handle}'.]"
                            )
                            return preview_json + notice, handle
            except Exception:
                pass

        # Text truncation near newline boundary
        cut_point = max(0, threshold - 250)
        newline_pos = content.rfind("\n", max(0, cut_point - 300), cut_point)
        if newline_pos > 0:
            preview_text = content[:newline_pos].strip()
        else:
            preview_text = content[:cut_point].strip()

        notice = f"\n\n[Showing preview of {len(preview_text)} chars ({total_chars} chars total). Full payload stored under handle '{handle}'.]"
        return preview_text + notice, handle


# Global singleton instance
scratch_store = ScratchStore()


async def read_scratch_payload_handler(args: dict[str, Any], _: ToolContext) -> ToolResult:
    handle = str(args.get("handle") or "").strip()
    if not handle:
        return ToolResult.error("handle is required")
    data = scratch_store.get(handle)
    if data is None:
        return ToolResult.error(f"Scratch payload '{handle}' not found or expired.")
    return ToolResult.ok(data)


def scratch_tool() -> Tool:
    return Tool(
        name="read_scratch_payload",
        description="Retrieve the full payload of a large tool result offloaded to scratch storage using its handle.",
        parameters={
            "type": "object",
            "properties": {
                "handle": {
                    "type": "string",
                    "description": "Handle identifier returned in a previous tool result (e.g. 'payload_gmail_1a2b3c').",
                }
            },
            "required": ["handle"],
        },
        handler=read_scratch_payload_handler,
        risk=RiskLevel.LOW,
    )
