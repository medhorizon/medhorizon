---
name: atlas-graph
description: "Use the Research Graph module to create and link hypotheses, evidence, literature, and conclusions. Prefer when tracking research structure outside Atlas cloud."
category: research
---

# Research Graph — atlas-graph

## When

User asks to track a research question as a graph, add hypotheses/evidence, or open the module UI.

## Steps

1. Ensure sidecar is up (`atlas_graph` action `ui` or `list`). If `RESEARCH_GRAPH_UNAVAILABLE`, tell the user to start `research-graph` backend.
2. Create or select a graph (`create` / `list` / `get`).
3. Add nodes: question → hypothesis → evidence → conclusion. Use `edge` with `supports` / `contradicts` / `derives` / `references` / `parent`.
4. Pass `idempotency_key`, `reason`, and rely on session/message ids from the tool context.
5. Offer the UI URL `http://127.0.0.1:5173` for visualization.

Do not call Atlas HTTP APIs directly; use `atlas_graph` / `atlas_sync` only.
