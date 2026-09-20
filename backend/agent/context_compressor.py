"""LLM-based context compression: summarizes middle turns while protecting head and tail.

When the conversation grows near the context window limit, this engine uses a
cheap auxiliary model to summarize the middle portion, preserving more information
than the drop-oldest approach. Head (system prompt + first N messages) and tail
(last M messages) are always kept verbatim.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from backend.agent.context_engine import ContextEngine

log = logging.getLogger(__name__)

# Default model for summarization. Configurable via settings.
_DEFAULT_COMPRESSION_MODEL = "mistralai/mistral-7b-instruct-v0.3"

# Anti-thrash: cooldown after failed compression (seconds).
_COOLDOWN_BASE = 60.0
_COOLDOWN_MAX = 900.0

# How many ineffective compressions before tripping the breaker.
_INEFFECTIVE_THRESHOLD = 2

# Recovery window after breaker trips.
_RECOVERY_SECONDS = 300.0


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: 4 chars per token."""
    return len(text or "") // 4


def _message_tokens(message: dict) -> int:
    """Token cost of one wire message."""
    cost = _estimate_tokens(message.get("content")) + 32  # per-message overhead
    calls = message.get("tool_calls")
    if calls:
        cost += _estimate_tokens(json.dumps(calls, default=str))
    return cost


def _dedup_tool_results(messages: list[dict]) -> list[dict]:
    """Replace duplicate tool results with a placeholder, keeping newest."""
    seen_hashes: dict[str, int] = {}
    result = []
    for idx, msg in enumerate(messages):
        if msg.get("role") == "tool":
            content = msg.get("content", "")
            h = hash(content[:500])  # quick hash of first 500 chars
            if h in seen_hashes and seen_hashes[h] < idx:
                result.append({
                    **msg,
                    "content": "[Duplicate tool output — same content as a more recent call]",
                })
                continue
            seen_hashes[h] = idx
        result.append(msg)
    return result


def _summarize_tool_result(content: str, tool_name: str) -> str:
    """Produce a one-line summary of a tool result."""
    lines = content.strip().split("\n")
    line_count = len(lines)
    preview = lines[0][:100] if lines else ""
    return f"[{tool_name}] {line_count} lines: {preview}"


def _prune_old_tool_results(
    messages: list[dict], protect_end: int
) -> list[dict]:
    """Demote old large tool results to one-line summaries."""
    MIN_CHARS = 200
    result = []
    for idx, msg in enumerate(messages):
        if (
            idx < protect_end
            and msg.get("role") == "tool"
            and len(msg.get("content", "")) > MIN_CHARS
        ):
            name = msg.get("name", "tool")
            result.append({
                **msg,
                "content": _summarize_tool_result(msg["content"], name),
            })
        else:
            result.append(msg)
    return result


def _build_summary_prompt(messages: list[dict], previous_summary: str | None = None) -> str:
    """Build a prompt for the summarization LLM."""
    # Serialize the conversation for the summarizer
    serialized = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if isinstance(content, list):
            # Multimodal: extract text parts
            text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
            content = " ".join(text_parts)
        # Truncate very long messages
        if len(content) > 6000:
            content = content[:6000] + "...[truncated]"
        if role in ("user", "assistant"):
            serialized.append(f"{role.upper()}: {content}")
        elif role == "tool":
            name = msg.get("name", "tool")
            serialized.append(f"TOOL_RESULT({name}): {content[:500]}")

    conversation_text = "\n".join(serialized)

    if previous_summary:
        return f"""You are compressing a conversation that has been partially summarized before.

PREVIOUS SUMMARY:
{previous_summary}

NEW MESSAGES SINCE LAST SUMMARY:
{conversation_text}

Update the summary to incorporate the new messages. Preserve:
- The user's goals and requests
- Key decisions made
- File paths modified or created
- Errors encountered and how they were resolved
- Current state of any ongoing work

Reply with ONLY the updated summary, no preamble."""

    return f"""Summarize this conversation concisely, preserving:
- The user's goals and requests
- Key decisions made
- File paths modified or created
- Errors encountered and how they were resolved
- Current state of any ongoing work
- Important context the model would need to continue

CONVERSATION:
{conversation_text}

Reply with ONLY the summary, no preamble."""


