"""Lightweight turn-level timing and diagnostics trace (AMETHYST_TRACE=1).

Records per turn:
- ms spent in classify_presentation
- ms spent in classify_and_extract
- ms spent in route()
- ms spent in resolve()
- ms spent in prefetch
- each LLM call (time to first token + total ms, input tokens, output tokens)
- each tool dispatch (duration ms, tool name)
- each blocking call on the event loop (>50ms) with callsite stack
- whether tool deferral (assemble_tool_defs returning a catalog) is active
- the exact tool-call sequence
- final count of LLM calls
"""

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass, field
import json
import logging
import os
import sys
import threading
import time
import traceback
from typing import Any

import uuid

log = logging.getLogger("amethyst.trace")


def is_trace_enabled() -> bool:
    """Return True if AMETHYST_TRACE is set or agent_config.enable_turn_tracing is True."""
    val = os.environ.get("AMETHYST_TRACE", "").strip().lower()
    if val:
        return val in ("1", "true", "yes", "on")
    try:
        from backend.agent.config import agent_config
        return agent_config.enable_turn_tracing
    except Exception:
        return True


@dataclass
class LLMCallRecord:
    call_index: int
    provider: str
    model: str
    ttft_ms: float
    total_ms: float
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass
class ToolDispatchRecord:
    dispatch_index: int
    tool_name: str
    duration_ms: float
    arguments: dict[str, Any] | None = None
    is_bridge: bool = False


@dataclass
class BlockingCallRecord:
    duration_ms: float
    callsite: str
    detail: str = ""


