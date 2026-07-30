"""API tests against local SQLite — no mocks of business logic."""

from __future__ import annotations


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["store"] == "sqlite"


def test_graph_node_edge_flow(client):
    g = client.post("/api/graphs", json={"title": "Demo", "idempotency_key": "g1", "reason": "test"}).json()
    assert g["title"] == "Demo"
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


def test_experiment_dry_run_and_gepa_gate(client, tmp_path):
    g = client.post("/api/graphs", json={"title": "Exp"}).json()
    h = client.post("/api/nodes", json={"graph_id": g["id"], "kind": "hypothesis", "title": "H"}).json()
    exp = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "hypothesis_node_id": h["id"],
            "title": "baseline",
            "objective": {"primary": "accuracy"},
            "code_ref": {"argv": ["echo", "ok"], "worktree": str(tmp_path)},
            "budget": {"max_cost": 1},
        },
    ).json()
    assert exp["status"] == "draft"

    bad = client.post(f"/api/experiments/{exp['id']}/runs", json={"dry_run": True})
    assert bad.status_code == 400

    approved = client.post(f"/api/experiments/{exp['id']}/approve", json={"reason": "ok"}).json()
    assert approved["status"] == "approved"

    run = client.post(f"/api/experiments/{exp['id']}/runs", json={"dry_run": True, "seed": 1}).json()
    assert run["status"] == "succeeded"

    exp2 = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "title": "inject",
            "code_ref": {"argv": ["echo", "a;rm"], "worktree": str(tmp_path)},
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
    assert it1["run"]["current_candidate_id"]

    detail = client.get(f"/api/gepa/runs/{gepa['id']}").json()
    assert detail["run"]["status"] == "awaiting_gate"

    approved_gepa = client.post(f"/api/gepa/runs/{gepa['id']}/approve", json={"reason": "ship"}).json()
    assert approved_gepa["status"] == "completed"

    replay = client.post(f"/api/gepa/runs/{gepa['id']}/replay", json={}).json()
    assert replay["id"] != gepa["id"]
    assert replay["seed"] == gepa["seed"]


def test_ai_without_key(client):
    g = client.post("/api/graphs", json={"title": "AI"}).json()
    res = client.post("/api/ai/chat", json={"graph_id": g["id"], "message": "hi"})
    assert res.status_code == 503
    assert res.json()["detail"]["error"] == "OPENAI_UNAVAILABLE"
