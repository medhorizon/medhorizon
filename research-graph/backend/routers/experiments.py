"""Experiment and run endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import (
    ExperimentCreate,
    ExperimentOut,
    ExperimentPatch,
    MetricIn,
    RunCreate,
    RunFinish,
    WriteMeta,
)
from backend.services.auth import User, current_user
from backend.services.provenance import bad_request, conflict, not_found, record_event, with_idempotency
from backend.services.runner import run_experiment

router = APIRouter()

ALLOWED = {
    "draft": {"approved", "archived"},
    "approved": {"running", "archived", "draft"},
    "running": {"completed", "failed"},
    "completed": {"archived"},
    "failed": {"archived", "draft"},
    "archived": set(),
}


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.post("/api/experiments", response_model=ExperimentOut)
def create_experiment(body: ExperimentCreate, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")

    def produce():
        row = store.insert(
            "experiments",
            {
                "id": uid(),
                "graph_id": body.graph_id,
                "hypothesis_node_id": body.hypothesis_node_id,
                "user_id": user.id,
                "title": body.title,
                "objective": body.objective,
                "dataset_refs": body.dataset_refs,
                "code_ref": body.code_ref,
                "parameters": body.parameters,
                "budget": body.budget,
                "status": "draft",
                "revision": 1,
                "created_at": now(),
                "updated_at": now(),
            },
        )
        record_event(
            store,
            user,
            actor="api",
            event_type="experiment.created",
            payload={"experiment_id": row["id"], "reason": body.reason},
            graph_id=body.graph_id,
            session_id=body.session_id,
            message_id=body.message_id,
        )
        return row

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/experiments", response_model=list[ExperimentOut])
def list_experiments(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    return store.list("experiments", where={"graph_id": graph_id}, user_id=user.id, order="updated_at DESC")


@router.get("/api/experiments/{experiment_id}", response_model=ExperimentOut)
def get_experiment(experiment_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("experiments", experiment_id, user.id)
    if not row:
        raise not_found("experiment not found")
    return row


@router.patch("/api/experiments/{experiment_id}", response_model=ExperimentOut)
def patch_experiment(
    experiment_id: str,
    body: ExperimentPatch,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    row = store.get("experiments", experiment_id, user.id)
    if not row:
        raise not_found("experiment not found")
    if row["status"] not in {"draft", "failed"}:
        raise bad_request("only draft/failed experiments can be edited")
    if body.expected_revision is not None and body.expected_revision != row["revision"]:
        raise conflict("revision conflict")
    patch: dict[str, Any] = {"updated_at": now(), "revision": row["revision"] + 1}
    for field in ("title", "objective", "dataset_refs", "code_ref", "parameters", "budget"):
        value = getattr(body, field)
        if value is not None:
            patch[field] = value
    return store.update("experiments", experiment_id, patch, user.id)


@router.post("/api/experiments/{experiment_id}/approve", response_model=ExperimentOut)
def approve_experiment(
    experiment_id: str,
    body: WriteMeta | None = None,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    body = body or WriteMeta()
    row = store.get("experiments", experiment_id, user.id)
    if not row:
        raise not_found("experiment not found")
    if row["status"] != "draft":
        raise bad_request("only draft experiments can be approved")
    updated = store.update("experiments", experiment_id, {"status": "approved", "updated_at": now()}, user.id)
    record_event(
        store,
        user,
        actor="api",
        event_type="experiment.approved",
        payload={"experiment_id": experiment_id, "reason": body.reason},
        graph_id=row["graph_id"],
        session_id=body.session_id,
        message_id=body.message_id,
    )
    return updated


@router.post("/api/experiments/{experiment_id}/runs")
def start_run(
    experiment_id: str,
    body: RunCreate,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    experiment = store.get("experiments", experiment_id, user.id)
    if not experiment:
        raise not_found("experiment not found")

    def produce():
        return run_experiment(
            store,
            user,
            experiment,
            seed=body.seed,
            dry_run=body.dry_run,
            provenance=body.provenance,
            session_id=body.session_id,
            message_id=body.message_id,
        )

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/runs/{run_id}")
def get_run(run_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("experiment_runs", run_id, user.id)
    if not row:
        raise not_found("run not found")
    metrics = store.list("run_metrics", where={"run_id": run_id})
    return {**row, "metrics": metrics}


@router.post("/api/runs/{run_id}/metrics")
def add_metrics(
    run_id: str,
    metrics: list[MetricIn],
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    row = store.get("experiment_runs", run_id, user.id)
    if not row:
        raise not_found("run not found")
    out = []
    for metric in metrics:
        out.append(
            store.insert(
                "run_metrics",
                {
                    "id": uid(),
                    "run_id": run_id,
                    "name": metric.name,
                    "value": metric.value,
                    "split": metric.split,
                    "unit": metric.unit,
                    "evaluator": metric.evaluator,
                    "created_at": now(),
                },
            )
        )
    return out


@router.post("/api/runs/{run_id}/finish")
def finish_run(
    run_id: str,
    body: RunFinish,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    row = store.get("experiment_runs", run_id, user.id)
    if not row:
        raise not_found("run not found")
    if row["status"] not in {"queued", "running"}:
        raise bad_request("run already finished")
    status = "succeeded" if body.exit_code == 0 else "failed"
    updated = store.update(
        "experiment_runs",
        run_id,
        {
            "status": status,
            "finished_at": now(),
            "exit_code": body.exit_code,
            "error_code": body.error_code,
        },
        user.id,
    )
    for metric in body.metrics:
        store.insert(
            "run_metrics",
            {
                "id": uid(),
                "run_id": run_id,
                "name": metric.name,
                "value": metric.value,
                "split": metric.split,
                "unit": metric.unit,
                "evaluator": metric.evaluator,
                "created_at": now(),
            },
        )
    experiment = store.get("experiments", row["experiment_id"], user.id)
    if experiment:
        store.update(
            "experiments",
            experiment["id"],
            {"status": "completed" if status == "succeeded" else "failed", "updated_at": now()},
            user.id,
        )
    return {**updated, "metrics": store.list("run_metrics", where={"run_id": run_id})}


@router.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("experiment_runs", run_id, user.id)
    if not row:
        raise not_found("run not found")
    if row["status"] not in {"queued", "running"}:
        raise bad_request("run cannot be cancelled")
    return store.update(
        "experiment_runs",
        run_id,
        {"status": "cancelled", "finished_at": now(), "error_code": "cancelled"},
        user.id,
    )


@router.post("/api/runs/{run_id}/artifacts")
def attach_artifact(
    run_id: str,
    name: str,
    storage_path: str,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
    mime: str | None = None,
    content_hash: str | None = None,
):
    row = store.get("experiment_runs", run_id, user.id)
    if not row:
        raise not_found("run not found")
    experiment = store.get("experiments", row["experiment_id"], user.id)
    return store.insert(
        "artifacts",
        {
            "id": uid(),
            "graph_id": experiment["graph_id"] if experiment else None,
            "node_id": None,
            "user_id": user.id,
            "name": name,
            "mime": mime,
            "storage_path": storage_path,
            "size": None,
            "content_hash": content_hash,
            "manifest": {"run_id": run_id},
            "created_at": now(),
        },
    )
