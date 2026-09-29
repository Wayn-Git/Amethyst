"""Reverse-proxy router that forwards ``/api/opencode/*`` to the local
OpenCode server.

SSE-aware: requests whose ``Accept`` header includes ``text/event-stream``
are proxied as unbuffered streaming responses so the browser receives
real-time events from OpenCode without intermediate buffering.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.opencode.manager import get_manager

log = logging.getLogger("amethyst.opencode.proxy")

router = APIRouter(prefix="/api/opencode", tags=["opencode"])


# ---------------------------------------------------------------------------
# Management endpoints (not proxied — they control the subprocess)
# ---------------------------------------------------------------------------


@router.get("/status")
async def opencode_status():
    """Return whether the opencode process is running and on which port."""
    mgr = get_manager()
    return {
        "running": mgr.is_running,
        "port": mgr.port,
        "healthy": await mgr.health_check() if mgr.is_running else False,
    }


@router.post("/start")
async def opencode_start():
    """Start the opencode process if it is not already running."""
    mgr = get_manager()
    try:
        port = await mgr.ensure_running()
        return {"running": True, "port": port}
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"running": False, "error": str(exc)},
        )


@router.post("/stop")
async def opencode_stop():
    """Stop the opencode process."""
    mgr = get_manager()
    await mgr.stop()
    return {"running": False}


# ---------------------------------------------------------------------------
# Catch-all proxy
# ---------------------------------------------------------------------------

# A single long-lived client so TCP connections to the opencode server are
# pooled.  Timeouts are generous because model turns and tool executions
# can take minutes.
_proxy_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _proxy_client
    if _proxy_client is None or _proxy_client.is_closed:
        _proxy_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=600, write=30, pool=10),
            follow_redirects=False,
            limits=httpx.Limits(
                max_connections=50,
                max_keepalive_connections=10,
            ),
        )
    return _proxy_client


async def _close_client() -> None:
    global _proxy_client
    if _proxy_client and not _proxy_client.is_closed:
        await _proxy_client.aclose()
        _proxy_client = None


def _target_url(port: int, path: str, query: str) -> str:
    """Build the opencode URL to proxy to."""
    clean_path = path.lstrip("/")
    base = f"http://127.0.0.1:{port}/{clean_path}"
    if query:
        base = f"{base}?{query}"
    return base


def _forward_headers(request: Request) -> dict[str, str]:
    """Extract headers to forward, dropping hop-by-hop headers."""
    skip = {
        "host",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
    }
    return {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in skip
    }


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy(request: Request, path: str):
    """Forward any request to the local opencode server.

    If the client asks for ``text/event-stream``, the response is streamed
    chunk-by-chunk without buffering so SSE events arrive in real time.
    """
    mgr = get_manager()
    if not mgr.is_running:
        try:
            await mgr.ensure_running()
        except Exception as exc:
            return JSONResponse(
                status_code=502,
                content={"error": f"OpenCode not available: {exc}"},
            )

    port = mgr.port
    if not port:
        return JSONResponse(
            status_code=502,
            content={"error": "OpenCode port unknown"},
        )

    url = _target_url(port, path, request.url.query)
    headers = _forward_headers(request)

    # Read request body for methods that have one.
    body: bytes | None = None
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()

    is_sse = "text/event-stream" in request.headers.get("accept", "")

    try:
        if is_sse:
            return await _stream_response(request.method, url, headers, body)
        return await _simple_response(request.method, url, headers, body)
    except httpx.ConnectError:
        return JSONResponse(
            status_code=502,
            content={"error": "Cannot connect to OpenCode server"},
        )
    except httpx.ReadTimeout:
        return JSONResponse(
            status_code=504,
            content={"error": "OpenCode server timed out"},
        )
    except Exception as exc:
        log.exception("proxy error for %s %s", request.method, path)
        return JSONResponse(
            status_code=502,
            content={"error": str(exc)},
        )


async def _simple_response(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
) -> StreamingResponse:
    """Proxy a regular (non-streaming) request."""
    resp = await _client().request(
        method,
        url,
        headers=headers,
        content=body,
    )
    # Forward response headers, stripping hop-by-hop.
    resp_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower()
        not in ("transfer-encoding", "connection", "content-encoding", "content-length")
    }

    async def _yield_body():
        yield resp.content

    return StreamingResponse(
        _yield_body(),
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=resp.headers.get("content-type"),
    )


async def _stream_response(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
) -> StreamingResponse:
    """Proxy an SSE or other streaming response without buffering."""
    client = _client()
    req = client.build_request(
        method,
        url,
        headers=headers,
        content=body,
        timeout=httpx.Timeout(connect=10, read=None, write=30, pool=10),
    )

    resp = await client.send(req, stream=True)

    resp_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower()
        not in ("transfer-encoding", "connection", "content-encoding", "content-length")
    }

    async def _generate():
        try:
            async for chunk in resp.aiter_bytes(chunk_size=None):
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        _generate(),
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=resp.headers.get("content-type", "text/event-stream"),
    )
