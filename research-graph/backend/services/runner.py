"""Restricted experiment runner — argv-only, dry-run by default."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from backend.db.sqlite import Store, now, uid
from backend.services.auth import User
from backend.services.provenance import bad_request, record_event


FORBIDDEN = {";", "|", "&", "`", "$(", ">", "<", "\n"}


def validate_command(argv: list[str], worktree: Path) -> list[str]:
    if not argv:
        raise bad_request("empty command")
    joined = " ".join(argv)
    for token in FORBIDDEN:
        if token in joined:
            raise bad_request(f"shell metacharacter rejected: {token!r}")
    binary = Path(argv[0])
    # Relative binaries resolve inside worktree; absolute must stay in worktree/sandbox
    if not binary.is_absolute():
        return argv
    try:
        binary.resolve().relative_to(worktree.resolve())
    except ValueError as err:
        raise bad_request("command binary outside worktree") from err
    return argv


def input_hash(experiment: dict[str, Any], seed: int | None, dry_run: bool) -> str:
    payload = {
        "parameters": experiment.get("parameters"),
        "code_ref": experiment.get("code_ref"),
        "dataset_refs": experiment.get("dataset_refs"),
        "seed": seed,
        "dry_run": dry_run,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def run_experiment(
    store: Store,
    user: User,
    experiment: dict[str, Any],
    *,
    seed: int | None,
    dry_run: bool,
    provenance: dict[str, Any],
    session_id: str | None = None,
    message_id: str | None = None,
    timeout_s: int = 120,
) -> dict[str, Any]:
    if experiment["status"] != "approved":
        raise bad_request("experiment must be approved before runs")

    code_ref = experiment.get("code_ref") or {}
    argv = code_ref.get("argv") or ["echo", "dry-run"]
    worktree = Path(code_ref.get("worktree") or os.getcwd())
    argv = validate_command(list(argv), worktree)
    digest = input_hash(experiment, seed, dry_run)

    run = store.insert(
        "experiment_runs",
        {
            "id": uid(),
            "experiment_id": experiment["id"],
            "user_id": user.id,
            "status": "queued",
            "input_hash": digest,
            "seed": seed,
            "provenance": {
                **provenance,
                "dry_run": dry_run,
                "argv": argv,
                "worktree": str(worktree),
            },
            "started_at": None,
            "finished_at": None,
            "exit_code": None,
            "error_code": None,
            "created_at": now(),
        },
    )

    store.update("experiments", experiment["id"], {"status": "running", "updated_at": now()}, user.id)
    store.update("experiment_runs", run["id"], {"status": "running", "started_at": now()}, user.id)

    record_event(
        store,
        user,
        actor="runner",
        event_type="run.started",
        payload={"run_id": run["id"], "dry_run": dry_run, "input_hash": digest},
        graph_id=experiment["graph_id"],
        session_id=session_id,
        message_id=message_id,
    )

    if dry_run:
        store.update(
            "experiment_runs",
            run["id"],
            {"status": "succeeded", "finished_at": now(), "exit_code": 0},
            user.id,
        )
        store.update("experiments", experiment["id"], {"status": "completed", "updated_at": now()}, user.id)
        store.insert(
            "run_metrics",
            {
                "id": uid(),
                "run_id": run["id"],
                "name": "dry_run",
                "value": 1.0,
                "split": "n/a",
                "unit": None,
                "evaluator": "local-dry-run",
                "created_at": now(),
            },
        )
        return store.get("experiment_runs", run["id"], user.id)  # type: ignore[return-value]

    try:
        completed = subprocess.run(
            argv,
            cwd=str(worktree),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            shell=False,
            env={k: v for k, v in os.environ.items() if not k.upper().endswith(("API_KEY", "SECRET", "TOKEN"))},
        )
        status = "succeeded" if completed.returncode == 0 else "failed"
        store.update(
            "experiment_runs",
            run["id"],
            {
                "status": status,
                "finished_at": now(),
                "exit_code": completed.returncode,
                "error_code": None if completed.returncode == 0 else "nonzero_exit",
                "provenance": {
                    **(store.get("experiment_runs", run["id"], user.id) or {}).get("provenance", {}),
                    "stdout_tail": (completed.stdout or "")[-4000:],
                    "stderr_tail": (completed.stderr or "")[-4000:],
                },
            },
            user.id,
        )
        store.update(
            "experiments",
            experiment["id"],
            {"status": "completed" if status == "succeeded" else "failed", "updated_at": now()},
            user.id,
        )
    except subprocess.TimeoutExpired:
        store.update(
            "experiment_runs",
            run["id"],
            {"status": "failed", "finished_at": now(), "error_code": "timeout"},
            user.id,
        )
        store.update("experiments", experiment["id"], {"status": "failed", "updated_at": now()}, user.id)
    except Exception as err:
        store.update(
            "experiment_runs",
            run["id"],
            {"status": "failed", "finished_at": now(), "error_code": type(err).__name__},
            user.id,
        )
        store.update("experiments", experiment["id"], {"status": "failed", "updated_at": now()}, user.id)

    record_event(
        store,
        user,
        actor="runner",
        event_type="run.finished",
        payload={"run_id": run["id"]},
        graph_id=experiment["graph_id"],
        session_id=session_id,
        message_id=message_id,
    )
    return store.get("experiment_runs", run["id"], user.id)  # type: ignore[return-value]
