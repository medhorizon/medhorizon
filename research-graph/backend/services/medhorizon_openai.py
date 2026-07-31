"""Resolve OpenAI-compatible credentials from MedHorizon / OpenScience config.

Precedence (per field, non-empty wins):
  1. Explicit Research Graph env: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, …
  2. MedHorizon/OpenScience user config (jsonc/json under XDG config dirs)
  3. Built-in defaults (OpenAI public base URL + gpt-4o-mini)

Does not modify MedHorizon source; only reads the user's config files.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"

_CONFIG_NAMES = (
    "medhorizon.jsonc",
    "medhorizon.json",
    "openscience.jsonc",
    "openscience.json",
    "synsc.jsonc",
    "synsc.json",
)

_COMPAT_NPM = (
    "@ai-sdk/openai-compatible",
    "@ai-sdk/openai",
    "@ai-sdk/azure",
)

_ENV_REF = re.compile(r"^\{env:([^}]+)\}$")
_LINE_COMMENT = re.compile(r"(?m)^\s*//.*?$")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


@dataclass(frozen=True)
class OpenAIResolved:
    api_key: str
    base_url: str
    model: str
    embedding_model: str
    source: str
    provider_id: str | None = None
    config_path: str | None = None


def strip_jsonc(text: str) -> str:
    """Strip // and /* */ comments plus trailing commas (JSONC → JSON)."""
    cleaned = _BLOCK_COMMENT.sub("", text)
    cleaned = _LINE_COMMENT.sub("", cleaned)
    return _TRAILING_COMMA.sub(r"\1", cleaned)


def parse_jsonc(text: str) -> dict[str, Any]:
    data = json.loads(strip_jsonc(text))
    return data if isinstance(data, dict) else {}


