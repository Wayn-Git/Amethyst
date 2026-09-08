"""Read the Director's existing diagnostics; never execute tools here."""

import json

from backend.agent.trace import get_recent_traces
from backend.db.repositories import AgentRunRepository, ExecutionLogRepository
from backend.secrets import redact


async def provide(widget_id):
    if widget_id == "agent.usage":
        from backend.dashboard.usage import provide as usage

        return await usage()
    if widget_id == "agent.rules":
        from backend.dashboard.rules import provide as rules

        return await rules()
    if widget_id == "agent.watchers":
        from backend.dashboard.watchers import provide as watchers

        return await watchers()
    if widget_id == "agent.research":
        from backend.dashboard.research import provide as research

        return await research()
    if widget_id == "agent.delegated":
        from backend.dashboard.delegated import provide as delegated

        return await delegated()
    if widget_id == "agent.jobs":
        from backend.dashboard.jobs import provide as jobs

        return await jobs()
    if widget_id == "need.decisions":
        from backend.agent.questions import outstanding

        return {
            "items": [
                {
                    "id": ask["id"],
                    "title": "Decision waiting",
                    "conversation_id": ask["conversation_id"],
                    "questions": ask["questions"],
                }
                for ask in outstanding()
            ]
        }
    if widget_id == "need.approvals":
        from backend.api.main import list_confirmations

        return {
            "items": [
                {
                    "id": prompt.id,
                    "title": prompt.tool_name,
                    "detail": f"{prompt.risk} · {prompt.reason}",
                    "arguments": json.dumps(redact(prompt.arguments), ensure_ascii=False),
                    "conversation_id": prompt.conversation_id,
                }
                for prompt in await list_confirmations()
            ],
            "history": [
                {
                    "id": row["id"],
                    "title": row["tool_name"],
                    "detail": f"{row['created_at']} · {row['confirmation_decision']}",
                }
                for row in ExecutionLogRepository().conn.execute(
                    "SELECT * FROM execution_logs WHERE confirmation_decision IS NOT NULL "
                    "AND confirmation_decision != 'auto' ORDER BY id DESC LIMIT 50"
                )
            ],
        }
    if widget_id == "agent.errors":
        rows = (
            ExecutionLogRepository()
            .conn.execute(
                "SELECT id, tool_name, error, created_at FROM execution_logs "
                "WHERE error IS NOT NULL AND error != '' ORDER BY id DESC LIMIT 50"
            )
            .fetchall()
        )
        return {
            "items": [
                {
                    "id": f"tool:{row['id']}",
                    "title": row["tool_name"],
                    "detail": f"{row['created_at']} · {row['error']}",
                }
                for row in rows
            ]
            + [
                {"id": f"{trace.turn_id}:{index}", "title": "Turn error", "detail": error}
                for trace in reversed(get_recent_traces()[-50:])
                for index, error in enumerate(trace.errors)
            ]
        }
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
