"""Benchmark the 4 prompts under AMETHYST_TRACE=1.

Prompts:
1. "hi"
2. "what's on my calendar today"
3. "summarize my latest email"
4. "search the web for X"
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time

# Ensure trace is enabled
os.environ["AMETHYST_TRACE"] = "1"

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("benchmark")

from backend.agent.trace import TurnTrace, get_recent_traces
from backend.api.main import _director, _mcp
from backend.db.repositories import ConversationRepository


async def run_benchmark():
    prompts = sys.argv[1:] if len(sys.argv) > 1 else [
        "hi",
        "what's on my calendar today",
        "summarize my latest email",
        "search the web for X",
    ]

    traces: list[TurnTrace] = []

    # Pre-build director once with warm connectors
    log.info("Warming up director and MCP connectors...")
    director = await _director(guard="full-access")
    log.info("Director ready with %d tools.", len(director.registry.schemas()))

    for prompt in prompts:
        log.info("\n" + "=" * 80)
        log.info("STARTING PROMPT: %s", prompt)
        log.info("=" * 80)

        # Create a fresh conversation for each prompt
        conv_repo = ConversationRepository()
        cid = conv_repo.create(provider="auto", model="", title=f"Benchmark: {prompt}")

        events = []
        turn_start = time.perf_counter()

        # Build director for this conversation with full-access guard mode
        conv_director = await _director(conversation_id=cid, guard="full-access")

        async for ev in conv_director.run(cid, prompt):
            events.append(ev)
            if getattr(ev, "type", None) == "assistant_delta" and isinstance(getattr(ev, "data", None), dict):
                text = ev.data.get("text", "")
                sys.stdout.write(text)
                sys.stdout.flush()

        turn_duration = (time.perf_counter() - turn_start) * 1000.0
        print(f"\n[Turn completed in {turn_duration:.1f}ms]")

        # Retrieve the latest trace
        recent = get_recent_traces()
        trace = recent[-1] if recent else None
        if trace:
            traces.append(trace)
            log.info("\n%s", trace.summary())
        else:
            log.error("No trace found for prompt: %s", prompt)

    # Shut down MCP manager cleanly
    if _mcp.get("manager"):
        await _mcp["manager"].shutdown()

    # Print markdown table
    print("\n" + "=" * 80)
    print("FINAL BENCHMARK TABLE")
    print("=" * 80)
    print_table(traces)

    # Also save structured JSON for analysis
    output_path = "benchmark_results.json"
    data = []
    for t in traces:
        data.append({
            "prompt": t.user_message,
            "conversation_id": t.conversation_id,
            "total_duration_ms": t.total_duration_ms,
            "classify_presentation_ms": t.classify_presentation_ms,
            "classify_and_extract_ms": t.classify_and_extract_ms,
            "classify_and_extract_skipped": t.classify_and_extract_skipped,
            "route_ms": t.route_ms,
            "resolve_ms": t.resolve_ms,
            "prefetch_ms": t.prefetch_ms,
            "assemble_tool_defs_ms": t.assemble_tool_defs_ms,
            "tool_deferral_active": t.tool_deferral_active,
            "catalog_size": t.catalog_size,
            "visible_tools_count": t.visible_tools_count,
            "tool_call_sequence": t.tool_call_sequence,
            "final_llm_call_count": t.final_llm_call_count,
            "llm_calls": [
                {
                    "call_index": c.call_index,
                    "provider": c.provider,
                    "model": c.model,
                    "ttft_ms": c.ttft_ms,
                    "total_ms": c.total_ms,
                    "input_tokens": c.input_tokens,
                    "output_tokens": c.output_tokens,
                }
                for c in t.llm_calls
            ],
            "tool_dispatches": [
                {
                    "dispatch_index": td.dispatch_index,
                    "tool_name": td.tool_name,
                    "duration_ms": td.duration_ms,
                    "is_bridge": td.is_bridge,
                }
                for td in t.tool_dispatches
            ],
            "blocking_calls": [
                {
                    "duration_ms": b.duration_ms,
                    "callsite": b.callsite,
                    "detail": b.detail,
                }
                for b in t.blocking_calls
            ],
        })
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Results saved to {output_path}")


def print_table(traces: list[TurnTrace]):
    headers = [
        "Prompt",
        "Classify Pres (ms)",
        "Classify & Ext (ms)",
        "Route (ms)",
        "Resolve (ms)",
        "Prefetch (ms)",
        "Tool Deferral Active?",
        "Tool Call Sequence",
        "LLM Calls (TTFT / Total ms / in / out)",
        "Tool Dispatches (ms)",
        "Blocking Calls >50ms",
        "Total (ms)",
    ]
    print("| " + " | ".join(headers) + " |")
    print("| " + " | ".join(["---"] * len(headers)) + " |")
    for t in traces:
        ext_str = f"{t.classify_and_extract_ms:.1f} (skipped)" if t.classify_and_extract_skipped else f"{t.classify_and_extract_ms:.1f}"
        llm_str = "<br>".join([
            f"#{c.call_index}: {c.model} (ttft={c.ttft_ms:.0f}ms, tot={c.total_ms:.0f}ms, in={c.input_tokens}, out={c.output_tokens})"
            for c in t.llm_calls
        ]) or "0"
        tool_str = " -> ".join(t.tool_call_sequence) or "*(none)*"
        disp_str = "<br>".join([
            f"{td.tool_name}: {td.duration_ms:.1f}ms"
            for td in t.tool_dispatches
        ]) or "*(none)*"
        block_str = "<br>".join([
            f"{b.duration_ms:.1f}ms: {b.callsite.split('/')[-1]}"
            for b in t.blocking_calls
        ]) or "*(none)*"

        row = [
            f"`{t.user_message}`",
            f"{t.classify_presentation_ms:.1f}",
            ext_str,
            f"{t.route_ms:.1f}",
            f"{t.resolve_ms:.1f}",
            f"{t.prefetch_ms:.1f}",
            f"**{t.tool_deferral_active}** (cat={t.catalog_size})",
            tool_str,
            llm_str,
            disp_str,
            block_str,
            f"**{t.total_duration_ms:.1f}**",
        ]
        print("| " + " | ".join(row) + " |")


if __name__ == "__main__":
    asyncio.run(run_benchmark())
