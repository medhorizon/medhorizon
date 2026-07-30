"""Apply / verify local store schema (SQLite). Supabase uses supabase/schema.sql in SQL Editor."""

from __future__ import annotations

from backend.config import get_settings
from backend.db.sqlite import get_store


def main() -> None:
    settings = get_settings()
    store = get_store(settings.sqlite_path)
    tables = [
        r[0]
        for r in store.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    ]
    required = {
        "graphs",
        "nodes",
        "edges",
        "artifacts",
        "experiments",
        "experiment_runs",
        "gepa_runs",
        "gepa_iterations",
        "gepa_candidates",
        "provenance_events",
        "sync_outbox",
        "idempotency_keys",
    }
    missing = sorted(required - set(tables))
    if missing:
        raise SystemExit(f"migration incomplete, missing: {missing}")
    print(f"ok store={settings.sqlite_path} tables={len(tables)}")


if __name__ == "__main__":
    main()
