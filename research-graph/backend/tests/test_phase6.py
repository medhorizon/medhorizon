def test_hypothesis_to_result_node(client, tmp_path):
    g = client.post("/api/graphs", json={"title": "P6"}).json()
    h = client.post("/api/nodes", json={"graph_id": g["id"], "kind": "hypothesis", "title": "H"}).json()
    exp = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "hypothesis_node_id": h["id"],
            "title": "spec",
            "objective": {"primary": "acc"},
            "dataset_refs": [{"path": "data/train.json", "hash": "abc"}],
            "code_ref": {"argv": ["echo", "ok"], "worktree": str(tmp_path)},
            "parameters": {"lr": 1e-3},
            "budget": {"max_cost": 1},
            "environment": {"python": "3.12"},
            "baseline": {"metric": 0.5},
        },
    ).json()
    assert exp["environment"]["python"] == "3.12"
    assert exp["baseline"]["metric"] == 0.5
    client.post(f"/api/experiments/{exp['id']}/approve", json={"reason": "design-ok"})
    run = client.post(
        f"/api/experiments/{exp['id']}/runs",
        json={"dry_run": True, "seed": 3, "session_id": "s1", "message_id": "m1", "reason": "baseline"},
    ).json()
    assert run["status"] == "succeeded"
    assert run["provenance"]["session_id"] == "s1"
    assert run.get("result_node_id")
    tree = client.get(f"/api/graphs/{g['id']}/tree").json()
    assert any(n["id"] == run["result_node_id"] for n in tree["nodes"])

    # Outside worktree absolute binary rejected
    exp2 = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "title": "badpath",
            "code_ref": {"argv": ["/usr/bin/echo", "x"], "worktree": str(tmp_path)},
        },
    ).json()
    client.post(f"/api/experiments/{exp2['id']}/approve", json={})
    bad = client.post(f"/api/experiments/{exp2['id']}/runs", json={"dry_run": False})
    assert bad.status_code == 400
