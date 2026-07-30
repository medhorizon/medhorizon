"""Frozen / production entry for the Research Graph sidecar binary."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _bundle_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


def main() -> None:
    root = _bundle_root()
    # Ensure backend package imports work when frozen or run from source.
    backend = root / "backend"
    if backend.is_dir() and str(root) not in sys.path:
        sys.path.insert(0, str(root))

    ui = root / "ui"
    if ui.is_dir():
        os.environ.setdefault("RESEARCH_GRAPH_UI_DIR", str(ui))

    data = Path(os.environ.get("RESEARCH_GRAPH_DATA", Path.home() / ".local" / "medhorizon" / "research-graph"))
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATA_DIR", str(data))
    os.environ.setdefault("SQLITE_PATH", str(data / "research-graph.db"))
    os.environ.setdefault("APP_ENV", os.environ.get("APP_ENV", "production"))
    os.environ.setdefault("BACKEND_HOST", "127.0.0.1")
    os.environ.setdefault("BACKEND_PORT", "8000")
    os.environ.setdefault("PUBLIC_API_URL", "http://127.0.0.1:8000")
    os.environ.setdefault("UI_URL", "http://127.0.0.1:8000")

    import uvicorn
    from backend.main import app

    host = os.environ.get("BACKEND_HOST", "127.0.0.1")
    port = int(os.environ.get("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
