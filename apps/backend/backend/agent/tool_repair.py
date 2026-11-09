"""Tool call argument JSON validation, repair, and type coercion (Task 17).

Provides robust handling for:
- Stripping markdown code fences (```json ... ```)
- Fixing trailing commas and invalid syntax
- Parsing single-quoted Python dicts and literal booleans/None
- Unescaping double-encoded JSON strings
- Balancing truncated/unclosed JSON delimiters
- Coercing basic types (string -> int/float/bool/list/dict) based on schema
- Validating required parameters and types with precise error reporting
"""

from __future__ import annotations

import ast
import json
import logging
import re
from typing import Any

from backend.agent.defaults import apply_tool_defaults
from backend.runtime.types import ToolCall

log = logging.getLogger(__name__)


def strip_markdown_code_fences(text: str) -> str:
    """Strip markdown code block fences and backticks from JSON string."""
    s = text.strip()
    if s.startswith("```"):
        newline_idx = s.find("\n")
        if newline_idx != -1:
            closing_idx = s.rfind("```")
            if closing_idx > newline_idx:
                s = s[newline_idx + 1:closing_idx].strip()
            else:
                s = s[newline_idx + 1:].strip()
        else:
            s = s[3:]
            if s.endswith("```"):
                s = s[:-3]
            s = s.strip()
    elif s.startswith("`") and s.endswith("`") and len(s) >= 2:
        s = s[1:-1].strip()
    return s


def repair_json_syntax(text: str) -> str:
    """Fix common JSON syntax errors such as trailing commas and consecutive commas."""
    s = text
    # Fix trailing commas before } or ]
    s = re.sub(r',\s*([\]}])', r'\1', s)
    # Fix double commas
    s = re.sub(r',\s*,+', ',', s)
    return s


def balance_delimiters(s: str) -> str:
    """Balance unclosed quotes, braces, and brackets in truncated JSON."""
    stack: list[str] = []
    in_str = False
    escape = False

    for ch in s:
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if not in_str:
            if ch in ("{", "["):
                stack.append(ch)
            elif ch == "}" and stack and stack[-1] == "{":
                stack.pop()
            elif ch == "]" and stack and stack[-1] == "[":
                stack.pop()

    res = s
    if in_str:
        res += '"'
    for open_ch in reversed(stack):
        if open_ch == "{":
            res += "}"
        elif open_ch == "[":
            res += "]"
    return res


def extract_embedded_json(text: str) -> str:
    """Extract innermost/outermost {...} substring if surrounded by conversational filler."""
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and start < end:
        return text[start : end + 1]
    return text


