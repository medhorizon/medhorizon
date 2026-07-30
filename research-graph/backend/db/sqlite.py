"""Local SQLite store mirroring the Supabase schema (dev / offline)."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid.uuid4())


SCHEMA = """
CREATE TABLE IF NOT EXISTS graphs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  hypothesis TEXT,
  summary TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'staged',
  outcome TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  embedding TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  graph_id TEXT,
  node_id TEXT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT,
  storage_path TEXT NOT NULL,
  size INTEGER,
  content_hash TEXT,
  manifest TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  hypothesis_node_id TEXT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '{}',
  dataset_refs TEXT NOT NULL DEFAULT '[]',
  code_ref TEXT NOT NULL DEFAULT '{}',
  parameters TEXT NOT NULL DEFAULT '{}',
  budget TEXT NOT NULL DEFAULT '{}',
  environment TEXT NOT NULL DEFAULT '{}',
  baseline TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_hash TEXT NOT NULL,
  seed INTEGER,
  provenance TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  exit_code INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  split TEXT,
  unit TEXT,
  evaluator TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gepa_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  budget TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_candidate_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gepa_iterations (
  id TEXT PRIMARY KEY,
  gepa_run_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  rollout_run_ids TEXT NOT NULL DEFAULT '[]',
  aggregate TEXT NOT NULL DEFAULT '{}',
  critic_report TEXT NOT NULL DEFAULT '{}',
  selected_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (gepa_run_id, generation)
);
CREATE TABLE IF NOT EXISTS gepa_candidates (
  id TEXT PRIMARY KEY,
  iteration_id TEXT NOT NULL,
  parent_id TEXT,
  program TEXT NOT NULL,
  program_hash TEXT NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}',
  constraints TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provenance_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  graph_id TEXT,
  session_id TEXT,
  message_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_graph_bindings (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  graph_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graphs_user ON graphs(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_graph ON nodes(graph_id);
CREATE INDEX IF NOT EXISTS idx_edges_graph ON edges(graph_id);
CREATE INDEX IF NOT EXISTS idx_experiments_graph_status ON experiments(graph_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_exp_status ON experiment_runs(experiment_id, status);
CREATE INDEX IF NOT EXISTS idx_provenance_session ON provenance_events(session_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status);
CREATE INDEX IF NOT EXISTS idx_session_bind ON session_graph_bindings(session_id);
"""

JSON_COLS = {
    "nodes": {"tags", "meta"},
    "edges": {"meta"},
    "artifacts": {"manifest"},
    "chat_history": {"citations"},
    "experiments": {"objective", "dataset_refs", "code_ref", "parameters", "budget", "environment", "baseline"},
    "experiment_runs": {"provenance"},
    "gepa_runs": {"objective", "budget"},
    "gepa_iterations": {"rollout_run_ids", "aggregate", "critic_report"},
    "gepa_candidates": {"program", "scores", "constraints"},
    "provenance_events": {"payload"},
    "sync_outbox": {"payload"},
    "idempotency_keys": {"response"},
}

BOOL_COLS = {"graphs": {"archived"}}


class Store:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = sqlite3.connect(self.path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def decode(self, table: str, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        for col in JSON_COLS.get(table, set()):
            if col in data and isinstance(data[col], str):
                data[col] = json.loads(data[col] or ("[]" if col.endswith("s") or col == "rollout_run_ids" else "{}"))
        for col in BOOL_COLS.get(table, set()):
            if col in data:
                data[col] = bool(data[col])
        if "embedding" in data and data["embedding"] is not None and isinstance(data["embedding"], str):
            data["embedding"] = json.loads(data["embedding"])
        return data

    def encode(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        for col in JSON_COLS.get(table, set()):
            if col in out and not isinstance(out[col], str):
                out[col] = json.dumps(out[col])
        for col in BOOL_COLS.get(table, set()):
            if col in out:
                out[col] = 1 if out[col] else 0
        if "embedding" in out and out["embedding"] is not None and not isinstance(out["embedding"], str):
            out["embedding"] = json.dumps(out["embedding"])
        return out

    def insert(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = self.encode(table, data)
        cols = list(payload.keys())
        placeholders = ",".join("?" for _ in cols)
        sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
        with self.connect() as conn:
            conn.execute(sql, [payload[c] for c in cols])
        return self.get(table, data["id"])  # type: ignore[return-value]

    def get(self, table: str, id: str, user_id: str | None = None) -> dict[str, Any] | None:
        sql = f"SELECT * FROM {table} WHERE id=?"
        args: list[Any] = [id]
        if user_id is not None and table not in {"run_metrics", "gepa_iterations", "gepa_candidates"}:
            sql += " AND user_id=?"
            args.append(user_id)
        with self.connect() as conn:
            row = conn.execute(sql, args).fetchone()
        return self.decode(table, row)

    def list(
        self,
        table: str,
        where: dict[str, Any] | None = None,
        order: str | None = None,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        args: list[Any] = []
        if user_id is not None and table not in {"run_metrics", "gepa_iterations", "gepa_candidates"}:
            clauses.append("user_id=?")
            args.append(user_id)
        for key, value in (where or {}).items():
            clauses.append(f"{key}=?")
            args.append(value)
        sql = f"SELECT * FROM {table}"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        if order:
            sql += f" ORDER BY {order}"
        with self.connect() as conn:
            rows = conn.execute(sql, args).fetchall()
        return [self.decode(table, r) for r in rows]  # type: ignore[misc]

    def update(self, table: str, id: str, patch: dict[str, Any], user_id: str | None = None) -> dict[str, Any] | None:
        if not patch:
            return self.get(table, id, user_id)
        payload = self.encode(table, patch)
        sets = ", ".join(f"{k}=?" for k in payload)
        args: list[Any] = list(payload.values()) + [id]
        sql = f"UPDATE {table} SET {sets} WHERE id=?"
        if user_id is not None and table not in {"run_metrics", "gepa_iterations", "gepa_candidates"}:
            sql += " AND user_id=?"
            args.append(user_id)
        with self.connect() as conn:
            conn.execute(sql, args)
        return self.get(table, id, user_id)

    def delete(self, table: str, id: str, user_id: str | None = None) -> bool:
        sql = f"DELETE FROM {table} WHERE id=?"
        args: list[Any] = [id]
        if user_id is not None:
            sql += " AND user_id=?"
            args.append(user_id)
        with self.connect() as conn:
            cur = conn.execute(sql, args)
            return cur.rowcount > 0

    def query(self, sql: str, args: list[Any] | tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(conn.execute(sql, args).fetchall())


_store: Store | None = None


def get_store(path: str | None = None) -> Store:
    global _store
    if _store is None:
        if path is None:
            from backend.config import get_settings

            path = get_settings().sqlite_path
        _store = Store(path)
    return _store


def reset_store(path: str) -> Store:
    global _store
    Path(path).unlink(missing_ok=True)
    _store = Store(path)
    return _store
