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
os.environ.setdefault("BACKEND_HOST", "127.0.0.1")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("SQLITE_PATH", str(db))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("OPENAI_API_KEY", "")

    from backend.config import get_settings
    from backend.db.sqlite import reset_store
    from backend.main import app
    from fastapi.testclient import TestClient

    get_settings.cache_clear()
    reset_store(str(db))
    return TestClient(app)