def parse_and_repair_json(raw: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Parse and repair malformed JSON arguments into a Python dictionary.

    Returns:
        (arguments_dict, error_message)
        If parsing succeeds, error_message is None.
        If parsing fails completely, arguments_dict is None and error_message names the reason.
    """
    if isinstance(raw, dict):
        # Handle _raw from openai_compat provider
        if len(raw) == 1 and "_raw" in raw:
            return parse_and_repair_json(raw["_raw"])
        if len(raw) == 1 and "_value" in raw:
            val = raw["_value"]
            if isinstance(val, dict):
                return val, None
            if isinstance(val, str):
                return parse_and_repair_json(val)
        return raw, None

    if raw is None:
        return {}, None

    if not isinstance(raw, str):
        return None, f"Expected dictionary or JSON string, got {type(raw).__name__}"

    s = raw.strip()
    if not s or s in ("{}", "null", "None"):
        return {}, None

    last_error = "unknown error"

    # Step 1: Direct JSON parse with strict=False (allows unescaped control chars)
    try:
        parsed = json.loads(s, strict=False)
        if isinstance(parsed, dict):
            return parsed, None
        if isinstance(parsed, str):
            # Double-encoded JSON string: "{\"query\": \"foo\"}"
            try:
                inner = json.loads(parsed, strict=False)
                if isinstance(inner, dict):
                    return inner, None
            except Exception:
                pass
    except Exception as exc:
        last_error = str(exc)

    # Step 2: Strip markdown code block fences
    cleaned = strip_markdown_code_fences(s)
    if cleaned != s:
        try:
            parsed = json.loads(cleaned, strict=False)
            if isinstance(parsed, dict):
                return parsed, None
        except Exception as exc:
            last_error = str(exc)

    # Step 3: Repair trailing commas & syntax
    repaired = repair_json_syntax(cleaned)
    try:
        parsed = json.loads(repaired, strict=False)
        if isinstance(parsed, dict):
            return parsed, None
    except Exception as exc:
        last_error = str(exc)

    # Step 4: Python literal evaluation (single quotes, True/False/None)
    # Convert lowercase booleans/null to Python equivalents for literal_eval if needed
    py_attempt = repaired
    py_attempt = re.sub(r'\btrue\b', 'True', py_attempt)
    py_attempt = re.sub(r'\bfalse\b', 'False', py_attempt)
    py_attempt = re.sub(r'\bnull\b', 'None', py_attempt)
    try:
        val = ast.literal_eval(py_attempt)
        if isinstance(val, dict):
            return val, None
    except Exception:
        pass

    # Step 5: Try replacing Python literals with JSON literals
    json_attempt = repaired
    json_attempt = re.sub(r'\bTrue\b', 'true', json_attempt)
    json_attempt = re.sub(r'\bFalse\b', 'false', json_attempt)
    json_attempt = re.sub(r'\bNone\b', 'null', json_attempt)
    try:
        parsed = json.loads(json_attempt, strict=False)
        if isinstance(parsed, dict):
            return parsed, None
    except Exception:
        pass

    # Step 6: Extract embedded JSON if conversational text surrounds it
    extracted = extract_embedded_json(cleaned)
    if extracted != cleaned:
        sub_parsed, _ = parse_and_repair_json(extracted)
        if sub_parsed is not None:
            return sub_parsed, None

    # Step 7: Balance unclosed braces/brackets for cut-off / truncated output
    balanced = balance_delimiters(cleaned)
    if balanced != cleaned:
        balanced_repaired = repair_json_syntax(balanced)
        try:
            parsed = json.loads(balanced_repaired, strict=False)
            if isinstance(parsed, dict):
                return parsed, None
        except Exception:
            try:
                val = ast.literal_eval(balanced_repaired)
                if isinstance(val, dict):
                    return val, None
            except Exception:
                pass

    return None, f"JSON syntax error ({last_error})"


def coerce_property_value(prop_schema: dict[str, Any], val: Any) -> Any:
    """Coerce a value to match the expected JSON schema property type."""
    if not isinstance(prop_schema, dict) or val is None:
        return val

    expected_type = prop_schema.get("type")
    if isinstance(expected_type, list):
        types = [t for t in expected_type if t != "null"]
        expected_type = types[0] if types else None
    if not expected_type:
        return val

    if expected_type in ("integer", "int"):
        if isinstance(val, bool):
            return 1 if val else 0
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str):
            s = val.strip()
            try:
                return int(s)
            except ValueError:
                try:
                    return int(float(s))
                except ValueError:
                    return val

    elif expected_type in ("number", "float"):
        if isinstance(val, bool):
            return 1.0 if val else 0.0
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str):
            try:
                return float(val.strip())
            except ValueError:
                return val

    elif expected_type in ("boolean", "bool"):
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            s = val.strip().lower()
            if s in ("true", "1", "yes", "t", "y"):
                return True
            if s in ("false", "0", "no", "f", "n"):
                return False
        if isinstance(val, (int, float)):
            return bool(val)

    elif expected_type in ("array", "list"):
        if isinstance(val, list):
            return val
        if isinstance(val, str):
            s = val.strip()
            if (s.startswith("[") and s.endswith("]")) or (s.startswith("(") and s.endswith(")")):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return parsed
                except Exception:
                    pass
            if "," in s:
                return [part.strip() for part in s.split(",") if part.strip()]
            return [s] if s else []
        if isinstance(val, (dict, int, float, bool)):
            return [val]

    elif expected_type in ("object", "dict"):
        if isinstance(val, dict):
            return val
        if isinstance(val, str):
            s = val.strip()
            if s.startswith("{") and s.endswith("}"):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    pass

    elif expected_type in ("string", "str"):
        if isinstance(val, (int, float, bool)):
            return str(val)
        if isinstance(val, (dict, list)):
            try:
                return json.dumps(val)
            except Exception:
                return str(val)

    return val


def coerce_argument_types(arguments: dict[str, Any], parameters: dict[str, Any] | None) -> dict[str, Any]:
    """Coerce argument types based on schema parameters."""
    if not parameters or not isinstance(parameters, dict):
        return arguments

    props = parameters.get("properties")
    if not isinstance(props, dict):
        return arguments

    args = dict(arguments)
    for prop_name, prop_def in props.items():
        if prop_name in args and isinstance(prop_def, dict):
            args[prop_name] = coerce_property_value(prop_def, args[prop_name])

    return args


def validate_arguments(
    tool_name: str,
    arguments: dict[str, Any],
    parameters: dict[str, Any] | None,
) -> str | None:
    """Validate arguments against schema parameters.

    Returns None if valid, or a precise error string naming the missing or incorrect field.
    """
    if not parameters or not isinstance(parameters, dict):
        return None

    # 1. Check required parameters
    required = parameters.get("required") or []
    if isinstance(required, list):
        for req in required:
            if req not in arguments:
                return (
                    f"Missing required parameter '{req}' for tool '{tool_name}'. "
                    f"Required: {required}. Got: {list(arguments.keys())}."
                )
            if arguments[req] is None:
                prop_def = parameters.get("properties", {}).get(req, {})
                prop_type = prop_def.get("type") if isinstance(prop_def, dict) else None
                if prop_type != "null" and not (isinstance(prop_type, list) and "null" in prop_type):
                    return (
                        f"Parameter '{req}' for tool '{tool_name}' cannot be null. "
                        f"Expected {prop_type or 'value'}."
                    )

    # 2. Check property types
    properties = parameters.get("properties") or {}
    if isinstance(properties, dict):
        for prop_name, val in arguments.items():
            prop_def = properties.get(prop_name)
            if not isinstance(prop_def, dict) or val is None:
                continue

            expected_type = prop_def.get("type")
            if isinstance(expected_type, list):
                expected_type = [t for t in expected_type if t != "null"]
                expected_type = expected_type[0] if expected_type else None
            if not expected_type:
                continue

            if expected_type in ("integer", "int"):
                if isinstance(val, bool) or not isinstance(val, int):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected integer, got {type(val).__name__} ({val!r})."
                    )
            elif expected_type in ("number", "float"):
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected number, got {type(val).__name__} ({val!r})."
                    )
            elif expected_type in ("boolean", "bool"):
                if not isinstance(val, bool):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected boolean, got {type(val).__name__} ({val!r})."
                    )
            elif expected_type in ("array", "list"):
                if not isinstance(val, list):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected array, got {type(val).__name__} ({val!r})."
                    )
            elif expected_type in ("object", "dict"):
                if not isinstance(val, dict):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected object, got {type(val).__name__} ({val!r})."
                    )
            elif expected_type in ("string", "str"):
                if not isinstance(val, str):
                    return (
                        f"Invalid value for parameter '{prop_name}' in tool '{tool_name}': "
                        f"expected string, got {type(val).__name__} ({val!r})."
                    )

    return None


def repair_and_validate_tool_call(
    call: ToolCall,
    registry: Any = None,
) -> tuple[ToolCall, str | None]:
    """Repair arguments of a ToolCall and validate against tool schema.

    Returns:
        (call, error_message)
        If error_message is not None, the tool call is invalid and could not be repaired.
    """
    args = call.arguments
    parsed_args, parse_err = parse_and_repair_json(args)
    if parsed_args is None:
        return call, f"Malformed JSON arguments for tool '{call.name}': {parse_err}. Please provide valid JSON arguments."

    # Tool resolution and schema lookup
    tool = None
    if registry is not None and hasattr(registry, "resolve_tool"):
        tool = registry.resolve_tool(call.name)

    # Normalize argument synonyms
    if tool is not None:
        if hasattr(registry, "normalize_arguments"):
            parsed_args = registry.normalize_arguments(tool, parsed_args)
    else:
        # Basic normalization for common patterns if tool is not resolved
        parsed_args = dict(parsed_args)
        if "filePath" in parsed_args and "path" not in parsed_args:
            parsed_args["path"] = parsed_args["filePath"]
        if "file_path" in parsed_args and "path" not in parsed_args:
            parsed_args["path"] = parsed_args["file_path"]

    # Coerce argument types based on schema
    params = tool.parameters if tool is not None and hasattr(tool, "parameters") else None
    parsed_args = coerce_argument_types(parsed_args, params)

    # Apply tool defaults (from defaults.py)
    parsed_args = apply_tool_defaults(call.name, parsed_args)

    # Validate required parameters and types
    val_err = validate_arguments(call.name, parsed_args, params)
    if val_err:
        call.arguments = parsed_args
        return call, val_err

    call.arguments = parsed_args
    return call, None
