"""Shared pytest fixtures — isolated SQLite per test module."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

TMP = tempfile.mkdtemp(prefix="rg-pytest-")
os.environ.setdefault("SQLITE_PATH", str(Path(TMP) / "shared.db"))
os.environ.setdefault("DATA_DIR", TMP)
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("OPENAI_API_KEY", "")
os.environ.setdefault("OPENAI_BASE_URL", "")
os.environ.setdefault("OPENAI_MODEL", "")
os.environ.setdefault("BACKEND_HOST", "127.0.0.1")
# Isolate from the developer's real MedHorizon config during tests.
os.environ.setdefault("MEDHORIZON_CONFIG_DIR", str(Path(TMP) / "no-medhorizon-config"))
# The dev client fixture simulates standalone development: dev identity is an
# explicit opt-in and the managed capability must never leak in from the shell.
os.environ.setdefault("RESEARCH_GRAPH_ALLOW_DEV_TOKENS", "0")
os.environ.pop("RESEARCH_GRAPH_MANAGED_CAPABILITY", None)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    empty_mh = tmp_path / "no-medhorizon-config"
    empty_mh.mkdir(exist_ok=True)
    monkeypatch.setenv("SQLITE_PATH", str(db))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("MEDHORIZON_CONFIG_DIR", str(empty_mh))
    monkeypatch.delenv("MEDHORIZON_CONFIG", raising=False)
    # Standalone development: dev identity requires the explicit bypass, and the
    # shared fixture is never in managed-sidecar mode.
    monkeypatch.setenv("RESEARCH_GRAPH_ALLOW_DEV_TOKENS", "1")
    monkeypatch.delenv("RESEARCH_GRAPH_MANAGED_CAPABILITY", raising=False)

    from backend.config import refresh_settings
    from backend.db.sqlite import reset_store
    from backend.main import app
    from fastapi.testclient import TestClient

    refresh_settings()
    reset_store(str(db))
    return TestClient(app)
