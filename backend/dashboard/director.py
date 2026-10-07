"""Read the Director's existing diagnostics; never execute tools here."""

from backend.agent.trace import get_recent_traces


async def provide(widget_id):
    return {
        "items": [
            {
                "id": trace.turn_id,
                "title": trace.user_message,
                "detail": (
                    f"{trace.final_llm_call_count} model calls · "
                    f"{len(trace.tool_dispatches)} tool calls"
                ),
                "conversation_id": trace.conversation_id,
            }
            for trace in reversed(get_recent_traces()[-50:])
        ]
    }
