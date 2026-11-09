"""Model call accounting from the Director's bounded trace history."""

from backend.agent.trace import get_recent_traces
from backend.config import configured_providers
from backend.runtime.models_dev_catalog import lookup_pricing
from backend.runtime.router import is_local


def total(values):
    return sum(values) if all(value is not None for value in values) else None


async def provide():
    providers = configured_providers()
    groups = {}
    traces = get_recent_traces()[-100:]
    for trace in traces:
        for call in trace.llm_calls:
            groups.setdefault((call.provider, call.model), []).append(call)
    items = []
    for (provider, model), calls in sorted(groups.items()):
        config = providers.get(provider)
        location = ("local" if is_local(config) else "cloud") if config else "unknown"
        input_tokens = total([call.input_tokens for call in calls])
        output_tokens = total([call.output_tokens for call in calls])
        price = lookup_pricing(provider, model) if location == "cloud" else None
        cost = None
        if price and input_tokens is not None and output_tokens is not None:
            cost = (input_tokens * price["input"] + output_tokens * price["output"]) / 1_000_000
        item = {
            "id": f"{provider}/{model}",
            "title": f"{provider} · {model}",
            "location": location,
            "calls": len(calls),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": round(sum(c.total_ms for c in calls), 2),
        }
        if location == "cloud":
            item["estimated_cost_usd"] = cost
        items.append(item)
    return {
        "items": items,
        "trace_count": len(traces),
        "window": "Up to 100 recent turns in this session",
    }