@dataclass
class TurnTrace:
    conversation_id: str
    user_message: str
    turn_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    start_time: float = field(default_factory=time.perf_counter)
    classify_presentation_ms: float = 0.0
    classify_and_extract_ms: float = 0.0
    classify_and_extract_skipped: bool = False
    route_ms: float = 0.0
    resolve_ms: float = 0.0
    prefetch_ms: float = 0.0
    assemble_tool_defs_ms: float = 0.0
    tool_deferral_active: bool = False
    catalog_size: int = 0
    visible_tools_count: int = 0
    steps_used: int = 0
    errors: list[str] = field(default_factory=list)
    provider_used: str = ""
    cache_hits: int = 0
    llm_calls: list[LLMCallRecord] = field(default_factory=list)
    tool_dispatches: list[ToolDispatchRecord] = field(default_factory=list)
    blocking_calls: list[BlockingCallRecord] = field(default_factory=list)
    end_time: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert trace to structured turn metrics dictionary."""
        effective_provider = self.provider_used
        if not effective_provider and self.llm_calls:
            effective_provider = self.llm_calls[0].provider
        return {
            "turn_id": self.turn_id,
            "conversation_id": self.conversation_id,
            "user_message": self.user_message,
            "steps_used": self.steps_used if self.steps_used > 0 else self.final_llm_call_count,
            "tool_calls": self.tool_call_sequence,
            "latencies": {
                "total_ms": round(self.total_duration_ms, 2),
                "classify_presentation_ms": round(self.classify_presentation_ms, 2),
                "route_ms": round(self.route_ms, 2),
                "resolve_ms": round(self.resolve_ms, 2),
                "prefetch_ms": round(self.prefetch_ms, 2),
                "assemble_tool_defs_ms": round(self.assemble_tool_defs_ms, 2),
                "llm_total_ms": round(sum(c.total_ms for c in self.llm_calls), 2),
                "tools_total_ms": round(sum(t.duration_ms for t in self.tool_dispatches), 2),
            },
            "errors": list(self.errors),
            "tokens": {
                "input_tokens": sum((c.input_tokens or 0) for c in self.llm_calls),
                "output_tokens": sum((c.output_tokens or 0) for c in self.llm_calls),
                "total_tokens": sum(((c.input_tokens or 0) + (c.output_tokens or 0)) for c in self.llm_calls),
            },
            "provider_used": effective_provider,
            "cache_hits": self.cache_hits,
        }

    @property
    def total_duration_ms(self) -> float:
        end = self.end_time or time.perf_counter()
        return (end - self.start_time) * 1000.0

    @property
    def tool_call_sequence(self) -> list[str]:
        return [td.tool_name for td in self.tool_dispatches]

    @property
    def final_llm_call_count(self) -> int:
        return len(self.llm_calls)

    def summary(self) -> str:
        lines = [
            "=" * 60,
            f"AMETHYST TURN TRACE: {self.user_message!r} (conv={self.conversation_id})",
            f"Total Turn Time: {self.total_duration_ms:.1f} ms",
            "Pipeline Stages (ms):",
            f"  classify_presentation: {self.classify_presentation_ms:.2f} ms",
            (
                f"  classify_and_extract:  {self.classify_and_extract_ms:.2f} ms (skipped={self.classify_and_extract_skipped})"
                if self.classify_and_extract_skipped
                else f"  classify_and_extract:  {self.classify_and_extract_ms:.2f} ms"
            ),
            f"  route():               {self.route_ms:.2f} ms",
            f"  resolve():             {self.resolve_ms:.2f} ms",
            f"  prefetch:              {self.prefetch_ms:.2f} ms",
            (
                f"  assemble_tool_defs:    {self.assemble_tool_defs_ms:.2f} ms "
                f"(deferral active={self.tool_deferral_active}, catalog={self.catalog_size}, visible={self.visible_tools_count})"
            ),
            f"LLM Calls ({self.final_llm_call_count} total):",
        ]

        if not self.llm_calls:
            lines.append("  (none)")
        else:
            for c in self.llm_calls:
                lines.append(
                    f"  #{c.call_index}: {c.provider}:{c.model} "
                    f"TTFT={c.ttft_ms:.1f}ms, total={c.total_ms:.1f}ms, "
                    f"in_tokens={c.input_tokens}, out_tokens={c.output_tokens}"
                )

        lines.append(f"Tool Dispatches ({len(self.tool_dispatches)} total):")
        if not self.tool_dispatches:
            lines.append("  (none)")
        else:
            for t in self.tool_dispatches:
                bridge_tag = " [bridge]" if t.is_bridge else ""
                lines.append(f"  #{t.dispatch_index}: {t.tool_name}{bridge_tag} -> {t.duration_ms:.1f} ms")

        lines.append(f"Tool Call Sequence: {' -> '.join(self.tool_call_sequence) if self.tool_call_sequence else '(none)'}")

        lines.append(f"Blocking Calls on Event Loop >50ms ({len(self.blocking_calls)} detected):")
        if not self.blocking_calls:
            lines.append("  (none)")
        else:
            for b in self.blocking_calls:
                lines.append(f"  Blocked for {b.duration_ms:.1f} ms: {b.callsite} {b.detail}")

        lines.append("=" * 60)
        return "\n".join(lines)


# ContextVar holding the active trace for the current asyncio task
current_turn_trace: ContextVar[TurnTrace | None] = ContextVar("current_turn_trace", default=None)

# Global history of recent traces for testing and benchmarking
_recent_traces: list[TurnTrace] = []
_traces_lock = threading.Lock()


def get_current_trace() -> TurnTrace | None:
    return current_turn_trace.get()


def get_recent_traces() -> list[TurnTrace]:
    with _traces_lock:
        return list(_recent_traces)


def get_last_trace() -> TurnTrace | None:
    with _traces_lock:
        return _recent_traces[-1] if _recent_traces else None


def record_step(step_name: str, duration_ms: float, **kwargs: Any) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if not trace:
        return
    if step_name == "classify_presentation":
        trace.classify_presentation_ms = duration_ms
    elif step_name == "classify_and_extract":
        trace.classify_and_extract_ms = duration_ms
        if "skipped" in kwargs:
            trace.classify_and_extract_skipped = bool(kwargs["skipped"])
    elif step_name == "route":
        trace.route_ms = duration_ms
    elif step_name == "resolve":
        trace.resolve_ms = duration_ms
    elif step_name == "prefetch":
        trace.prefetch_ms = duration_ms
    elif step_name == "assemble_tool_defs":
        trace.assemble_tool_defs_ms = duration_ms
        if "deferral_active" in kwargs:
            trace.tool_deferral_active = bool(kwargs["deferral_active"])
        if "catalog_size" in kwargs:
            trace.catalog_size = int(kwargs["catalog_size"])
        if "visible_count" in kwargs:
            trace.visible_tools_count = int(kwargs["visible_count"])


def record_llm_call(
    provider: str,
    model: str,
    ttft_ms: float,
    total_ms: float,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace:
        record = LLMCallRecord(
            call_index=len(trace.llm_calls) + 1,
            provider=provider,
            model=model,
            ttft_ms=ttft_ms,
            total_ms=total_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        trace.llm_calls.append(record)
    log.info(
        "[TRACE] LLM call: provider=%s model=%s TTFT=%.1fms total=%.1fms in_tokens=%s out_tokens=%s",
        provider,
        model,
        ttft_ms,
        total_ms,
        input_tokens,
        output_tokens,
    )


def record_tool_dispatch(
    tool_name: str,
    duration_ms: float,
    arguments: dict[str, Any] | None = None,
    is_bridge: bool = False,
) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace:
        record = ToolDispatchRecord(
            dispatch_index=len(trace.tool_dispatches) + 1,
            tool_name=tool_name,
            duration_ms=duration_ms,
            arguments=arguments,
            is_bridge=is_bridge,
        )
        trace.tool_dispatches.append(record)
    log.info(
        "[TRACE] Tool dispatch: %s%s took %.1fms",
        tool_name,
        " [bridge]" if is_bridge else "",
        duration_ms,
    )


def record_blocking_call(
    duration_ms: float,
    callsite: str,
    detail: str = "",
    trace: TurnTrace | None = None,
) -> None:
    if not is_trace_enabled():
        return
    t = trace or current_turn_trace.get()
    if t:
        record = BlockingCallRecord(
            duration_ms=duration_ms,
            callsite=callsite,
            detail=detail,
        )
        t.blocking_calls.append(record)
    log.warning(
        "[TRACE] BLOCKING CALL on event loop (>50ms): %.1fms at %s %s",
        duration_ms,
        callsite,
        detail,
    )


class LoopWatchdog:
    """Monitors the asyncio event loop for blocking callbacks (> threshold_ms)."""

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        threshold_ms: float = 50.0,
        main_thread_id: int | None = None,
        trace: TurnTrace | None = None,
    ):
        self.loop = loop
        self.threshold_s = threshold_ms / 1000.0
        self.threshold_ms = threshold_ms
        self.main_thread_id = main_thread_id or threading.main_thread().ident
        self.trace = trace
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._monitor,
            daemon=True,
            name="amethyst-trace-watchdog",
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=0.2)
            self._thread = None

    def _monitor(self) -> None:
        check_interval_s = 0.010  # 10ms check frequency
        while not self._stop_event.is_set():
            ping_event = threading.Event()
            t0 = time.perf_counter()
            try:
                self.loop.call_soon_threadsafe(ping_event.set)
            except RuntimeError:
                # Loop closed or shutting down
                break

            signaled = ping_event.wait(timeout=self.threshold_s)
            if not signaled:
                # Loop was blocked for more than threshold_s! Capture stack now
                callsite = ""
                if self.main_thread_id:
                    frame = sys._current_frames().get(self.main_thread_id)
                    if frame:
                        raw_lines = [line.strip().replace("\n", " ") for line in traceback.format_stack(frame)]
                        app_lines = [l for l in raw_lines if "<frozen" not in l and "traceback" not in l]
                        if app_lines:
                            callsite = f"{' -> '.join(app_lines[-2:])} -> {raw_lines[-1]}"
                        else:
                            callsite = " -> ".join(raw_lines[-3:])

                # Now wait for the loop to finally unblock and run the callback
                ping_event.wait()
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                record_blocking_call(
                    elapsed_ms,
                    callsite or "unknown synchronous code",
                    detail="(watchdog detected stall)",
                    trace=self.trace,
                )
            else:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                if elapsed_ms >= self.threshold_ms:
                    record_blocking_call(
                        elapsed_ms,
                        "event loop callback delay",
                        detail=f"(callback took {elapsed_ms:.1f}ms to dispatch)",
                        trace=self.trace,
                    )

            time.sleep(check_interval_s)


def record_error(error: str) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace and error:
        trace.errors.append(str(error))


def record_cache_hit() -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace:
        trace.cache_hits += 1


def record_provider(provider: str) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace and provider:
        trace.provider_used = str(provider)


def record_steps_used(steps: int) -> None:
    if not is_trace_enabled():
        return
    trace = current_turn_trace.get()
    if trace:
        trace.steps_used = steps


def start_turn_trace(
    conversation_id: str,
    user_message: str,
    turn_id: str | None = None,
    loop: asyncio.AbstractEventLoop | None = None,
) -> tuple[TurnTrace | None, LoopWatchdog | None, Any]:
    """Start a new turn trace if AMETHYST_TRACE is enabled."""
    if not is_trace_enabled():
        return None, None, None

    trace = TurnTrace(
        conversation_id=conversation_id,
        user_message=user_message,
        turn_id=turn_id or str(uuid.uuid4()),
    )
    token = current_turn_trace.set(trace)

    watchdog = None
    try:
        active_loop = loop or asyncio.get_running_loop()
        watchdog = LoopWatchdog(active_loop, threshold_ms=50.0, trace=trace)
        watchdog.start()
    except Exception as exc:
        log.debug("Could not start event loop watchdog: %s", exc)

    return trace, watchdog, token


def finish_turn_trace(
    trace: TurnTrace | None,
    watchdog: LoopWatchdog | None,
    token: Any,
    state: Any = None,
) -> None:
    """Finish the turn trace, stop the watchdog, persist metrics, and store."""
    if not trace:
        return

    if watchdog:
        try:
            watchdog.stop()
        except Exception:
            pass

    trace.end_time = time.perf_counter()

    if state is not None:
        if getattr(state, "id", None):
            trace.turn_id = state.id
        spent = getattr(state, "budget_spent", 0)
        if spent > 0:
            trace.steps_used = spent
        for f in getattr(state, "failed_calls", []):
            reason = f.get("reason") or f.get("error")
            if reason and reason not in trace.errors:
                trace.errors.append(str(reason))
        if getattr(state, "error", None) and state.error not in trace.errors:
            trace.errors.append(str(state.error))

    with _traces_lock:
        _recent_traces.append(trace)
        if len(_recent_traces) > 100:
            _recent_traces.pop(0)

    # Persist structured turn metrics to JSONL
    try:
        from pathlib import Path
        from backend.agent.config import agent_config
        from backend.config import paths

        log_path_str = agent_config.trace_log_path
        if log_path_str:
            trace_file = Path(log_path_str)
        else:
            trace_file = paths().logs_dir / "turn_traces.jsonl"
        trace_file.parent.mkdir(parents=True, exist_ok=True)
        with open(trace_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(trace.to_dict()) + "\n")
    except Exception as exc:
        log.debug("Could not persist turn trace: %s", exc)

    # Log turn summary
    summary_text = trace.summary()
    log.info("\n%s", summary_text)

    if token is not None:
        try:
            current_turn_trace.reset(token)
        except Exception:
            pass
