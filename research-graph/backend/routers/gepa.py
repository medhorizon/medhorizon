"""GEPA endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store
from backend.models.schemas import GepaCreate, GepaIterate, WriteMeta
from backend.services import gepa as gepa_service
from backend.services.auth import User, current_user
from backend.services.provenance import not_found, with_idempotency

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.post("/api/gepa/runs")
def create_gepa(body: GepaCreate, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    def produce():
        return gepa_service.start_run(
            store,
            user,
            experiment_id=body.experiment_id,
            objective=body.objective,
            budget=body.budget,
            seed=body.seed,
            session_id=body.session_id,
            message_id=body.message_id,
            reason=body.reason,
        )

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/gepa/runs/{gepa_run_id}")
def get_gepa(gepa_run_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    run = store.get("gepa_runs", gepa_run_id, user.id)
    if not run:
        raise not_found("gepa run not found")
    iterations = store.list("gepa_iterations", where={"gepa_run_id": gepa_run_id}, order="generation ASC")
    return {"run": run, "iterations": iterations}


@router.post("/api/gepa/runs/{gepa_run_id}/iterations")
def iterate_gepa(
    gepa_run_id: str,
    body: GepaIterate,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    def produce():
        return gepa_service.iterate(
            store,
            user,
            gepa_run_id,
            parent_candidate_id=body.parent_candidate_id,
            candidates=body.candidates,
            session_id=body.session_id,
            message_id=body.message_id,
        )

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/gepa/runs/{gepa_run_id}/iterations/{generation}")
def get_iteration(
    gepa_run_id: str,
    generation: int,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    if not store.get("gepa_runs", gepa_run_id, user.id):
        raise not_found("gepa run not found")
    rows = store.list("gepa_iterations", where={"gepa_run_id": gepa_run_id, "generation": generation})
    if not rows:
        raise not_found("iteration not found")
    iteration = rows[0]
    candidates = store.list("gepa_candidates", where={"iteration_id": iteration["id"]})
    return {"iteration": iteration, "candidates": candidates}


@router.post("/api/gepa/runs/{gepa_run_id}/approve")
def approve_gepa(
    gepa_run_id: str,
    body: WriteMeta | None = None,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    body = body or WriteMeta()
    return gepa_service.approve(store, user, gepa_run_id, session_id=body.session_id, message_id=body.message_id)


@router.post("/api/gepa/runs/{gepa_run_id}/stop")
def stop_gepa(gepa_run_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    return gepa_service.stop(store, user, gepa_run_id)


@router.post("/api/gepa/runs/{gepa_run_id}/replay")
def replay_gepa(
    gepa_run_id: str,
    body: WriteMeta | None = None,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    """Replay starts a new GEPA run cloning objective/budget/seed — history is never overwritten."""
    body = body or WriteMeta()
    run = store.get("gepa_runs", gepa_run_id, user.id)
    if not run:
        raise not_found("gepa run not found")
    return gepa_service.start_run(
        store,
        user,
        experiment_id=run["experiment_id"],
        objective=run["objective"],
        budget=run["budget"],
        seed=run["seed"],
        session_id=body.session_id,
        message_id=body.message_id,
        reason=body.reason or f"replay of {gepa_run_id}",
    )