def expand_secret(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    match = _ENV_REF.match(text)
    if match:
        return os.environ.get(match.group(1), "").strip()
    return text


def _xdg_config_home() -> Path:
    raw = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if raw:
        return Path(raw)
    return Path.home() / ".config"


def candidate_config_dirs(
    *,
    config_path: str = "",
    config_dir: str = "",
) -> list[Path]:
    """Ordered dirs / files to search for MedHorizon provider config.

    Explicit MEDHORIZON_CONFIG / OPENSCIENCE_CONFIG / MEDHORIZON_CONFIG_DIR
    (or the matching function args) isolate the search to those paths only.
    OPENSCIENCE_CONFIG_DIR is not isolating — it is used elsewhere as a
    plugin overlay path and is only consulted among the default locations.
    """
    out: list[Path] = []
    seen: set[str] = set()

    def add(path: Path) -> None:
        key = str(path)
        if key in seen:
            return
        seen.add(key)
        out.append(path)

    exclusive: list[Path] = []
    for raw in (
        config_path,
        os.environ.get("MEDHORIZON_CONFIG", ""),
        os.environ.get("OPENSCIENCE_CONFIG", ""),
        config_dir,
        os.environ.get("MEDHORIZON_CONFIG_DIR", ""),
    ):
        text = (raw or "").strip()
        if text:
            exclusive.append(Path(text).expanduser())

    if exclusive:
        for path in exclusive:
            add(path)
        return out

    xdg = _xdg_config_home()
    for name in ("medhorizon", "openscience", "synsc"):
        add(xdg / name)
        add(Path.home() / f".{name}")

    local = os.environ.get("LOCALAPPDATA", "").strip()
    if local:
        for name in ("medhorizon", "openscience", "synsc"):
            add(Path(local) / name)

    for raw in (os.environ.get("OPENSCIENCE_CONFIG_DIR", ""),):
        text = (raw or "").strip()
        if text:
            add(Path(text).expanduser())

    return out


def find_config_file(
    *,
    config_path: str = "",
    config_dir: str = "",
) -> Path | None:
    for path in candidate_config_dirs(config_path=config_path, config_dir=config_dir):
        if path.is_file():
            if path.name in _CONFIG_NAMES or path.suffix in {".json", ".jsonc"}:
                return path
            continue
        if not path.is_dir():
            continue
        for name in _CONFIG_NAMES:
            candidate = path / name
            if candidate.is_file():
                return candidate
    return None


def _provider_options(info: dict[str, Any]) -> dict[str, Any]:
    opts = info.get("options")
    return opts if isinstance(opts, dict) else {}


def _provider_base_url(info: dict[str, Any]) -> str:
    opts = _provider_options(info)
    for key in ("baseURL", "baseUrl", "base_url"):
        value = expand_secret(opts.get(key) or info.get(key))
        if value:
            return value.rstrip("/")
    api = expand_secret(info.get("api"))
    if api.startswith("http://") or api.startswith("https://"):
        return api.rstrip("/")
    return ""


def _provider_api_key(info: dict[str, Any]) -> str:
    opts = _provider_options(info)
    for key in ("apiKey", "api_key"):
        value = expand_secret(opts.get(key) or info.get(key))
        if value:
            return value
    return ""


def _is_openai_compatible(pid: str, info: dict[str, Any]) -> bool:
    npm = str(info.get("npm") or "")
    if any(token in npm for token in _COMPAT_NPM):
        return True
    if pid in {"openai", "azure", "openrouter", "together", "groq", "deepseek", "mistral"}:
        return True
    # Custom local OpenAI-compatible gateways often only set options.baseURL + apiKey.
    return bool(_provider_base_url(info) and _provider_api_key(info))


def _first_model(info: dict[str, Any]) -> str:
    models = info.get("models")
    if isinstance(models, dict) and models:
        return str(next(iter(models.keys())))
    if isinstance(models, list) and models:
        first = models[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict) and first.get("id"):
            return str(first["id"])
    return ""


def _split_model_ref(raw: str) -> tuple[str | None, str]:
    text = (raw or "").strip()
    if not text:
        return None, ""
    if "/" in text:
        provider, model = text.split("/", 1)
        return provider.strip() or None, model.strip()
    return None, text


def pick_provider(
    data: dict[str, Any],
    *,
    provider_id: str = "",
) -> tuple[str, dict[str, Any]] | None:
    providers = data.get("provider")
    if not isinstance(providers, dict) or not providers:
        return None

    preferred = (provider_id or "").strip()
    if not preferred:
        preferred = (
            os.environ.get("RESEARCH_GRAPH_PROVIDER", "")
            or os.environ.get("MEDHORIZON_PROVIDER", "")
            or ""
        ).strip()
    if not preferred:
        model_provider, _ = _split_model_ref(str(data.get("model") or ""))
        preferred = model_provider or ""

    if preferred and preferred in providers and isinstance(providers[preferred], dict):
        info = providers[preferred]
        if _is_openai_compatible(preferred, info) and _provider_api_key(info):
            return preferred, info

    npm_hit: tuple[str, dict[str, Any]] | None = None
    any_hit: tuple[str, dict[str, Any]] | None = None
    for pid, info in providers.items():
        if not isinstance(info, dict):
            continue
        if not _is_openai_compatible(pid, info) or not _provider_api_key(info):
            continue
        npm = str(info.get("npm") or "")
        if npm_hit is None and any(token in npm for token in _COMPAT_NPM):
            npm_hit = (pid, info)
        if any_hit is None:
            any_hit = (pid, info)
    return npm_hit or any_hit


def _model_for_provider(data: dict[str, Any], pid: str, info: dict[str, Any]) -> str:
    top_provider, top_model = _split_model_ref(str(data.get("model") or ""))
    if top_model and (top_provider is None or top_provider == pid):
        return top_model
    return _first_model(info) or DEFAULT_MODEL


def load_medhorizon_openai(
    *,
    config_path: str = "",
    config_dir: str = "",
    provider_id: str = "",
) -> OpenAIResolved | None:
    path = find_config_file(config_path=config_path, config_dir=config_dir)
    if path is None:
        return None
    data = parse_jsonc(path.read_text(encoding="utf-8"))
    picked = pick_provider(data, provider_id=provider_id)
    if picked is None:
        return None
    pid, info = picked
    key = _provider_api_key(info)
    if not key:
        return None
    base = _provider_base_url(info) or DEFAULT_BASE_URL
    model = _model_for_provider(data, pid, info)
    return OpenAIResolved(
        api_key=key,
        base_url=base,
        model=model,
        embedding_model=DEFAULT_EMBEDDING_MODEL,
        source="medhorizon",
        provider_id=pid,
        config_path=str(path),
    )


@lru_cache(maxsize=8)
def _cached_load(config_path: str, config_dir: str, provider_id: str) -> OpenAIResolved | None:
    return load_medhorizon_openai(
        config_path=config_path,
        config_dir=config_dir,
        provider_id=provider_id,
    )


def clear_medhorizon_openai_cache() -> None:
    _cached_load.cache_clear()


def _label_source(*, env_key: str, env_base: str, env_model: str, mh: OpenAIResolved | None, key: str) -> str:
    if not key:
        return "none"
    used_env = bool(env_key or env_base or env_model)
    used_mh = bool(mh)
    if used_env and used_mh and not env_key:
        return "mixed"
    if env_key and used_mh and (not env_base or not env_model):
        return "mixed"
    if env_key and not used_mh:
        return "env"
    if used_mh and not env_key:
        return "medhorizon" if not (env_base or env_model) else "mixed"
    if env_key:
        return "env"
    return "medhorizon" if used_mh else "none"


def resolve_openai(
    *,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
    embedding_model: str = "",
    provider_id: str = "",
    config_path: str = "",
    config_dir: str = "",
    use_cache: bool = True,
) -> OpenAIResolved:
    """Merge env-style fields with MedHorizon config.

    Field precedence: non-empty explicit arg → MedHorizon → default.
    """
    mh = (
        _cached_load(config_path or "", config_dir or "", provider_id or "")
        if use_cache
        else load_medhorizon_openai(
            config_path=config_path,
            config_dir=config_dir,
            provider_id=provider_id,
        )
    )

    env_key = (api_key or "").strip()
    env_base = (base_url or "").strip().rstrip("/")
    env_model = (model or "").strip()
    env_embed = (embedding_model or "").strip()

    key = env_key or (mh.api_key if mh else "")
    resolved_base = env_base or (mh.base_url if mh else "") or DEFAULT_BASE_URL
    resolved_model = env_model or (mh.model if mh else "") or DEFAULT_MODEL
    resolved_embed = env_embed or DEFAULT_EMBEDDING_MODEL
    source = _label_source(env_key=env_key, env_base=env_base, env_model=env_model, mh=mh, key=key)

    return OpenAIResolved(
        api_key=key,
        base_url=resolved_base,
        model=resolved_model,
        embedding_model=resolved_embed,
        source=source,
        provider_id=None if env_key else (mh.provider_id if mh else None),
        config_path=mh.config_path if mh else None,
    )
