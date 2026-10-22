"""Structured diagnostic logging and diffing for LLM model calls (Problem 2).

Logs for every model call:
- provider, model id, base URL
- whether provider client was freshly created or reused
- whether HTTP connection was reused and how long it had been idle
- message count and roles
- presence of reasoning/thinking fields
- tool_calls and tool-result formats
- number of tools sent
- every request parameter (tool_choice, parallel_tool_calls, stream_options, max_tokens, temperature)
- full failure: HTTP status, response body, error code, duration
- structural diff for failure followed by success
"""

from __future__ import annotations

import difflib
import json
import logging
import time
from typing import Any
from urllib.parse import urlparse

log = logging.getLogger("amethyst.llm_diagnostic")

# Track client instance IDs seen so far: {provider: set(client_ids)}
_seen_client_ids: set[int] = set()

# Track last request time per host: {host: timestamp}
_host_last_request_time: dict[str, float] = {}

# Track last failed payload per provider/model: {key: (timestamp, payload, error_info)}
_last_failed_call: dict[str, tuple[float, dict[str, Any], dict[str, Any]]] = {}


def redact_headers(headers: dict[str, str] | None) -> dict[str, str]:
    if not headers:
        return {}
    clean = {}
    for k, v in headers.items():
        lower_k = k.lower()
        if any(secret in lower_k for secret in ("auth", "key", "token", "secret", "password")):
            clean[k] = "[REDACTED]"
        else:
            clean[k] = v
    return clean


def structural_diff(old: Any, new: Any, path: str = "") -> list[str]:
    """Produce a readable structural diff between two JSON-like structures."""
    diffs = []
    if type(old) != type(new):
        diffs.append(f"{path}: type changed from {type(old).__name__} to {type(new).__name__}")
        return diffs

    if isinstance(old, dict):
        old_keys = set(old.keys())
        new_keys = set(new.keys())
        for k in sorted(new_keys - old_keys):
            p = f"{path}.{k}" if path else k
            diffs.append(f"+ {p} = {json.dumps(new[k], default=str)[:120]}")
        for k in sorted(old_keys - new_keys):
            p = f"{path}.{k}" if path else k
            diffs.append(f"- {p} (was {json.dumps(old[k], default=str)[:120]})")
        for k in sorted(old_keys & new_keys):
            p = f"{path}.{k}" if path else k
            if old[k] != new[k]:
                if isinstance(old[k], (dict, list)):
                    diffs.extend(structural_diff(old[k], new[k], p))
                else:
                    diffs.append(f"~ {p}: {old[k]!r} -> {new[k]!r}")
    elif isinstance(old, list):
        if len(old) != len(new):
            diffs.append(f"{path}: list length changed from {len(old)} to {len(new)}")
        for i in range(min(len(old), len(new))):
            p = f"{path}[{i}]"
            if old[i] != new[i]:
                diffs.extend(structural_diff(old[i], new[i], p))
        if len(new) > len(old):
            for i in range(len(old), len(new)):
                diffs.append(f"+ {path}[{i}] = {json.dumps(new[i], default=str)[:120]}")
        elif len(old) > len(new):
            for i in range(len(new), len(old)):
                diffs.append(f"- {path}[{i}] (was {json.dumps(old[i], default=str)[:120]})")
    elif old != new:
        diffs.append(f"~ {path}: {old!r} -> {new!r}")
    return diffs


def record_call_start(
    url: str,
    payload: dict[str, Any],
    client_instance: Any = None,
    provider: str | None = None,
) -> dict[str, Any]:
    """Capture and log all request attributes before sending."""
    parsed_url = urlparse(url)
    host = parsed_url.netloc or parsed_url.path.split("/")[0]
    now = time.perf_counter()

    # Connection reuse / idle time
    last_req = _host_last_request_time.get(host)
    conn_reused = last_req is not None
    idle_seconds = (now - last_req) if last_req is not None else 0.0
    _host_last_request_time[host] = now

    # Client reuse
    client_id = id(client_instance) if client_instance is not None else None
    client_reused = False
    if client_id is not None:
        client_reused = client_id in _seen_client_ids
        _seen_client_ids.add(client_id)

    # Inspect payload
    model = payload.get("model") or payload.get("model_id") or "unknown"
    messages = payload.get("messages") or payload.get("contents") or []
    message_count = len(messages) if isinstance(messages, list) else 0

    roles = []
    has_reasoning = False
    tool_call_formats = []
    tool_result_formats = []

    if isinstance(messages, list):
        for idx, m in enumerate(messages):
            if isinstance(m, dict):
                r = m.get("role", "unknown")
                roles.append(r)
                if any(k in m for k in ("reasoning", "reasoning_content", "thought")):
                    has_reasoning = True
                if m.get("tool_calls"):
                    for tc in m["tool_calls"]:
                        fn = tc.get("function") if isinstance(tc, dict) else None
                        has_fn = fn is not None
                        args = fn.get("arguments") if has_fn else None
                        args_is_str = isinstance(args, str)
                        tool_call_formats.append(
                            f"tc[msg={idx},type={tc.get('type')},has_fn={has_fn},args_str={args_is_str}]"
                        )
                if r == "tool" or m.get("tool_call_id"):
                    tool_result_formats.append(
                        f"tr[msg={idx},call_id={bool(m.get('tool_call_id'))},has_name={bool(m.get('name'))}]"
                    )

    if payload.get("reasoning_effort"):
        has_reasoning = True

    tools = payload.get("tools") or []
    tools_count = len(tools) if isinstance(tools, list) else 0

    params_summary = {
        "tool_choice": payload.get("tool_choice"),
        "parallel_tool_calls": payload.get("parallel_tool_calls"),
        "stream_options": payload.get("stream_options"),
        "max_tokens": payload.get("max_tokens"),
        "temperature": payload.get("temperature"),
        "reasoning_effort": payload.get("reasoning_effort"),
        "stream": payload.get("stream"),
    }

    diag_info = {
        "provider": provider or "unknown",
        "model": model,
        "base_url": f"{parsed_url.scheme}://{parsed_url.netloc}",
        "url": url,
        "client_reused": client_reused,
        "conn_reused": conn_reused,
        "conn_idle_seconds": round(idle_seconds, 3),
        "message_count": message_count,
        "roles": roles,
        "has_reasoning": has_reasoning,
        "tool_calls_formats": tool_call_formats,
        "tool_result_formats": tool_result_formats,
        "tools_count": tools_count,
        "parameters": params_summary,
        "start_time": now,
        "payload": payload,
    }

    log.info(
        "[LLM_CALL_DIAGNOSTIC] START | provider=%s model=%s url=%s client_reused=%s conn_reused=%s (idle=%.2fs) msgs=%d roles=%s reasoning=%s tools=%d params=%s",
        diag_info["provider"],
        diag_info["model"],
        diag_info["base_url"],
        diag_info["client_reused"],
        diag_info["conn_reused"],
        diag_info["conn_idle_seconds"],
        diag_info["message_count"],
        diag_info["roles"],
        diag_info["has_reasoning"],
        diag_info["tools_count"],
        json.dumps(params_summary, default=str),
    )
    return diag_info


