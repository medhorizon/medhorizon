---
name: atlas-sidebar
description: Surface the Research Graph featured sidebar card inside MedHorizon without editing MedHorizon core (gateway inject or bookmarklet).
---

# Research Graph · MedHorizon 侧栏突出卡片

## 原则

- **不修改** MedHorizon `frontend/workspace` / `backend/cli` 源码。
- 通过 HTTP 集成接口 + 嵌入脚本 / 网关注入实现侧栏突出卡片。

## 启用

```bash
# 1) Research Graph API + UI
cd research-graph/backend && python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
cd research-graph/frontend && npm run dev -- --host 127.0.0.1 --port 5173

# 2) MedHorizon 正常启动（例如 web @4444 / serve @4096）

# 3) 网关（推荐）：代理 MedHorizon 并注入侧栏卡片
bun research-graph/scripts/medhorizon-gateway.ts
# 打开 http://127.0.0.1:5199
```

或访问书签页：`http://127.0.0.1:8000/embed/bookmarklet`

## Agent 工具

- `atlas_sidebar` action=`card` → 实时卡片 JSON（图谱/实验/待门控计数）
- `atlas_sidebar` action=`manifest` → 集成契约
- `atlas_sidebar` action=`inject_hint` → 网关/书签说明

用户问“研究图谱在哪”时：返回卡片 CTA URL，并提示经网关打开 MedHorizon 可在会话侧栏顶部看到突出卡片。
