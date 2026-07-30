"""Semantic search router."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store
from backend.models.schemas import SemanticSearchIn
from backend.services.auth import User, current_user
from backend.services.openai_service import cosine, embed_texts
from backend.services.provenance import not_found

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.post("/api/search/semantic")
async def semantic_search(
    body: SemanticSearchIn,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")
    query_vec = (await embed_texts([body.query]))[0]
    nodes = store.list("nodes", where={"graph_id": body.graph_id}, user_id=user.id)
    scored = []
    for node in nodes:
        emb = node.get("embedding")
        if not emb:
            continue
        scored.append({**node, "score": cosine(query_vec, emb)})
    scored.sort(key=lambda n: n["score"], reverse=True)
    return {
        "results": scored[: body.limit],
        "model": "text-embedding-3-small",
        "at": datetime.now(timezone.utc).isoformat(),
        "sources": [n["id"] for n in scored[: body.limit]],
    }
