from __future__ import annotations

import json
import base64
import os
import struct
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Any

from .common import (
    DEFAULT_ENDPOINT,
    IMAGE_TYPES,
    MAX_GENERATION_BYTES,
    MAX_REFERENCE_IMAGE_BYTES,
    PROMPTS,
    artifact_dir,
    atomic_write,
    connect,
    digest,
    event,
    now,
    read_prompts,
    sync_prompt_tasks,
    task_access,
    valid_id,
)


def _save_failure(widget_id: str, prompt: str, error: str) -> None:
    out = artifact_dir(widget_id)
    out.mkdir(parents=True, exist_ok=True)
    metadata_path = out / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        metadata = {}
    hashes = metadata.get("contentHashes", {})
    for name in ("template.jsx", "data.json", "reference.png", "reference.jpg"):
        path = out / name
        if path.is_file():
            hashes[name] = digest(path.read_bytes())
    metadata.update(
        {
            "widgetId": widget_id,
            "prompt": prompt,
            "generatedAt": now(),
            "generationStatus": "failed",
            "imageStatus": "available" if metadata.get("imageFile") in hashes else "missing",
            "contentHashes": hashes,
            "error": error[:4000],
        }
    )
    atomic_write(out / "metadata.json", (json.dumps(metadata, indent=2) + "\n").encode("utf-8"))
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "INSERT INTO tasks(widget_id,status,created_at,updated_at,error) "
            "VALUES(?,?,?,?,?) ON CONFLICT(widget_id) DO UPDATE SET "
            "status='failed',updated_at=excluded.updated_at,error=excluded.error",
            (widget_id, "failed", now(), now(), error[:4000]),
        )
        event(db, widget_id, None, "generation_failed", error)
        db.commit()
    finally:
        db.close()


