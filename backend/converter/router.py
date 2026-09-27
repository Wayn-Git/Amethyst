"""API routes for file conversion and processing workspace."""
from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel

from .service import ConverterService

router = APIRouter(prefix="/api/converter", tags=["converter"])
service = ConverterService()


class ProcessRequest(BaseModel):
    file_id: str | None = None
    file_ids: list[str] | None = None
    operation: str = "convert"
    target_format: str | None = None
    options: dict[str, Any] = {}


@router.get("/capabilities")
async def get_capabilities() -> dict[str, Any]:
    """Get installed converter engines, formats, and available operations."""
    return service.get_capabilities()


@router.post("/upload")
async def upload_files(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    """Upload one or more files for conversion/processing."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    uploaded = []
    for file in files:
        try:
            meta = await service.save_upload(file)
            uploaded.append(meta)
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}")

    return {"uploaded": uploaded}


@router.post("/process")
async def process_file(payload: ProcessRequest) -> dict[str, Any]:
    """Execute a conversion or transformation on uploaded file(s)."""
    try:
        result = await service.process(
            file_id=payload.file_id,
            file_ids=payload.file_ids,
            operation=payload.operation,
            target_format=payload.target_format,
            options=payload.options,
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}")


@router.get("/download/{job_id}")
async def download_result(job_id: str) -> FileResponse:
    """Download the converted/processed file."""
    path = service.get_output_path(job_id)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="Processed file not found or expired.")

    mime_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(
        path=str(path),
        filename=path.name,
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@router.get("/preview/{job_id}")
async def preview_result(job_id: str) -> FileResponse:
    """Inline view of the processed result (images, video, audio, pdf, text)."""
    path = service.get_output_path(job_id)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    mime_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(
        path=str(path),
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


@router.delete("/files/{file_id}")
async def delete_upload(file_id: str) -> dict[str, bool]:
    """Remove an uploaded or output directory."""
    import shutil

    upload_dir = service.uploads_dir / file_id
    if upload_dir.is_dir():
        shutil.rmtree(upload_dir, ignore_errors=True)

    output_dir = service.outputs_dir / file_id
    if output_dir.is_dir():
        shutil.rmtree(output_dir, ignore_errors=True)

    return {"deleted": True}


class QRRequest(BaseModel):
    content: str
    kind: str = "png"
    scale: int = 10
    border: int = 2


@router.post("/qr")
async def generate_qr(payload: QRRequest) -> dict[str, Any]:
    """Generate a QR code as PNG (data URL) or SVG."""
    import base64
    import io
    import urllib.parse
    import segno

    text = (payload.content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="QR content cannot be empty.")

    qr = segno.make_qr(text)
    kind = payload.kind.lower()
    if kind not in {"png", "svg"}:
        kind = "png"

    buf = io.BytesIO()
    qr.save(buf, kind=kind, scale=payload.scale, border=payload.border)
    val = buf.getvalue()

    if kind == "svg":
        data_url = f"data:image/svg+xml;utf8,{urllib.parse.quote(val.decode('utf-8'))}"
    else:
        b64 = base64.b64encode(val).decode("utf-8")
        data_url = f"data:image/png;base64,{b64}"

    return {
        "content": text,
        "kind": kind,
        "data_url": data_url,
    }
