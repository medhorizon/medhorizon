"""Module settings — loaded from research-graph/.env, with MedHorizon AI fallback."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.services.medhorizon_openai import OpenAIResolved, clear_medhorizon_openai_cache, resolve_openai

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4444,http://127.0.0.1:4444,"
        "http://localhost:4096,http://127.0.0.1:4096,"
        "http://localhost:5199,http://127.0.0.1:5199"
    )
    research_graph_mode: str = "local"  # local | atlas | hybrid
    data_dir: str = str(ROOT / "data")
    sqlite_path: str = str(ROOT / "data" / "research-graph.db")

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = "dev-jwt-secret-change-me"

    # Empty strings allow MedHorizon config fallback (see openai_resolved).
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = ""
    openai_embedding_model: str = ""

    # Optional MedHorizon provider bridge
    research_graph_provider: str = ""
    medhorizon_config: str = ""
    medhorizon_config_dir: str = ""
    openscience_config_dir: str = ""

    dev_user_id: str = "00000000-0000-4000-8000-000000000001"

    medhorizon_server_url: str = "http://127.0.0.1:4096"
    medhorizon_atlas_bridge: str = "/api/atlas"
    medhorizon_web_origin: str = "http://127.0.0.1:4444"
    public_api_url: str = "http://127.0.0.1:8000"
    ui_url: str = "http://127.0.0.1:8000"
    gateway_url: str = "http://127.0.0.1:5199"
    research_graph_ui_dir: str = ""

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def openai_resolved(self) -> OpenAIResolved:
        return resolve_openai(
            api_key=self.openai_api_key,
            base_url=self.openai_base_url,
            model=self.openai_model,
            embedding_model=self.openai_embedding_model,
            provider_id=self.research_graph_provider,
            config_path=self.medhorizon_config,
            config_dir=self.medhorizon_config_dir,
        )

    @property
    def openai_ready(self) -> bool:
        return bool(self.openai_resolved.api_key)

    @property
    def effective_openai_api_key(self) -> str:
        return self.openai_resolved.api_key

    @property
    def effective_openai_base_url(self) -> str:
        return self.openai_resolved.base_url

    @property
    def effective_openai_model(self) -> str:
        return self.openai_resolved.model

    @property
    def effective_openai_embedding_model(self) -> str:
        return self.openai_resolved.embedding_model

    @property
    def ui_dir(self) -> Path | None:
        raw = self.research_graph_ui_dir.strip()
        if raw:
            path = Path(raw)
            return path if path.is_dir() else None
        bundled = ROOT / "ui"
        return bundled if bundled.is_dir() else None


@lru_cache
def get_settings() -> Settings:
    return Settings()


def refresh_settings() -> Settings:
    """Drop Settings + MedHorizon OpenAI caches (e.g. after config change)."""
    clear_medhorizon_openai_cache()
    get_settings.cache_clear()
    return get_settings()
