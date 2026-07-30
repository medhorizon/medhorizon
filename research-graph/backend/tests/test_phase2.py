"""Phase 2 — graph/node/edge CRUD, archive, revision, export, research chain."""

from __future__ import annotations

from backend.config import Settings
from backend.services.auth import current_user
from fastapi import HTTPException


def test_question_hypothesis_evidence_conclusion(client):
    g = client.post("/api/graphs", json={"title": "Chain", "idempotency_key": "c1"}).json()
    q = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "note", "title": "Question", "content": "Does X cause Y?"},
    ).json()
    h = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "hypothesis", "title": "H", "content": "X causes Y"},
    ).json()
    e = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "evidence", "title": "E", "content": "trial n=40"},
    ).json()
    c = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "conclusion", "title": "C", "content": "Supported"},
    ).json()
    client.post(
        "/api/edges",
        json={"graph_id": g["id"], "source_id": q["id"], "target_id": h["id"], "relation": "parent"},
    )
    client.post(
        "/api/edges",
        json={"graph_id": g["id"], "source_id": e["id"], "target_id": h["id"], "relation": "supports"},
    )
    client.post(
        "/api/edges",
        json={"graph_id": g["id"], "source_id": h["id"], "target_id": c["id"], "relation": "derives"},
    )
    tree = client.get(f"/api/graphs/{g['id']}/tree").json()
    assert len(tree["nodes"]) == 4
    assert len(tree["edges"]) == 3
    exported = client.get(f"/api/graphs/{g['id']}/export").json()
    assert "exported_at" in exported
    archived = client.post(f"/api/graphs/{g['id']}/archive", json={"reason": "done"}).json()
    assert archived["archived"] is True


def test_revision_conflict_and_idempotency(client):
    g = client.post("/api/graphs", json={"title": "Rev"}).json()
    n = client.post("/api/nodes", json={"graph_id": g["id"], "kind": "note", "title": "n1"}).json()
    ok = client.patch(f"/api/nodes/{n['id']}", json={"title": "n2", "expected_revision": 1}).json()
    assert ok["revision"] == 2
    bad = client.patch(f"/api/nodes/{n['id']}", json={"title": "n3", "expected_revision": 1})
    assert bad.status_code == 409
    a = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "note", "title": "dup", "idempotency_key": "n-dup"},
    ).json()
    b = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "note", "title": "dup2", "idempotency_key": "n-dup"},
    ).json()
    assert a["id"] == b["id"]


def test_auth_required_in_production():
    try:
        current_user(authorization=None, settings=Settings(app_env="production"))
        assert False
    except HTTPException as err:
        assert err.status_code == 401


def test_plugin_unavailable_contract():
    from backend.services.errors import unavailable

    payload = unavailable("connection refused")
    assert payload["error"] == "RESEARCH_GRAPH_UNAVAILABLE"
