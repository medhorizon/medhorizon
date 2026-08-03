"""Phase 1 infrastructure tests."""

from __future__ import annotations

from backend.config import Settings, get_settings
from backend.services.auth import current_user
from fastapi import HTTPException


def test_health_loopback_ready(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["store"] in {"sqlite", "supabase"}
    assert get_settings().backend_host in {"127.0.0.1", "localhost"}


def test_idempotency_roundtrip(client):
    a = client.post("/api/graphs", json={"title": "P1", "idempotency_key": "phase1-key"}).json()
    b = client.post("/api/graphs", json={"title": "P1-other", "idempotency_key": "phase1-key"}).json()
    assert a["id"] == b["id"]


def test_production_requires_auth():
    try:
        current_user(authorization=None, settings=Settings(app_env="production"))
        assert False, "expected 401"
    except HTTPException as err:
        assert err.status_code == 401


def test_local_dev_bearer_requires_bypass():
    try:
        current_user(authorization="Bearer local-dev", settings=Settings(app_env="production"))
        assert False, "expected 401 without dev bypass"
    except HTTPException as err:
        assert err.status_code == 401


def test_local_dev_bearer_accepted_with_bypass():
    settings = Settings(app_env="production", research_graph_allow_dev_tokens=True)
    user = current_user(authorization="Bearer local-dev", settings=settings)
    assert user.id == settings.dev_user_id
    assert user.email == "dev@localhost"
