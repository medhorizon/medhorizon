# 14 - Graph UI 数据、布局与渲染架构清理

> **Superseded — 2026-08-01:** Atlas Canvas 产品面将按 [15-atlas-surface-retirement.md](15-atlas-surface-retirement.md) 隐藏并默认关闭，本计划不得继续实施。下文仅保留历史审计；若 Research Graph UI 本身需要架构拆分，应基于其实际代码另立计划，不复用 Atlas Canvas 的目标模块。

**Status:** Superseded  
**Priority:** —  
**Dependencies:** 由 `15-atlas-surface-retirement.md` 取代。

## Current state

- `frontend/workspace/src/atlas/AtlasCanvas.tsx` 约 1,721 行，混合 graph API resources、folder→project resolution、localStorage、8 秒轮询、mutation、force simulation、pan/zoom/drag、SVG、detail drawer 与 empty/error heroes。
- 文件顶部仍描述 orbit/cards/timeline 三视图，代码也保留 layered/CardNode 分支；但 `mode()` 已固定为 `orbit`，注释明确 cards/timeline retired。原总计划“保持三种视图”与当前产品事实不符。
- `frontend/workspace/src/atlas/api/atlas.ts` 手写 Atlas DTO、`fetch`、错误解析和 route；`AtlasCanvas`、`FileExplorer`、`NodeDetail` 直接消费它。
- `AtlasCanvas` 直接读写 `thesis-canvas-positions-v1` 与 `thesis-graph-id-v1`，并直接管理 timer/window/document events。
- 现有 `frontend/workspace/e2e/atlas-bridge.spec.ts` 已覆盖 connected/unavailable、edge、pan/zoom、fit 与 detail drawer，是可复用 characterization 基线。

## Problem

数据、副作用、布局和 view 同文件，任何 API/资源状态变化都可能重热 simulation 或影响 SVG；手写 DTO 会与 Hono/SDK route 漂移。退休视图的不可达分支继续扩大测试面，并让“行为保持”目标含糊。

## Goals

1. 明确当前产品只支持 orbit；在截图/交互基线保护下移除不可达 cards/timeline 分支。
2. Atlas bridge API 以服务端契约 + 生成 SDK 为类型事实源，workspace 不再复制 DTO/route。
3. 把 graph normalization、orbit step、label collision、fit bounds 抽为纯函数并覆盖 cycle/孤点/缺父节点/稳定位置。
4. controller 独占 resources、polling、selection、localStorage 和 mutation；view 不直接 fetch/localStorage。
5. 保持当前 URL、localStorage keys、orbit interaction、empty/error states 与 detail behavior。

## Non-goals

- 不重新引入 cards/timeline，也不做视觉换肤或新的 graph 分析功能。
- 不重写 Research Graph sidecar/FastAPI/React UI，也不合并两套 graph 产品。
- 不更改 Atlas backend graph 算法、数据模型或权限语义。
- 不把 controller 扩展成全局状态框架；只服务 Atlas canvas/相邻 artifact consumer。

## Proposed design

### Target modules

```text
atlas/AtlasCanvas.tsx             composition facade
atlas/graph/controller.ts         resources, polling, persistence, actions
atlas/graph/orbit.ts              pure graph/simulation/fit/label functions
atlas/graph/CanvasView.tsx        SVG + pointer/keyboard rendering
atlas/graph/NodeDetail.tsx        detail/artifact presentation
atlas/api/atlas.ts                temporary thin generated-SDK adapter, then removable
```

controller 接收 SDK client、storage、clock/visibility adapters，便于用实际 contract 响应测试副作用；production 传浏览器实现。Orbit functions 不读取 DOM/Storage/SDK。View 只接受 state/actions，不创建 resource 或 timer。

### API boundary

Plan 04 先稳定同源路由与 SDK 生成链路；本计划再给既有 Atlas bridge `/api/atlas/*` 增加稳定 schema，并运行根目录 `./tooling/repo/generate.ts`。workspace 从 `@synsci/sdk` 导入请求/响应类型；迁移期间 `createAtlasAPI()` 只是薄 adapter，全部 consumer 完成后删除。

### Compatibility and rollback

- 保留 `AtlasCanvas` export、`/api/atlas/*` URL、`thesis-canvas-positions-v1` 与 `thesis-graph-id-v1`；不清空用户 pin/selection。
- SDK route 是 additive；迁移期 adapter 保留原方法名，便于逐 consumer 回滚。
- cards/timeline 当前不可达；删除前用 runtime assertion/e2e 证明没有设置入口，并保留 orbit screenshot。若发现可达入口，停止删除并先由产品确认。
- controller/view split 分 commit；任何 screenshot/interaction regression 可独立 revert，无数据 migration。

