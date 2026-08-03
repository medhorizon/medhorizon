"""Auth dependency — managed capability first, then JWT / explicit dev bypass."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

from backend.config import Settings, get_settings

DEV_TOKENS = ("local-dev", "dev")


@dataclass
class User:
    id: str
    email: str | None = None


def _dev_user(settings: Settings) -> User:
    return User(id=settings.dev_user_id, email="dev@localhost")


def _require_managed_capability(settings: Settings, authorization: str | None) -> None:
    """Reject unless the exact managed capability is presented (timing-safe).

    When no capability is configured this is a no-op, so /health stays
    unauthenticated for infrastructure probes in deployed mode. JWT decoding and
    dev tokens must never fall through to this path's outcome: the comparison is
    the only acceptance test.
    """
    expected = settings.research_graph_managed_capability
    if not expected:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="capability required")
    token = authorization.split(" ", 1)[1].strip()
    if not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="invalid capability")


def managed_capability(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Optional capability gate — only enforces when managed capability is configured."""
    _require_managed_capability(settings, authorization)


def current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.research_graph_managed_capability:
        # Managed sidecar mode: the capability is the sole credential. Only the exact
        # configured value is accepted; a valid JWT or dev token cannot satisfy it.
        _require_managed_capability(settings, authorization)
        return _dev_user(settings)

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token in DEV_TOKENS:
            if not settings.research_graph_allow_dev_tokens:
                raise HTTPException(status_code=401, detail="dev tokens not enabled")
            return _dev_user(settings)
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        except jwt.PyJWTError as err:
            raise HTTPException(status_code=401, detail="invalid token") from err
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="token missing sub")
        return User(id=str(sub), email=payload.get("email"))

    if settings.research_graph_allow_dev_tokens:
        return _dev_user(settings)

    raise HTTPException(status_code=401, detail="authorization required")
