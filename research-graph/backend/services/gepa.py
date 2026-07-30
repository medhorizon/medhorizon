"""GEPA (Generalized Evolutionary Prompt Adaptation) loop."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from backend.db.sqlite import Store, now, uid
from backend.services.auth import User
from backend.services.provenance import bad_request, conflict, not_found, record_event


def program_hash(program: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(program, sort_keys=True, default=str).encode()).hexdigest()


def evaluate_candidate(program: dict[str, Any], seed: int) -> dict[str, Any]:
    """Deterministic local evaluator — no model weights mutated."""
    prompt = str(program.get("prompt") or "")
    length = len(prompt)
    # Stable pseudo-score from seed + content
    digest = hashlib.sha256(f"{seed}:{prompt}".encode()).hexdigest()
    primary = (int(digest[:8], 16) % 10000) / 10000.0
    # Prefer shorter constrained prompts slightly
    penalty = min(length / 4000.0, 0.2)
    score = max(0.0, min(1.0, primary - penalty + min(length, 200) / 2000.0))
    return {
        "primary": round(score, 6),
        "secondary": {"length": length, "seed": seed},
        "evaluator": "local-deterministic-v1",
        "constraints_ok": length <= 4000 and "ignore previous" not in prompt.lower(),
    }


def start_run(
    store: Store,
    user: User,
    *,
    experiment_id: str,
    objective: dict[str, Any],
    budget: dict[str, Any],
    seed: int,
    session_id: str | None = None,
    message_id: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    experiment = store.get("experiments", experiment_id, user.id)
    if not experiment:
        raise not_found("experiment not found")
    if experiment["status"] not in {"approved", "completed", "running"}:
        raise bad_request("experiment must be approved before GEPA")

    run = store.insert(
        "gepa_runs",
        {
            "id": uid(),
            "experiment_id": experiment_id,
            "user_id": user.id,
            "objective": objective,
            "budget": budget,
            "seed": seed,
            "status": "draft",
            "current_candidate_id": None,
            "created_at": now(),
            "updated_at": now(),
        },
    )
    record_event(
        store,
        user,
        actor="gepa",
        event_type="gepa.started",
        payload={"gepa_run_id": run["id"], "reason": reason},
        graph_id=experiment["graph_id"],
        session_id=session_id,
        message_id=message_id,
    )
    return run


def iterate(
    store: Store,
    user: User,
    gepa_run_id: str,
    *,
    parent_candidate_id: str | None,
    candidates: list[dict[str, Any]] | None,
    session_id: str | None = None,
    message_id: str | None = None,
) -> dict[str, Any]:
    run = store.get("gepa_runs", gepa_run_id, user.id)
    if not run:
        raise not_found("gepa run not found")
    if run["status"] in {"completed", "stopped", "failed"}:
        raise bad_request(f"gepa run is {run['status']}")

    budget = run.get("budget") or {}
    max_iterations = int(budget.get("max_iterations", 3))
    max_candidates = int(budget.get("max_candidates", 4))
    patience = int(budget.get("patience", 2))

    existing = store.list("gepa_iterations", where={"gepa_run_id": gepa_run_id}, order="generation ASC")
    generation = (existing[-1]["generation"] + 1) if existing else 1
    if generation > max_iterations:
        store.update("gepa_runs", gepa_run_id, {"status": "stopped", "updated_at": now()}, user.id)
        raise bad_request("max_iterations reached")

    store.update("gepa_runs", gepa_run_id, {"status": "generating", "updated_at": now()}, user.id)

    parent_program = {"prompt": "baseline", "tools": []}
    if parent_candidate_id:
        parent = store.get("gepa_candidates", parent_candidate_id)
        if not parent:
            raise not_found("parent candidate not found")
        parent_program = parent["program"]

    raw_candidates = candidates or _default_candidates(parent_program, generation, max_candidates)
    if len(raw_candidates) > max_candidates:
        raise bad_request("too many candidates for budget")

    iteration = store.insert(
        "gepa_iterations",
        {
            "id": uid(),
            "gepa_run_id": gepa_run_id,
            "generation": generation,
            "rollout_run_ids": [],
            "aggregate": {},
            "critic_report": {},
            "selected_id": None,
            "created_at": now(),
        },
    )

    store.update("gepa_runs", gepa_run_id, {"status": "evaluating", "updated_at": now()}, user.id)

    scored: list[dict[str, Any]] = []
    for program in raw_candidates:
        scores = evaluate_candidate(program, int(run["seed"]) + generation)
        decision = "pending" if scores["constraints_ok"] else "invalid"
        row = store.insert(
            "gepa_candidates",
            {
                "id": uid(),
                "iteration_id": iteration["id"],
                "parent_id": parent_candidate_id,
                "program": program,
                "program_hash": program_hash(program),
                "scores": scores,
                "constraints": {"max_length": 4000},
                "decision": decision,
                "created_at": now(),
            },
        )
        if decision == "pending":
            scored.append(row)

    # Critic: explain only — never mutate scores
    critic = {
        "summary": f"Evaluated {len(raw_candidates)} candidates at generation {generation}",
        "failures": [c["id"] for c in scored if (c["scores"].get("primary") or 0) < 0.3],
        "suggestions": ["Tighten prompt", "Add explicit output schema"] if scored else ["Provide valid candidates"],
        "model": "local-critic",
    }

    selected = None
    if scored:
        scored.sort(key=lambda c: (-float(c["scores"]["primary"]), c["scores"]["secondary"]["length"], c["id"]))
        selected = scored[0]
        store.update("gepa_candidates", selected["id"], {"decision": "selected"})
        for other in scored[1:]:
            store.update("gepa_candidates", other["id"], {"decision": "rejected"})

    aggregate = {
        "best_primary": selected["scores"]["primary"] if selected else None,
        "n_valid": len(scored),
        "n_total": len(raw_candidates),
        "cost": {
            "candidates": len(raw_candidates),
            "generation": generation,
            "evaluator": "local-deterministic-v1",
        },
    }

    # Patience: no improvement vs previous best
    if selected and existing:
        prev_best = None
        for it in existing:
            if it.get("aggregate", {}).get("best_primary") is not None:
                prev_best = it["aggregate"]["best_primary"]
        stagnant = 0
        if prev_best is not None and selected["scores"]["primary"] <= prev_best:
            # count trailing non-improving gens
            stagnant = 1
            for it in reversed(existing):
                best = (it.get("aggregate") or {}).get("best_primary")
                if best is None or best < prev_best:
                    break
                if best <= prev_best:
                    stagnant += 1
            if stagnant >= patience and selected["scores"]["primary"] <= float(prev_best):
                store.update(
                    "gepa_iterations",
                    iteration["id"],
                    {
                        "aggregate": {**aggregate, "stopped_reason": "patience"},
                        "critic_report": critic,
                        "selected_id": selected["id"],
                    },
                )
                store.update("gepa_runs", gepa_run_id, {"status": "stopped", "updated_at": now()}, user.id)
                return {
                    "iteration": store.get("gepa_iterations", iteration["id"]),
                    "candidates": store.list("gepa_candidates", where={"iteration_id": iteration["id"]}),
                    "run": store.get("gepa_runs", gepa_run_id, user.id),
                    "gate_required": False,
                    "stopped": True,
                }

    store.update(
        "gepa_iterations",
        iteration["id"],
        {
            "aggregate": aggregate,
            "critic_report": critic,
            "selected_id": selected["id"] if selected else None,
        },
    )
    store.update(
        "gepa_runs",
        gepa_run_id,
        {
            "status": "awaiting_gate",
            "current_candidate_id": selected["id"] if selected else None,
            "updated_at": now(),
        },
        user.id,
    )

    record_event(
        store,
        user,
        actor="gepa",
        event_type="gepa.iteration",
        payload={"gepa_run_id": gepa_run_id, "generation": generation, "selected_id": selected["id"] if selected else None},
        session_id=session_id,
        message_id=message_id,
    )

    return {
        "iteration": store.get("gepa_iterations", iteration["id"]),
        "candidates": store.list("gepa_candidates", where={"iteration_id": iteration["id"]}),
        "run": store.get("gepa_runs", gepa_run_id, user.id),
        "gate_required": True,
        "stopped": False,
    }


def approve(store: Store, user: User, gepa_run_id: str, *, session_id: str | None = None, message_id: str | None = None) -> dict[str, Any]:
    run = store.get("gepa_runs", gepa_run_id, user.id)
    if not run:
        raise not_found("gepa run not found")
    if run["status"] != "awaiting_gate":
        raise conflict("gepa run is not awaiting gate")
    if not run.get("current_candidate_id"):
        raise bad_request("no candidate to approve")

    store.update("gepa_runs", gepa_run_id, {"status": "selected", "updated_at": now()}, user.id)
    record_event(
        store,
        user,
        actor="gepa",
        event_type="gepa.approved",
        payload={"gepa_run_id": gepa_run_id, "candidate_id": run["current_candidate_id"]},
        session_id=session_id,
        message_id=message_id,
    )
    # Mark completed after apply gate
    store.update("gepa_runs", gepa_run_id, {"status": "completed", "updated_at": now()}, user.id)
    return store.get("gepa_runs", gepa_run_id, user.id)  # type: ignore[return-value]


def stop(store: Store, user: User, gepa_run_id: str) -> dict[str, Any]:
    run = store.get("gepa_runs", gepa_run_id, user.id)
    if not run:
        raise not_found("gepa run not found")
    store.update("gepa_runs", gepa_run_id, {"status": "stopped", "updated_at": now()}, user.id)
    return store.get("gepa_runs", gepa_run_id, user.id)  # type: ignore[return-value]


def _default_candidates(parent: dict[str, Any], generation: int, n: int) -> list[dict[str, Any]]:
    base = str(parent.get("prompt") or "baseline")
    out = []
    for i in range(n):
        out.append(
            {
                "prompt": f"{base}\n\n[gen={generation} variant={i}] Be precise. Cite evidence. Return JSON.",
                "tools": parent.get("tools") or [],
                "version": f"g{generation}-c{i}",
            }
        )
    return out
