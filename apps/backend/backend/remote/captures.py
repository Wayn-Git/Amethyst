"""Durable phone captures imported by the existing library service."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend import jobs
from backend.db.connection import get_connection
from backend.db.repositories import ExecutionLogRepository
from backend.library.service import LibraryService
from backend.security.confirmation import ConfirmationService
from backend.security.remote_access import allowed
from backend.sync.devices import get_device
from backend.tools.base import RiskLevel, Tool

KIND = "mobile_capture"
router = APIRouter(prefix="/api/mobile", tags=["mobile"])


class Capture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    title: str = Field(min_length=1, max_length=400)
    text: str = Field(default="", max_length=100000)
    url: str = Field(default="", max_length=8192)
    approved: Literal[True]

    @model_validator(mode="after")
    def content(self):
        from urllib.parse import urlsplit
        if not self.title.strip() or not (self.text.strip() or self.url.strip()):
            raise ValueError("A title and text or URL are required")
        if self.url and urlsplit(self.url).scheme not in {"http", "https"}:
            raise ValueError("Only HTTP and HTTPS links can be captured")
        return self


async def run_capture(job, store):
    payload = job.payload
    if payload["device_id"] != "local" and not allowed(
        get_device(get_connection(), payload["device_id"]), "library",
    ):
        raise jobs.Unretryable("The capturing device no longer has library access")
    library = LibraryService()
    if payload["url"]:
        result = await library.capture_url(payload["url"], title=payload["title"], notes=payload["text"] or None)
    else:
        result = await library.log_manual(title=payload["title"], text=payload["text"],
                                          source_ref=f"mobile:{job.idempotency_key}")
    return {"item_id": result.item["id"], "capture_note": result.item.get("capture_note")}


jobs.register(jobs.Handler(kind=KIND, run=run_capture, max_attempts=3, auto_retry_after_crash=True))
lane = jobs.JobRunner([KIND], name="mobile-captures")


@router.post("/captures", status_code=202)
async def capture(body: Capture, request: Request):
    device = request.scope.get("device")
    owner = device.id if device else "local"
    payload = {"device_id": owner, "title": body.title, "text": body.text, "url": body.url}

    async def approve(_):
        return body.approved

    tool = Tool(name="mobile_capture", description="Save a reviewed phone capture to the library",
                parameters={}, handler=approve, risk=RiskLevel.MEDIUM)
    outcome = await ConfirmationService(callback=approve, require_write_approval=True).check(tool, payload)
    if not outcome.allowed:
        raise HTTPException(403, "Capture denied by permission policy")
    job = jobs.enqueue(KIND, f"mobile:{owner}:{body.id}", payload=payload)
    if job.payload != payload:
        raise HTTPException(409, "This capture ID already belongs to different content")
    ExecutionLogRepository().record(tool_name=tool.name, tool_source="builtin",
                                    arguments={"device_id": owner, "capture_id": str(body.id)},
                                    confirmation_decision=outcome.decision, risk_level="medium")
    lane.nudge()
    return {"job_id": job.id, "state": job.state}