def generate(
    widget_id: str,
    prompt: str,
    endpoint: str | None = None,
    retries: int = 3,
    timeout: float = 600,
    reference_image: Path | None = None,
) -> dict[str, Any]:
    valid_id(widget_id)
    if not prompt.strip():
        raise ValueError("Prompt must not be empty")
    if retries < 0 or retries > 5:
        raise ValueError("retries must be between 0 and 5")
    image_path = reference_image or _existing_reference_image(widget_id)
    image_ext, image_bytes = _read_reference_image(image_path) if image_path else (None, None)
    endpoint = endpoint or os.environ.get("WIDGET_FACTORY_ENDPOINT", DEFAULT_ENDPOINT)
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT status,session_id,worktree FROM tasks WHERE widget_id=?", (widget_id,)
        ).fetchone()
        if existing and (
            existing["status"]
            in ("generating", "claimed", "implementing", "review", "integrating", "completed")
            or existing["session_id"]
            or existing["worktree"]
        ):
            raise ValueError(f"Cannot regenerate a task in status {existing['status']}")
        stamp = now()
        db.execute(
            "INSERT INTO tasks(widget_id,status,created_at,updated_at,error) "
            "VALUES(?,?,?,?,NULL) ON CONFLICT(widget_id) DO UPDATE SET "
            "status='generating',updated_at=excluded.updated_at,error=NULL",
            (widget_id, "generating", stamp, stamp),
        )
        event(db, widget_id, None, "generation_started")
        db.commit()
    finally:
        db.close()
    if reference_image and image_ext and image_bytes:
        _store_reference_image(widget_id, image_ext, image_bytes)
    mime_type = "image/png" if image_ext == ".png" else "image/jpeg"
    reference_images = (
        [{"dataUrl": f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"}]
        if image_bytes
        else []
    )
    body = json.dumps({"prompt": prompt, "referenceImages": reference_images}).encode()
    last_error = "generation failed"
    response_data: dict[str, Any] | None = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Amethyst-Widget-Factory/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read(MAX_GENERATION_BYTES + 1)
                if len(raw) > MAX_GENERATION_BYTES:
                    raise ValueError("Gan-Tu response exceeds the 25 MiB limit")
                response_data = json.loads(raw)
                if (
                    not isinstance(response_data, dict)
                    or not isinstance(response_data.get("template"), str)
                    or not response_data["template"].strip()
                    or response_data.get("data") is None
                ):
                    raise ValueError("Gan-Tu response must contain a non-empty template and data")
                break
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:1000]}"
            retryable = exc.code == 429 or 500 <= exc.code < 600
        except (TimeoutError, urllib.error.URLError) as exc:
            last_error, retryable = f"{type(exc).__name__}: {exc}", True
        except (json.JSONDecodeError, ValueError) as exc:
            last_error, retryable = f"Malformed response: {exc}", True
        if attempt >= retries or not retryable:
            _save_failure(widget_id, prompt, last_error)
            raise RuntimeError(last_error)
        time.sleep(min(2**attempt, 8))
    assert response_data is not None
    out = artifact_dir(widget_id)
    out.mkdir(parents=True, exist_ok=True)
    template = response_data["template"]
    data_bytes = (json.dumps(response_data["data"], ensure_ascii=False, indent=2) + "\n").encode()
    template_bytes = template.encode("utf-8")
    atomic_write(out / "template.jsx", template_bytes)
    atomic_write(out / "data.json", data_bytes)
    old_meta_path = out / "metadata.json"
    old = json.loads(old_meta_path.read_text()) if old_meta_path.exists() else {}
    image = out / "reference.png"
    metadata = {
        "widgetId": widget_id,
        "prompt": prompt,
        "generatedAt": now(),
        "generationStatus": "generated",
        "imageStatus": "available"
        if image.exists() or (out / "reference.jpg").exists()
        else "missing",
        "theme": response_data.get("theme"),
        "designSpec": response_data.get("designSpec"),
        "stages": response_data.get("stages"),
        "contentHashes": {"template.jsx": digest(template_bytes), "data.json": digest(data_bytes)},
    }
    image_name = old.get("imageFile")
    image_path = out / image_name if image_name in ("reference.png", "reference.jpg") else None
    if not image_path or not image_path.exists():
        image_path = image if image.exists() else out / "reference.jpg"
    if image_path.exists():
        metadata["imageStatus"] = "available"
        metadata["imageFile"] = image_path.name
        metadata["contentHashes"][image_path.name] = digest(image_path.read_bytes())
    atomic_write(
        out / "metadata.json",
        (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "UPDATE tasks SET status='generated',updated_at=?,error=NULL WHERE widget_id=?",
            (now(), widget_id),
        )
        event(db, widget_id, None, "generated", json.dumps(metadata["contentHashes"]))
        db.commit()
    finally:
        db.close()
    return metadata


def generate_batch(path: Path = PROMPTS, endpoint: str | None = None) -> dict[str, Any]:
    results = {}
    prompts = read_prompts(path)
    sync_prompt_tasks(prompts)
    for widget_id, prompt in prompts.items():
        try:
            results[widget_id] = {"ok": True, "metadata": generate(widget_id, prompt, endpoint)}
        except Exception as exc:  # preserve each failure and continue independent widgets
            results[widget_id] = {"ok": False, "error": str(exc)}
    return results


def register_image(
    widget_id: str, image_path: Path, session_id: str | None = None
) -> dict[str, Any]:
    task_access(widget_id, session_id)
    out = artifact_dir(widget_id)
    if not image_path.is_file():
        raise ValueError("Image path must name an existing regular file")
    ext, raw = _read_reference_image(image_path)
    target = _store_reference_image(widget_id, ext, raw)
    return {"widgetId": widget_id, "imageFile": str(target), "sha256": digest(raw)}


def _existing_reference_image(widget_id: str) -> Path | None:
    out = artifact_dir(widget_id)
    meta_path = out / "metadata.json"
    try:
        image_name = json.loads(meta_path.read_text(encoding="utf-8")).get("imageFile")
    except (OSError, json.JSONDecodeError):
        image_name = None
    candidates = [out / image_name] if image_name in ("reference.png", "reference.jpg") else []
    candidates.extend((out / "reference.png", out / "reference.jpg"))
    return next((path for path in candidates if path.is_file()), None)


def _read_reference_image(image_path: Path) -> tuple[str, bytes]:
    ext = image_path.suffix.lower()
    if ext not in IMAGE_TYPES:
        raise ValueError("Reference must be PNG or JPEG")
    raw = image_path.read_bytes()
    if len(raw) > MAX_REFERENCE_IMAGE_BYTES:
        raise ValueError("Reference image exceeds the 10 MiB limit")
    if ext == ".png":
        validate_png(raw)
    else:
        validate_jpeg(raw)
    return (".jpg" if ext in (".jpg", ".jpeg") else ext), raw


def _store_reference_image(widget_id: str, ext: str, raw: bytes) -> Path:
    out = artifact_dir(widget_id)
    out.mkdir(parents=True, exist_ok=True)
    target = out / ("reference.png" if ext == ".png" else "reference.jpg")
    atomic_write(target, raw)
    meta_path = out / "metadata.json"
    metadata = (
        json.loads(meta_path.read_text(encoding="utf-8"))
        if meta_path.exists()
        else {"widgetId": widget_id, "generationStatus": "missing", "contentHashes": {}}
    )
    metadata.update({"imageStatus": "available", "imageFile": target.name})
    metadata.setdefault("contentHashes", {})[target.name] = digest(raw)
    atomic_write(
        meta_path, (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )
    return target


def validate_png(raw: bytes) -> None:
    if not raw.startswith(IMAGE_TYPES[".png"][0]):
        raise ValueError("File extension and image signature do not match")
    offset = 8
    seen_header = seen_data = seen_end = False
    while offset + 12 <= len(raw):
        length = struct.unpack(">I", raw[offset : offset + 4])[0]
        end = offset + 12 + length
        if end > len(raw):
            break
        kind = raw[offset + 4 : offset + 8]
        payload = raw[offset + 8 : offset + 8 + length]
        checksum = struct.unpack(">I", raw[offset + 8 + length : end])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != checksum:
            raise ValueError("PNG contains an invalid chunk checksum")
        if kind == b"IHDR":
            if seen_header or offset != 8 or length != 13:
                raise ValueError("PNG has an invalid header")
            width, height = struct.unpack(">II", payload[:8])
            if width == 0 or height == 0:
                raise ValueError("PNG dimensions must be positive")
            seen_header = True
        elif kind == b"IDAT":
            seen_data = True
        elif kind == b"IEND":
            seen_end = length == 0 and end == len(raw)
            break
        offset = end
    if not (seen_header and seen_data and seen_end):
        raise ValueError("PNG image data is incomplete")


def validate_jpeg(raw: bytes) -> None:
    if not raw.startswith(b"\xff\xd8\xff") or not raw.endswith(b"\xff\xd9"):
        raise ValueError("File extension and image signature do not match")
    if not any(
        bytes((marker,)) in raw
        for marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF)
    ):
        raise ValueError("JPEG frame header is missing")


def artifacts(widget_id: str, session_id: str | None = None) -> dict[str, Any]:
    task_access(widget_id, session_id)
    out = artifact_dir(widget_id)
    meta_path = out / "metadata.json"
    metadata = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    image_path = out / metadata.get("imageFile", "")
    if image_path.name not in ("reference.png", "reference.jpg") or not image_path.is_file():
        image_path = out / "reference.png"
        if not image_path.exists():
            image_path = out / "reference.jpg"
    return {
        "widgetId": widget_id,
        "directory": str(out),
        "template": str(out / "template.jsx"),
        "data": str(out / "data.json"),
        "metadata": str(out / "metadata.json"),
        "image": str(image_path) if image_path.exists() else None,
        "metadataContent": metadata,
        "available": [p.name for p in out.iterdir()] if out.exists() else [],
    }
