"""Sidecar capability contract tests — service identity, protocol, managed capability.

These exercise the real app and auth dependency (no mocks). The managed capability
stands in for the >=256-bit random value a parent supervisor generates per process.
"""

from __future__ import annotations

import jwt
import pytest
from fastapi import HTTPException

from backend.config import HEALTH_PROTOCOL_VERSION, SERVICE_NAME, SERVICE_VERSION, Settings
from backend.models.schemas import HealthOut
from backend.services.auth import DEV_TOKENS, current_user, managed_capability

CAP = "a" * 64  # stand-in for the parent's generated (>=256-bit) capability.
JWT_SECRET = "test-jwt-secret-for-contract-tests-012345"


def _jwt(sub: str = "user-123", secret: str = JWT_SECRET) -> str:
    return jwt.encode({"sub": sub, "email": f"{sub}@example.com"}, secret, algorithm="HS256")


def _no_medhorizon(monkeypatch, tmp_path):
    empty_mh = tmp_path / "no-medhorizon-config"
    empty_mh.mkdir(exist_ok=True)
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("MEDHORIZON_CONFIG_DIR", str(empty_mh))
    monkeypatch.delenv("MEDHORIZON_CONFIG", raising=False)


@pytest.fixture()
def managed_client(tmp_path, monkeypatch):
    """Research Graph in managed-sidecar mode with a configured capability."""
    _no_medhorizon(monkeypatch, tmp_path)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("RESEARCH_GRAPH_MANAGED_CAPABILITY", CAP)
    monkeypatch.setenv("RESEARCH_GRAPH_ALLOW_DEV_TOKENS", "0")

    from backend.config import refresh_settings
    from backend.db.sqlite import reset_store
    from backend.main import app
    from fastapi.testclient import TestClient

    refresh_settings()
    reset_store(str(tmp_path / "test.db"))
    return TestClient(app)


@pytest.fixture()
def deployed_client(tmp_path, monkeypatch):
    """Research Graph in deployed JWT mode with no managed capability."""
    _no_medhorizon(monkeypatch, tmp_path)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("RESEARCH_GRAPH_ALLOW_DEV_TOKENS", "0")
    monkeypatch.delenv("RESEARCH_GRAPH_MANAGED_CAPABILITY", raising=False)

    from backend.config import refresh_settings
    from backend.db.sqlite import reset_store
    from backend.main import app
    from fastapi.testclient import TestClient

    refresh_settings()
    reset_store(str(tmp_path / "test.db"))
    return TestClient(app)


# --------------------------------------------------------------------------- #
# Service identity / protocol contract
# --------------------------------------------------------------------------- #


def test_health_exposes_identity_fields(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"status", "service", "version", "protocol", "mode", "store", "openai"}
    assert body["status"] == "ok"
    assert body["service"] == "research-graph" == SERVICE_NAME
    assert body["version"] == SERVICE_VERSION
    assert body["protocol"] == 1
    assert isinstance(body["protocol"], int)


def test_protocol_is_documented_exact_match_integer():
    assert isinstance(HEALTH_PROTOCOL_VERSION, int)
    assert HEALTH_PROTOCOL_VERSION == 1
    # Schema field must stay an integer — the JSON wire type for the handshake.
    assert HealthOut.model_fields["protocol"].annotation is int
    # SERVICE_VERSION is the semantic version advertised by /health and the app.
    assert SERVICE_VERSION.count(".") == 2 and SERVICE_VERSION[0].isdigit()


# --------------------------------------------------------------------------- #
# Managed-sidecar mode: exact capability required on /health and protected APIs
# --------------------------------------------------------------------------- #


def test_managed_health_rejects_missing_capability(managed_client):
    assert managed_client.get("/health").status_code == 401


def test_managed_health_rejects_wrong_capability(managed_client):
    res = managed_client.get("/health", headers={"Authorization": "Bearer wrong-capability"})
    assert res.status_code == 401


