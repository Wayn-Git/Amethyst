"""Read the Director's existing diagnostics; never execute tools here."""

from backend.agent.trace import get_recent_traces
from backend.db.repositories import AgentRunRepository, ExecutionLogRepository


async def provide(widget_id):
    if widget_id == "agent.audit":
        return {
            "items": [
                {
                    "id": row["id"],
                    "title": row["tool_name"],
                    "detail": " · ".join(
                        str(value)
                        for value in (
                            row["created_at"],
                            row["tool_source"],
                            row["confirmation_decision"],
                            row["error"] or row["result_summary"],
                        )
                        if value
                    ),
                    "conversation_id": row["conversation_id"],
                }
                for row in ExecutionLogRepository().recent(50)
            ]
        }
    if widget_id == "agent.running":
        return {
            "items": [
                {
                    "id": run.id,
                    "title": run.phase,
                    "detail": f"{run.tool_calls_made} tool calls completed",
                    "conversation_id": run.conversation_id,
                }
                for run in AgentRunRepository().live()
            ]
        }
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
