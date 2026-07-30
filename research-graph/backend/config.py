"""Module settings — loaded from research-graph/.env only."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

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

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    dev_user_id: str = "00000000-0000-4000-8000-000000000001"

    medhorizon_server_url: str = "http://127.0.0.1:4096"
    medhorizon_atlas_bridge: str = "/api/atlas"
    medhorizon_web_origin: str = "http://127.0.0.1:4444"
    public_api_url: str = "http://127.0.0.1:8000"
    ui_url: str = "http://127.0.0.1:5173"
    gateway_url: str = "http://127.0.0.1:5199"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def openai_ready(self) -> bool:
        return bool(self.openai_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
