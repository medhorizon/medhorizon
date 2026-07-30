"""Stage → Research Graph node landing API (MedHorizon stage is source of truth)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store, now, uid
from backend.models.schemas import NodeOut, SessionBindIn, SessionBindOut, StageLandIn
from backend.services.auth import User, current_user
from backend.services.provenance import not_found, record_event, with_idempotency
from backend.services.stage_map import PROTOCOL_VERSION, idempotency_for, stage_title, suggest_kind

router = APIRouter(tags=["stages"])


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


def _binding(store: Store, user: User, session_id: str) -> dict | None:
    rows = store.query(
        "SELECT * FROM session_graph_bindings WHERE session_id=? AND user_id=?",
        (session_id, user.id),
    )
    if not rows:
        return None
    return dict(rows[0])


def _ensure_graph(store: Store, user: User, body: StageLandIn) -> str:
    if body.graph_id:
        if not store.get("graphs", body.graph_id, user.id):
            raise not_found("graph not found")
        return body.graph_id

    if body.session_id:
        bound = _binding(store, user, body.session_id)
        if bound:
            return bound["graph_id"]

    graphs = store.list("graphs", user_id=user.id, order="updated_at DESC")
    active = [g for g in graphs if not g.get("archived")]
    if active:
        gid = active[0]["id"]
        if body.session_id:
            _upsert_binding(store, user, body.session_id, gid)
        return gid

    title = body.create_graph_title or (
        f"MedHorizon session {(body.session_id or 'local')[:8]}"
    )
    row = store.insert(
        "graphs",
        {
            "id": uid(),
            "user_id": user.id,
            "title": title,
            "summary": "Auto-created for MedHorizon stage landing",
            "revision": 1,
            "archived": False,
            "created_at": now(),
            "updated_at": now(),
        },
    )
    if body.session_id:
        _upsert_binding(store, user, body.session_id, row["id"])
    return row["id"]


def _upsert_binding(store: Store, user: User, session_id: str, graph_id: str) -> SessionBindOut:
    stamp = now()
    existing = _binding(store, user, session_id)
    if existing:
        with store.connect() as conn:
            conn.execute(
                "UPDATE session_graph_bindings SET graph_id=?, updated_at=? WHERE session_id=? AND user_id=?",
                (graph_id, stamp, session_id, user.id),
            )
        return SessionBindOut(
            session_id=session_id,
            graph_id=graph_id,
            created_at=existing["created_at"],
            updated_at=stamp,
        )
    with store.connect() as conn:
        conn.execute(
            "INSERT INTO session_graph_bindings (session_id, user_id, graph_id, created_at, updated_at) VALUES (?,?,?,?,?)",
            (session_id, user.id, graph_id, stamp, stamp),
        )
    return SessionBindOut(session_id=session_id, graph_id=graph_id, created_at=stamp, updated_at=stamp)


@router.get("/api/stages/protocol")
def protocol():
    """Machine-readable stage → node landing contract (no MedHorizon core edits)."""
    return {
        "version": PROTOCOL_VERSION,
        "name": "research-graph.stage-landing",
        "source_of_truth": "medhorizon.session.stage",
        "node_link": "nodes.meta.medhorizon_stage",
        "idempotency": "stage-land:{session_id}:{part_id}",
        "hooks": ["tool.execute.after:stage", "experimental.chat.system.transform"],
        "tools": ["atlas_stage", "atlas_graph"],
        "kind_hints": [
            {"match": "design", "kind": "note"},
            {"match": "baseline", "kind": "note"},
            {"match": "execute", "kind": "experiment"},
            {"match": "select", "kind": "insight"},
            {"match": "report", "kind": "conclusion"},
            {"match": "hypothesis", "kind": "hypothesis"},
            {"match": "evidence", "kind": "evidence"},
        ],
        "endpoints": {
            "land": "POST /api/stages/land",
            "bind": "POST /api/sessions/bind",
            "by_session": "GET /api/stages/by-session",
            "protocol": "GET /api/stages/protocol",
        },
    }


@router.post("/api/sessions/bind", response_model=SessionBindOut)
def bind_session(body: SessionBindIn, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    if not store.get("graphs", body.graph_id, user.id):
        raise not_found("graph not found")
    out = _upsert_binding(store, user, body.session_id, body.graph_id)
    record_event(
        store,
        user,
        actor="api",
        event_type="session.bound",
        payload={"session_id": body.session_id, "graph_id": body.graph_id, "reason": body.reason},
        graph_id=body.graph_id,
        session_id=body.session_id,
        message_id=body.message_id,
    )
    return out


@router.get("/api/sessions/bind")
def get_bind(session_id: str, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    bound = _binding(store, user, session_id)
    if not bound:
        raise not_found("no binding for session")
    return {
        "session_id": bound["session_id"],
        "graph_id": bound["graph_id"],
        "created_at": bound["created_at"],
        "updated_at": bound["updated_at"],
    }


@router.post("/api/stages/land", response_model=NodeOut)
def land_stage(body: StageLandIn, user: User = Depends(current_user), store: Store = Depends(store_dep)):
    stage = body.stage
    session_id = body.session_id or ""
    key = body.idempotency_key or idempotency_for(session_id, stage.part_id, stage.name, stage.index)

    def produce():
        graph_id = _ensure_graph(store, user, body)
        kind = body.kind or suggest_kind(stage.name)
        title = body.title or stage_title(stage.name, stage.index)
        content = body.content
        if content is None and stage.summary:
            content = stage.summary
        meta = {
            "medhorizon_stage": {
                "protocol_version": PROTOCOL_VERSION,
                "name": stage.name,
                "index": stage.index,
                "part_id": stage.part_id,
                "status": stage.status,
                "summary": stage.summary,
                "gated": stage.gated,
                "session_id": session_id or None,
                "message_id": body.message_id,
                "source": "api.stages.land",
            }
        }
        row = store.insert(
            "nodes",
            {
                "id": uid(),
                "graph_id": graph_id,
                "user_id": user.id,
                "kind": kind,
                "title": title,
                "content": content,
                "hypothesis": None,
                "summary": stage.summary,
                "lifecycle": "staged",
                "outcome": None,
                "tags": ["medhorizon_stage", f"stage:{stage.name.strip().lower().replace(' ', '_')}"],
                "meta": meta,
                "embedding": None,
                "revision": 1,
                "created_at": now(),
                "updated_at": now(),
            },
        )
        # Link sequentially: previous stage node → this node (parent edge).
        prior = store.query(
            """
            SELECT id FROM nodes
            WHERE user_id=? AND graph_id=?
              AND json_extract(meta, '$.medhorizon_stage.session_id')=?
              AND id!=?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user.id, graph_id, session_id, row["id"]),
        )
        if prior and session_id:
            store.insert(
                "edges",
                {
                    "id": uid(),
                    "graph_id": graph_id,
                    "user_id": user.id,
                    "source_id": prior[0]["id"],
                    "target_id": row["id"],
                    "relation": "derives",
                    "meta": {"reason": "stage sequence"},
                    "created_at": now(),
                },
            )
        record_event(
            store,
            user,
            actor="api",
            event_type="stage.landed",
            payload={
                "node_id": row["id"],
                "stage": stage.name,
                "index": stage.index,
                "part_id": stage.part_id,
                "reason": body.reason,
            },
            graph_id=graph_id,
            session_id=session_id or None,
            message_id=body.message_id,
        )
        return row

    return with_idempotency(store, user, key, produce)


@router.get("/api/stages/by-session", response_model=list[NodeOut])
def stages_by_session(
    session_id: str,
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
):
    rows = store.query(
        """
        SELECT * FROM nodes
        WHERE user_id=? AND json_extract(meta, '$.medhorizon_stage.session_id')=?
        ORDER BY created_at ASC
        """,
        (user.id, session_id),
    )
    out = []
    for row in rows:
        data = store.decode("nodes", row)
        if data:
            out.append(data)
    return out
