"""Artifacts upload and sync outbox."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.services.auth import User, current_user
from backend.services.provenance import not_found

router = APIRouter()

SECRET_RE = re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S+")


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


def scan_secret(text: str) -> bool:
    return bool(SECRET_RE.search(text))


@router.post("/api/artifacts/upload")
async def upload_artifact(
    file: UploadFile = File(...),
    graph_id: str | None = Form(default=None),
    node_id: str | None = Form(default=None),
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
    settings: Settings = Depends(get_settings),
):
    if graph_id and not store.get("graphs", graph_id, user.id):
        raise not_found("graph not found")
    data_dir = Path(settings.data_dir) / "artifacts" / user.id
    data_dir.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    digest = hashlib.sha256(raw).hexdigest()
    # Secret scan for text-ish payloads
    try:
        text = raw.decode("utf-8")
        if scan_secret(text):
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="artifact failed secret scan")
    except UnicodeDecodeError:
        pass

    name = file.filename or "artifact.bin"
    target = data_dir / f"{digest[:16]}_{name}"
    target.write_bytes(raw)
    row = store.insert(
        "artifacts",
        {
            "id": uid(),
            "graph_id": graph_id,
            "node_id": node_id,
            "user_id": user.id,
            "name": name,
            "mime": file.content_type,
            "storage_path": str(target),
            "size": len(raw),
            "content_hash": digest,
            "manifest": {"scanned": True},
            "created_at": now(),
        },
    )
    if graph_id:
        store.insert(
            "sync_outbox",
            {
                "id": uid(),
                "user_id": user.id,
                "entity_type": "artifact",
                "entity_id": row["id"],
                "operation": "upsert",
                "payload": {"artifact_id": row["id"], "graph_id": graph_id, "name": name},
                "status": "pending",
                "attempts": 0,
                "next_retry_at": None,
                "last_error": None,
                "created_at": now(),
            },
        )
    return row


@router.get("/api/sync/outbox")
def list_outbox(user: User = Depends(current_user), store: Store = Depends(store_dep), status: str | None = None):
    where = {"status": status} if status else None
    return store.list("sync_outbox", where=where, user_id=user.id, order="created_at DESC")


@router.post("/api/sync/outbox/{item_id}/retry")
def retry_outbox(item_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    row = store.get("sync_outbox", item_id, user.id)
    if not row:
        raise not_found("outbox item not found")
    # Local mode: mark sent without calling Atlas; hybrid/atlas adapter lives in plugin
    return store.update(
        "sync_outbox",
        item_id,
        {"status": "sent", "attempts": row["attempts"] + 1, "last_error": None},
        user.id,
    )


@router.get("/api/sync/capability")
def capability(settings: Settings = Depends(get_settings)):
    return {
        "mode": settings.research_graph_mode,
        "atlas_bridge": f"{settings.medhorizon_server_url}{settings.medhorizon_atlas_bridge}",
        "supports": {
            "graphs": True,
            "experiments": True,
            "gepa": True,
            "atlas_projection": settings.research_graph_mode in {"atlas", "hybrid"},
        },
    }
