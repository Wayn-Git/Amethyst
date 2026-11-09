"""Pluggable registry for auto-detecting local AI provider configurations.

Scans local, read-only configuration paths and environment variables
without leaking secrets or phoning home. Supports OpenCode / OpenCode Zen,
Hermes agent, Kilo Code, standard environment variables, and active local runtimes
like Ollama and LM Studio.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import yaml

log = logging.getLogger(__name__)


def _strip_json_comments(text: str) -> str:
    """Remove // and /* */ comments while preserving strings, and trailing commas."""
    pattern = r'("(?:\\.|[^"\\])*")|//.*|/\*[\s\S]*?\*/'

    def replace(match: re.Match) -> str:
        if match.group(1):
            return match.group(1)
        return ""

    text = re.sub(pattern, replace, text)
    # Remove trailing commas before } or ]
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return text



@dataclass
class DetectedProvider:
    id: str
    name: str
    provider: str
    source: str
    base_url: str | None = None
    api_key: str | None = None
    models: list[str] = field(default_factory=list)
    default_model: str | None = None
    adapter: str | None = None

    def to_dict(self, mask_key: bool = True) -> dict[str, Any]:
        key_repr = None
        if self.api_key:
            if mask_key:
                clean = self.api_key.strip()
                if len(clean) > 8:
                    key_repr = f"{clean[:4]}...{clean[-4:]}"
                else:
                    key_repr = "***"
            else:
                key_repr = self.api_key

        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "source": self.source,
            "base_url": self.base_url,
            "has_key": bool(self.api_key),
            "masked_key": key_repr,
            "models": self.models,
            "default_model": self.default_model,
            "adapter": self.adapter or self.provider,
        }


class BaseDetector(ABC):
    """Abstract detector contract for external AI tools and runtimes."""

    id: str = "base"
    name: str = "Base Detector"

    @abstractmethod
    async def detect(self) -> list[DetectedProvider]:
        """Perform non-blocking local scan and return detected providers."""
        raise NotImplementedError


