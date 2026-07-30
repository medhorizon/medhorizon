---
name: atlas-stage
description: "Land MedHorizon session stages onto Research Graph nodes. Use when entering research/experiment/GEPA phases with the stage tool, or when stage nodes are missing after a phase change."
category: research
---

# Research Graph — atlas-stage

## Protocol

MedHorizon `stage` remains the **source of truth** for conversation phases.
Research Graph stores a **mirror node** per stage enter under `meta.medhorizon_stage`.

Contract: `GET http://127.0.0.1:8000/api/stages/protocol`

## Auto path (preferred)

1. Call MedHorizon `stage` (name / summary / gate as usual).
2. Plugin hook `tool.execute.after` lands a node automatically (idempotent).
3. Do **not** land again if the hook succeeded.

## Manual / recovery path

If sidecar was down or landing failed:

```
atlas_stage action=land stage_name="<same as stage>" stage_index=<n> part_id=<from stage metadata>
```

Optional: `atlas_stage action=bind graph_id=<uuid>` to pin this session to a graph.

## Open session / branch from the graph UI

Stage-linked nodes store `meta.medhorizon_stage.{session_id,part_id,directory}`.

| UI | Action |
| -- | ------ |
| Double-click node | Open MedHorizon session (`GET /api/nodes/{id}/medhorizon` → `open_url`) |
| Right-click → 打开对话 | Same |
| Right-click → 在此开分支 | `POST /api/nodes/{id}/medhorizon/branch` → MedHorizon `stages/jump` / `fork`, then open new session |

MedHorizon has no message-level deep link; open lands on the session. Branch forks at the stage boundary (original session kept).

## Rules

- On `stage` gate abort (`metadata.aborted`), do **not** create a node.
- Idempotency key: `stage-land:{session_id}:{part_id}`.
- Kind hints: Design/Baseline→note, Execute→experiment, Select→insight, Report→conclusion.
- Never invent a second stage timeline in the graph DB.
