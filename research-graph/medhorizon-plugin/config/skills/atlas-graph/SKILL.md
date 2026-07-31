---
name: atlas-graph
description: "Default local research memory: create/link hypotheses, evidence, literature, and conclusions in Research Graph. Prefer over Atlas cloud initialize-atlas-graph unless the user explicitly asks for Atlas."
category: research
---

# Research Graph — atlas-graph

## When

**Default** for the `research` agent at task start, and whenever the user wants hypotheses/evidence tracked as a graph. Prefer this over `initialize-atlas-graph` / Atlas cloud.

## Steps

1. Ensure sidecar is up (`atlas_graph` action `ui` or `list`). If `RESEARCH_GRAPH_UNAVAILABLE`, tell the user to start `research-graph` backend — then continue research in markdown (do not fall back to Atlas cloud unless asked).
2. Create or select a graph (`create` / `list` / `get`). Optionally `atlas_stage` `bind` this session to the graph.
3. For multi-phase work, call MedHorizon `stage` first — plugin auto-lands a node (`meta.medhorizon_stage`). Recover with `atlas_stage` `land` if needed.
4. Add nodes: question → hypothesis → evidence → conclusion. Use `edge` with `supports` / `contradicts` / `derives` / `references` / `parent`.
5. Pass `idempotency_key`, `reason`, and rely on session/message ids from the tool context.
6. Offer the UI URL `http://127.0.0.1:8000` (or Vite `http://127.0.0.1:5173`) for visualization.

Do not call Atlas HTTP APIs or `initialize-atlas-graph` unless the user explicitly wants Atlas cloud. Use `atlas_graph` / `atlas_stage` / `atlas_sync` for local RG.
