"""Shared error contract for plugin ↔ API (also imported by tests)."""

RESEARCH_GRAPH_UNAVAILABLE = "RESEARCH_GRAPH_UNAVAILABLE"


def unavailable(message: str) -> dict[str, str]:
    return {"error": RESEARCH_GRAPH_UNAVAILABLE, "message": message}
