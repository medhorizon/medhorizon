"""Integration / sidebar-card contract tests."""

from __future__ import annotations


def test_manifest_contract(client):
    res = client.get("/integration/manifest")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "research-graph"
    assert body["medhorizon"]["modifies_core"] is False
    surfaces = {s["id"]: s for s in body["surfaces"]}
    assert "sidebar_card" in surfaces
    assert "atlas_sidebar" in body["plugin_tools"]


def test_sidebar_card_payload(client):
    g = client.post("/api/graphs", json={"title": "Sidebar Pilot", "reason": "test"}).json()
    client.post(
        "/api/experiments",
        json={"graph_id": g["id"], "title": "Exp A", "reason": "test"},
    )
    res = client.get("/integration/sidebar-card")
    assert res.status_code == 200
    card = res.json()
    assert card["kind"] == "sidebar_card"
    assert card["prominence"] == "featured"
    assert card["placement"] == "medhorizon.session_sidebar.top"
    assert card["metrics"]["graphs"] >= 1
    assert card["metrics"]["experiments"] >= 1
    assert card["latest_graph"]["title"] == "Sidebar Pilot"
    assert card["cta"]["href"]
    assert "sidebar-card.js" in card["embed"]["script"]


def test_embed_assets(client):
    js = client.get("/embed/sidebar-card.js")
    assert js.status_code == 200
    assert "rg-featured-card" in js.text
    css = client.get("/embed/sidebar-card.css")
    assert css.status_code == 200
    assert ".rg-featured-card" in css.text
    page = client.get("/embed/bookmarklet")
    assert page.status_code == 200
    assert "sidebar-card.js" in page.text
