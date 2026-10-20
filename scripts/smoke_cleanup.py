#!/usr/bin/env python3
"""Smoke test for the amethyst cleanup branch.

Runs against one running instance (default http://127.0.0.1:8017) and keeps a
machine-readable summary so before/after runs can be diffed. Non-destructive:
anything it can undo, it undoes at the end (the probe conversation it created).
Messages it sends are prefixed "[cleanup-smoke]" so they are recognizable in the
database and the log.

Usage:  python scripts/smoke_cleanup.py [--base http://127.0.0.1:8017] [--out FILE]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8017"
STREAM_TIMEOUT = 180
LABEL = "[cleanup-smoke]"


def _get(base: str, path: str, timeout: float = 15) -> tuple[int, object]:
    req = urllib.request.Request(base + path, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    try:
        return resp.status, json.loads(raw)
    except ValueError:
        return resp.status, raw


def _post(base: str, path: str, body: dict | None, timeout: float = 30) -> tuple[int, object]:
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        base + path, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    try:
        return resp.status, json.loads(raw)
    except ValueError:
        return resp.status, raw


def _stream_turn(base: str, conv_id: str, message: str, mode: str = "chat",
                 timeout: float = STREAM_TIMEOUT) -> dict:
    """POST a turn and harvest SSE frames. Returns a summary, not the text."""
    data = json.dumps({"message": message, "mode": mode}).encode()
    req = urllib.request.Request(
        f"{base}/api/conversations/{conv_id}/turn", data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    frames: list[str] = []
    started = time.monotonic()
    error = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for line in resp:
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data: "):
                    continue
                try:
                    payload = json.loads(line[6:])
                except ValueError:
                    continue
                frames.append(payload.get("type", "?"))
                if time.monotonic() - started > timeout:
                    error = "stream timeout"
                    break
    except urllib.error.HTTPError as exc:
        error = f"HTTP {exc.code}"
        body_txt = exc.read().decode("utf-8", "replace")[:200]
        return {"ok": False, "http": exc.code, "error": body_txt, "frames": []}
    except Exception as exc:  # noqa: BLE001 - recorded, not raised
        error = f"{type(exc).__name__}: {exc}"
    tail = frames[-12:]
    return {
        "ok": error is None and len(frames) > 1,
        "error": error,
        "seconds": round(time.monotonic() - started, 1),
        "frame_count": len(frames),
        "event_types": sorted(set(frames)),
        "tool_names": sorted({f for f in frames if f.startswith("tool_")}),
        "tail": tail,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--out", default="smoke_result.json")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    result: dict = {"base": base, "steps": {}, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}

    def step(name: str, ok: bool, detail: object = None):
        result["steps"][name] = {"ok": bool(ok), "detail": detail}
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  {detail}" if detail is not None else ""))

    # 1. ping + health
    try:
        status, ping = _get(base, "/api/ping")
        step("ping", status == 200, ping)
    except Exception as exc:  # noqa: BLE001
        step("ping", False, str(exc))
        result["started"] = result["started"]
        json.dump(result, open(args.out, "w"), indent=1, default=str)
        return 2

    try:
        status, health = _get(base, "/api/health")
        tools_src = None
        result["steps"]["health"] = {
            "ok": status == 200,
            "providers": sorted(health.get("providers", [])),
            "status": health.get("status"),
        }
        print(f"  PASS  health  providers={len(health.get('providers', []))}")
    except Exception as exc:  # noqa: BLE001
        result["steps"]["health"] = {"ok": False, "error": str(exc)}

    # 2. tool registry snapshot
    try:
        _, tools = _get(base, "/api/tools")
        names = sorted(t["name"] for t in tools)
        digest = hashlib.sha256("\n".join(names).encode()).hexdigest()[:16]
        composio = sorted({t["server"] for t in tools if t.get("server") == "composio" and t.get("source") == "mcp"})
        mcp_servers = sorted({t.get("server") for t in tools if t.get("source") == "mcp" and t.get("server") != "composio"})
        result["tools"] = {"count": len(names), "sha16": digest,
                           "composio_servers": composio, "mcp_servers": mcp_servers}
        step("tools", len(names) > 10, f"count={len(names)} sha16={digest} composio={len(composio)} mcp={len(mcp_servers)}")
    except Exception as exc:  # noqa: BLE001
        step("tools", False, str(exc))

    # 3. settings + routes sanity
    try:
        _, settings = _get(base, "/api/settings")
        result["settings_keys"] = sorted(settings.keys())[:40] if isinstance(settings, dict) else str(type(settings))
        step("settings", True, result["settings_keys"][:12])
    except Exception as exc:  # noqa: BLE001
        step("settings", False, str(exc))

    # 4. providers list
    try:
        status, providers = _get(base, "/api/providers")
        plist = None
        if isinstance(providers, dict):
            plist = providers.get("configured") or providers.get("providers") or providers.get("data")
        if plist is None:
            plist = providers
        if isinstance(plist, dict):
            count, names = len(plist), sorted(plist.keys())
        elif isinstance(plist, list):
            count = len(plist)
            names = [p.get("name", p.get("slug", "?")) for p in plist if isinstance(p, dict)]
        else:
            count, names = 0, []
        result["providers"] = {"count": count, "names": names}
        step("providers", status == 200, f"count={count}")
    except Exception as exc:  # noqa: BLE001
        step("providers", False, str(exc))

    # 5. streaming chat turn (fresh conversation, labelled, deleted after)
    conv_id = None
    conv_model = None
    try:
        _, health = _get(base, "/api/health")
        tier = (health.get("tiers") or {}).get("default") or {}
        conv_model = {"provider": tier.get("provider"), "model": tier.get("model")}
        _, conv = _post(base, "/api/conversations", {**conv_model, "title": LABEL + " cleanup baseline probe"})
        conv_id = conv.get("id", conv.get("conversation_id")) if isinstance(conv, dict) else None
        step("create_conversation", bool(conv_id), conv_id)
    except Exception as exc:  # noqa: BLE001
        step("create_conversation", False, str(exc))

    if conv_id:
        try:
            r = _stream_turn(base, conv_id, f"{LABEL} Reply with exactly one word: smoke.")
            result["steps"]["stream_chat"] = r
            step("stream_chat", r.get("ok"), f"frames={r.get('frame_count')} types={r.get('event_types')}")
        except Exception as exc:  # noqa: BLE001
            step("stream_chat", False, str(exc))

        # 6. a builtin tool turn (read-only task listing)
        try:
            r = _stream_turn(base, conv_id, f"{LABEL} List my tasks. Answer TOOL-OK when done.")
            result["steps"]["builtin_tool_turn"] = r
            step("builtin_tool_turn", r.get("ok"), f"frames={r.get('frame_count')} tail={r.get('tail')[:4]}")
        except Exception as exc:  # noqa: BLE001
            step("builtin_tool_turn", False, str(exc))

        # 7. a composio tool turn (read-only, if composio tools exist)
        if result.get("tools", {}).get("composio_servers"):
            try:
                r = _stream_turn(
                    base, conv_id,
                    f"{LABEL} Can you see any Composio tools in your registry? "
                    "Do not execute anything. Answer COMPOSIO-VISIBLE if calender/email tools are listed.",
                )
                result["steps"]["composio_turn"] = r
                step("composio_turn", r.get("ok"), f"frames={r.get('frame_count')}")
            except Exception as exc:  # noqa: BLE001
                step("composio_turn", False, str(exc))

        # 8. unknown mode parameter: must be rejected, never crash
        for bad in ("work", "code"):
            try:
                r = _stream_turn(base, conv_id, f"{LABEL} ignored", mode=bad)
                result["steps"][f"mode_{bad}"] = r
                step(f"turn_rejects_mode_{bad}", not r.get("ok"), r.get("error"))
            except Exception as exc:  # noqa: BLE001
                step(f"turn_rejects_mode_{bad}", False, str(exc))

        # cleanup: delete the probe conversation
        try:
            req = urllib.request.Request(f"{base}/api/conversations/{conv_id}", method="DELETE")
            with urllib.request.urlopen(req, timeout=15) as resp:
                step("cleanup_delete_conversation", resp.status in (200, 204), resp.status)
        except urllib.error.HTTPError as exc:
            step("cleanup_delete_conversation", False, f"HTTP {exc.code}")
        except Exception as exc:  # noqa: BLE001
            step("cleanup_delete_conversation", False, str(exc))

    result["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    dumps = json.dumps(result, indent=1, default=str)
    with open(args.out, "w") as fh:
        fh.write(dumps)
    print(f"--> wrote {args.out}")
    ok = all(v.get("ok") for k, v in result["steps"].items()
             if k not in {"cleanup_delete_conversation"} and isinstance(v, dict) and "ok" in v)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
