def test_ai_endpoints_require_key(client):
    g = client.post("/api/graphs", json={"title": "AI"}).json()
    n = client.post("/api/nodes", json={"graph_id": g["id"], "kind": "note", "title": "n", "content": "x"}).json()
    for path, body in [
        ("/api/ai/summarize", {"node_id": n["id"]}),
        ("/api/ai/chat", {"graph_id": g["id"], "message": "hi"}),
        ("/api/ai/generate-hypothesis", {"graph_id": g["id"], "prompt": "protein folding"}),
        ("/api/ai/suggest-links", {"graph_id": g["id"], "node_id": n["id"]}),
        ("/api/search/semantic", {"graph_id": g["id"], "query": "fold"}),
    ]:
        res = client.post(path, json=body)
        assert res.status_code == 503, path
        assert res.json()["detail"]["error"] == "OPENAI_UNAVAILABLE"
