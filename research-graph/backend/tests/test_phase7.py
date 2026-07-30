def test_gepa_reproducible_two_generations_and_budget(client, tmp_path):
    g = client.post("/api/graphs", json={"title": "GEPA"}).json()
    exp = client.post(
        "/api/experiments",
        json={
            "graph_id": g["id"],
            "title": "opt",
            "objective": {"primary": "score"},
            "code_ref": {"argv": ["echo", "ok"], "worktree": str(tmp_path)},
            "budget": {"max_cost": 1},
        },
    ).json()
    client.post(f"/api/experiments/{exp['id']}/approve", json={})
    # first dry run so experiment is completed — gepa allows completed
    client.post(f"/api/experiments/{exp['id']}/runs", json={"dry_run": True, "seed": 1})

    def run_two(seed: int):
        gepa = client.post(
            "/api/gepa/runs",
            json={
                "experiment_id": exp["id"],
                "objective": {"primary": "score"},
                "budget": {"max_iterations": 3, "max_candidates": 3, "patience": 5},
                "seed": seed,
            },
        ).json()
        it1 = client.post(f"/api/gepa/runs/{gepa['id']}/iterations", json={}).json()
        assert it1["gate_required"] is True
        assert it1["run"]["status"] == "awaiting_gate"
        # pending candidates must not be applied yet
        assert all(c["decision"] != "applied" for c in it1["candidates"])
        selected1 = it1["run"]["current_candidate_id"]
        client.post(f"/api/gepa/runs/{gepa['id']}/approve", json={"reason": "gen1"})
        # start replay for gen2 continuity without wiping history
        gepa2 = client.post(f"/api/gepa/runs/{gepa['id']}/replay", json={}).json()
        it2 = client.post(
            f"/api/gepa/runs/{gepa2['id']}/iterations",
            json={"parent_candidate_id": selected1},
        ).json()
        return selected1, it1["candidates"], it2["candidates"], gepa["id"], gepa2["id"]

    s1a, c1a, c2a, id_a, id_a2 = run_two(11)
    s1b, c1b, c2b, id_b, id_b2 = run_two(11)
    # same seed → same selected program hashes at gen1
    hash_a = next(c["program_hash"] for c in c1a if c["id"] == s1a)
    hash_b = next(c["program_hash"] for c in c1b if c["id"] == s1b)
    assert hash_a == hash_b
    assert id_a != id_b  # history not overwritten

    # budget stop: max_iterations=1 then second iterate fails/stops
    gepa = client.post(
        "/api/gepa/runs",
        json={
            "experiment_id": exp["id"],
            "objective": {"primary": "score"},
            "budget": {"max_iterations": 1, "max_candidates": 2, "patience": 5},
            "seed": 99,
        },
    ).json()
    client.post(f"/api/gepa/runs/{gepa['id']}/iterations", json={})
    client.post(f"/api/gepa/runs/{gepa['id']}/approve", json={})
    # new run with max_iterations 1 — after one iteration, further iterate on same run should stop
    gepa3 = client.post(
        "/api/gepa/runs",
        json={
            "experiment_id": exp["id"],
            "objective": {"primary": "score"},
            "budget": {"max_iterations": 1, "max_candidates": 2, "patience": 5},
            "seed": 3,
        },
    ).json()
    first = client.post(f"/api/gepa/runs/{gepa3['id']}/iterations", json={}).json()
    assert first["gate_required"] is True
    # approve then iterate again should hit max_iterations
    client.post(f"/api/gepa/runs/{gepa3['id']}/approve", json={})
    # completed run cannot iterate
    again = client.post(f"/api/gepa/runs/{gepa3['id']}/iterations", json={})
    assert again.status_code == 400

    # cost report present in critic aggregate path
    detail = client.get(f"/api/gepa/runs/{gepa3['id']}").json()
    assert detail["iterations"]
    assert "best_primary" in (detail["iterations"][0].get("aggregate") or {})