def record_call_outcome(
    diag_info: dict[str, Any],
    status_code: int | None,
    response_body: str | None = None,
    error_code: str | None = None,
    exception: BaseException | None = None,
) -> None:
    """Record call outcome, log failure details or check for recovery diff."""
    duration_ms = (time.perf_counter() - diag_info["start_time"]) * 1000.0
    provider = diag_info["provider"]
    model = diag_info["model"]
    key = f"{provider}:{model}"

    is_failure = (status_code is not None and status_code >= 400) or exception is not None

    if is_failure:
        err_msg = str(exception) if exception else (response_body or "no body")
        # Attempt to parse json error code from body
        parsed_err_code = error_code
        if not parsed_err_code and response_body:
            try:
                b_json = json.loads(response_body)
                if isinstance(b_json, dict):
                    err_obj = b_json.get("error")
                    if isinstance(err_obj, dict):
                        parsed_err_code = err_obj.get("code") or err_obj.get("type") or parsed_err_code
                    parsed_err_code = b_json.get("errorCode") or parsed_err_code
            except Exception:
                pass

        fail_info = {
            "status_code": status_code,
            "response_body": (response_body or "")[:500],
            "error_code": parsed_err_code,
            "duration_ms": round(duration_ms, 2),
            "exception_class": type(exception).__name__ if exception else None,
            "exception_msg": str(exception) if exception else None,
        }
        _last_failed_call[key] = (time.perf_counter(), diag_info["payload"], fail_info)
        _last_failed_call[provider] = (time.perf_counter(), diag_info["payload"], fail_info)

        log.error(
            "[LLM_CALL_DIAGNOSTIC] FAILURE | provider=%s model=%s status=%s err_code=%s duration=%.1fms error=%s body=%s",
            provider,
            model,
            status_code,
            parsed_err_code,
            duration_ms,
            fail_info["exception_msg"] or fail_info["exception_class"],
            fail_info["response_body"],
        )
    else:
        # Success: check if this follows a recent failure on same provider/model or same provider
        log.info(
            "[LLM_CALL_DIAGNOSTIC] SUCCESS | provider=%s model=%s status=%s duration=%.1fms",
            provider,
            model,
            status_code or 200,
            duration_ms,
        )
        matched_fail = None
        matched_key = None
        if key in _last_failed_call:
            matched_key = key
            matched_fail = _last_failed_call.pop(key)
            _last_failed_call.pop(provider, None)
        elif provider in _last_failed_call:
            matched_key = provider
            matched_fail = _last_failed_call.pop(provider)

        if matched_fail:
            fail_time, fail_payload, fail_info = matched_fail
            time_since_fail = time.perf_counter() - fail_time
            if time_since_fail < 300.0:  # Within 5 minutes
                diff_lines = structural_diff(fail_payload, diag_info["payload"])
                diff_str = "\n".join(f"  {line}" for line in diff_lines) if diff_lines else "  (No structural payload differences; network/timing/connection recovery)"
                log.info(
                    "[LLM_CALL_DIAGNOSTIC] RECOVERY STRUCTURAL DIFF (Fail -> Success in %.1fs) for %s:\n%s",
                    time_since_fail,
                    matched_key,
                    diff_str,
                )
                print(
                    f"\n=======================================================\n"
                    f"[LLM_CALL_DIAGNOSTIC] RECOVERY STRUCTURAL DIFF (Fail -> Success in {time_since_fail:.1f}s) for {matched_key}:\n"
                    f"{diff_str}\n"
                    f"=======================================================\n"
                )
