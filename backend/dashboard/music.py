"""The local desktop playback session; no connector or playback history cache."""

import asyncio

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard import items
from backend.dashboard.models import StrictModel
from backend.remote import media


class MusicInput(StrictModel):
    player: str = Field(pattern=r"^org\.mpris\.MediaPlayer2\.[A-Za-z0-9_.-]+$", max_length=255)
    track_id: str = Field(default="", max_length=2048)


async def provide(widget_id):
    state = await asyncio.to_thread(media.get_playback_status)
    return {
        **state,
        "items": [
            {
                "title": state.get("title") or state["active_player"],
                "artists": state.get("artists", []),
            }
        ]
        if state["active_player"]
        else [],
    }


def draft(action, body):
    if action not in ("play", "pause", "previous", "next"):
        raise HTTPException(404, "Unknown playback action")
    state = media.get_playback_status(body.player)
    if state["player_id"] != body.player or state.get("track_id", "") != body.track_id:
        raise HTTPException(409, "The desktop player changed. Refresh and try again.")
    if not state["controls"].get(action):
        raise HTTPException(409, "This player does not support that control.")
    return items.save_draft(
        "glance.music",
        action,
        body,
        {
            **body.model_dump(),
            "status": state["status"],
        },
    )


async def apply(action, body):
    def execute():
        state = media.get_playback_status(body["player"])
        if (
            state["player_id"] != body["player"]
            or state.get("track_id", "") != body["track_id"]
            or state["status"] != body["status"]
        ):
            raise HTTPException(409, "Playback changed. Review a new command.")
        if action not in ("play", "pause", "previous", "next") or not state["controls"].get(action):
            raise HTTPException(409, "This player does not support that control.")
        result = media.media_control(action, body["player"])
        if not result["ok"]:
            raise HTTPException(503, result["error"])

    await asyncio.to_thread(execute)
