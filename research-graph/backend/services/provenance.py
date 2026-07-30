"""Idempotency helpers and provenance event writer."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

from fastapi import HTTPException

from backend.db.sqlite import Store, now, uid
from backend.services.auth import User


def digest(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def with_idempotency(
    store: Store,
    user: User,
    key: str | None,
    producer: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    if not key:
        return producer()

    with store.connect() as conn:
        row = conn.execute(
            "SELECT response FROM idempotency_keys WHERE key=? AND user_id=?",
            (key, user.id),
        ).fetchone()
        if row:
            return json.loads(row["response"])

    result = producer()
    with store.connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO idempotency_keys (key, user_id, response, created_at) VALUES (?,?,?,?)",
            (key, user.id, json.dumps(result, default=str), now()),
        )
    return result


def record_event(
    store: Store,
    user: User,
    *,
    actor: str,
    event_type: str,
    payload: dict[str, Any],
    graph_id: str | None = None,
    session_id: str | None = None,
    message_id: str | None = None,
) -> dict[str, Any]:
    scrubbed = {
        k: v
        for k, v in payload.items()
        if "key" not in k.lower() and "secret" not in k.lower() and "token" not in k.lower()
    }
    return store.insert(
        "provenance_events",
        {
            "id": uid(),
            "user_id": user.id,
            "graph_id": graph_id,
            "session_id": session_id,
            "message_id": message_id,
            "actor": actor,
            "event_type": event_type,
            "payload": scrubbed,
            "created_at": now(),
        },
    )


def conflict(msg: str) -> HTTPException:
    return HTTPException(status_code=409, detail=msg)


def bad_request(msg: str) -> HTTPException:
    return HTTPException(status_code=400, detail=msg)


def not_found(msg: str = "not found") -> HTTPException:
    return HTTPException(status_code=404, detail=msg)
