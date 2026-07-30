"""Graph health + CRUD (archive/export). Nodes/edges live in sibling routers."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import GraphCreate, GraphOut, GraphPatch, HealthOut, WriteMeta
from backend.services.auth import User, current_user
from backend.services.provenance import not_found, record_event, with_idempotency

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.get("/health", response_model=HealthOut)
def health(settings: Settings = Depends(get_settings)) -> HealthOut:
    return HealthOut(
        status="ok",
        mode=settings.research_graph_mode,
        store="supabase" if settings.use_supabase else "sqlite",
        openai=settings.openai_ready,
    )


@router.get("/api/graphs", response_model=list[GraphOut])
def list_graphs(user: User = Depends(current_user), store: Store = Depends(store_dep)):
    return store.list("graphs", user_id=user.id, order="updated_at DESC")


@router.post("/api/graphs", response_model=GraphOut)
def create_graph(body: GraphCreate, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    def produce():
        row = store.insert(
            "graphs",
            {
                "id": uid(),
                "user_id": user.id,
                "title": body.title,
                "summary": body.summary,
                "revision": 1,
                "archived": False,
                "created_at": now(),
                "updated_at": now(),
            },
        )
        record_event(
            store,
            user,
            actor="api",
            event_type="graph.created",
            payload={"graph_id": row["id"], "reason": body.reason},
            graph_id=row["id"],
            session_id=body.session_id,
            message_id=body.message_id,
        )
        return row

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/graphs/{graph_id}", response_model=GraphOut)
def get_graph(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("graphs", graph_id, user.id)
    if not row:
        raise not_found("graph not found")
    return row


@router.patch("/api/graphs/{graph_id}", response_model=GraphOut)
def patch_graph(graph_id: str, body: GraphPatch, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("graphs", graph_id, user.id)
    if not row:
        raise not_found("graph not found")
    from backend.services.provenance import conflict

    if body.expected_revision is not None and body.expected_revision != row["revision"]:
        raise conflict("revision conflict")
    patch = {"updated_at": now(), "revision": row["revision"] + 1}
    if body.title is not None:
        patch["title"] = body.title
    if body.summary is not None:
        patch["summary"] = body.summary
    if body.archived is not None:
        patch["archived"] = body.archived
    return store.update("graphs", graph_id, patch, user.id)


@router.post("/api/graphs/{graph_id}/archive", response_model=GraphOut)
def archive_graph(
    graph_id: str,
    body: WriteMeta | None = None,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    body = body or WriteMeta()
    row = store.get("graphs", graph_id, user.id)
    if not row:
        raise not_found("graph not found")
    updated = store.update(
        "graphs",
        graph_id,
        {"archived": True, "updated_at": now(), "revision": row["revision"] + 1},
        user.id,
    )
    record_event(
        store,
        user,
        actor="api",
        event_type="graph.archived",
        payload={"graph_id": graph_id, "reason": body.reason},
        graph_id=graph_id,
        session_id=body.session_id,
        message_id=body.message_id,
    )
    return updated


@router.get("/api/graphs/{graph_id}/tree")
def graph_tree(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    graph = store.get("graphs", graph_id, user.id)
    if not graph:
        raise not_found("graph not found")
    nodes = store.list("nodes", where={"graph_id": graph_id}, user_id=user.id)
    edges = store.list("edges", where={"graph_id": graph_id}, user_id=user.id)
    return {"graph": graph, "nodes": nodes, "edges": edges}


@router.get("/api/graphs/{graph_id}/export")
def export_graph(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    tree = graph_tree(graph_id, user, store)
    experiments = store.list("experiments", where={"graph_id": graph_id}, user_id=user.id)
    return {**tree, "experiments": experiments, "exported_at": now()}


@router.delete("/api/graphs/{graph_id}")
def delete_graph(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.delete("graphs", graph_id, user.id):
        raise not_found("graph not found")
    return {"ok": True}
