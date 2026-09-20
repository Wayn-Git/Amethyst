"""Anthropic adapter.

Anthropic's wire format differs enough from chat-completions to justify a real
adapter: a top-level system parameter, content blocks rather than a string, and
tool_use / tool_result blocks instead of a tool_calls array. Extended thinking is
mapped from AMETHYST's generic thinking_budget and clamped so it cannot exceed
max_tokens -- a provider quirk absorbed here and invisible above (ADR-0001).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from backend.config import ProviderConfig
from backend.runtime.failures import classify_stream_error
from backend.runtime.http import MAX_RETRIES, ProviderStreamError, post_json, stream_sse
from backend.runtime.providers.openai_compat import _describe_provider_error
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

API_VERSION = "2023-06-01"

#: Room for the answer itself, when the caller names no `max_tokens`.
#:
#: Was 4096, and 4096 was also the entire output ceiling -- so an answer with
#: any substance was cut off, and because the thinking budget is clamped to
#: `max_tokens - 1024`, *every* reasoning effort above "low" silently collapsed
#: to 3072 thinking tokens. Asking for "max" bought exactly nothing.
DEFAULT_MAX_TOKENS = 8192

#: The ceiling for a `max_tokens` this adapter works out for itself, when the
#: model is not one it recognises.
#:
#: Anthropic counts thinking tokens against `max_tokens`, so "max" effort
#: (100,000 thinking tokens) cannot simply be added to the answer budget: the
#: request is refused outright by any model whose output limit is lower. An
#: unrecognised model gets the smallest ceiling in the thinking-capable Claude
#: line, because being conservative costs some depth and being wrong costs the
#: turn.
#:
#: Only applied to a figure derived here. An explicit `max_tokens` from the
#: caller is obeyed as given.
DERIVED_MAX_TOKENS_CEILING = 32_000

#: Output ceilings that are lower than the line's usual 64,000. Anthropic
#: publishes these per model and they do not follow from the name, so they are
#: listed rather than inferred: Opus 4 and 4.1 cap at 32,000 where every other
#: thinking-capable Claude allows 64,000.
#:
#: Matched as a prefix, so dated ids (`claude-opus-4-1-20250805`) hit too. A
#: provider entry may override the lot with `max_output_tokens:` in
#: providers.yaml -- which is the knob to reach for when a new model ships and
#: this table has not caught up.
_LOW_OUTPUT_MODELS = ("claude-opus-4-2", "claude-opus-4-1", "claude-opus-4-0", "claude-opus-4")
_LOW_OUTPUT_CEILING = 32_000

#: What the rest of the thinking-capable line allows.
_STANDARD_OUTPUT_CEILING = 64_000


def _output_ceiling(model: str) -> int:
    """This model's output limit, as far as the name gives it away.

    Anything that is not recognisably a Claude model gets the conservative
    figure: an over-estimate here is a 400 that loses the turn, an
    under-estimate is only a shallower answer.
    """
    name = (model or "").lower()
    if any(name.startswith(m) or f"/{m}" in name for m in _LOW_OUTPUT_MODELS):
        return _LOW_OUTPUT_CEILING
    if "claude" in name:
        return _STANDARD_OUTPUT_CEILING
    return DERIVED_MAX_TOKENS_CEILING

#: reasoning_effort -> thinking budget. Anthropic has no native effort levels,
#: so the levels the rest of AMETHYST speaks are mapped to token budgets here.
EFFORT_BUDGETS = {
    "low": 2048,
    "medium": 8192,
    "high": 32768,
    "xhigh": 65536,
    "max": 100000,
}

#: Where an entry with no `base_url` lands; shared with the liveness probe,
#: which needs the real endpoint to hit rather than a silent yes.
DEFAULT_BASE_URL = "https://api.anthropic.com/v1"


def _budget_and_max_tokens(
    params: ModelParameters, ceiling: int
) -> tuple[int | None, int]:
    """The thinking budget, and the `max_tokens` that has to contain it.

    Anthropic counts thinking against `max_tokens`, so the two cannot be chosen
    independently. The old code chose `max_tokens` first and squeezed the budget
    into whatever was left over -- and since nothing in the chat path ever sets
    `max_tokens`, what was left over was always 3072, whatever effort the user
    picked.

    Here the budget is the request and `max_tokens` is derived to hold it plus
    room to answer. Only an explicit `max_tokens` from the caller still clamps
    the budget down, because a caller that named a ceiling meant it.
    """
    budget = params.thinking_budget
    if not budget and params.reasoning_effort and params.reasoning_effort != "none":
        budget = EFFORT_BUDGETS.get(params.reasoning_effort, 32768)

    answer_room = params.answer_tokens or DEFAULT_MAX_TOKENS
    if not budget:
        return None, params.max_tokens or answer_room
    if params.max_tokens:
        return min(budget, max(1024, params.max_tokens - 1024)), params.max_tokens

    # `answer_room` is the answer's share; the budget sits on top of it, and
    # the ceiling takes back whatever will not fit.
    max_tokens = min(budget + answer_room, ceiling)
    return max(1024, max_tokens - answer_room), max_tokens


def _to_anthropic_messages(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict]]:
    """Split out the system prompt and convert tool messages to content blocks."""
    system: str | None = None
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            system = m.get("content") or system
            continue
        if role == "tool":
            out.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": m.get("tool_call_id"),
                            "content": m.get("content") or "",
                            **({"is_error": True} if m.get("is_error") else {}),
                        }
                    ],
                }
            )
            continue
        if role == "assistant" and m.get("tool_calls"):
            blocks: list[dict] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for tc in m["tool_calls"]:
                fn = tc.get("function", tc)
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": tc.get("id"),
                        "name": fn.get("name"),
                        "input": fn.get("arguments") or {},
                    }
                )
            out.append({"role": "assistant", "content": blocks})
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
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": b.get("data")
                        }
                    })
            out.append({"role": role, "content": formatted})
        else:
            out.append({"role": role, "content": content})
    return system, out


class AnthropicClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        base_url: str,
        timeout: float = 120.0,
        max_retries: int = MAX_RETRIES,
        max_output_tokens: int | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        #: Attempts this client may make, counting the first. The fallback chain
        #: owns one budget for the whole turn and hands each link its share, so
        #: a three-provider chain costs the same order of wall clock as one
        #: provider rather than three times it.
        self.max_retries = max_retries
        #: This endpoint's output ceiling, where the provider entry declares
        #: one. Only bounds a `max_tokens` derived from a thinking budget.
        self.max_output_tokens = max_output_tokens or _output_ceiling(model)

    def _build_payload(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None,
        params: ModelParameters | None,
        *,
        stream: bool = False,
        cache_system: bool = False,
    ) -> dict[str, Any]:
        p = params or ModelParameters()
        system, converted = _to_anthropic_messages(messages)
        thinking_budget, max_tokens = _budget_and_max_tokens(p, self.max_output_tokens)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": converted,
            "max_tokens": max_tokens,
        }
        if stream:
            payload["stream"] = True
        if system:
            if cache_system:
                payload["system"] = [
                    {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
                ]
            else:
                payload["system"] = system
        if tools:
            tool_list = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in tools
            ]
            if cache_system and tool_list:
                tool_list[-1]["cache_control"] = {"type": "ephemeral"}
            payload["tools"] = tool_list
        if p.temperature is not None:
            payload["temperature"] = p.temperature
        if p.stop:
            payload["stop_sequences"] = p.stop
        if thinking_budget:
            payload["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        return payload

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json", "anthropic-version": API_VERSION}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None = None,
        params: ModelParameters | None = None,
    ) -> ModelResponse:
        data = await post_json(
            f"{self.base_url}/messages",
            headers=self._headers(),
            payload=self._build_payload(
                messages, tools, params, cache_system=getattr(self, "_cache_system", False)
            ),
            timeout=self.timeout,
            max_retries=self.max_retries,
        )
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for block in data.get("content") or []:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                calls.append(
                    ToolCall(
                        id=block.get("id") or str(uuid.uuid4()),
                        name=block.get("name", ""),
                        arguments=block.get("input") or {},
                    )
                )
        usage = data.get("usage") or {}
        return ModelResponse(
            text="\n".join(t for t in text_parts if t) or None,
            tool_calls=calls,
            stop_reason=data.get("stop_reason"),
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            raw=data,
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema] | None = None,
        params: ModelParameters | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield deltas, then a final event with the assembled response.

        Anthropic streams typed content blocks rather than one delta shape, so
        text, thinking and tool input each arrive on their own event names.
        """
        payload = self._build_payload(
            messages, tools, params, stream=True,
            cache_system=getattr(self, "_cache_system", False),
        )

        text_parts: list[str] = []
        thinking_parts: list[str] = []
        blocks: dict[int, dict[str, Any]] = {}
        stop_reason: str | None = None
        usage: dict[str, Any] = {}

        async for raw in stream_sse(
            f"{self.base_url}/messages",
            headers=self._headers(),
            payload=payload,
            timeout=self.timeout,
            max_retries=self.max_retries,
        ):
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue

            kind = event.get("type")
            index = event.get("index", 0)

            if kind == "error":
                # Anthropic can fail over an already-open 200 the same way an
                # OpenAI-compatible endpoint can. This branch did not exist, so
                # an `overloaded_error` mid-stream matched nothing and was
                # dropped -- surfacing as a truncated answer with no message, or
                # as a redundant non-streaming retry into the same overload.
                error = event.get("error")
                raise ProviderStreamError(
                    _describe_provider_error(error), kind=classify_stream_error(error)
                )

            if kind == "content_block_start":
                block = event.get("content_block") or {}
                if block.get("type") == "tool_use":
                    blocks[index] = {
                        "id": block.get("id"),
                        "name": block.get("name"),
                        "arguments": "",
                    }
            elif kind == "content_block_delta":
                delta = event.get("delta") or {}
                delta_type = delta.get("type")
                if delta_type == "text_delta" and delta.get("text"):
                    text_parts.append(delta["text"])
                    yield StreamEvent(type="text", text=delta["text"])
                elif delta_type == "thinking_delta" and delta.get("thinking"):
                    thinking_parts.append(delta["thinking"])
                    yield StreamEvent(type="reasoning", text=delta["thinking"])
                elif delta_type == "input_json_delta" and index in blocks:
                    blocks[index]["arguments"] += delta.get("partial_json", "")
            elif kind == "message_delta":
                stop_reason = (event.get("delta") or {}).get("stop_reason") or stop_reason
                if event.get("usage"):
                    usage.update(event["usage"])
            elif kind == "message_start":
                usage.update((event.get("message") or {}).get("usage") or {})

        calls = []
        for _, block in sorted(blocks.items()):
            if not block.get("name"):
                continue
            try:
                arguments = json.loads(block["arguments"]) if block["arguments"] else {}
            except json.JSONDecodeError:
                arguments = {"_raw": block["arguments"]}
            calls.append(
                ToolCall(
                    id=block["id"] or str(uuid.uuid4()),
                    name=block["name"],
                    arguments=arguments if isinstance(arguments, dict) else {"_value": arguments},
                )
            )

        if not text_parts and not thinking_parts and not calls:
            # A stream that carried nothing is not an empty answer; it is an
            # endpoint that did not stream. Asking again without streaming is
            # the difference between an answer and a blank turn.
            yield StreamEvent(type="done", response=await self.complete(messages, tools, params))
            return

        yield StreamEvent(
            type="done",
            response=ModelResponse(
                text="".join(text_parts) or None,
                reasoning="".join(thinking_parts) or None,
                tool_calls=calls,
                stop_reason=stop_reason,
                input_tokens=usage.get("input_tokens"),
                output_tokens=usage.get("output_tokens"),
            ),
        )


def initialize(
    config: ProviderConfig, model: str | None = None, *, max_retries: int = MAX_RETRIES
) -> ResolvedModel:
    resolved_model = model or config.default_model
    if not resolved_model:
        raise ValueError(f"no model specified for provider '{config.name}'")
    api_key = resolve_api_key(ref=config.api_key_ref, env=config.api_key_env or "ANTHROPIC_API_KEY")
    client = AnthropicClient(
        api_key=api_key,
        model=resolved_model,
        base_url=config.base_url or DEFAULT_BASE_URL,
        max_retries=max_retries,
        max_output_tokens=config.extra.get("max_output_tokens"),
    )
    return ResolvedModel(
        provider=config.name,
        model=resolved_model,
        client=client,
        capabilities=Capabilities(
            tools=True,
            streaming=True,
            vision=True,
            reasoning=True,
            # 200k is right for the Claude 3/4 line and wrong for a model that
            # declares a million; an entry that states its window wins.
            context_window=config.context_window or 200_000,
            max_tools=config.max_tools,
            tokens_per_minute=config.tokens_per_minute,
        ),
    )
