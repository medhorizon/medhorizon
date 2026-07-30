"""AI endpoints — summarize, chat, hypothesis, suggest-links."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import AiChatIn, AiHypothesisIn, AiSuggestLinksIn, AiSummarizeIn
from backend.services.auth import User, current_user
from backend.services.embedding import embed_node
from backend.services.openai_service import chat
from backend.services.provenance import not_found, record_event

router = APIRouter()


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


@router.post("/api/ai/summarize")
async def summarize(body: AiSummarizeIn, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    text = body.text
    source_ids: list[str] = []
    if body.node_id:
        node = store.get("nodes", body.node_id, user.id)
        if not node:
            raise not_found("node not found")
        text = "\n".join(filter(None, [node.get("title"), node.get("content"), node.get("summary")]))
        source_ids = [body.node_id]
    if not text:
        raise not_found("no text to summarize")
    result = await chat(
        [
            {"role": "system", "content": "Summarize the research note in 2-3 sentences."},
            {"role": "user", "content": text},
        ],
        model="gpt-4o-mini",
    )
    record_event(
        store,
        user,
        actor="ai",
        event_type="ai.summarize",
        payload={"sources": source_ids, "model": result["model"]},
    )
    return {**result, "sources": source_ids, "at": now()}


@router.post("/api/ai/chat")
async def ai_chat(body: AiChatIn, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")
    nodes = store.list("nodes", where={"graph_id": body.graph_id}, user_id=user.id)
    context = "\n\n".join(
        f"[{n['kind']}] {n['title']}: {n.get('summary') or n.get('content') or ''}" for n in nodes[:20]
    )
    result = await chat(
        [
            {"role": "system", "content": f"Answer using only this research graph context:\n{context}"},
            {"role": "user", "content": body.message},
        ],
        model="gpt-4o",
    )
    sources = [n["id"] for n in nodes[:5]]
    store.insert(
        "chat_history",
        {
            "id": uid(),
            "graph_id": body.graph_id,
            "user_id": user.id,
            "role": "user",
            "content": body.message,
            "citations": [],
            "model": None,
            "created_at": now(),
        },
    )
    store.insert(
        "chat_history",
        {
            "id": uid(),
            "graph_id": body.graph_id,
            "user_id": user.id,
            "role": "assistant",
            "content": result["content"],
            "citations": [{"node_id": s} for s in sources],
            "model": result["model"],
            "created_at": now(),
        },
    )
    record_event(
        store,
        user,
        actor="ai",
        event_type="ai.chat",
        payload={"graph_id": body.graph_id, "model": result["model"], "sources": sources},
        graph_id=body.graph_id,
    )
    return {**result, "sources": sources, "at": now()}


@router.post("/api/ai/generate-hypothesis")
async def generate_hypothesis(
    body: AiHypothesisIn,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")
    result = await chat(
        [
            {"role": "system", "content": "Propose one falsifiable scientific hypothesis. Be specific."},
            {"role": "user", "content": body.prompt},
        ],
        model="gpt-4o",
    )
    node = store.insert(
        "nodes",
        {
            "id": uid(),
            "graph_id": body.graph_id,
            "user_id": user.id,
            "kind": "hypothesis",
            "title": "Generated hypothesis",
            "content": result["content"],
            "hypothesis": result["content"],
            "summary": result["content"][:240],
            "lifecycle": "staged",
            "outcome": None,
            "tags": ["ai-generated"],
            "meta": {"model": result["model"], "at": now()},
            "embedding": None,
            "revision": 1,
            "created_at": now(),
            "updated_at": now(),
        },
    )
    background.add_task(embed_node, store, node["id"], user.id)
    record_event(
        store,
        user,
        actor="ai",
        event_type="ai.hypothesis",
        payload={"node_id": node["id"], "model": result["model"], "sources": [node["id"]]},
        graph_id=body.graph_id,
    )
    return {"node": node, "model": result["model"], "sources": [node["id"]], "at": now()}


@router.post("/api/ai/suggest-links")
async def suggest_links(body: AiSuggestLinksIn, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    node = store.get("nodes", body.node_id, user.id)
    if not node or node["graph_id"] != body.graph_id:
        raise not_found("node not found")
    others = [n for n in store.list("nodes", where={"graph_id": body.graph_id}, user_id=user.id) if n["id"] != body.node_id]
    context = "\n".join(f"- {n['id']} [{n['kind']}] {n['title']}" for n in others[:30])
    result = await chat(
        [
            {
                "role": "system",
                "content": "Suggest up to 5 edges as JSON array of {target_id, relation}. Relations: supports, contradicts, derives, references, parent.",
            },
            {"role": "user", "content": f"Source node: {node['id']} {node['title']}\nCandidates:\n{context}"},
        ],
        model="gpt-4o",
    )
    return {"suggestions": result["content"], "model": result["model"], "sources": [body.node_id], "at": now()}
