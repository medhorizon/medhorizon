"""MedHorizon → OpenAI config bridge — real temp jsonc, no business-logic mocks."""

from __future__ import annotations

from pathlib import Path

from backend.config import Settings, refresh_settings
from backend.services.medhorizon_openai import (
    clear_medhorizon_openai_cache,
    load_medhorizon_openai,
    parse_jsonc,
    resolve_openai,
)


SAMPLE = """
{
  // demo provider
  "model": "local-8317/claude-4.5-sonnet",
  "provider": {
    "local-8317": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local",
      "options": {
        "baseURL": "http://127.0.0.1:8317/v1",
        "apiKey": "sk-test-from-jsonc"
      },
      "models": {
        "claude-4.5-sonnet": { "name": "Sonnet" },
        "other-model": { "name": "Other" }
      }
    },
    "ignored": {
      "npm": "@ai-sdk/anthropic",
      "options": { "apiKey": "nope" }
    }
  },
}
"""


def test_strip_jsonc_comments_and_trailing_commas():
    data = parse_jsonc(SAMPLE)
    assert data["model"] == "local-8317/claude-4.5-sonnet"
    assert "local-8317" in data["provider"]


def test_load_medhorizon_openai_from_temp_jsonc(tmp_path: Path):
    path = tmp_path / "medhorizon.jsonc"
    path.write_text(SAMPLE, encoding="utf-8")
    clear_medhorizon_openai_cache()
    loaded = load_medhorizon_openai(config_path=str(path))
    assert loaded is not None
    assert loaded.api_key == "sk-test-from-jsonc"
    assert loaded.base_url == "http://127.0.0.1:8317/v1"
    assert loaded.model == "claude-4.5-sonnet"
    assert loaded.provider_id == "local-8317"
    assert loaded.source == "medhorizon"


def test_resolve_env_overrides_medhorizon(tmp_path: Path, monkeypatch):
    path = tmp_path / "medhorizon.jsonc"
    path.write_text(SAMPLE, encoding="utf-8")
    clear_medhorizon_openai_cache()
    monkeypatch.delenv("RESEARCH_GRAPH_PROVIDER", raising=False)

    resolved = resolve_openai(
        api_key="sk-env",
        base_url="https://api.example.com/v1",
        model="env-model",
        config_path=str(path),
        use_cache=False,
    )
    assert resolved.api_key == "sk-env"
    assert resolved.base_url == "https://api.example.com/v1"
    assert resolved.model == "env-model"

    inherited = resolve_openai(config_path=str(path), use_cache=False)
    assert inherited.api_key == "sk-test-from-jsonc"
    assert inherited.base_url == "http://127.0.0.1:8317/v1"
    assert inherited.model == "claude-4.5-sonnet"
    assert inherited.source == "medhorizon"


def test_settings_openai_ready_via_medhorizon(tmp_path: Path, monkeypatch):
    path = tmp_path / "medhorizon.jsonc"
    path.write_text(SAMPLE, encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("MEDHORIZON_CONFIG", str(path))
    monkeypatch.delenv("MEDHORIZON_CONFIG_DIR", raising=False)
    clear_medhorizon_openai_cache()
    refresh_settings()
    settings = Settings()
    assert settings.openai_ready is True
    assert settings.effective_openai_api_key == "sk-test-from-jsonc"
    assert settings.effective_openai_base_url == "http://127.0.0.1:8317/v1"
    assert settings.effective_openai_model == "claude-4.5-sonnet"


def test_health_openai_true_when_medhorizon_config(client, tmp_path, monkeypatch):
    path = tmp_path / "medhorizon.jsonc"
    path.write_text(SAMPLE, encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("MEDHORIZON_CONFIG", str(path))
    monkeypatch.delenv("MEDHORIZON_CONFIG_DIR", raising=False)
    refresh_settings()
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["openai"] is True


def test_expand_env_api_key(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MY_MH_KEY", "from-env-ref")
    path = tmp_path / "medhorizon.jsonc"
    path.write_text(
        """
        {
          "provider": {
            "p1": {
              "npm": "@ai-sdk/openai-compatible",
              "options": {
                "baseURL": "http://localhost:9/v1",
                "apiKey": "{env:MY_MH_KEY}"
              },
              "models": { "m1": {} }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    clear_medhorizon_openai_cache()
    loaded = load_medhorizon_openai(config_path=str(path))
    assert loaded is not None
    assert loaded.api_key == "from-env-ref"