## Implementation tasks

### Task 1: 固定 orbit 行为并清除退休模式

**Description:** 用现有 E2E 和新增纯行为测试确认只有 orbit 可达，再删除 Mode union、layered layout、CardNode 与不可达 JSX/CSS 分支。

**Acceptance:**

- [ ] repo 中没有可把 AtlasCanvas 切到 cards/timeline 的 runtime/config/localStorage 入口。
- [ ] orbit 的 node/edge count、pan/zoom/fit、drag/pin、tooltip/detail、empty/error 行为不变。
- [ ] 顶部文档与实际 orbit-only 产品一致。
- [ ] 删除不可达代码后 screenshot 像素差在批准阈值内；若不一致则停止而非更新基线掩盖。

**Verification:**

- [ ] 运行 `atlas-bridge.spec.ts` connected/unavailable 路径。
- [ ] 增加 orbit light/dark、360/768/1440 screenshot 和 mode-unreachable 静态断言。

**Dependencies:** Task 8 截图基线。  
**Files:** `frontend/workspace/src/atlas/AtlasCanvas.tsx`、`frontend/workspace/e2e/atlas-bridge.spec.ts`、`frontend/workspace/e2e/atlas-canvas-visual.spec.ts`、相关 CSS（仅删除不可达 selector）。  
**Scope:** M（4 hand-written files）

### Task 2: 迁移到生成 SDK 契约

**Description:** 将 Atlas DTO/request/error contract 移到 server route schema 与生成 SDK；逐步把 Canvas/FileExplorer/NodeDetail 的手写 client 替换为 SDK adapter。

**Acceptance:**

- [ ] workspace 不再声明 `AtlasNode/GraphTreeResponse/NodesListResponse/AtlasArtifact` 的重复接口。
- [ ] `atlas/api/atlas.ts` 不直接 `fetch` 或拼 `/api/atlas` URL；只包装生成 client，最终可删除。
- [ ] graph/project/artifact 错误使用稳定 code/status，不解析任意错误字符串。
- [ ] API 变化能在 `./tooling/repo/generate.ts` 后由 TypeScript 暴露到所有 consumer。

**Verification:**

- [ ] backend Atlas route contract tests + SDK generation clean diff 检查。
- [ ] workspace typecheck、Atlas/FileExplorer focused tests 与现有 e2e 通过。

**Dependencies:** Plan 04 的 SDK 生成链路完成；本任务为 Atlas bridge 补齐自己的 OpenAPI schema。  
**Files:** `backend/cli/src/server/routes/atlas-bridge.ts`（仅缺失 schema 时）、`frontend/workspace/src/atlas/api/atlas.ts`、`frontend/workspace/src/atlas/AtlasCanvas.tsx`、`frontend/workspace/src/atlas/FileExplorer.tsx`、生成 SDK（机械生成）。  
**Scope:** M（4 hand-written files + generated SDK）

### Task 3: 抽取纯 Orbit layout/model

**Description:** 把 node/link normalization、initial/saved positions、simulation step、label collision 和 fit bounds 抽到无副作用模块。

**Acceptance:**

- [ ] 纯函数不访问 Solid、DOM、Storage、SDK、timer 或随机全局状态。
- [ ] 测试覆盖 cycle、孤点、缺失 parent、multiple roots、staged edge、saved pin 与稳定输入顺序。
- [ ] 相同 nodes/saved/viewport 输入产生稳定初始 model 与 fit；no-op refetch 不重热 simulation。
- [ ] 当前 force constants、node radius/outcome/lifecycle mapping 和 fit 结果保持。

**Verification:**

- [ ] Bun 单测对真实 Atlas node fixtures 运行 normalization/step/fit/labels。
- [ ] connected graph e2e 的 node/edge count、fit transform、zoom/drag 行为保持。

**Dependencies:** Tasks 1–2。  
**Files:** `frontend/workspace/src/atlas/graph/orbit.ts`、`frontend/workspace/src/atlas/graph/orbit.test.ts`、`frontend/workspace/src/atlas/AtlasCanvas.tsx`、`frontend/workspace/src/atlas/graph/fixtures.ts`。  
**Scope:** M（4 files）

