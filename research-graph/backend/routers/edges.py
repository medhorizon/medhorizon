"""Edge CRUD router."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import EdgeCreate, EdgeOut
from backend.services.auth import User, current_user
from backend.services.provenance import not_found, record_event, with_idempotency

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.post("/api/edges", response_model=EdgeOut)
def create_edge(body: EdgeCreate, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")
    if not store.get("nodes", body.source_id, user.id) or not store.get("nodes", body.target_id, user.id):
        raise not_found("source or target node not found")

    def produce():
        row = store.insert(
            "edges",
            {
                "id": uid(),
                "graph_id": body.graph_id,
                "user_id": user.id,
                "source_id": body.source_id,
                "target_id": body.target_id,
                "relation": body.relation,
                "meta": body.meta,
                "created_at": now(),
            },
        )
        record_event(
            store,
            user,
            actor="api",
            event_type="edge.created",
            payload={"edge_id": row["id"], "relation": body.relation, "reason": body.reason},
            graph_id=body.graph_id,
            session_id=body.session_id,
            message_id=body.message_id,
        )
        return row

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.delete("/api/edges/{edge_id}")
def delete_edge(edge_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.delete("edges", edge_id, user.id):
        raise not_found("edge not found")
    return {"ok": True}
