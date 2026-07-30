"""Markdown import/export helpers for graph nodes."""

from __future__ import annotations

import re
from typing import Any


FRONT = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)


def node_to_markdown(node: dict[str, Any]) -> str:
    tags = node.get("tags") or []
    meta = "\n".join(
        [
            "---",
            f"id: {node.get('id','')}",
            f"kind: {node.get('kind','note')}",
            f"lifecycle: {node.get('lifecycle','staged')}",
            f"title: {node.get('title','')}",
            f"tags: {','.join(tags) if isinstance(tags, list) else tags}",
            "---",
            "",
            node.get("content") or node.get("summary") or "",
            "",
        ]
    )
    return meta


def markdown_to_node(text: str, graph_id: str) -> dict[str, Any]:
    kind = "note"
    title = "Imported note"
    lifecycle = "staged"
    tags: list[str] = []
    body = text.strip()
    m = FRONT.match(text.strip())
    if m:
        header, body = m.group(1), m.group(2).strip()
        for line in header.splitlines():
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            key, val = key.strip(), val.strip()
            if key == "kind":
                kind = val
            elif key == "title":
                title = val
            elif key == "lifecycle":
                lifecycle = val
            elif key == "tags" and val:
                tags = [t.strip() for t in val.split(",") if t.strip()]
    if not title or title == "Imported note":
        first = body.splitlines()[0].lstrip("# ").strip() if body else title
        title = first or title
    return {
        "graph_id": graph_id,
        "kind": kind,
        "title": title,
        "content": body,
        "lifecycle": lifecycle,
        "tags": tags,
        "summary": body[:240] if body else None,
    }
