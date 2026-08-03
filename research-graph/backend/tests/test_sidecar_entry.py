"""Sidecar entry discovery tests — dynamic loopback port and single discovery record.

These exercise the real ``sidecar/entry.py`` helpers and spawn TWO real child
processes (no mocks) to prove that two concurrent MedHorizon instances get
distinct loopback ports and serve an authenticated /health that matches the
discovery record. Discovery goes to stdout; every uvicorn diagnostic must land
on stderr.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from backend.config import HEALTH_PROTOCOL_VERSION, SERVICE_NAME, SERVICE_VERSION
from sidecar.entry import DISCOVERY_BYTE_BUDGET, bind_loopback, discovery_line

ROOT = Path(__file__).resolve().parents[2]
ENTRY = ROOT / "sidecar" / "entry.py"
PY_CMD = ["py", "-3.14"]


# --------------------------------------------------------------------------- #
# Discovery-record framing (unit level, no processes)
# --------------------------------------------------------------------------- #


def test_discovery_line_is_single_json_record_with_exact_fields():
    line = discovery_line(54321)
    assert isinstance(line, str)
    assert "\n" not in line
    payload = json.loads(line)
    assert payload == {
        "port": 54321,
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "protocol": HEALTH_PROTOCOL_VERSION,
    }
    # Exactly the required fields — and never the capability.
    assert set(payload) == {"port", "service", "version", "protocol"}
    assert "capability" not in line
    assert "RESEARCH_GRAPH" not in line
    assert len((line + "\n").encode("utf-8")) <= DISCOVERY_BYTE_BUDGET


def test_discovery_line_fits_byte_budget_for_any_port():
    for port in (1, 12345, 65535):
        line = discovery_line(port)
        assert len((line + "\n").encode("utf-8")) <= DISCOVERY_BYTE_BUDGET
        # The real record is far smaller than the budget — leave headroom.
        assert len((line + "\n").encode("utf-8")) < 512


def test_discovery_line_rejects_invalid_ports():
    for bad in (-1, 65536, "8000", None):
        try:
            discovery_line(bad)  # type: ignore[arg-type]
            assert False, f"expected ValueError for {bad!r}"
        except ValueError:
            pass


# --------------------------------------------------------------------------- #
# Loopback binding (unit level, real sockets)
# --------------------------------------------------------------------------- #


def test_bind_loopback_binds_loopback_only():
    sock = bind_loopback()
    try:
        host, port = sock.getsockname()[:2]
        assert host == "127.0.0.1"
        assert 0 < port <= 65535
    finally:
        sock.close()


def test_sequential_port_zero_binds_are_distinct():
    first = bind_loopback()
    second = bind_loopback()
    try:
        assert first.getsockname()[1] != second.getsockname()[1]
    finally:
        first.close()
        second.close()


# --------------------------------------------------------------------------- #
# Real-process integration: two concurrent children
# --------------------------------------------------------------------------- #


def _child_env(tmp_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    # Isolate every Research Graph / MedHorizon / OpenScience knob from the
    # shell so both children behave identically regardless of the developer's
    # machine. The capability is the only managed-sidecar credential.
    for key in list(env):
        if key.startswith(("RESEARCH_GRAPH_", "MEDHORIZON_", "OPENSCIENCE_")):
            env.pop(key, None)
    env["RESEARCH_GRAPH_MANAGED_CAPABILITY"] = secrets.token_hex(32)  # 256-bit
    env["RESEARCH_GRAPH_DATA"] = str(tmp_path / "data")
    no_config = tmp_path / "no-config"
    no_config.mkdir(exist_ok=True)
    env["MEDHORIZON_CONFIG_DIR"] = str(no_config)
    env["OPENAI_API_KEY"] = ""
    env["OPENAI_BASE_URL"] = ""
    env["OPENAI_MODEL"] = ""
    env["APP_ENV"] = "development"
    env["BACKEND_HOST"] = "127.0.0.1"
    return env


def _spawn_child(env: dict[str, str]) -> subprocess.Popen:
    return subprocess.Popen(
        [*PY_CMD, str(ENTRY)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )


def _read_first_line(proc: subprocess.Popen, timeout: int = 90) -> str:
    result: dict = {}

    def reader() -> None:
        try:
            result["line"] = proc.stdout.readline()
        except Exception as err:  # pragma: no cover - defensive
            result["error"] = err

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError(f"child pid={proc.pid} produced no discovery line within {timeout}s")
    if "error" in result:
        raise result["error"]
    return str(result.get("line") or "")


def _wait_health(port: int, cap: str, timeout: int = 60) -> dict:
    deadline = time.monotonic() + timeout
    last: object = "never attempted"
    while time.monotonic() < deadline:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/health",
            headers={"Authorization": f"Bearer {cap}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                if res.status == 200:
                    return json.loads(res.read().decode("utf-8"))
                last = f"status {res.status}"
        except (urllib.error.URLError, OSError) as err:
            last = err
        time.sleep(0.5)
    raise AssertionError(f"/health on 127.0.0.1:{port} never returned 200 (last: {last!r})")


def test_two_real_children_get_distinct_ports_and_authenticated_health(tmp_path):
    env = _child_env(tmp_path)
    cap = env["RESEARCH_GRAPH_MANAGED_CAPABILITY"]
    procs = [_spawn_child(env) for _ in range(2)]
    stderr_by_pid: dict[int, str] = {}
    try:
        lines = []
        for proc in procs:
            line = _read_first_line(proc)
            if not line.strip():
                diagnostic = ""
                if proc.poll() is not None:
                    diagnostic = proc.stderr.read()
                raise AssertionError(
                    f"child pid={proc.pid} produced no discovery line; stderr:\n{diagnostic}"
                )
            assert cap not in line, "discovery line must never contain the capability"
            lines.append(line)

        payloads = [json.loads(line) for line in lines]
        for payload in payloads:
            assert set(payload) == {"port", "service", "version", "protocol"}, payload
            assert payload["service"] == SERVICE_NAME
            assert payload["version"] == SERVICE_VERSION
            assert payload["protocol"] == HEALTH_PROTOCOL_VERSION

        ports = [payload["port"] for payload in payloads]
        assert len(set(ports)) == 2, f"expected distinct loopback ports, got {ports}"
        assert all(0 < port <= 65535 for port in ports)

        for payload in payloads:
            body = _wait_health(payload["port"], cap)
            assert body["status"] == "ok"
            assert body["service"] == SERVICE_NAME
            assert body["version"] == SERVICE_VERSION
            assert body["protocol"] == HEALTH_PROTOCOL_VERSION
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:  # pragma: no cover - hard kill
                proc.kill()
                proc.wait(timeout=30)
            stderr_by_pid[proc.pid] = proc.stderr.read()

    # Every child exited, stdout carried ONLY the discovery line, and every
    # uvicorn diagnostic (including the access log) landed on stderr.
    for proc in procs:
        assert proc.returncode is not None, f"child pid={proc.pid} did not exit"
        rest = proc.stdout.read()
        assert rest == "", f"child pid={proc.pid} wrote extra stdout: {rest!r}"
        err = stderr_by_pid[proc.pid]
        assert "Application startup complete." in err, f"child stderr missing startup:\n{err}"
        assert "GET /health" in err, f"child stderr missing access log:\n{err}"
