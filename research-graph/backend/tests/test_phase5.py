def test_artifact_upload_download_and_dedupe(client):
    g = client.post("/api/graphs", json={"title": "Art"}).json()
    files = {"file": ("note.txt", b"hello research", "text/plain")}
    data = {"graph_id": g["id"]}
    a = client.post("/api/artifacts/upload", files=files, data=data).json()
    assert a["content_hash"]
    b = client.post("/api/artifacts/upload", files=files, data=data).json()
    assert a["id"] == b["id"]
    outbox = client.get("/api/sync/outbox").json()
    assert len([o for o in outbox if o["entity_id"] == a["id"]]) == 1
    dl = client.get(f"/api/artifacts/{a['id']}/download")
    assert dl.status_code == 200
    assert dl.content == b"hello research"
    retried = client.post(f"/api/sync/outbox/{outbox[0]['id']}/retry").json()
    assert retried["status"] == "sent"