class EnvVarDetector(BaseDetector):
    id = "env_vars"
    name = "Environment Variables"

    ENV_MAPPING = [
        ("OPENAI_API_KEY", "openai", "OpenAI", "gpt-4o", None, None),
        ("ANTHROPIC_API_KEY", "anthropic", "Anthropic", "claude-3-7-sonnet-latest", None, None),
        ("OPENROUTER_API_KEY", "openrouter", "OpenRouter", "cohere/north-mini-code:free", "https://openrouter.ai/api/v1", None),
        ("GEMINI_API_KEY", "google", "Google Gemini", "gemini-2.0-flash", "https://generativelanguage.googleapis.com/v1beta/openai/", None),
        ("GOOGLE_API_KEY", "google", "Google Gemini", "gemini-2.0-flash", "https://generativelanguage.googleapis.com/v1beta/openai/", None),
        ("GROQ_API_KEY", "groq", "Groq", "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1", None),
        ("MISTRAL_API_KEY", "mistral", "Mistral AI", "mistral-large-latest", "https://api.mistral.ai/v1", None),
        ("DEEPSEEK_API_KEY", "deepseek", "DeepSeek", "deepseek-chat", "https://api.deepseek.com/v1", None),
        ("TOGETHER_API_KEY", "together", "Together AI", "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "https://api.together.xyz/v1", None),
        ("NVIDIA_API_KEY", "nvidia", "NVIDIA NIM", "nvidia/llama-3.1-nemotron-70b-instruct", "https://integrate.api.nvidia.com/v1", None),
        ("KILO_API_KEY", "kilocode", "Kilo Code", "kilo-auto/free", "https://api.kilo.ai/api/gateway", None),
    ]

    async def detect(self) -> list[DetectedProvider]:
        results: list[DetectedProvider] = []
        seen_providers: set[str] = set()

        for var_name, provider_slug, display_name, def_model, base_url, adapter in self.ENV_MAPPING:
            val = os.environ.get(var_name, "").strip()
            if val and provider_slug not in seen_providers:
                seen_providers.add(provider_slug)
                results.append(
                    DetectedProvider(
                        id=f"env-{provider_slug}",
                        name=f"{display_name} (Environment)",
                        provider=provider_slug,
                        source=f"Environment variable {var_name}",
                        base_url=base_url,
                        api_key=val,
                        models=[def_model] if def_model else [],
                        default_model=def_model,
                        adapter=adapter or provider_slug,
                    )
                )
        return results


class OpenCodeDetector(BaseDetector):
    id = "opencode"
    name = "OpenCode / OpenCode Zen"

    def _get_candidate_paths(self) -> list[Path]:
        custom_file = os.environ.get("OPENCODE_CONFIG")
        if custom_file:
            return [Path(custom_file)]

        paths = []
        custom_dir = os.environ.get("OPENCODE_CONFIG_DIR")
        if custom_dir:
            p = Path(custom_dir)
            paths.extend([p / "opencode.jsonc", p / "opencode.json"])
            return paths

        home = Path.home()

        if sys.platform == "win32":
            appdata = os.environ.get("APPDATA")
            if appdata:
                paths.extend([Path(appdata) / "opencode" / "opencode.jsonc", Path(appdata) / "opencode" / "opencode.json"])
            paths.extend([home / ".config" / "opencode" / "opencode.jsonc", home / ".config" / "opencode" / "opencode.json"])
        elif sys.platform == "darwin":
            paths.extend([
                home / "Library" / "Application Support" / "opencode" / "opencode.jsonc",
                home / "Library" / "Application Support" / "opencode" / "opencode.json",
                home / ".config" / "opencode" / "opencode.jsonc",
                home / ".config" / "opencode" / "opencode.json",
            ])
        else:
            xdg = os.environ.get("XDG_CONFIG_HOME")
            base = Path(xdg) if xdg else home / ".config"
            paths.extend([base / "opencode" / "opencode.jsonc", base / "opencode" / "opencode.json"])

        return paths

    async def detect(self) -> list[DetectedProvider]:
        results: list[DetectedProvider] = []
        for path in self._get_candidate_paths():
            if not path.is_file():
                continue
            try:
                raw_text = path.read_text(encoding="utf-8")
                cleaned = _strip_json_comments(raw_text)
                data = json.loads(cleaned)
            except Exception as exc:
                log.debug("Failed parsing OpenCode config at %s: %s", path, exc)
                continue

            providers_obj = data.get("provider") or {}
            if isinstance(providers_obj, dict):
                for p_name, p_val in providers_obj.items():
                    if not isinstance(p_val, dict):
                        continue
                    options = p_val.get("options") or {}
                    base_url = options.get("baseURL") or options.get("baseUrl") or ""
                    api_key = options.get("apiKey") or p_val.get("apiKey") or os.environ.get("OPENCODE_ZEN_API_KEY", "").strip()

                    models_dict = p_val.get("models") or {}
                    models_list = list(models_dict.keys()) if isinstance(models_dict, dict) else []

                    # Detect OpenCode Zen
                    if "zen" in p_name.lower() or "opencode.ai/zen" in base_url or p_name == "opencode-go":
                        default_m = models_list[0] if models_list else "kimi-k2.6"
                        results.append(
                            DetectedProvider(
                                id="opencode-zen",
                                name="OpenCode Zen",
                                provider="opencode-zen",
                                source=f"OpenCode config ({path})",
                                base_url="https://opencode.ai/zen/v1",
                                api_key=api_key or os.environ.get("OPENCODE_ZEN_API_KEY", "").strip() or None,
                                models=models_list or ["kimi-k2.6", "glm-5.1", "minimax-m2.7"],
                                default_model=default_m,
                                adapter="opencode-zen",
                            )
                        )
                    elif p_name in ("openai", "anthropic", "openrouter", "groq", "deepseek", "together", "nvidia", "mistral"):
                        default_m = models_list[0] if models_list else None
                        results.append(
                            DetectedProvider(
                                id=f"opencode-{p_name}",
                                name=f"{p_name.capitalize()} (via OpenCode)",
                                provider=p_name,
                                source=f"OpenCode config ({path})",
                                base_url=base_url or None,
                                api_key=api_key or None,
                                models=models_list,
                                default_model=default_m,
                                adapter=p_name,
                            )
                        )
            break  # Found primary config

        return results


class HermesDetector(BaseDetector):
    id = "hermes"
    name = "Hermes Agent"

    def _get_candidate_paths(self) -> list[Path]:
        custom_file = os.environ.get("HERMES_CONFIG")
        if custom_file:
            return [Path(custom_file)]

        custom_dir = os.environ.get("HERMES_CONFIG_DIR")
        if custom_dir:
            return [Path(custom_dir) / "config.yaml"]


        home = Path.home()
        paths: list[Path] = [
            home / ".hermes" / "config.yaml",
            home / ".config" / "hermes" / "config.yaml",
        ]
        if sys.platform == "win32":
            userprofile = os.environ.get("USERPROFILE")
            if userprofile:
                paths.append(Path(userprofile) / ".hermes" / "config.yaml")
        return paths

    async def detect(self) -> list[DetectedProvider]:
        results: list[DetectedProvider] = []
        for path in self._get_candidate_paths():
            if not path.is_file():
                continue
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    continue
                provider = str(data.get("provider", "")).strip().lower()
                api_key = str(data.get("api_key", "")).strip() or None
                base_url = str(data.get("base_url", "")).strip() or None
                model = str(data.get("model", "")).strip() or None

                if provider and provider != "custom":
                    results.append(
                        DetectedProvider(
                            id=f"hermes-{provider}",
                            name=f"{provider.capitalize()} (via Hermes)",
                            provider=provider,
                            source=f"Hermes agent config ({path})",
                            base_url=base_url,
                            api_key=api_key,
                            models=[model] if model else [],
                            default_model=model,
                            adapter=provider,
                        )
                    )
                elif base_url:
                    results.append(
                        DetectedProvider(
                            id="hermes-custom",
                            name="Hermes Agent Model",
                            provider="custom",
                            source=f"Hermes agent config ({path})",
                            base_url=base_url,
                            api_key=api_key,
                            models=[model] if model else [],
                            default_model=model,
                            adapter="custom",
                        )
                    )
            except Exception as exc:
                log.debug("Failed parsing Hermes config at %s: %s", path, exc)
                continue
            break

        return results


class KiloCodeDetector(BaseDetector):
    """Detector for Kilo Code VS Code extension or standalone gateway.

    Best effort: VS Code SecretStorage is protected by OS keyring, but
    plain configs or env vars are scanned and reported. Fails silently.
    """

    id = "kilocode"
    name = "Kilo Code"

    def _get_candidate_paths(self) -> list[Path]:
        home = Path.home()
        paths = [
            home / ".config" / "kilo" / "config.json",
            home / ".kilo" / "config.json",
        ]
        if sys.platform == "win32":
            appdata = os.environ.get("APPDATA")
            if appdata:
                paths.append(Path(appdata) / "Code" / "User" / "settings.json")
                paths.append(Path(appdata) / "kilo" / "config.json")
        elif sys.platform == "darwin":
            paths.append(home / "Library" / "Application Support" / "Code" / "User" / "settings.json")
        else:
            paths.append(home / ".config" / "Code" / "User" / "settings.json")
        return paths

    async def detect(self) -> list[DetectedProvider]:
        results: list[DetectedProvider] = []
        env_key = os.environ.get("KILO_API_KEY", "").strip()
        if env_key:
            results.append(
                DetectedProvider(
                    id="kilocode-env",
                    name="Kilo Code",
                    provider="kilocode",
                    source="Environment variable KILO_API_KEY",
                    base_url="https://api.kilo.ai/api/gateway",
                    api_key=env_key,
                    models=["kilo-auto/free"],
                    default_model="kilo-auto/free",
                    adapter="kilocode",
                )
            )
            return results

        for path in self._get_candidate_paths():
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
                data = json.loads(_strip_json_comments(text))
                kilo_key = data.get("kilo.apiKey") or data.get("kiloApiKey") or data.get("apiKey")
                if kilo_key and isinstance(kilo_key, str) and kilo_key.strip():
                    results.append(
                        DetectedProvider(
                            id="kilocode-config",
                            name="Kilo Code",
                            provider="kilocode",
                            source=f"Config file ({path.name})",
                            base_url="https://api.kilo.ai/api/gateway",
                            api_key=kilo_key.strip(),
                            models=["kilo-auto/free"],
                            default_model="kilo-auto/free",
                            adapter="kilocode",
                        )
                    )
                    break
            except Exception:
                # Fails silently as per prompt requirements
                pass

        return results


class OllamaDetector(BaseDetector):
    id = "ollama"
    name = "Ollama (Local)"

    async def detect(self) -> list[DetectedProvider]:
        endpoint = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
        if not endpoint.startswith("http"):
            endpoint = f"http://{endpoint}"

        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                resp = await client.get(f"{endpoint}/api/tags")
                if resp.status_code == 200:
                    payload = resp.json()
                    models = [
                        m.get("name")
                        for m in payload.get("models", [])
                        if isinstance(m, dict) and m.get("name")
                    ]
                    if models:
                        def_m = models[0]
                        return [
                            DetectedProvider(
                                id="ollama-local",
                                name="Ollama (Local)",
                                provider="ollama",
                                source=f"Running service at {endpoint}",
                                base_url=f"{endpoint}/v1",
                                api_key="ollama",
                                models=models,
                                default_model=def_m,
                                adapter="ollama",
                            )
                        ]
        except Exception:
            pass
        return []


class LMStudioDetector(BaseDetector):
    id = "lmstudio"
    name = "LM Studio (Local)"

    async def detect(self) -> list[DetectedProvider]:
        endpoint = os.environ.get("LM_STUDIO_HOST", "http://127.0.0.1:1234").rstrip("/")
        if not endpoint.startswith("http"):
            endpoint = f"http://{endpoint}"

        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                resp = await client.get(f"{endpoint}/v1/models")
                if resp.status_code == 200:
                    payload = resp.json()
                    data = payload.get("data", [])
                    models = [
                        m.get("id")
                        for m in data
                        if isinstance(m, dict) and m.get("id")
                    ]
                    if models:
                        def_m = models[0]
                        return [
                            DetectedProvider(
                                id="lmstudio-local",
                                name="LM Studio (Local)",
                                provider="custom",
                                source=f"Running service at {endpoint}",
                                base_url=f"{endpoint}/v1",
                                api_key="lm-studio",
                                models=models,
                                default_model=def_m,
                                adapter="custom",
                            )
                        ]
        except Exception:
            pass
        return []


# Pluggable detector registry
_REGISTRY: list[BaseDetector] = [
    OpenCodeDetector(),
    HermesDetector(),
    KiloCodeDetector(),
    EnvVarDetector(),
    OllamaDetector(),
    LMStudioDetector(),
]

_CACHED_DETECTIONS: dict[str, DetectedProvider] = {}


def register_detector(detector: BaseDetector) -> None:
    """Register a new custom detector."""
    _REGISTRY.append(detector)


async def scan_all_detectors() -> list[DetectedProvider]:
    """Execute all registered detectors concurrently and cache by ID."""
    global _CACHED_DETECTIONS
    detections: list[DetectedProvider] = []
    seen_ids: set[str] = set()

    for detector in _REGISTRY:
        try:
            found = await detector.detect()
            for item in found:
                if item.id not in seen_ids:
                    seen_ids.add(item.id)
                    detections.append(item)
                    _CACHED_DETECTIONS[item.id] = item
        except Exception as exc:
            log.warning("Detector %s failed: %s", detector.id, exc)

    return detections


def get_cached_detection(detection_id: str) -> DetectedProvider | None:
    """Retrieve a previously detected provider by its unique detection ID."""
    return _CACHED_DETECTIONS.get(detection_id)