def test_managed_health_accepts_exact_capability(managed_client):
    res = managed_client.get("/health", headers={"Authorization": f"Bearer {CAP}"})
    assert res.status_code == 200
    assert res.json()["service"] == "research-graph"
    assert res.json()["protocol"] == 1


def test_managed_api_rejects_missing_capability(managed_client):
    assert managed_client.post("/api/graphs", json={"title": "g"}).status_code == 401


def test_managed_api_rejects_wrong_capability(managed_client):
    res = managed_client.post(
        "/api/graphs",
        json={"title": "g"},
        headers={"Authorization": "Bearer wrong-capability"},
    )
    assert res.status_code == 401


def test_managed_api_accepts_exact_capability(managed_client):
    res = managed_client.post(
        "/api/graphs",
        json={"title": "managed"},
        headers={"Authorization": f"Bearer {CAP}"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "managed"


def test_jwt_cannot_satisfy_managed_capability():
    settings = Settings(
        app_env="production",
        supabase_jwt_secret=JWT_SECRET,
        research_graph_managed_capability=CAP,
    )
    valid = _jwt(secret=JWT_SECRET)
    assert valid != CAP
    try:
        current_user(authorization=f"Bearer {valid}", settings=settings)
        assert False, "expected 401: a valid JWT must not pass a capability check"
    except HTTPException as err:
        assert err.status_code == 401


# --------------------------------------------------------------------------- #
# Deployed JWT mode: /health unauthenticated, protected APIs need a JWT
# --------------------------------------------------------------------------- #


def test_deployed_health_stays_unauthenticated(deployed_client):
    assert deployed_client.get("/health").status_code == 200


def test_deployed_api_requires_jwt(deployed_client):
    assert deployed_client.post("/api/graphs", json={"title": "g"}).status_code == 401


def test_deployed_api_accepts_jwt(deployed_client):
    res = deployed_client.post(
        "/api/graphs",
        json={"title": "deployed"},
        headers={"Authorization": f"Bearer {_jwt()}"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "deployed"


def test_deployed_api_rejects_dev_token(deployed_client):
    res = deployed_client.post(
        "/api/graphs",
        json={"title": "g"},
        headers={"Authorization": "Bearer local-dev"},
    )
    assert res.status_code == 401


# --------------------------------------------------------------------------- #
# Fixed dev tokens / unauthenticated dev access: explicit bypass only
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("token", DEV_TOKENS)
def test_dev_tokens_rejected_without_bypass(token):
    settings = Settings(app_env="development", research_graph_allow_dev_tokens=False)
    try:
        current_user(authorization=f"Bearer {token}", settings=settings)
        assert False, "expected 401: dev token without explicit bypass"
    except HTTPException as err:
        assert err.status_code == 401


@pytest.mark.parametrize("token", DEV_TOKENS)
def test_dev_tokens_accepted_with_bypass(token):
    settings = Settings(app_env="production", research_graph_allow_dev_tokens=True)
    user = current_user(authorization=f"Bearer {token}", settings=settings)
    assert user.id == settings.dev_user_id
    assert user.email == "dev@localhost"


def test_unauthenticated_rejected_in_dev_without_bypass():
    settings = Settings(app_env="development", research_graph_allow_dev_tokens=False)
    try:
        current_user(authorization=None, settings=settings)
        assert False, "expected 401: no implicit non-production trust"
    except HTTPException as err:
        assert err.status_code == 401


def test_unauthenticated_accepted_in_dev_with_bypass():
    settings = Settings(app_env="development", research_graph_allow_dev_tokens=True)
    user = current_user(authorization=None, settings=settings)
    assert user.id == settings.dev_user_id


def test_managed_capability_dependency_noop_when_not_configured():
    assert managed_capability(authorization=None, settings=Settings(app_env="production")) is None
    assert managed_capability(authorization="Bearer whatever", settings=Settings(app_env="production")) is None
