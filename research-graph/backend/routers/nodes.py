"""Node CRUD router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import NodeCreate, NodeOut, NodePatch
from backend.services.auth import User, current_user
from backend.services.provenance import conflict, not_found, record_event, with_idempotency

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.get("/api/nodes", response_model=list[NodeOut])
def list_nodes(graph_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    return store.list("nodes", where={"graph_id": graph_id}, user_id=user.id, order="created_at ASC")


@router.post("/api/nodes", response_model=NodeOut)
def create_node(body: NodeCreate, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")

    def produce():
        row = store.insert(
            "nodes",
            {
                "id": uid(),
                "graph_id": body.graph_id,
                "user_id": user.id,
                "kind": body.kind,
                "title": body.title,
                "content": body.content,
                "hypothesis": body.hypothesis,
                "summary": body.summary,
                "lifecycle": body.lifecycle,
                "outcome": body.outcome,
                "tags": body.tags,
                "meta": body.meta,
                "embedding": None,
                "revision": 1,
                "created_at": now(),
                "updated_at": now(),
            },
        )
        record_event(
            store,
            user,
            actor="api",
            event_type="node.created",
            payload={"node_id": row["id"], "kind": body.kind, "reason": body.reason},
            graph_id=body.graph_id,
            session_id=body.session_id,
            message_id=body.message_id,
        )
        return row

    return with_idempotency(store, user, body.idempotency_key, produce)


@router.get("/api/nodes/{node_id}", response_model=NodeOut)
def get_node(node_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("nodes", node_id, user.id)
    if not row:
        raise not_found("node not found")
    return row


@router.patch("/api/nodes/{node_id}", response_model=NodeOut)
def patch_node(node_id: str, body: NodePatch, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("nodes", node_id, user.id)
    if not row:
        raise not_found("node not found")
    if body.expected_revision is not None and body.expected_revision != row["revision"]:
        raise conflict("revision conflict")
    patch: dict[str, Any] = {"updated_at": now(), "revision": row["revision"] + 1}
    for field in ("title", "content", "hypothesis", "summary", "lifecycle", "outcome", "tags", "meta"):
        value = getattr(body, field)
        if value is not None:
            patch[field] = value
    updated = store.update("nodes", node_id, patch, user.id)
    record_event(
        store,
        user,
        actor="api",
        event_type="node.updated",
        payload={"node_id": node_id, "reason": body.reason},
        graph_id=row["graph_id"],
        session_id=body.session_id,
        message_id=body.message_id,
    )
    return updated


@router.delete("/api/nodes/{node_id}")
def delete_node(node_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("nodes", node_id, user.id)
    if not row:
        raise not_found("node not found")
    store.delete("nodes", node_id, user.id)
    return {"ok": True}
