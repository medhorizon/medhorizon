"""MedHorizon integration surface — sidebar card contract (no MedHorizon core edits)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse, HTMLResponse

from backend.config import Settings, get_settings
from backend.db.sqlite import Store, get_store
from backend.services.auth import User, current_user

router = APIRouter(tags=["integration"])
STATIC = Path(__file__).resolve().parents[1] / "static" / "embed"


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings.sqlite_path)


def card_payload(settings: Settings, store: Store, user: User) -> dict:
    graphs = store.list("graphs", user_id=user.id, order="updated_at DESC")
    experiments = store.list("experiments", user_id=user.id, order="updated_at DESC")
    gepa = store.list("gepa_runs", user_id=user.id, order="updated_at DESC")
    active = [g for g in graphs if not g.get("archived")]
    awaiting = [g for g in gepa if g.get("status") == "awaiting_gate"]
    latest = active[0] if active else None
    ui = settings.ui_url.rstrip("/")
    return {
        "id": "research-graph-sidebar-card",
        "kind": "sidebar_card",
        "placement": "medhorizon.session_sidebar.top",
        "title": "Research Graph",
        "subtitle": "图谱 · 实验 · GEPA",
        "status": "ok" if settings else "unknown",
        "mode": settings.research_graph_mode,
        "prominence": "featured",
        "metrics": {
            "graphs": len(active),
            "experiments": len(experiments),
            "gepa_awaiting_gate": len(awaiting),
        },
        "latest_graph": (
            {"id": latest["id"], "title": latest["title"]} if latest else None
        ),
        "cta": {
            "label": "打开研究图谱",
            "href": ui,
            "target": "_blank",
        },
        "actions": [
            {"id": "open_ui", "label": "打开 UI", "href": ui},
            {"id": "open_experiments", "label": "实验", "href": f"{ui}/experiments"},
            {"id": "open_search", "label": "Search+AI", "href": f"{ui}/search"},
            {
                "id": "open_latest",
                "label": "最近图谱",
                "href": f"{ui}/graphs/{latest['id']}" if latest else ui,
                "disabled": latest is None,
            },
        ],
        "embed": {
            "script": f"{settings.public_api_url.rstrip('/')}/embed/sidebar-card.js",
            "iframe": f"{ui}/embed/card",
            "gateway": settings.gateway_url,
        },
        "api": {
            "manifest": "/integration/manifest",
            "card": "/integration/sidebar-card",
            "health": "/health",
        },
    }


@router.get("/integration/manifest")
def manifest(settings: Settings = Depends(get_settings)):
    """Machine-readable contract for MedHorizon overlays / agents / gateway."""
    api = settings.public_api_url.rstrip("/")
    ui = settings.ui_url.rstrip("/")
    return {
        "name": "research-graph",
        "version": "0.3.1",
        "medhorizon": {
            "modifies_core": False,
            "integration": "http_interface_plus_embed",
            "config_overlay": "OPENSCIENCE_CONFIG_DIR → research-graph/medhorizon-plugin/config",
        },
        "surfaces": [
            {
                "id": "sidebar_card",
                "type": "featured_card",
                "description": "Prominent Research Graph card for MedHorizon session sidebar",
                "endpoints": {
                    "card": f"{api}/integration/sidebar-card",
                    "script": f"{api}/embed/sidebar-card.js",
                    "iframe": f"{ui}/embed/card",
                },
                "inject": {
                    "selector": ".session-sidebar",
                    "position": "prepend",
                    "via": "gateway_or_bookmarklet",
                },
            }
        ],
        "plugin_tools": ["atlas_graph", "atlas_experiment", "atlas_gepa", "atlas_sync", "atlas_sidebar"],
        "env": {
            "RESEARCH_GRAPH_API": api,
            "RESEARCH_GRAPH_UI": ui,
            "RESEARCH_GRAPH_MODE": settings.research_graph_mode,
            "MEDHORIZON_ORIGIN": settings.medhorizon_web_origin,
        },
    }


@router.get("/integration/sidebar-card")
def sidebar_card(
    user: User = Depends(current_user),
    store: Store = Depends(store_dep),
    settings: Settings = Depends(get_settings),
):
    return card_payload(settings, store, user)


@router.get("/embed/sidebar-card.js")
def embed_script():
    path = STATIC / "sidebar-card.js"
    return FileResponse(path, media_type="application/javascript; charset=utf-8")


@router.get("/embed/sidebar-card.css")
def embed_css():
    path = STATIC / "sidebar-card.css"
    return FileResponse(path, media_type="text/css; charset=utf-8")


@router.get("/embed/bookmarklet", response_class=HTMLResponse)
def bookmarklet(settings: Settings = Depends(get_settings)):
    script = f"{settings.public_api_url.rstrip('/')}/embed/sidebar-card.js"
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>RG Sidebar Bookmarklet</title>
<style>body{{font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}}
code,a{{word-break:break-all}}</style></head><body>
<h1>Research Graph 侧边栏卡片</h1>
<p>不修改 MedHorizon 源码。任选其一：</p>
<ol>
<li><b>网关</b>：运行 <code>bun run research-graph/scripts/medhorizon-gateway.ts</code>，打开网关 URL。</li>
<li><b>书签</b>：把下面链接拖到书签栏，在 MedHorizon 页面点击一次即可注入卡片。</li>
</ol>
<p><a href="javascript:(()=>{{const s=document.createElement('script');s.src='{script}';s.dataset.rgApi='{settings.public_api_url.rstrip('/')}';document.documentElement.appendChild(s);}})();">注入 Research Graph 卡片</a></p>
<p>脚本地址：<code>{script}</code></p>
</body></html>"""


@router.options("/integration/sidebar-card")
@router.options("/integration/manifest")
def options_ok() -> Response:
    return Response(status_code=204)
