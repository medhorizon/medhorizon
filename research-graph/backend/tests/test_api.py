"""API tests against local SQLite — no mocks of business logic."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Point store at a temp DB before importing app
TMP = tempfile.mkdtemp(prefix="rg-test-")
os.environ["SQLITE_PATH"] = str(Path(TMP) / "test.db")
os.environ["DATA_DIR"] = TMP
os.environ["APP_ENV"] = "development"
os.environ["OPENAI_API_KEY"] = ""

from backend.config import get_settings
from backend.db.sqlite import reset_store
from backend.main import app

get_settings.cache_clear()
reset_store(os.environ["SQLITE_PATH"])
client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db():
    get_settings.cache_clear()
    reset_store(os.environ["SQLITE_PATH"])
    yield


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["store"] == "sqlite"


def test_graph_node_edge_flow():
    g = client.post("/api/graphs", json={"title": "Demo", "idempotency_key": "g1", "reason": "test"}).json()
    assert g["title"] == "Demo"
    # idempotent replay
    g2 = client.post("/api/graphs", json={"title": "Demo", "idempotency_key": "g1", "reason": "test"}).json()
    assert g2["id"] == g["id"]

    h = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "hypothesis", "title": "H1", "content": "x causes y"},
    ).json()
    evi = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "evidence", "title": "E1", "content": "data"},
    ).json()
    edge = client.post(
        "/api/edges",
        json={"graph_id": g["id"], "source_id": evi["id"], "target_id": h["id"], "relation": "supports"},
    ).json()
    assert edge["relation"] == "supports"
    tree = client.get(f"/api/graphs/{g['id']}/tree").json()
    assert len(tree["nodes"]) == 2
    assert len(tree["edges"]) == 1


def test_experiment_dry_run_and_gepa_gate():
    g = client.post("/api/graphs", json={"title": "Exp"}).json()
    h = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "hypothesis", "title": "H"},
    ).json()
    exp = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "hypothesis_node_id": h["id"],
            "title": "baseline",
            "objective": {"primary": "accuracy"},
            "code_ref": {"argv": ["echo", "ok"], "worktree": TMP},
            "budget": {"max_cost": 1},
        },
    ).json()
    assert exp["status"] == "draft"

    # Cannot run before approve
    bad = client.post(f"/api/experiments/{exp['id']}/runs", json={"dry_run": True})
    assert bad.status_code == 400

    approved = client.post(f"/api/experiments/{exp['id']}/approve", json={"reason": "ok"}).json()
    assert approved["status"] == "approved"

    run = client.post(f"/api/experiments/{exp['id']}/runs", json={"dry_run": True, "seed": 1}).json()
    assert run["status"] == "succeeded"

    # Shell injection rejected
    client.patch(
        f"/api/experiments/{exp['id']}",
        json={"code_ref": {"argv": ["echo", "a; rm -rf /"], "worktree": TMP}},
    )
    # re-approve path: failed/draft only — force draft
    # After completed, edit blocked — create new experiment for injection test
    exp2 = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "title": "inject",
            "code_ref": {"argv": ["echo", "a;rm"], "worktree": TMP},
        },
    ).json()
    client.post(f"/api/experiments/{exp2['id']}/approve", json={})
    inj = client.post(f"/api/experiments/{exp2['id']}/runs", json={"dry_run": False})
    assert inj.status_code == 400

    gepa = client.post(
        "/api/gepa/runs",
        json={
            "experiment_id": exp["id"],
            "objective": {"primary": "accuracy"},
            "budget": {"max_iterations": 3, "max_candidates": 3, "patience": 2},
            "seed": 7,
        },
    ).json()
    it1 = client.post(f"/api/gepa/runs/{gepa['id']}/iterations", json={}).json()
    assert it1["gate_required"] is True
    assert it1["run"]["status"] == "awaiting_gate"
    selected = it1["run"]["current_candidate_id"]
    assert selected

    # Unapproved candidate must not be applied — still awaiting until approve
    detail = client.get(f"/api/gepa/runs/{gepa['id']}").json()
    assert detail["run"]["status"] == "awaiting_gate"

    approved_gepa = client.post(f"/api/gepa/runs/{gepa['id']}/approve", json={"reason": "ship"}).json()
    assert approved_gepa["status"] == "completed"

    # Replay preserves history
    replay = client.post(f"/api/gepa/runs/{gepa['id']}/replay", json={}).json()
    assert replay["id"] != gepa["id"]
    assert replay["seed"] == gepa["seed"]


def test_ai_without_key():
    g = client.post("/api/graphs", json={"title": "AI"}).json()
    res = client.post("/api/ai/chat", json={"graph_id": g["id"], "message": "hi"})
    assert res.status_code == 503
    assert res.json()["detail"]["error"] == "OPENAI_UNAVAILABLE"
