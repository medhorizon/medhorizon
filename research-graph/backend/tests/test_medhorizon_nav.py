"""Navigate / branch helpers for MedHorizon-linked stage nodes."""

from __future__ import annotations

from backend.services.medhorizon import dir_slug, session_url


def test_dir_slug_matches_medhorizon_style():
    assert dir_slug("/tmp/proj") == "L3RtcC9wcm9q"
    assert "+" not in dir_slug("/x/y")
    assert "/" not in dir_slug("/x/y")
    assert "=" not in dir_slug("/x/y")


def test_session_url():
    url = session_url("http://127.0.0.1:4444", "/tmp/proj", "ses_abc")
    assert url == "http://127.0.0.1:4444/L3RtcC9wcm9q/session/ses_abc"


def test_navigate_and_branch_endpoints(client):
    landed = client.post(
        "/api/stages/land",
        json={
            "session_id": "sess-nav",
            "message_id": "msg-1",
            "directory": "/tmp/proj",
            "stage": {
                "name": "Design",
                "index": 0,
                "part_id": "part-design",
                "status": "running",
            },
            "reason": "test",
        },
    ).json()
    assert landed["meta"]["medhorizon_stage"]["directory"] == "/tmp/proj"

    nav = client.get(f"/api/nodes/{landed['id']}/medhorizon")
    assert nav.status_code == 200, nav.text
    body = nav.json()
    assert body["can_open"] is True
    assert body["can_branch"] is True
    assert body["open_url"].endswith("/session/sess-nav")
    assert "L3RtcC9wcm9q" in body["open_url"]

    # MedHorizon not running in unit tests → 503 from proxy
    branched = client.post(
        f"/api/nodes/{landed['id']}/medhorizon/branch",
        json={"restore_files": True, "reason": "test"},
    )
    assert branched.status_code == 503


def test_navigate_requires_stage_meta(client):
    g = client.post("/api/graphs", json={"title": "plain"}).json()
    n = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "note", "title": "plain"},
    ).json()
    res = client.get(f"/api/nodes/{n['id']}/medhorizon")
    assert res.status_code == 404
