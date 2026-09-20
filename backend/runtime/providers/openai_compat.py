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
import uuid
from collections.abc import AsyncIterator
from typing import Any

from backend.config import ProviderConfig
from backend.runtime.failures import classify_stream_error, should_retry
from backend.runtime.http import (
    MAX_RETRIES,
    ProviderHTTPError,
    ProviderStreamError,
    post_json,
    stream_backoff,
    stream_sse,
)
from backend.runtime.types import (
    Capabilities,
    ModelParameters,
    ModelResponse,
    ResolvedModel,
    StreamEvent,
    ToolCall,
    ToolSchema,
)
from backend.runtime.reasoning_catalog import (
    is_reasoning_model,
    effort_levels,
    default_effort,
    capabilities_for,
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


__all__ = ["OpenAICompatClient", "ProviderHTTPError", "ProviderStreamError", "initialize"]


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
    for m in messages:
        role = m.get("role")

        if role == "tool":
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": m.get("tool_call_id"),
                    "content": m.get("content") or "",
                }
            )
            continue

        if role == "assistant" and m.get("tool_calls"):
            calls = []
            for tc in m["tool_calls"]:
                fn = tc.get("function", tc)
                arguments = fn.get("arguments")
                calls.append(
                    {
                        "id": tc.get("id"),
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
            out.append({"role": "assistant", "content": m.get("content"), "tool_calls": calls})
            continue

        content = m.get("content") or ""
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
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        #: Attempts this client may make, counting the first. The fallback chain
        #: owns one budget for the whole turn and hands each link its share, so
        #: a three-provider chain costs the same order of wall clock as one
        #: provider rather than three times it.
        self.max_retries = max_retries
        #: Session ID for provider-side prompt cache affinity. Set per-turn by
        #: the director so repeated turns to the same conversation hit the
        #: cached prefix instead of re-processing system+tools from scratch.
        self.session_id: str | None = None

    @property
    def _url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.session_id:
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
        if stream:
            payload["stream"] = True
        if tools:
            payload["tools"] = [
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
        # Provider quirk, absorbed here so the loop never learns about it: some
        # reasoning models reject reasoning_effort when function tools are present.
        if p.reasoning_effort and p.reasoning_effort != "none":
            if not (tools and is_reasoning_model(self.model)):
                payload["reasoning_effort"] = p.reasoning_effort
        return payload

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None = None,
        params: ModelParameters | None = None,
    ) -> ModelResponse:
        data = await post_json(
            self._url,
            headers=self._headers(),
            payload=self._build_payload(messages, tools, params),
            timeout=self.timeout,
            max_retries=self.max_retries,
        )
        return self._parse(data)

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

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        partial: dict[int, dict[str, Any]] = {}
        dropped = 0
        finish_reason: str | None = None
        usage: dict[str, Any] = {}

        for stream_attempt in range(self.max_retries + 1):
            text_parts.clear()
            reasoning_parts.clear()
            partial.clear()
            dropped = 0
            finish_reason = None
            usage = {}
            yielded_any = False
            retry_stream = False

            try:
                async for raw in stream_sse(
                    self._url,
                    headers=self._headers(),
                    payload=payload,
                    timeout=self.timeout,
                    max_retries=self.max_retries if stream_attempt == 0 else 0,
                ):
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        # Counted rather than silently dropped: a provider emitting
                        # subtly broken frames otherwise produces a blank or truncated
                        # answer with nothing anywhere to say why.
                        dropped += 1
                        continue

                    # An OpenAI-compatible provider can report a failure *inside* the
                    # stream rather than as an HTTP status: the connection is already
                    # open and 200, so the only sign is a frame carrying `error`.
                    if error := chunk.get("error"):
                        kind = classify_stream_error(error)
                        desc = _describe_provider_error(error)
                        if not yielded_any and should_retry(kind) and stream_attempt < self.max_retries:
                            log.warning(
                                "%s stream reported %s before content (%s); retrying stream (%d/%d)",
                                self.model,
                                kind,
                                desc,
                                stream_attempt + 1,
                                self.max_retries,
                            )
                            await asyncio.sleep(stream_backoff(stream_attempt))
                            retry_stream = True
                            break
                        raise ProviderStreamError(desc, kind=kind)

                    if chunk.get("usage"):
                        usage = chunk["usage"]

                    choice = (chunk.get("choices") or [{}])[0]
                    finish_reason = choice.get("finish_reason") or finish_reason
                    delta = choice.get("delta") or {}

                    if (piece := _as_text(delta.get("content"))) is not None:
                        text_parts.append(piece)
                        yielded_any = True
                        yield StreamEvent(type="text", text=piece)

                    if thought := _reasoning_of(delta):
                        reasoning_parts.append(thought)
                        yielded_any = True
                        yield StreamEvent(type="reasoning", text=thought)

                    for fragment in delta.get("tool_calls") or []:
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
                                yielded_any = True
                                yield StreamEvent(
                                    type="tool_arguments",
                                    tool_name=slot["name"],
                                    tool_index=index,
                                    arguments_so_far=slot["arguments"],
                                )

                if retry_stream:
                    continue

                break
            except ProviderHTTPError as exc:
                if not yielded_any and should_retry(exc.kind) and stream_attempt < self.max_retries:
                    log.warning(
                        "%s stream connection dropped before content (%s); retrying stream (%d/%d)",
                        self.model,
                        exc,
                        stream_attempt + 1,
                        self.max_retries,
                    )
                    await asyncio.sleep(stream_backoff(stream_attempt))
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
            yield StreamEvent(type="done", response=await self.complete(messages, tools, params))
            return

        if dropped:
            log.warning(
                "%s sent %d frame(s) this stream that were not valid JSON; they were skipped",
                self.model,
                dropped,
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


def initialize(
    config: ProviderConfig, model: str | None = None, *, max_retries: int = MAX_RETRIES
) -> ResolvedModel:
    resolved_model = model or config.default_model
    if not resolved_model:
        raise ValueError(f"no model specified for provider '{config.name}'")
    base_url = config.base_url or DEFAULT_BASE_URL
    api_key = resolve_api_key(ref=config.api_key_ref, env=config.api_key_env)
    client = OpenAICompatClient(
        base_url=base_url, api_key=api_key, model=resolved_model, max_retries=max_retries
    )
    return ResolvedModel(
        provider=config.name,
        model=resolved_model,
        client=client,
        capabilities=Capabilities(
            tools=True,
            streaming=True,
            vision="gpt-4o" in resolved_model.lower() or "vision" in resolved_model.lower(),
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