def _build_static_fallback_summary(messages: list[dict]) -> str:
    """Deterministic fallback when the summary LLM fails: extract anchors."""
    anchors = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not content:
            continue
        if role == "user":
            # First 200 chars of each user message
            anchors.append(f"User asked: {content[:200]}")
        elif role == "tool":
            name = msg.get("name", "tool")
            if "error" in content.lower()[:200]:
                anchors.append(f"Error in {name}: {content[:200]}")
    if not anchors:
        return "[Conversation history compacted — no anchors extracted]"
    return "[Conversation summary]\n" + "\n".join(anchors[-10:])


class ContextCompressor(ContextEngine):
    """LLM-based context compression engine.

    Uses a configurable auxiliary model to summarize middle turns while
    protecting the head (system prompt + first N messages) and tail (last M
    messages).
    """

    def __init__(
        self,
        *,
        context_length: int = 128_000,
        threshold_percent: float = 0.50,
        compression_model: str | None = None,
        max_tokens: int = 2000,
    ):
        self.context_length = context_length
        self.threshold_percent = threshold_percent
        self.compression_model = compression_model or _DEFAULT_COMPRESSION_MODEL
        self.max_tokens = max_tokens

        # Compute threshold
        self.threshold_tokens = int(context_length * threshold_percent)

        # State
        self._previous_summary: str | None = None
        self._ineffective_count = 0
        self._cooldown_until = 0.0
        self._breaker_until = 0.0
        self._last_compress_time = 0.0

    @property
    def name(self) -> str:
        return "compressor"

    def update_from_response(self, usage: dict[str, Any]) -> None:
        """Track token usage from the provider's response."""
        self.last_prompt_tokens = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0) or 0
        self.last_completion_tokens = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0) or 0
        self.last_total_tokens = usage.get("total_tokens", 0) or (
            self.last_prompt_tokens + self.last_completion_tokens
        )

        # Check if compression was effective
        if self.compression_count > 0 and self.last_prompt_tokens > 0:
            if self.last_prompt_tokens >= self.threshold_tokens:
                self._ineffective_count += 1
                log.warning(
                    "compression ineffective: prompt_tokens=%d >= threshold=%d "
                    "(ineffective_count=%d)",
                    self.last_prompt_tokens,
                    self.threshold_tokens,
                    self._ineffective_count,
                )
                if self._ineffective_count >= _INEFFECTIVE_THRESHOLD:
                    self._breaker_until = time.monotonic() + _RECOVERY_SECONDS
                    log.warning(
                        "compression breaker tripped; recovering in %ds",
                        _RECOVERY_SECONDS,
                    )
            else:
                self._ineffective_count = 0

    def should_compress(self, prompt_tokens: int | None = None) -> bool:
        """Whether context needs compaction."""
        tokens = prompt_tokens or self.last_prompt_tokens
        if tokens <= 0:
            return False

        # Breaker check
        now = time.monotonic()
        if now < self._breaker_until:
            return False
        # Cooldown check
        if now < self._cooldown_until:
            return False

        return tokens >= self.threshold_tokens

    def compress(self, messages: list[dict]) -> list[dict]:
        """Compact the message list by summarizing middle turns.

        Algorithm:
        1. Deterministic pruning: dedup tool results, demote old large results
        2. Head/tail protection: system prompt + first N, last M tokens
        3. LLM summarization of middle window
        4. Assembly: head + summary + tail
        """
        if len(messages) <= 4:
            return messages

        self.compression_count += 1
        self._last_compress_time = time.monotonic()

        try:
            return self._compress_impl(messages)
        except Exception as exc:
            log.warning("compression failed, using fallback: %s", exc)
            self._set_cooldown(exc)
            return messages

    def _compress_impl(self, messages: list[dict]) -> list[dict]:
        """Core compression algorithm."""
        # Phase 1: Deterministic pruning
        messages = _dedup_tool_results(messages)

        # Find head/tail boundaries
        head_end = self._find_head_end(messages)
        tail_start = self._find_tail_start(messages, head_end)

        if tail_start <= head_end + 2:
            # Nothing meaningful to compress
            return messages

        # Phase 2: Prune old tool results in the middle
        messages = _prune_old_tool_results(messages, head_end)

        # Phase 3: LLM summary of middle window
        middle = messages[head_end:tail_start]
        if not middle:
            return messages

        summary = self._generate_summary(middle)
        if summary is None:
            # Summary failed; use deterministic fallback
            summary = _build_static_fallback_summary(middle)

        # Phase 4: Assembly
        head = messages[:head_end]
        tail = messages[tail_start:]

        summary_message = {
            "role": "user",
            "content": (
                f"[Note: Some earlier conversation turns have been compacted "
                f"to save context space. Here is a summary of what was discussed]\n\n"
                f"{summary}"
            ),
        }

        compressed = head + [summary_message] + tail
        log.info(
            "compressed %d messages -> %d (head=%d, summary=1, tail=%d)",
            len(messages),
            len(compressed),
            head_end,
            len(tail),
        )
        return compressed

    def _find_head_end(self, messages: list[dict]) -> int:
        """Index of the first message after the protected head."""
        idx = 0
        # Skip system message if present
        if messages and messages[0].get("role") == "system":
            idx = 1
        # Protect first N non-system messages
        protected = 0
        while idx < len(messages) and protected < self.protect_first_n:
            if messages[idx].get("role") in ("user", "assistant"):
                protected += 1
            idx += 1
        return idx

    def _find_tail_start(self, messages: list[dict], head_end: int) -> int:
        """Index where the protected tail begins."""
        tail_budget = max(10000, min(25000, self.context_length // 40))
        running = 0
        idx = len(messages) - 1
        # Protect at least the last few messages
        protected = 0
        while idx >= head_end and protected < self.protect_last_n:
            cost = _message_tokens(messages[idx])
            running += cost
            protected += 1
            idx -= 1
        # Continue adding to tail while under budget
        while idx >= head_end:
            cost = _message_tokens(messages[idx])
            if running + cost > tail_budget:
                break
            running += cost
            idx -= 1
        return idx + 1

    def _generate_summary(self, middle: list[dict]) -> str | None:
        """Call the auxiliary LLM to summarize the middle window."""
        prompt = _build_summary_prompt(middle, self._previous_summary)

        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an async context; use a thread to avoid blocking
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(self._call_summary_llm, prompt)
                    summary = future.result(timeout=60)
            else:
                summary = loop.run_until_complete(self._call_summary_llm(prompt))
        except Exception as exc:
            log.warning("summary LLM call failed: %s", exc)
            return None

        if summary:
            self._previous_summary = summary
        return summary

    def _call_summary_llm(self, prompt: str) -> str | None:
        """Call the summary model. Runs in a thread (sync context)."""
        try:
            from backend.runtime.registry import resolve

            # Use the configured compression model
            provider, model = self._parse_model(self.compression_model)
            resolved = resolve(provider, model)
            if resolved is None:
                log.warning("could not resolve compression model %s", self.compression_model)
                return None

            # Make a synchronous completion call
            import httpx

            # Build the request based on provider type
            client = resolved.client
            messages = [{"role": "user", "content": prompt}]

            # Use the client's complete method if available
            if hasattr(client, "complete"):
                import asyncio
                # Create a new event loop for this thread
                loop = asyncio.new_event_loop()
                try:
                    response = loop.run_until_complete(
                        client.complete(messages, params={"max_tokens": self.max_tokens})
                    )
                    return response.text
                finally:
                    loop.close()

            log.warning("compression model client has no complete() method")
            return None

        except Exception as exc:
            log.warning("summary LLM call failed: %s", exc)
            return None

    def _parse_model(self, model_str: str) -> tuple[str, str]:
        """Parse 'provider/model' into (provider, model)."""
        if "/" in model_str:
            parts = model_str.split("/", 1)
            return parts[0], parts[1]
        return "", model_str

    def _set_cooldown(self, exc: Exception) -> None:
        """Set an escalating cooldown after failure."""
        now = time.monotonic()
        if "quota" in str(exc).lower() or "429" in str(exc):
            self._cooldown_until = now + _COOLDOWN_MAX
        else:
            current_cooldown = max(
                _COOLDOWN_BASE,
                min(_COOLDOWN_MAX, _COOLDOWN_BASE * (2 ** self._ineffective_count)),
            )
            self._cooldown_until = now + current_cooldown
