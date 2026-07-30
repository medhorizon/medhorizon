"""Checkpoint — mode / offline / auth / sync recovery."""

from __future__ import annotations

from backend.config import Settings
from backend.services.auth import current_user
from backend.services.errors import unavailable
from fastapi import HTTPException


def test_modes_capability(client, monkeypatch):
    for mode in ("local", "atlas", "hybrid"):
        monkeypatch.setenv("RESEARCH_GRAPH_MODE", mode)
        from backend.config import get_settings

        get_settings.cache_clear()
        # health uses cached settings from app startup — capability reads get_settings each call via Depends
        cap = client.get("/api/sync/capability").json()
        assert "supports" in cap


def test_offline_unavailable_contract():
    payload = unavailable("connection refused")
    assert payload["error"] == "RESEARCH_GRAPH_UNAVAILABLE"


def test_401_production():
    try:
        current_user(authorization=None, settings=Settings(app_env="production"))
        assert False
    except HTTPException as err:
        assert err.status_code == 401


def test_partial_sync_recovery(client):
    g = client.post("/api/graphs", json={"title": "sync"}).json()
    a = client.post(
        "/api/artifacts/upload",
        files={"file": ("a.txt", b"payload-one", "text/plain")},
        data={"graph_id": g["id"]},
    ).json()
    outbox = client.get("/api/sync/outbox?status=pending").json()
    assert outbox
    item = outbox[0]
    # simulate failed attempt then recovery
    from backend.db.sqlite import get_store
    from backend.config import get_settings

    store = get_store(get_settings().sqlite_path)
    store.update("sync_outbox", item["id"], {"status": "failed", "last_error": "5xx", "attempts": 1})
    failed = client.get("/api/sync/outbox?status=failed").json()
    assert any(o["id"] == item["id"] for o in failed)
    sent = client.post(f"/api/sync/outbox/{item['id']}/retry").json()
    assert sent["status"] == "sent"
    # re-upload same bytes does not duplicate artifact
    b = client.post(
        "/api/artifacts/upload",
        files={"file": ("a.txt", b"payload-one", "text/plain")},
        data={"graph_id": g["id"]},
    ).json()
    assert a["id"] == b["id"]


def test_core_medhorizon_untouched():
    """Allow only the Research Graph sidecar auto-start wiring under backend/cli."""
    import subprocess

    out = subprocess.check_output(
        ["git", "diff", "main", "--name-only", "--", "backend/", "frontend/", "tooling/"],
        cwd="/workspace",
        text=True,
    ).strip()
    allowed = {
        "backend/cli/src/cli/cmd/serve.ts",
        "backend/cli/src/cli/cmd/web.ts",
        "backend/cli/src/sidecar/research-graph.ts",
        "backend/cli/src/plugin/index.ts",
        "backend/cli/src/plugin/research-graph.ts",
        "backend/cli/src/index.ts",
    }
    unexpected = [line for line in out.splitlines() if line and line not in allowed]
    assert unexpected == [], f"unexpected core diffs:\n{chr(10).join(unexpected)}"
