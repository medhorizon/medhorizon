"""Map MedHorizon stage names to Research Graph node kinds (protocol helpers)."""

from __future__ import annotations

# Protocol version for stage → node landing.
PROTOCOL_VERSION = 1

# First matching substring (lowercased stage name) wins.
KIND_HINTS: list[tuple[str, str]] = [
    ("select/apply", "insight"),
    ("select", "insight"),
    ("apply", "insight"),
    ("report", "conclusion"),
    ("hypothesis", "hypothesis"),
    ("evidence", "evidence"),
    ("literature", "literature"),
    ("experiment", "experiment"),
    ("critique", "insight"),
    ("evaluate", "note"),
    ("generate", "note"),
    ("baseline", "note"),
    ("execute", "experiment"),
    ("design", "note"),
    ("discovery", "note"),
]


def suggest_kind(name: str) -> str:
    key = name.strip().lower()
    for needle, kind in KIND_HINTS:
        if needle in key:
            return kind
    return "note"


def stage_title(name: str, index: int | None) -> str:
    if index is None:
        return f"Stage: {name}"
    return f"Stage {index}: {name}"


def idempotency_for(session_id: str, part_id: str | None, name: str, index: int | None) -> str:
    if part_id:
        return f"stage-land:{session_id}:{part_id}"
    idx = index if index is not None else "x"
    return f"stage-land:{session_id}:{idx}:{name.strip().lower()}"
