"""Composio response sanitizer and MIME/CSS auto-escalation handler.

Protects against payload bloat and remote workbench offloading:
1. Strips bulky inline <style> and <script> blocks from HTML email bodies.
2. Auto-extracts clean text/plain content from multi-part MIME trees.
3. Automatically decodes URL-safe and standard base64 email bodies.
4. Omits excessive MIME/CSS trees when plain text is available, annotating omitted tokens.
5. Emits warnings when verbose: true pulls disproportionate CSS (>50% of content).
"""

from __future__ import annotations

import base64
import html
import json
import logging
import re
from typing import Any

from backend.tools.base import ToolResult

log = logging.getLogger(__name__)

STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>[\s\S]*?<\/style>", re.IGNORECASE)
SCRIPT_BLOCK_RE = re.compile(r"<script\b[^>]*>[\s\S]*?<\/script>", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")


def decode_email_data(data: str | bytes) -> str:
    """Decode standard or URL-safe base64 email payload data."""
    if isinstance(data, bytes):
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            data = data.decode("latin-1")

    clean = data.strip().replace("-", "+").replace("_", "/")
    # Pad to multiple of 4
    remainder = len(clean) % 4
    if remainder:
        clean += "=" * (4 - remainder)

    try:
        decoded_bytes = base64.b64decode(clean)
        return decoded_bytes.decode("utf-8", errors="replace")
    except Exception:
        try:
            return base64.urlsafe_b64decode(clean).decode("utf-8", errors="replace")
        except Exception:
            return str(data)


def strip_style_and_scripts(html_text: str) -> tuple[str, int]:
    """Strip <style> and <script> blocks from HTML, returning (clean_html, stripped_char_count)."""
    if not html_text:
        return html_text, 0

    stripped_chars = 0

    def style_sub(match: re.Match) -> str:
        nonlocal stripped_chars
        stripped_chars += len(match.group(0))
        return ""

    cleaned = STYLE_BLOCK_RE.sub(style_sub, html_text)
    cleaned = SCRIPT_BLOCK_RE.sub(style_sub, cleaned)
    return cleaned, stripped_chars


def html_to_plain_text(html_text: str) -> str:
    """Convert HTML string to readable plain text with stripped tags."""
    if not html_text:
        return ""
    # Strip styles & scripts first
    cleaned, _ = strip_style_and_scripts(html_text)
    # Convert block line breaks
    text = re.sub(r"<(?:br|p|div|tr|li)[\s/]*>", "\n", cleaned, flags=re.IGNORECASE)
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    # Collapse multiple blank lines
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _extract_from_part(part: dict[str, Any]) -> tuple[list[str], list[str], int, int]:
    """Recursively extract (plain_parts, html_parts, total_mime_chars, total_css_chars) from a MIME part."""
    plain_parts: list[str] = []
    html_parts: list[str] = []
    total_mime_chars = 0
    total_css_chars = 0

    mime_type = str(part.get("mimeType", "")).lower()
    body = part.get("body") or {}
    raw_data = body.get("data") if isinstance(body, dict) else None

    if raw_data and isinstance(raw_data, str):
        total_mime_chars += len(raw_data)
        decoded = decode_email_data(raw_data)
        if "text/plain" in mime_type:
            plain_parts.append(decoded)
        elif "text/html" in mime_type:
            cleaned_html, stripped_css = strip_style_and_scripts(decoded)
            total_css_chars += stripped_css
            html_parts.append(cleaned_html)
        else:
            # fallback for untyped parts
            if "<html" in decoded.lower() or "<div" in decoded.lower():
                cleaned_html, stripped_css = strip_style_and_scripts(decoded)
                total_css_chars += stripped_css
                html_parts.append(cleaned_html)
            else:
                plain_parts.append(decoded)

    subparts = part.get("parts")
    if isinstance(subparts, list):
        for sub in subparts:
            if isinstance(sub, dict):
                p, h, m_chars, c_chars = _extract_from_part(sub)
                plain_parts.extend(p)
                html_parts.extend(h)
                total_mime_chars += m_chars
                total_css_chars += c_chars

    return plain_parts, html_parts, total_mime_chars, total_css_chars


def sanitize_gmail_message(
    msg: dict[str, Any],
    *,
    verbose: bool = False,
    caller_format: str | None = None,
) -> dict[str, Any]:
    """Process a single Gmail message: extract plain text inline and strip CSS/MIME bloat."""
    if not isinstance(msg, dict):
        return msg

    out = dict(msg)

    # If already has body as plain string
    direct_body = out.get("body")
    if isinstance(direct_body, str):
        if "<style" in direct_body.lower():
            clean_body, stripped_css = strip_style_and_scripts(direct_body)
            out["body"] = clean_body
            if stripped_css > 1000:
                omitted_tokens = stripped_css // 4
                out["_omitted_notice"] = (
                    f"({omitted_tokens} tokens of MIME/CSS omitted, plain-text body returned; call with format:'raw' for the full tree.)"
                )

    payload = out.get("payload")
    if isinstance(payload, dict):
        plain_parts, html_parts, mime_chars, css_chars = _extract_from_part(payload)

        # Decide on plain text body
        plain_text: str | None = None
        if plain_parts:
            plain_text = "\n\n".join(p.strip() for p in plain_parts if p.strip())
        elif html_parts:
            plain_text = html_to_plain_text("\n\n".join(html_parts))
        elif out.get("snippet"):
            plain_text = str(out["snippet"])

        # Retain necessary email headers
        raw_headers = payload.get("headers") or []
        essential_headers: list[dict[str, str]] = []
        if isinstance(raw_headers, list):
            for h in raw_headers:
                if isinstance(h, dict) and h.get("name") in (
                    "Subject", "From", "To", "Date", "Message-ID", "Cc"
                ):
                    essential_headers.append({"name": h["name"], "value": h.get("value", "")})

        if plain_text is not None:
            # Place plain text body inline and untruncated (single instance to respect token budget)
            out["body"] = plain_text

            omitted_tokens = (mime_chars + css_chars) // 4
            if omitted_tokens > 200 and caller_format != "raw":
                out["_omitted_notice"] = (
                    f"({omitted_tokens} tokens of MIME/CSS omitted, plain-text body returned; call with format:'raw' for the full tree.)"
                )

            # Warning if verbose=True and CSS is heavy
            if verbose and css_chars > 1000 and (mime_chars == 0 or css_chars / max(mime_chars, 1) > 0.4):
                css_kb = css_chars / 1024
                out["_css_warning"] = (
                    f"⚠ This message contains {css_kb:.0f}KB of inline CSS. Set verbose:false unless you need attachments."
                )

            # Prune bloated raw parts from response unless raw format explicitly requested
            if caller_format != "raw":
                pruned_payload = {
                    "headers": essential_headers if essential_headers else raw_headers,
                    "mimeType": payload.get("mimeType", "text/plain"),
                    "body": {"size": len(plain_text)},
                }
                out["payload"] = pruned_payload

    return out


def _sanitize_structure(
    data: Any,
    *,
    verbose: bool = False,
    caller_format: str | None = None,
) -> Any:
    """Recursively search and sanitize Gmail messages in dictionaries or lists."""
    if isinstance(data, list):
        return [_sanitize_structure(item, verbose=verbose, caller_format=caller_format) for item in data]

    if isinstance(data, dict):
        # Check if this dict represents a Gmail message
        is_gmail_msg = (
            ("id" in data and ("payload" in data or "threadId" in data or "snippet" in data))
            or ("mimeType" in data and "headers" in data)
        )
        if is_gmail_msg:
            return sanitize_gmail_message(data, verbose=verbose, caller_format=caller_format)

        # Check for multi-execute results structure: results -> response_data
        out = {}
        for k, v in data.items():
            if k in ("results", "messages", "threads", "response_data", "data"):
                out[k] = _sanitize_structure(v, verbose=verbose, caller_format=caller_format)
            else:
                out[k] = v
        return out

    return data


def sanitize_composio_content(
    content: str,
    *,
    tool_name: str = "",
    arguments: dict[str, Any] | None = None,
) -> str:
    """Sanitize Composio content string: decode emails, omit MIME/CSS bloat, enforce inline plain text."""
    if not content:
        return content

    args = arguments or {}
    verbose = bool(args.get("verbose", False))
    caller_format = args.get("format")

    # If JSON formatted
    content_stripped = content.strip()
    if (content_stripped.startswith("{") and content_stripped.endswith("}")) or (
        content_stripped.startswith("[") and content_stripped.endswith("]")
    ):
        try:
            parsed = json.loads(content_stripped)
            sanitized = _sanitize_structure(parsed, verbose=verbose, caller_format=caller_format)
            return json.dumps(sanitized, indent=2)
        except Exception:
            pass

    # If raw HTML with style blocks
    if "<style" in content.lower():
        cleaned, stripped_chars = strip_style_and_scripts(content)
        if stripped_chars > 1000:
            omitted_tokens = stripped_chars // 4
            notice = f"\n\n({omitted_tokens} tokens of MIME/CSS omitted, plain-text body returned; call with format:'raw' for the full tree.)"
            content = cleaned + notice
        else:
            content = cleaned

    return cap_tool_result_content(content, tool_name=tool_name, arguments=arguments)


MAX_TOOL_CHARS = 8000  # ~2,000 tokens at ~4 chars/token


def detect_paging_arg(tool_name: str = "", arguments: dict[str, Any] | None = None) -> str:
    """Infer the paging argument name for a given tool and its invocation arguments."""
    args = arguments or {}
    for key in ("offset", "cursor", "page_token", "next_token", "page", "start_index", "StartLine", "start_line", "skip"):
        if key in args:
            return key

    lowered_name = (tool_name or "").lower()
    if "view_file" in lowered_name or "read_file" in lowered_name or lowered_name.endswith("file"):
        return "StartLine"
    if any(k in lowered_name for k in ("mail", "email", "gmail", "calendar", "event", "slack", "discord", "message")):
        return "cursor"
    if any(k in lowered_name for k in ("search", "grep", "list", "fetch", "query")):
        return "offset"

    return "offset"


def cap_tool_result_content(
    content: str,
    *,
    tool_name: str = "",
    arguments: dict[str, Any] | None = None,
    max_chars: int = MAX_TOOL_CHARS,
) -> str:
    """Cap tool result content at ~2k tokens (~8k chars) with trailing paging guidance."""
    if not content or len(content) <= max_chars:
        return content

    paging_arg = detect_paging_arg(tool_name, arguments)
    trailer = f"\n\n[truncated; call again with {paging_arg} for more]"
    cut_length = max(0, max_chars - len(trailer))
    return content[:cut_length] + trailer


def sanitize_composio_tool_result(
    result: ToolResult,
    *,
    tool_name: str = "",
    arguments: dict[str, Any] | None = None,
) -> ToolResult:
    """Sanitize a ToolResult from Composio, ensuring email text is inline and within budget."""
    if result.is_error or not result.content:
        return result

    sanitized_content = sanitize_composio_content(
        result.content,
        tool_name=tool_name,
        arguments=arguments,
    )
    return ToolResult(
        content=sanitized_content,
        artifacts=result.artifacts,
        is_error=result.is_error,
    )
