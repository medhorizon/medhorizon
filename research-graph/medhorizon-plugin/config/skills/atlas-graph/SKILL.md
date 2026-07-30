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
2. Create or select a graph (`create` / `list` / `get`). Optionally `atlas_stage` `bind` this session to the graph.
3. For multi-phase work, call MedHorizon `stage` first — plugin auto-lands a node (`meta.medhorizon_stage`). Recover with `atlas_stage` `land` if needed.
4. Add nodes: question → hypothesis → evidence → conclusion. Use `edge` with `supports` / `contradicts` / `derives` / `references` / `parent`.
5. Pass `idempotency_key`, `reason`, and rely on session/message ids from the tool context.
6. Offer the UI URL `http://127.0.0.1:8000` for visualization.

Do not call Atlas HTTP APIs directly; use `atlas_graph` / `atlas_stage` / `atlas_sync` only.
