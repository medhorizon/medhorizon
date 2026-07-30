"""Auth dependency — JWT when configured, otherwise local DEV_USER_ID."""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

from backend.config import Settings, get_settings


@dataclass
class User:
    id: str
    email: str | None = None


def current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        # Desktop / bundled UI uses this sentinel (loopback-only sidecar).
        if token in ("local-dev", "dev"):
            return User(id=settings.dev_user_id, email="dev@localhost")
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

    if settings.app_env != "production":
        return User(id=settings.dev_user_id, email="dev@localhost")

    raise HTTPException(status_code=401, detail="authorization required")
