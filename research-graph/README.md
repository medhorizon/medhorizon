# Research Graph (MedHorizon optional module)

Independent FastAPI + React + Supabase-schema module for research graphs, experiments, and GEPA loops.
**Does not modify MedHorizon source.** Connect via external config / plugin / skills.

**Version:** `0.3.0` (ships with MedHorizon v0.3.0)

## Layout

```text
research-graph/
├── backend/              # FastAPI on 127.0.0.1:8000
├── frontend/             # Vite UI on 127.0.0.1:5173
├── medhorizon-plugin/    # Plugin, skills, agents, overlay config
├── supabase/schema.sql   # Postgres + RLS (+ experiment/GEPA tables)
├── .env.example
└── data/                 # local SQLite + artifacts (gitignored)
```

## Quick start

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

## Tests

```bash
cd research-graph
PYTHONPATH=. backend/.venv/bin/pytest backend/tests -q
```

## Modes

| Mode | Behavior |
|------|----------|
| `local` | Module SQLite/Supabase only |
| `atlas` / `hybrid` | Plugin may project summaries via existing MedHorizon `/api/atlas/*` bridge; full experiment/GEPA stay local |

## Usage guide (screenshots)

中文可视化使用说明（含启动方式、界面操作与预期结果截图）：

→ [`docs/USAGE.md`](docs/USAGE.md)

## Plan

See `docs/plans/research-graph-plan.md` in the MedHorizon repo (this module is the implementation).
