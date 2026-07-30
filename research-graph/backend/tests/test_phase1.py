"""Phase 1 infrastructure tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

os.environ["SQLITE_PATH"] = str(Path(tempfile.mkdtemp(prefix="rg-p1-")) / "t.db")
os.environ["DATA_DIR"] = str(Path(os.environ["SQLITE_PATH"]).parent)
os.environ["APP_ENV"] = "development"
os.environ["OPENAI_API_KEY"] = ""
os.environ["BACKEND_HOST"] = "127.0.0.1"

from backend.config import get_settings
from backend.db.sqlite import reset_store
from backend.main import app
from fastapi.testclient import TestClient

get_settings.cache_clear()
reset_store(os.environ["SQLITE_PATH"])
client = TestClient(app)


def test_health_loopback_ready():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["store"] in {"sqlite", "supabase"}
    assert get_settings().backend_host in {"127.0.0.1", "localhost"}


def test_idempotency_roundtrip():
    a = client.post("/api/graphs", json={"title": "P1", "idempotency_key": "phase1-key"}).json()
    b = client.post("/api/graphs", json={"title": "P1-other", "idempotency_key": "phase1-key"}).json()
    assert a["id"] == b["id"]


def test_production_requires_auth(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    # Recreate client settings dependency by clearing cache; auth reads settings per-request
    from backend import config

    config.get_settings.cache_clear()
    res = client.get("/api/graphs")
    # Depending on cached Settings object in Depends — force via header-less production settings
    from backend.services.auth import current_user
    from backend.config import Settings
    from fastapi import HTTPException

    try:
        current_user(authorization=None, settings=Settings(app_env="production"))
        assert False, "expected 401"
    except HTTPException as err:
        assert err.status_code == 401