### Task 4: 拆分 controller 与 SVG view

**Description:** 将 resources、folder resolution、selection/persistence、visibility polling、create/init/refetch 和 artifact loading移入 controller；SVG/pointer 渲染移入 view/detail 组件。

**Acceptance:**

- [ ] `CanvasView.tsx` 不出现 `fetch/createResource/localStorage/setInterval`；只消费 state/actions。
- [ ] `controller.ts` 不操作 SVG/DOM transform，不渲染 JSX。
- [ ] polling 仅在 visible 时运行，cleanup 后没有 timer/listener；folder graph 自动选择只执行一次并尊重手动选择。
- [ ] 原 storage keys、8 秒刷新、init/create/refetch、error-vs-empty 和 artifact drawer 语义不变。

**Verification:**

- [ ] controller test 使用真实 SDK contract-shaped responses 与可控 clock/storage adapter，覆盖 cleanup、visibility、selection、error、mutation。
- [ ] workspace typecheck、Atlas e2e、截图和 accessibility smoke 全部通过。

**Dependencies:** Task 3。  
**Files:** `frontend/workspace/src/atlas/graph/controller.ts`、`frontend/workspace/src/atlas/graph/controller.test.ts`、`frontend/workspace/src/atlas/graph/CanvasView.tsx`、`frontend/workspace/src/atlas/graph/NodeDetail.tsx`、`frontend/workspace/src/atlas/AtlasCanvas.tsx`。  
**Scope:** M（5 files）

### Task 5: 收口 adapter 与依赖边界

**Description:** 迁完最后 consumer，删除无用 adapter/DTO/import，增加边界守卫并记录最终模块图。

**Acceptance:**

- [ ] `frontend/workspace/src/atlas` 中 Atlas bridge 调用只通过生成 SDK/controller；无手写 `/api/atlas` fetch。
- [ ] view 层无 storage/network/resource 副作用；pure layout 无 Solid/browser import。
- [ ] `createAtlasAPI` 若无 consumer 则删除；若暂留，明确 owner 与删除条件。
- [ ] 最终文件职责、依赖方向和 storage/API compatibility 写入本计划 Progress。

**Verification:**

- [ ] 静态 dependency grep/test、workspace typecheck、Playwright Atlas suite、screenshots 全通过。
- [ ] 从 repo root 运行 `./tooling/repo/generate.ts` 后无未提交的 SDK 漂移。

**Dependencies:** Task 4。  
**Files:** `frontend/workspace/src/atlas/api/atlas.ts`（删除或收窄）、`frontend/workspace/src/atlas/AtlasCanvas.tsx`、`frontend/workspace/src/atlas/graph/*` 边界测试、本计划 Progress。  
**Scope:** S（≤4 hand-written files）

## Checkpoint

- [ ] Orbit-only 事实与文档一致，不再携带不可达视图代码。
- [ ] DTO/route 由服务端 schema + 生成 SDK 单一维护。
- [ ] layout/model 可纯函数测试，controller/view 副作用边界清晰。
- [ ] storage keys、API URL、interaction、empty/error/detail 行为兼容。
- [ ] typecheck、contract、unit、e2e、screenshots、a11y 全部通过。

## Risks

| Risk                          | Impact                    | Mitigation                                                               |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| 退休模式其实仍有隐藏入口      | 删除用户功能              | 静态搜索 + runtime assertion + 产品确认；发现入口即停止                  |
| 抽取 simulation 改变位置      | screenshot/交互漂移       | 固定 constants/order；pure golden + fit e2e；不随意更新基线              |
| SDK schema 不完整             | 前端被迫回到 any/手写 DTO | 先为 managed Atlas bridge route 补 schema；SDK migration 是硬依赖        |
| controller adapter 变成新巨石 | 复杂度搬家                | state/actions 最小接口；layout 与 view 不能反向依赖 controller internals |
| localStorage key 变化丢 pin   | 用户布局重置              | 原 key 原格式保持；任何迁移先双读单写并可回滚                            |

## Definition of done

- [ ] Tasks 1–5 与 checkpoint 全部通过。
- [ ] 所有行为/API/storage 兼容和 rollback 条件有自动化证据。
- [ ] 生成 SDK 无漂移，workspace 无重复 Atlas DTO/手写 route。
- [ ] Atlas connected/unavailable、pan/zoom/fit/drag/detail/init/create/artifact 流程无回归。
- [ ] 最终架构职责与依赖方向已记录并经 review。
