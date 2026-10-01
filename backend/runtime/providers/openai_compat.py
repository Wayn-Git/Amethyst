"""OpenAI and OpenAI-compatible adapter.

This one adapter covers OpenAI itself plus Ollama, vLLM, LM Studio, NVIDIA NIM,
Groq, OpenRouter and anything else speaking the chat-completions wire format.
Unrecognized provider names fall through to here (ADR-0001), which is why AMETHYST
supports an open-ended provider set with four adapters.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

from backend.agent.trace import record_llm_call
from backend.runtime.failures import (
    FailureKind,
    classify_stream_error,
    looks_like_quota,
    should_retry,
)
from backend.runtime.http import (
    MAX_RETRIES,
    ProviderError,
    ProviderHTTPError,
    ProviderStreamError,
    post_json,
    stream_backoff,
    stream_sse,
)
from backend.runtime.reasoning_catalog import is_reasoning_model
from backend.runtime.types import (
    Capabilities,
    ModelParameters,
    ModelResponse,
    ResolvedModel,
    StreamEvent,
    ToolCall,
    ToolSchema,
)
from backend.secrets import resolve_api_key

#: What a provider calls the chain-of-thought it returns beside the answer.
#: NVIDIA, DeepSeek and Ollama send `reasoning_content`; Groq's gpt-oss models
#: send `reasoning`. Reading only the first meant a Groq turn's thinking was
#: dropped on the floor -- and, worse, that the "a model that spent its whole
#: budget thinking has not answered" guard below never saw it.
REASONING_FIELDS = ("reasoning_content", "reasoning")

#: Where an entry with no `base_url` lands. Every unknown provider name falls
#: through to this adapter, and liveness probes need the real endpoint to hit
#: rather than a silent yes -- see `backend/runtime/availability.py`.
DEFAULT_BASE_URL = "https://api.openai.com/v1"


def _reasoning_of(payload: dict) -> str | None:
    """The thinking in a message or a delta, whichever field carries it."""
    for field in REASONING_FIELDS:
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            return value
    return None


#: OpenCode CLI header mimicking its Bun/AI-SDK environment
OPENCODE_USER_AGENT = "opencode/1.18.35 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14"


def _generate_opencode_id(prefix: str, descending: bool = True) -> str:
    """Generate an OpenCode-compatible ID with descending timestamp encoding."""
    now_ms = int(time.time() * 1000)
    counter = 1
    val = now_ms * 0x1000 + counter
    val = (~val) if descending else val
    hex_str = "".join(f"{(val >> (40 - 8 * w)) & 0xff:02x}" for w in range(6))
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    rand = "".join(chars[b % 62] for b in os.urandom(14))
    return f"{prefix}{hex_str}{rand}"


#: Core tools required by OpenCode's server gate to allow free-tier models
OPENCODE_CORE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read",
            "description": "Read a file or directory from the local filesystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string", "description": "The path to the file to read"}
                },
                "required": ["filePath"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit",
            "description": "Performs exact string replacements in files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string", "description": "The path to the file to modify"},
                    "oldString": {"type": "string", "description": "The text to replace"},
                    "newString": {"type": "string", "description": "The text to replace it with"},
                },
                "required": ["filePath", "oldString", "newString"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bash",
            "description": "Execute a bash command.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to execute"}
                },
                "required": ["command"],
            },
        },
    },
]


__all__ = ["OpenAICompatClient", "ProviderHTTPError", "ProviderStreamError", "auth_headers_for_config", "initialize", "normalize_model_name"]


def normalize_model_name(provider_or_url: str, model: str) -> str:
    """Normalize user-friendly or legacy model aliases for specific providers."""
    if not model:
        return model
    m = model.strip()
    target = (provider_or_url or "").lower()
    if "opencode" in target or "zen" in target:
        lower = m.lower()
        if lower in ("mimo", "mimo-flash", "mimo-v2.6-flash", "mimo-v2.6", "mimo-free", "mimo2.6"):
            return "mimo-v2.6-flash-free"
        if lower in ("mimo2.4", "mimo-2.4", "minimax", "minimax-mimo"):
            return "minimax-m3"
        if lower in ("big-pickle", "big pickle", "pickle"):
            return "big-pickle"
        if lower in ("space-bunny", "space bunny", "spacebunny"):
            return "space-bunny-free"
        if lower in ("muse-spark", "muse spark", "muse-spark-free"):
            return "muse-spark-1.3-contributor-free"
        if lower in ("nemotron-lightning", "nemotron", "nemotron-free"):
            return "nemotron-3.5-lightning-free"
        if lower in ("jev-free", "jev"):
            return "jev-1.13-free"
        if lower in ("longcat", "longcat-free"):
            return "longcat-2.5-preview-free"
        if lower in ("kimi", "k2.7", "kimi2.7"):
            return "kimi-k2.7-code"
        if lower in ("k2.6", "kimi2.6"):
            return "kimi-k2.6"
        if lower in ("glm", "glm5", "glm-5"):
            return "glm-5.3"
    if "kilo" in target:
        lower = m.lower()
        if lower in ("mimo", "mimo2.4", "minimax"):
            return "minimax/minimax-01"
    return m


def _to_openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """AMETHYST's normalized messages into the chat-completions wire shape.

    The two other adapters already translate; this one used to forward AMETHYST's
    own rows untouched, which happens to work only while a turn takes one
    iteration. As soon as a tool call is replayed the difference bites: the wire
    format wants `type: "function"` on every tool call and `arguments` as a JSON
    *string*, and rejects the `tool_name` and `is_error` columns AMETHYST carries on
    tool rows for its own use. Lenient servers ignored all three; OpenAI itself
    and schema-validating servers answer 400.
    """
    out: list[dict[str, Any]] = []
    valid_tool_call_ids: set[str] = set()

    for m in messages:
        role = m.get("role")

        if role == "assistant" and m.get("tool_calls"):
            calls = []
            for tc in m["tool_calls"]:
                fn = tc.get("function", tc)
                arguments = fn.get("arguments")
                call_id = tc.get("id")
                calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": fn.get("name"),
                            # Already a string when it came straight off the wire;
                            # a dict once it has been through AMETHYST's storage.
                            "arguments": arguments
                            if isinstance(arguments, str)
                            else json.dumps(arguments or {}),
                        },
                    }
                )
                if call_id:
                    valid_tool_call_ids.add(call_id)
            out.append({"role": "assistant", "content": m.get("content"), "tool_calls": calls})
            continue

        if role == "tool":
            call_id = m.get("tool_call_id")
            # In chat completions spec (Mistral, OpenAI, Anthropic), a 'tool' role message
            # MUST directly follow an 'assistant' message with matching tool_calls.
            # An orphaned tool result (e.g. from history compaction or turn slicing)
            # would trigger 400 'Unexpected role tool after role user' or 'invalid_request_message_order'.
            if call_id and call_id in valid_tool_call_ids:
                valid_tool_call_ids.discard(call_id)
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": m.get("content") or "",
                    }
                )
            else:
                # Orphaned tool result: safely represent as user context instead of breaking wire schema
                orphan_name = m.get("name") or "tool"
                orphan_text = f"[Previous tool output for {orphan_name}]:\n{m.get('content') or ''}"
                if out and out[-1].get("role") == "user" and isinstance(out[-1].get("content"), str):
                    out[-1]["content"] = f"{out[-1]['content']}\n\n{orphan_text}"
                else:
                    out.append({"role": "user", "content": orphan_text})
            continue

        valid_tool_call_ids.clear()
        content = m.get("content") or ""

        # Collapse consecutive user messages to satisfy strict alternation APIs (e.g. Mistral)
        if (
            role == "user"
            and out
            and out[-1].get("role") == "user"
            and isinstance(out[-1].get("content"), str)
            and isinstance(content, str)
        ):
            out[-1]["content"] = f"{out[-1]['content']}\n\n{content}"
            continue

        if isinstance(content, list):
            formatted = []
            for b in content:
                if b.get("type") == "text":
                    formatted.append({"type": "text", "text": b.get("text", "")})
                elif b.get("type") == "image":
                    mime = b.get("media_type", "image/jpeg")
                    formatted.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b.get('data')}"}
                    })
            out.append({"role": role, "content": formatted})
        else:
            out.append({"role": role, "content": content})
    return out


log = logging.getLogger(__name__)


def _as_text(value: object) -> str | None:
    """Content coerced to a string, because not every provider sends one.

    Cloudflare Workers AI serialises a purely numeric content token -- the "3"
    in a reply that counts -- as a JSON number, so `delta.content` arrives as an
    int and `"".join(parts)` raised `expected str instance, int found`, killing
    the whole stream over one token. The spec says content is a string; this is
    the shim for the providers that treat that as advisory. `None` and `""` stay
    falsy so the role-only first chunk is still skipped.
    """
    if value is None or value == "":
        return None
    return value if isinstance(value, str) else str(value)


def _describe_provider_error(error: object) -> str:
    """The provider's own words, however it chose to shape them.

    `{"error": {"message": ...}}` is the common form; some send a bare string,
    and at least one sends `{"error": {"detail": ...}}`. Anything unrecognised
    is stringified rather than dropped -- an unhelpful message beats a silent
    stall.
    """
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        for key in ("message", "detail", "description", "reason"):
            value = error.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return str(error)


def _validate_stream_chunk(chunk: dict[str, Any]) -> None:
    """Reject malformed frames instead of silently turning them into a blank turn."""
    choices = chunk.get("choices")
    if choices is not None and not isinstance(choices, list):
        raise ProviderStreamError(
            "Provider sent malformed choices in stream",
            kind=FailureKind.UPSTREAM_UNHEALTHY,
        )
    if choices and not isinstance(choices[0], dict):
        raise ProviderStreamError(
            "Provider sent malformed choice in stream",
            kind=FailureKind.UPSTREAM_UNHEALTHY,
        )


class OpenAICompatClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        # 300s, matching OpenCode's header timeout: a slow reasoning model that
        # takes two minutes to its first token is slow, not broken, and a flat
        # 120s was cutting those off. Connect stays fast (see http._as_timeout).
        timeout: float = 300.0,
        max_retries: int = MAX_RETRIES,
        provider_name: str = "openai-compatible",
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = normalize_model_name(f"{self.base_url} {model}", model)
        self.timeout = timeout
        self.provider_name = provider_name
        #: Retries after the first attempt. The fallback chain
        #: owns one budget for the whole turn and hands each link its share, so
        #: a three-provider chain costs the same order of wall clock as one
        #: provider rather than three times it.
        self.max_retries = max(0, max_retries)
        #: Session ID for provider-side prompt cache affinity. Set per-turn by
        #: the director so repeated turns to the same conversation hit the
        #: cached prefix instead of re-processing system+tools from scratch.
        self.session_id: str | None = None
        self.is_opencode = "opencode.ai" in (self.base_url or "").lower() or "zen" in (self.base_url or "").lower()
        self._opencode_session_id: str | None = None

    @property
    def _url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.is_opencode:
            headers["User-Agent"] = OPENCODE_USER_AGENT
            headers["x-opencode-client"] = "cli"
            if not self._opencode_session_id:
                self._opencode_session_id = _generate_opencode_id("ses_")
            headers["x-opencode-session"] = self._opencode_session_id
            headers["x-opencode-session-id"] = self._opencode_session_id
            headers["x-opencode-request"] = _generate_opencode_id("msg_")
        elif self.session_id:
            headers["X-Session-Id"] = self.session_id
            headers["x-session-affinity"] = self.session_id
        return headers

    def _build_payload(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None,
        params: ModelParameters | None,
        *,
        stream: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.model, "messages": _to_openai_messages(messages)}
        if stream or self.is_opencode:
            payload["stream"] = True

        rendered_tools: list[dict[str, Any]] = []
        if tools:
            rendered_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]

        if self.is_opencode:
            # OpenCode's server gate requires read, edit, and bash core tools to be in payload["tools"]
            existing_names = {
                t.get("function", {}).get("name")
                for t in rendered_tools
                if isinstance(t, dict) and "function" in t
            }
            for core_tool in OPENCODE_CORE_TOOLS:
                if core_tool["function"]["name"] not in existing_names:
                    rendered_tools.append(core_tool)

        if rendered_tools:
            payload["tools"] = rendered_tools

        p = params or ModelParameters()
        if p.temperature is not None:
            payload["temperature"] = p.temperature
        # `max_tokens` here bounds the answer only -- these endpoints keep
        # reasoning tokens on their own budget -- so the answer's share is the
        # right value when no explicit ceiling was named.
        if p.max_tokens is not None:
            payload["max_tokens"] = p.max_tokens
        elif p.answer_tokens is not None:
            payload["max_tokens"] = p.answer_tokens
        if p.stop:
            payload["stop"] = p.stop
        if p.seed is not None:
            payload["seed"] = p.seed
        # Gateways and non-reasoning models reject reasoning_effort
        is_gateway = any(gw in (self.base_url or "") for gw in ("kilo.ai", "opencode.ai", "openrouter.ai"))
        if p.reasoning_effort and p.reasoning_effort != "none":
            if is_reasoning_model(self.model) and not tools and not is_gateway:
                payload["reasoning_effort"] = p.reasoning_effort
        return payload

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None = None,
        params: ModelParameters | None = None,
    ) -> ModelResponse:
        if self.is_opencode:
            # OpenCode's gate rejects non-streaming completions with 403 FreeTierError.
            # Consume stream to assemble the complete ModelResponse.
            last_resp: ModelResponse | None = None
            async for ev in self.stream(messages, tools, params):
                if ev.type == "done" and ev.response:
                    last_resp = ev.response
            if last_resp is not None:
                return last_resp
            return ModelResponse(text=None)

        _t0 = time.perf_counter()
        data = await post_json(
            self._url,
            headers=self._headers(),
            payload=self._build_payload(messages, tools, params),
            timeout=self.timeout,
            max_retries=self.max_retries,
        )
        resp = self._parse(data)
        _total_ms = (time.perf_counter() - _t0) * 1000.0
        record_llm_call(
            provider=getattr(self, "provider_name", "openai-compatible"),
            model=self.model,
            ttft_ms=_total_ms,
            total_ms=_total_ms,
            input_tokens=resp.input_tokens,
            output_tokens=resp.output_tokens,
        )
        return resp

    def _parse(self, data: dict[str, Any]) -> ModelResponse:
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}

        calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            calls.append(
                ToolCall(
                    id=tc.get("id") or str(uuid.uuid4()),
                    name=fn.get("name", ""),
                    arguments=_parse_arguments(fn.get("arguments")),
                )
            )

        usage = data.get("usage") or {}
        # Reasoning models (Nemotron, DeepSeek-R1 and friends) return chain-of-thought
        # in a sibling field. It is not the answer, so it must not become the answer.
        reasoning = _reasoning_of(message)
        return ModelResponse(
            text=_as_text(message.get("content")),
            reasoning=reasoning,
            tool_calls=calls,
            stop_reason=choice.get("finish_reason"),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            raw=data,
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None = None,
        params: ModelParameters | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield deltas as they arrive, then one final event carrying the whole response.

        Tool calls arrive fragmented across chunks -- the name in one, the JSON
        arguments a few characters at a time in later ones -- so they are
        accumulated by index and only parsed once the stream ends.
        """
        payload = self._build_payload(messages, tools, params, stream=True)
        _stream_start = time.perf_counter()
        _ttft_ms: float | None = None

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        partial: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None
        usage: dict[str, Any] = {}

        effective_stream_retries = min(self.max_retries, 2)
        for stream_attempt in range(effective_stream_retries + 1):
            text_parts.clear()
            reasoning_parts.clear()
            partial.clear()
            finish_reason = None
            usage = {}
            yielded_content = False

            try:
                async for raw in stream_sse(
                    self._url,
                    headers=self._headers(),
                    payload=payload,
                    timeout=self.timeout,
                    max_retries=min(self.max_retries, 2),
                ):
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        desc = (
                            "Error in input stream"
                            if "error in input stream" in raw.lower()
                            else "Provider sent malformed JSON in stream"
                        )
                        raise ProviderStreamError(
                            desc, kind=FailureKind.UPSTREAM_UNHEALTHY
                        ) from exc

                    if not isinstance(chunk, dict):
                        raise ProviderStreamError(
                            "Provider sent a non-object stream chunk",
                            kind=FailureKind.UPSTREAM_UNHEALTHY,
                        )

                    # An OpenAI-compatible provider can report a failure *inside* the
                    # stream rather than as an HTTP status: the connection is already
                    # open and 200, so the only sign is a frame carrying `error`.
                    if error := chunk.get("error"):
                        kind = classify_stream_error(error)
                        desc = _describe_provider_error(error)
                        raise ProviderStreamError(desc, kind=kind)

                    _validate_stream_chunk(chunk)
                    if chunk.get("usage"):
                        usage = chunk["usage"]

                    choice = (chunk.get("choices") or [{}])[0]
                    finish_reason = choice.get("finish_reason") or finish_reason
                    delta = choice.get("delta") or {}

                    if (piece := _as_text(delta.get("content"))):
                        if _ttft_ms is None:
                            _ttft_ms = (time.perf_counter() - _stream_start) * 1000.0
                        text_parts.append(piece)
                        yielded_content = True
                        yield StreamEvent(type="text", text=piece)

                    if thought := _reasoning_of(delta):
                        if _ttft_ms is None:
                            _ttft_ms = (time.perf_counter() - _stream_start) * 1000.0
                        reasoning_parts.append(thought)
                        yield StreamEvent(type="reasoning", text=thought)

                    for fragment in delta.get("tool_calls") or []:
                        if _ttft_ms is None:
                            _ttft_ms = (time.perf_counter() - _stream_start) * 1000.0
                        index = fragment.get("index", 0)
                        slot = partial.setdefault(index, {"id": None, "name": "", "arguments": ""})
                        if fragment.get("id"):
                            slot["id"] = fragment["id"]
                        function = fragment.get("function") or {}
                        if function.get("name"):
                            slot["name"] = function["name"]
                        if function.get("arguments"):
                            slot["arguments"] += function["arguments"]
                            if slot["name"]:
                                yielded_content = True
                                yield StreamEvent(
                                    type="tool_arguments",
                                    tool_name=slot["name"],
                                    tool_index=index,
                                    arguments_so_far=slot["arguments"],
                                )

                break
            except ProviderError as exc:
                if (
                    not yielded_content
                    and not reasoning_parts
                    and (should_retry(exc.kind) or exc.kind in (FailureKind.UPSTREAM_UNHEALTHY, FailureKind.RETRYABLE))
                    and exc.kind != FailureKind.NON_RETRYABLE_RATE_LIMIT
                    and not looks_like_quota(str(exc))
                    and stream_attempt < effective_stream_retries
                ):
                    log.warning(
                        "%s stream connection dropped before answer content (%s); retrying stream (%d/%d)",
                        self.model,
                        exc,
                        stream_attempt + 1,
                        effective_stream_retries,
                    )
                    if exc.retry_after and exc.retry_after > self.timeout:
                        raise
                    await asyncio.sleep(min(max(stream_backoff(stream_attempt), exc.retry_after or 0), 2.0))
                    continue
                raise

        calls = [
            ToolCall(
                id=slot["id"] or str(uuid.uuid4()),
                name=slot["name"],
                arguments=_parse_arguments(slot["arguments"]),
            )
            for _, slot in sorted(partial.items())
            if slot["name"]
        ]

        if not text_parts and not calls:
            # Plenty of OpenAI-compatible servers ignore `stream: true` and
            # answer with an ordinary JSON body, which produces no SSE frames at
            # all. Yielding an empty response for that ended the turn with a
            # blank answer and no error anywhere -- so ask again without
            # streaming rather than reporting silence as an answer.
            #
            # Reasoning deliberately does not count as an answer here. A
            # thinking model that spends its whole budget on reasoning
            # and stops produced no text and no tool call, skipped this branch
            # because `reasoning_parts` was non-empty, and the loop then burned
            # both continuations before ending the turn on an empty bubble.
            # Thinking is not a reply.
            if not self.is_opencode:
                yield StreamEvent(type="done", response=await self.complete(messages, tools, params))
                return

        _total_ms = (time.perf_counter() - _stream_start) * 1000.0
        if _ttft_ms is None:
            _ttft_ms = _total_ms
        record_llm_call(
            provider=getattr(self, "provider_name", "openai-compatible"),
            model=self.model,
            ttft_ms=_ttft_ms,
            total_ms=_total_ms,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )

        yield StreamEvent(
            type="done",
            response=ModelResponse(
                text="".join(text_parts) or None,
                reasoning="".join(reasoning_parts) or None,
                tool_calls=calls,
                stop_reason=finish_reason,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            ),
        )


