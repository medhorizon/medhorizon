"""OpenAI helpers — graceful degrade when key missing."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from backend.config import Settings, get_settings


class OpenAIUnavailable(HTTPException):
    def __init__(self):
        super().__init__(
            status_code=503,
            detail={
                "error": "OPENAI_UNAVAILABLE",
                "message": "Set OPENAI_API_KEY in research-graph/.env to enable AI endpoints.",
            },
        )


def require_openai(settings: Settings | None = None) -> Settings:
    settings = settings or get_settings()
    if not settings.openai_ready:
        raise OpenAIUnavailable()
    return settings


async def embed_texts(texts: list[str], settings: Settings | None = None) -> list[list[float]]:
    settings = require_openai(settings)
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    response = await client.embeddings.create(model="text-embedding-3-small", input=texts)
    return [item.embedding for item in response.data]


async def chat(
    messages: list[dict[str, str]],
    *,
    model: str = "gpt-4o-mini",
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = require_openai(settings)
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    response = await client.chat.completions.create(model=model, messages=messages)
    choice = response.choices[0].message
    return {
        "content": choice.content or "",
        "model": model,
        "usage": response.usage.model_dump() if response.usage else {},
    }


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
