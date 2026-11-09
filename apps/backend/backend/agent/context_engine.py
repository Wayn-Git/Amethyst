"""Abstract base class for pluggable context engines.

A context engine decides when/how conversation context is compacted near the
token limit and tracks usage. The default implementation (ContextCompressor)
uses an LLM to summarize middle turns while protecting head and tail.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ContextEngine(ABC):
    """Base class all context engines must implement."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Short identifier (e.g. 'compressor')."""

    # Token state: subclasses must maintain these.
    last_prompt_tokens: int = 0
    last_completion_tokens: int = 0
    last_total_tokens: int = 0
    threshold_tokens: int = 0
    context_length: int = 0
    compression_count: int = 0

    # Compaction parameters.
    threshold_percent: float = 0.50
    protect_first_n: int = 3
    protect_last_n: int = 6

    @abstractmethod
    def update_from_response(self, usage: dict[str, Any]) -> None:
        """Update tracked token usage after every LLM call."""

    @abstractmethod
    def should_compress(self, prompt_tokens: int | None = None) -> bool:
        """Whether the context needs compaction."""

    @abstractmethod
    def compress(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Compact the message list and return the compressed version."""

    def on_session_start(self) -> None:
        """Called when a session begins or resumes."""

    def on_session_end(self) -> None:
        """Called at real session boundaries (exit, reset)."""