def _parse_arguments(raw: Any) -> dict[str, Any]:
    """Tool arguments arrive as a JSON string, and models sometimes emit invalid JSON."""
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw}
    return parsed if isinstance(parsed, dict) else {"_value": parsed}


def _context_window(model: str, declared: int | None = None) -> int:
    """The declared window if providers.yaml states one, else a guess.

    The guess matches substrings in the model name and falls through to 128,000,
    which is a plausible number rather than a known one -- `nemotron-3-ultra-550b`
    matches nothing and got 128,000 by default. `budget_history` then trims the
    history against a figure nobody checked, so an entry that declares its window
    is the only way the budget is right rather than lucky.
    """
    if declared:
        return declared
    m = model.lower()
    if "gpt-4o" in m or "gpt-4.1" in m or "gpt-5" in m:
        return 128_000
    if "llama" in m or "qwen" in m or "mistral" in m:
        return 32_768
    return 128_000


def is_vision_model(model_name: str) -> bool:
    """True if model name signals vision or multimodal capabilities."""
    lowered = model_name.lower()
    vision_markers = (
        "vision", "vl", "pixtral", "ocr", "4o", "gemini", "claude",
        "multimodal", "llava", "omni", "kosmos", "fuyu", "deplot",
    )
    return any(marker in lowered for marker in vision_markers)


