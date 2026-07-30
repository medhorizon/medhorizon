def test_markdown_import_export(client):
    g = client.post("/api/graphs", json={"title": "MD"}).json()
    n = client.post(
        "/api/nodes",
        json={"graph_id": g["id"], "kind": "hypothesis", "title": "H", "content": "body"},
    ).json()
    md = client.get(f"/api/nodes/{n['id']}/markdown").json()["markdown"]
    assert "kind: hypothesis" in md
    imported = client.post(
        f"/api/graphs/{g['id']}/import/markdown",
        json={"markdown": "---\nkind: evidence\ntitle: FromMD\n---\nObserved effect"},
    ).json()
    assert imported["kind"] == "evidence"
    assert imported["title"] == "FromMD"
