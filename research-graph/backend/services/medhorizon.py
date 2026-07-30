"""Build MedHorizon session URLs and proxy fork/stage-jump (no MedHorizon core edits)."""

from __future__ import annotations

import base64
from typing import Any

import httpx
from fastapi import HTTPException

from backend.config import Settings


def dir_slug(directory: str) -> str:
    """Match MedHorizon frontend base64Encode (url-safe, no padding)."""
    raw = directory.encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def session_url(web_origin: str, directory: str, session_id: str) -> str:
    origin = web_origin.rstrip("/")
    return f"{origin}/{dir_slug(directory)}/session/{session_id}"


def stage_meta(node: dict[str, Any]) -> dict[str, Any] | None:
    meta = node.get("meta") or {}
    if not isinstance(meta, dict):
        return None
    stage = meta.get("medhorizon_stage")
    return stage if isinstance(stage, dict) else None


def resolve_directory(stage: dict[str, Any], binding: dict | None, fallback: str | None) -> str | None:
    for candidate in (
        stage.get("directory"),
        (binding or {}).get("directory"),
        fallback,
    ):
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return None


def navigate_payload(
    settings: Settings,
    *,
    node: dict[str, Any],
    stage: dict[str, Any],
    directory: str | None,
) -> dict[str, Any]:
    session_id = stage.get("session_id")
    part_id = stage.get("part_id")
    message_id = stage.get("message_id")
    open_url = None
    gateway_url = None
    server_url = None
    if directory and session_id:
        open_url = session_url(settings.medhorizon_web_origin, directory, session_id)
        gateway_url = session_url(settings.gateway_url, directory, session_id)
        server_url = session_url(settings.medhorizon_server_url, directory, session_id)
    return {
        "node_id": node["id"],
        "graph_id": node["graph_id"],
        "session_id": session_id,
        "message_id": message_id,
        "part_id": part_id,
        "stage_name": stage.get("name"),
        "stage_index": stage.get("index"),
        "directory": directory,
        "can_open": bool(open_url),
        "can_branch": bool(directory and session_id and (part_id or message_id)),
        "open_url": open_url,
        "open_url_gateway": gateway_url,
        "open_url_server": server_url,
        "hint": None
        if open_url
        else "Missing MedHorizon directory or session_id on this node. Re-land stage with plugin overlay enabled.",
    }


def medhorizon_branch(
    settings: Settings,
    *,
    session_id: str,
    directory: str,
    part_id: str | None,
    message_id: str | None,
    restore_files: bool = True,
) -> dict[str, Any]:
    base = settings.medhorizon_server_url.rstrip("/")
    params = {"directory": directory}
    headers = {"x-openscience-directory": directory, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=30.0) as client:
            if part_id:
                res = client.post(
                    f"{base}/session/{session_id}/stages/jump",
                    params=params,
                    headers=headers,
                    json={"partID": part_id, "restoreFiles": restore_files},
                )
            elif message_id:
                res = client.post(
                    f"{base}/session/{session_id}/fork",
                    params=params,
                    headers=headers,
                    json={"messageID": message_id},
                )
            else:
                raise HTTPException(status_code=400, detail="part_id or message_id required to branch")
    except httpx.HTTPError as err:
        raise HTTPException(
            status_code=503,
            detail=f"MedHorizon server unreachable at {base}: {err}",
        ) from err

    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"MedHorizon {res.status_code}: {res.text[:500]}")

    data = res.json()
    # stageJump returns { session, stage, ... }; fork returns session Info directly.
    session = data.get("session") if isinstance(data, dict) and "session" in data else data
    new_id = session.get("id") if isinstance(session, dict) else None
    if not new_id:
        raise HTTPException(status_code=502, detail="MedHorizon branch response missing session id")

    return {
        "source_session_id": session_id,
        "session": session,
        "stage": data.get("stage") if isinstance(data, dict) else None,
        "restored": bool(data.get("restored")) if isinstance(data, dict) else False,
        "open_url": session_url(settings.medhorizon_web_origin, directory, new_id),
        "open_url_gateway": session_url(settings.gateway_url, directory, new_id),
        "open_url_server": session_url(settings.medhorizon_server_url, directory, new_id),
    }
