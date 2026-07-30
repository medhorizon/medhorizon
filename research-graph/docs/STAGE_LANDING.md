# Research Graph — Stage Landing Protocol

MedHorizon conversation **stages** stay in MedHorizon (`stage` tool / StagesPanel).
Research Graph stores a **mirror node** when a stage is entered.

## Open session / branch (graph UI)

| UI | Effect |
| -- | ------ |
| Double-click stage node | Opens MedHorizon session URL |
| Right-click → 打开对话 | Same |
| Right-click → 在此开分支 | Proxies `POST /session/{id}/stages/jump` (or `/fork`) then opens the forked session |

APIs: `GET /api/nodes/{id}/medhorizon`, `POST /api/nodes/{id}/medhorizon/branch`

Requires `directory` on the stage meta (plugin hook stores `PluginInput.directory`).

## Enable (v0.3.8+)

Research Graph **plugin is built into MedHorizon**. Opening `medhorizon web` /
`serve` with a sibling `research-graph` binary:

1. Starts the sidecar on `127.0.0.1:8000`
2. Loads `atlas_*` tools + stage auto-land hooks (no `OPENSCIENCE_CONFIG_DIR`)

Disable both with `RESEARCH_GRAPH_DISABLE=1`.

### Optional overlay (dev / custom skills)

```bash
export OPENSCIENCE_CONFIG_DIR=/absolute/path/to/research-graph/medhorizon-plugin/config
export RESEARCH_GRAPH_API=http://127.0.0.1:8000
export RESEARCH_GRAPH_MODE=local
# sidecar already auto-started with MedHorizon installers
medhorizon web
```

## How auto-landing works

```text
LLM calls MedHorizon `stage`
        │
        ▼
plugin hook tool.execute.after  (research-graph plugin)
        │
        ▼
POST /api/stages/land  →  node with meta.medhorizon_stage
```

- Idempotent key: `stage-land:{session_id}:{part_id}`
- On gate abort (`metadata.aborted`) the hook does **not** land
- Sequential stages get a `derives` edge between mirror nodes
- Optional: `POST /api/sessions/bind` pins a session to a graph

## LLM recovery tool

`atlas_stage` actions: `land` | `bind` | `list` | `protocol` | `get_bind`

## Contract

`GET /api/stages/protocol`
