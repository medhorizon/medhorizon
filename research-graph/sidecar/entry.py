"""Frozen / production entry for the Research Graph sidecar binary.

Binds an OS-selected loopback port (race-free: the socket is bound before any
import), derives the public API/UI origins from the selected port BEFORE the
FastAPI app is imported (so ``get_settings()`` — lru-cached at import time —
freezes the correct origins), emits exactly one newline-delimited JSON
discovery record on stdout, then hands the already-bound socket to uvicorn.

Two concurrent MedHorizon instances therefore get distinct loopback ports and
can never collide on fixed port 8000. The managed capability is never emitted;
every diagnostic log goes to stderr so stdout stays a single-line channel.
"""

from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path


def _bundle_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


# Make the bundle root importable BEFORE importing backend.config below. This
# must run at module scope: entry.py is executed directly (not via a package),
# so sys.path does not yet contain the bundle root when this file loads.
_BUNDLE_ROOT = _bundle_root()
_BACKEND = _BUNDLE_ROOT / "backend"
if _BACKEND.is_dir() and str(_BUNDLE_ROOT) not in sys.path:
    sys.path.insert(0, str(_BUNDLE_ROOT))

from backend.config import HEALTH_PROTOCOL_VERSION, SERVICE_NAME, SERVICE_VERSION  # noqa: E402

# Byte budget for the single discovery record. A parent supervisor must be able
# to buffer this much from the child's stdout before any service traffic.
DISCOVERY_BYTE_BUDGET = 2048


def bind_loopback() -> socket.socket:
    """Bind ``127.0.0.1:0`` (OS-selected port) and return the bound socket.

    Binding happens before the app is imported, so two children can never race
    for the same port and the OS guarantees a distinct ephemeral port.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    return sock


def discovery_line(port: int) -> str:
    """The single JSON discovery line for a chosen ``port``.

    Carries exactly ``port`` / ``service`` / ``version`` / ``protocol`` and
    never the capability. ``json.loads`` of the returned string is the wire
    contract a parent supervisor must be able to parse.
    """
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError(f"invalid discovery port: {port!r}")
    record = {
        "port": port,
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "protocol": HEALTH_PROTOCOL_VERSION,
    }
    return json.dumps(record, sort_keys=True, separators=(",", ":"))


def _uvicorn_log_config() -> dict:
    """uvicorn's default log config with the access handler forced to stderr.

    uvicorn's stock access handler writes to stdout, which would corrupt the
    single-line discovery channel; every uvicorn log must land on stderr.
    """
    import copy

    from uvicorn.config import LOGGING_CONFIG

    cfg = copy.deepcopy(LOGGING_CONFIG)
    cfg["handlers"]["access"]["stream"] = "ext://sys.stderr"
    return cfg


def main() -> None:
    root = _BUNDLE_ROOT
    ui = root / "ui"
    if ui.is_dir():
        os.environ.setdefault("RESEARCH_GRAPH_UI_DIR", str(ui))

    data = Path(os.environ.get("RESEARCH_GRAPH_DATA", Path.home() / ".local" / "medhorizon" / "research-graph"))
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATA_DIR", str(data))
    os.environ.setdefault("SQLITE_PATH", str(data / "research-graph.db"))
    # Local loopback desktop sidecar. Managed mode authenticates ONLY the exact
    # configured capability; dev identity is an explicit operator opt-in and is
    # never enabled here (RESEARCH_GRAPH_ALLOW_DEV_TOKENS stays untouched).
    os.environ.setdefault("APP_ENV", "development")
    os.environ.setdefault("BACKEND_HOST", "127.0.0.1")

    try:
        sock = bind_loopback()
        port = sock.getsockname()[1]
    except OSError as err:
        print(f"research-graph: cannot bind loopback port: {err}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(port, int) or port <= 0:
        print(f"research-graph: cannot derive a loopback port (got {port!r})", file=sys.stderr)
        sock.close()
        sys.exit(1)

    # Set origins from the selected port BEFORE importing the app so that
    # get_settings() (lru-cached at backend.main import) freezes the right values.
    origin = f"http://127.0.0.1:{port}"
    os.environ["BACKEND_PORT"] = str(port)
    os.environ["PUBLIC_API_URL"] = origin
    os.environ["UI_URL"] = origin

    line = discovery_line(port)
    if len(line.encode("utf-8")) > DISCOVERY_BYTE_BUDGET:
        print(f"research-graph: discovery record exceeds {DISCOVERY_BYTE_BUDGET} bytes", file=sys.stderr)
        sock.close()
        sys.exit(1)

    try:
        import uvicorn
        from backend.main import app
    except Exception as err:
        print(f"research-graph: failed to load app: {err}", file=sys.stderr)
        sock.close()
        sys.exit(1)

    # Emit exactly one discovery record before any service traffic; the parent
    # reads this single line, then polls authenticated /health until ready.
    print(line, flush=True)

    sock.setblocking(False)
    config = uvicorn.Config(app, log_config=_uvicorn_log_config(), log_level="info")
    uvicorn.Server(config).run(sockets=[sock])


if __name__ == "__main__":
    main()