def initialize(
    config: ProviderConfig, model: str | None = None, *, max_retries: int = MAX_RETRIES
) -> ResolvedModel:
    resolved_model = model or config.default_model
    if not resolved_model:
        raise ValueError(f"no model specified for provider '{config.name}'")
    base_url = config.base_url or DEFAULT_BASE_URL
    resolved_model = normalize_model_name(f"{config.name} {base_url}", resolved_model)
    api_key = resolve_api_key(ref=config.api_key_ref, env=config.api_key_env)
    is_local = any(h in base_url.lower() for h in ("localhost", "127.0.0.1", "0.0.0.0", "lmstudio", "ollama", "192.168.", "10.", "172.16."))
    if not api_key and not is_local and (config.api_key_ref or config.api_key_env):
        from backend.runtime.registry import ProviderNotConfigured
        raise ProviderNotConfigured(f"No API key configured for provider '{config.name}'. Add an API key in Settings.")
    client = OpenAICompatClient(
        base_url=base_url,
        api_key=api_key,
        model=resolved_model,
        max_retries=max_retries,
        provider_name=config.name,
    )
    return ResolvedModel(
        provider=config.name,
        model=resolved_model,
        client=client,
        capabilities=Capabilities(
            tools=True,
            streaming=True,
            vision=is_vision_model(resolved_model),
            reasoning=is_reasoning_model(resolved_model),
            context_window=_context_window(resolved_model, config.context_window),
            max_tools=config.max_tools,
            tokens_per_minute=config.tokens_per_minute,
        ),
    )


