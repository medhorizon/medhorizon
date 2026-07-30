# Research Graph (MedHorizon optional module)

Independent FastAPI + React + Supabase-schema module for research graphs, experiments, and GEPA loops.
**Does not modify MedHorizon source.** Connect via external config / plugin / skills.

**Version:** `0.3.6` (ships with MedHorizon v0.3.6 installers as an auto-started sidecar)

## Layout

```text
research-graph/
├── backend/              # FastAPI on 127.0.0.1:8000
├── frontend/             # Vite UI on 127.0.0.1:5173
├── sidecar/              # PyInstaller entry + build for release binary
├── medhorizon-plugin/    # Plugin, skills, agents, overlay config
├── supabase/schema.sql   # Postgres + RLS (+ experiment/GEPA tables)
├── .env.example
└── data/                 # local SQLite + artifacts (gitignored)
```

## Release sidecar (MedHorizon installers)

From v0.3.6, GitHub Releases ship a PyInstaller binary built via `sidecar/build.sh`
(or the Release workflow). Place `research-graph` / `research-graph.exe` next to
`medhorizon`; opening MedHorizon auto-starts it on `127.0.0.1:8000`.

```bash
./sidecar/build.sh   # produces sidecar/dist/research-graph[.exe]
```

Disable auto-start with `RESEARCH_GRAPH_DISABLE=1`.

## MedHorizon stage → node landing

When the Research Graph plugin overlay is enabled, entering a MedHorizon `stage`
auto-creates a mirror node (`meta.medhorizon_stage`). See
[`docs/STAGE_LANDING.md`](./docs/STAGE_LANDING.md).


```bash
cd research-graph
cp .env.example .env

# Backend (local SQLite if Supabase unset)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
PYTHONPATH=. backend/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000

# Frontend (other terminal)
cd frontend && npm install && npm run dev

# Optional: enable MedHorizon overlay (other terminal)
export OPENSCIENCE_CONFIG_DIR="$(pwd)/medhorizon-plugin/config"
export RESEARCH_GRAPH_API=http://127.0.0.1:8000
export RESEARCH_GRAPH_MODE=local
medhorizon web
```

Disable by unsetting those env vars — no MedHorizon rollback required.

## MedHorizon sidebar card (no core edits)

Research Graph exposes an **HTTP integration contract** and injects a featured
card into MedHorizon’s session sidebar **without modifying MedHorizon source**.

| Surface               | URL / command                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- |
| Card JSON             | `GET http://127.0.0.1:8000/integration/sidebar-card`                                  |
| Manifest              | `GET http://127.0.0.1:8000/integration/manifest`                                      |
| Embed script          | `GET http://127.0.0.1:8000/embed/sidebar-card.js`                                     |
| Bookmarklet           | `http://127.0.0.1:8000/embed/bookmarklet`                                             |
| Iframe card           | `http://127.0.0.1:5173/embed/card`                                                    |
| Gateway (recommended) | `python3 research-graph/scripts/medhorizon-gateway.py` → open `http://127.0.0.1:5199` |

Plugin tool: `atlas_sidebar` (`card` / `manifest` / `inject_hint`).

```bash
# With MedHorizon web already on :4444 and RG API on :8000
python3 research-graph/scripts/medhorizon-gateway.py
# or: bun research-graph/scripts/medhorizon-gateway.ts
# Session sidebar shows a prominent Research Graph card at the top
```

## Tests

```bash
cd research-graph
PYTHONPATH=. backend/.venv/bin/pytest backend/tests -q
```

## Modes

| Mode               | Behavior                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `local`            | Module SQLite/Supabase only                                                                                 |
| `atlas` / `hybrid` | Plugin may project summaries via existing MedHorizon `/api/atlas/*` bridge; full experiment/GEPA stay local |

## Usage guide (screenshots)

中文可视化使用说明（含启动方式、界面操作与预期结果截图）：

→ [`docs/USAGE.md`](docs/USAGE.md)

## Plan

See `docs/plans/research-graph-plan.md` in the MedHorizon repo (this module is the implementation).
