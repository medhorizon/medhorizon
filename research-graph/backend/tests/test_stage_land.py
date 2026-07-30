"""Tests for MedHorizon stage → Research Graph node landing protocol."""

from __future__ import annotations


def test_protocol_shape(client):
    res = client.get("/api/stages/protocol")
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == 1
    assert body["node_link"] == "nodes.meta.medhorizon_stage"
    assert "land" in body["endpoints"]


def test_land_creates_node_and_is_idempotent(client):
    landed = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-1",
            "message_id": "msg-1",
            "stage": {
                "name": "Design",
                "index": 0,
                "part_id": "part-design",
                "status": "running",
                "summary": "freeze objective",
                "gated": True,
            },
            "idempotency_key": "stage-land:sess-1:part-design",
            "reason": "test",
        },
    )
    assert landed.status_code == 200, landed.text
    node = landed.json()
    assert node["kind"] == "note"
    assert node["title"].startswith("Stage 0:")
    assert node["meta"]["medhorizon_stage"]["name"] == "Design"
    assert node["meta"]["medhorizon_stage"]["part_id"] == "part-design"
    assert "medhorizon_stage" in node["tags"]

    again = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-1",
            "message_id": "msg-1",
            "stage": {"name": "Design", "index": 0, "part_id": "part-design"},
            "idempotency_key": "stage-land:sess-1:part-design",
        },
    )
    assert again.status_code == 200
    assert again.json()["id"] == node["id"]

    listed = client.get("/api/stages/by-session?session_id=sess-1")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_bind_session_and_land_on_bound_graph(client):
    g = client.post("/api/graphs", json={"title": "Bound graph", "reason": "test"}).json()
    bind = client.post(
        "/api/sessions/bind",
        json={"session_id": "sess-bind", "graph_id": g["id"], "reason": "pin"},
    )
    assert bind.status_code == 200
    assert bind.json()["graph_id"] == g["id"]

    got = client.get("/api/sessions/bind?session_id=sess-bind")
    assert got.json()["graph_id"] == g["id"]

    node = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-bind",
            "stage": {"name": "Report", "index": 2, "part_id": "part-report"},
            "reason": "test",
        },
    ).json()
    assert node["graph_id"] == g["id"]
    assert node["kind"] == "conclusion"


def test_stage_sequence_edge(client):
    a = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-seq",
            "stage": {"name": "Baseline", "index": 0, "part_id": "p0"},
        },
    ).json()
    b = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-seq",
            "stage": {"name": "Execute", "index": 1, "part_id": "p1"},
        },
    ).json()
    assert a["graph_id"] == b["graph_id"]
    assert b["kind"] == "experiment"
    tree = client.get(f"/api/graphs/{b['graph_id']}/tree").json()
    edges = tree["edges"]
    assert any(e["source_id"] == a["id"] and e["target_id"] == b["id"] and e["relation"] == "derives" for e in edges)


def test_kind_hints():
    from backend.services.stage_map import suggest_kind

    assert suggest_kind("Select/apply") == "insight"
    assert suggest_kind("Report") == "conclusion"
    assert suggest_kind("Random phase") == "note"
