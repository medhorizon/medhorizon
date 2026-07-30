"""Embedding helpers — failures never block node persistence."""

from __future__ import annotations

from backend.config import Settings, get_settings
from backend.db.sqlite import Store
from backend.services.openai_service import embed_texts


async def embed_node(store: Store, node_id: str, user_id: str, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.openai_ready:
        return
    row = store.get("nodes", node_id, user_id)
    if not row:
        return
    text = "\n".join(filter(None, [row.get("title"), row.get("summary"), row.get("content"), row.get("hypothesis")]))
    if not text.strip():
        return
    try:
        vectors = await embed_texts([text], settings)
        store.update("nodes", node_id, {"embedding": vectors[0]}, user_id)
    except Exception:
        return