def list_models(payload: Any) -> list[dict[str, Any]]:
    """The model ids out of an OpenAI-style `/models` body, free flagged where known.

    Lives here rather than in the route that renders it: this is the shape
    *this adapter's* endpoints answer with, and the route must not know one
    provider's body from another's (ADR-0001). Google overrides it.

    Shapes vary: OpenAI/Groq/Cerebras return `{"data": [{"id": ...}]}`,
    OpenRouter adds a `pricing` object per entry, and a few return a bare list.
    Unknown shapes yield nothing rather than a guess -- the picker's free-text
    field is the fallback, not an invented id.
    """
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        model_id = row.get("id") or row.get("name")
        if not model_id:
            continue
        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        # Zero prompt-and-completion price, or the `:free` suffix OpenRouter uses.
        priced_free = pricing and all(
            _is_zero(pricing.get(k)) for k in ("prompt", "completion") if k in pricing
        )
        model_dict = {
            "id": str(model_id),
            "free": bool(priced_free) or str(model_id).endswith(":free"),
        }
        
        # OpenRouter provides architecture and reasoning metadata
        if "context_length" in row:
            model_dict["context_length"] = row["context_length"]
            
        if "reasoning" in row and isinstance(row["reasoning"], dict):
            reasoning = row["reasoning"]
            model_dict["capabilities"] = {
                "supports_effort": True,
                "effort_levels": reasoning.get("supported_efforts", ["low", "medium", "high"]),
                "default_effort": reasoning.get("default_effort", "high")
            }
            # Store raw provider reasoning metadata for catalog fallback
            model_dict["_provider_reasoning"] = {
                "supports_effort": True,
                "effort_levels": reasoning.get("supported_efforts", ["low", "medium", "high"]),
                "default_effort": reasoning.get("default_effort", "high"),
            }
        
        out.append(model_dict)
    out.sort(key=lambda m: (not m["free"], m["id"]))
    return out


def _is_zero(value: Any) -> bool:
    try:
        return float(value) == 0.0
    except (TypeError, ValueError):
        return False


def auth_headers_for_config(config: ProviderConfig) -> Callable[[str], dict[str, str]]:
    base = (config.base_url or "").lower()
    name = (config.name or "").lower()
    if "opencode" in base or "zen" in base or "opencode" in name:
        return lambda key: {
            "Authorization": f"Bearer {key}" if key else "",
            "User-Agent": OPENCODE_USER_AGENT,
            "x-opencode-client": "cli",
        }
    return lambda key: {"Authorization": f"Bearer {key}"} if key else {}

