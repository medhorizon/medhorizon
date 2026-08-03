# 22 — 将 EvidenceGraph 交互迁移到现有 Research Graph

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** Plan 21 artifact/provenance identity contract；Plans 03/04 的 Research Graph supervisor/gateway；Plan 15 Atlas 退役边界
- **Coordination:** 只扩展 `research-graph/backend`、`research-graph/frontend` 与既有 gateway/integration；严禁引入 OpenScience 2.0 `EvidenceGraph.tsx`、独立 graph store、Atlas RightPane 或第二个 graph tab
- **Source:** OpenScience 2.0 EvidenceGraph 的 filtering、focus、evidence detail 和 source navigation 交互思想；实现目标是 MedHorizon 当前 Research Graph

## Current state

- MedHorizon 已有独立 `research-graph/` sidecar：FastAPI backend、SQLite graph 数据、React `GraphView/GraphCanvas/NodePanel/ProvenancePanel` 和 workspace `ResearchGraphPane`。
- Plans 03/04 已把 sidecar 生命周期、同源 gateway、capability 与 authoritative session→graph binding 作为先决边界；浏览器不应直连动态 sidecar 端口。
- backend CLI 另有小型 local provenance DAG 和 review tools；Plan 21 将为 project artifacts 冻结 stable artifact ID、content version、annotation 与 provenance refs。
- OpenScience 2.0 的 `EvidenceGraph.tsx` 在 Atlas surface 提供 kind/verdict filter、node focus、邻居探索、evidence detail 与来源跳转，但属于已退役的 Atlas 产品路径。
- Plan 15 已规定 Stage 与 Research Graph 是唯一可见研究阶段/图谱入口，因此任何 evidence 体验必须进入现有 Research Graph，而不是复活 Atlas Canvas 或并排第二张图。

## Problem

MedHorizon 的证据数据和 Research Graph 尚未形成统一的可操作体验：artifact、run、source、claim 与 review evidence 可能存在，却缺少稳定投影、过滤、聚焦、邻居探索、详情和回源。如果直接复制 `EvidenceGraph.tsx`，会产生第二套 graph state/API/UI，并与 RG 的 graph/node/edge ownership 冲突。需要把“交互模式”移植到 RG 的现有 node/edge/read model，以幂等 upsert 和稳定 ref 连接 Plan 21，而不是迁移旧 Atlas 实现。

## Goals

1. 定义 project artifact/local provenance 到现有 RG node/edge 的版本化、幂等 evidence projection；RG 仍是唯一用户可见 graph 事实源。
2. 复用 RG 现有 graph、node、edge table/API/store 和 GraphView/GraphCanvas；不创建第二套 database、route namespace、frontend store 或 tab。
3. 在现有图上增加 kind/status/verdict/severity/source filters、搜索、聚焦、相邻节点探索和一键 reset。
4. 在现有 NodePanel/ProvenancePanel 增加 artifact version、annotation/review evidence、lineage 与稳定 source deep link。
5. artifact 内容变化、rename/delete 或 projection lag 时显示 stale/missing，不静默删除历史证据。
6. 保持无 evidence 项目和旧 graph 的原行为、性能、路由与回退。

## Non-goals

- 不添加 `EvidenceGraph.tsx`、`evidenceGraphStore`、`/evidence-graph` route、Evidence tab 或独立 graph database/table family。
- 不恢复 Atlas Canvas、RightPane、artifacts toggle、managed sync 或 `/api/atlas/*`。
- 不让 workspace 浏览器直接读取 CLI local provenance 文件或 sidecar 动态端口。
- 不以 filesystem scan 作为 GraphView 每次 render 的隐式副作用；projection 必须显式、可重试、可观测。
- 不把 Plan 21 annotation storage 复制进 RG；RG node metadata 只持稳定 ref/summary，详情按授权 gateway 获取。
- 不在本计划重新设计 RG layout engine、实验/GEPA 模型或 Stage workflow。
- 不对已存在的普通 RG node 强制迁移为 evidence node；evidence fields 应 additive。

## Single-graph invariants

```text
Plan 21 project artifact + local provenance
                  │ explicit, idempotent projection
                  ▼
existing Research Graph node/edge API + SQLite store
                  │
                  ▼
existing GraphView → GraphCanvas → NodePanel/ProvenancePanel
```

- 一个 project/session 只解析到 Plans 03/04 绑定的现有 RG graph。
- artifact ref 存在 RG node metadata/external ref 中，不能成为另一份 graph 的 primary key。
- projection 使用 deterministic external ref + source version upsert；重复执行不新增重复 node/edge。
- source 消失时保留 RG node/edge 并标记 `missing`；source version 变化标记 `stale` 直到新 projection 完成。
- 用户 filter/focus 是 GraphView 的 view state，不写入 graph facts；review/annotation 修改仍走其权威 API。

## Implementation tasks

### Task 1：冻结现有 RG 行为与 evidence projection/read-model contract

**Description:** Characterize 当前 RG graph/node/edge schema、GraphView routing、selection/layout 和 gateway binding；定义 Plan 21 artifact/provenance refs 如何 additive 映射到现有 node/edge metadata、状态、summary 和 deep link。

**Acceptance:**

- [ ] 记录现有 graph/node/edge API、SQLite tables、frontend query/cache/selection 和 URL contract，并建立 no-evidence baseline。
- [ ] projection mapping 覆盖 artifact、run、source、claim、supports/refutes/produced/consumed/derived-from，未知 kind/relation 有明确策略。
- [ ] deterministic external ref、source version、upsert key、idempotency、stale/missing 和 conflict 语义由 versioned schema 固定。
- [ ] contract 明确 RG node ID 与 Plan 21 artifact ID 不等价，只通过 external ref 映射；annotation 只存 ref/count/status summary。
- [ ] architecture test/allowlist 明确禁止新 graph DB/table family、route namespace、store、tab 和 `EvidenceGraph` import。
- [ ] deep link 格式使用现有 RG graph route + node selection 参数，刷新与分享后可恢复 focus。

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_api.py backend/tests/test_integration.py backend/tests/test_evidence_projection.py -k contract`
- [ ] `(cwd: research-graph/frontend) bun run build`
- [ ] `rg -n 'EvidenceGraph|evidence.graph|evidenceGraphStore|/evidence-graph' frontend research-graph backend/cli` 基线已记录
- [ ] 计划评审确认 single-graph invariants 与 projection schema

**Dependencies:** Plan 21 Task 1 identity contract；Plans 03/04 contract 可先按 planned schema 评审，实施前必须冻结

**Files:**

- `research-graph/backend/models/schemas.py`
- `research-graph/frontend/src/lib/api.ts`
- `research-graph/backend/tests/test_evidence_projection.py`（新增 contract test）
- `tasks/plans/22-research-graph-evidence-interactions.md`

**Scope:** M — backend/frontend contract tests 与计划 schema

### Task 2：在现有 RG API/store 实现幂等 evidence projection

**Description:** 扩展现有 integration/service，把 Plan 21 typed refs 映射为当前 graph 的 node/edge upsert；沿用已有 graph authorization、SQLite transaction 与 route namespace，并记录 projection receipt/lag，而不增加第二份 graph storage。

**Acceptance:**

- [ ] projection 解析到 Plans 03/04 authoritative graph binding；无 binding、错误 project 或无权限时不猜 graph。
- [ ] 同一 payload 重放 10 次后 node/edge count 不变；partial retry 和并发 upsert 不产生 duplicate edge/node。
- [ ] source version 更新在同一 mapped node 上更新 evidence metadata/状态；不丢历史 edge，冲突有确定 receipt。
- [ ] source missing/stale 通过 existing node metadata/status 表达，不物理删除 evidence 或破坏 lineage。
- [ ] transaction failure 不留下半个 projection；receipt 只有 counts/refs/status/timing，不记录 annotation body、文件内容、绝对路径或 token。
- [ ] 实现只使用现有 graph/node/edge repositories/tables 和 integration route family；没有新 evidence graph database/store/namespace。
- [ ] projection endpoint 有 payload/count/deadline 限制，拒绝跨 graph refs 和 dangling edge，错误可重试。

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_evidence_projection.py backend/tests/test_api.py backend/tests/test_integration.py`
- [ ] DB schema/introspection assertion 证明没有新增第二套 graph/node/edge table family
- [ ] idempotent/concurrent/partial-failure/stale/missing focused cases 通过

**Dependencies:** Task 1；Plan 21 Task 3 artifact detail/provenance API；Plans 03/04

**Files:**

- `research-graph/backend/services/provenance.py`
- `research-graph/backend/routers/integration.py`
- `research-graph/backend/models/schemas.py`
- `research-graph/backend/tests/test_evidence_projection.py`
- `backend/cli/src/server/routes/research-graph.ts`（仅在需要 server-to-sidecar adapter 时修改）

**Scope:** M — 3 个 RG implementation files、1 个 test、最多 1 个 CLI adapter

## Checkpoint A：唯一图谱与幂等投影

- [ ] projection 始终写入 authoritative existing RG graph，无法绑定时 fail closed。
- [ ] 重放、并发、partial failure、source update/delete 都无 duplicate/dangling/静默丢失。
- [ ] DB/API/frontend 没有第二套 graph namespace/store/tab，Atlas surface 未恢复。
- [ ] 无 Plan 21 evidence 的旧 graph API/route/render output 与 baseline 等价。
- [ ] RG backend focused tests 与 CLI gateway contract tests 通过。

### Task 3：在现有 GraphView 增加过滤、聚焦与邻居探索

**Description:** 把 EvidenceGraph 的交互思想实现为 `GraphView/GraphCanvas` 的 additive view model：kind/status/verdict/severity/source filter、搜索、选中 focus、1-hop/lineage 邻居、dim/hide 与 reset；继续使用现有 graph fetch/store 和 layout，并为当前无 test script 的 RG frontend 建立最小 Vitest focused runner。

**Acceptance:**

- [ ] filters 作用于当前 RG graph read model，不触发第二次 graph fetch 或构造独立持久 store；组合条件结果确定。
- [ ] focus 可由点击、搜索结果或 URL node 参数进入；reset 恢复全图与原 layout/selection 行为。
- [ ] 1-hop/lineage exploration 只使用现有 nodes/edges 或既有 node trace API，dangling/missing node 有可见状态。
- [ ] hide/dim 策略、visible counts 与 filter chips 一致；0 结果保留 reset，不显示空白画布。
- [ ] 键盘可访问 filter、search result、node focus 和 reset；focus ring、ARIA status 与 reduced motion 合格。
- [ ] 5k nodes/10k edges representative graph 的 filter/focus 操作达到 Task 1 冻结预算，不因每次 keystroke 重跑昂贵 layout。
- [ ] 普通 RG node 无 evidence fields 时仍可过滤/选中/打开 detail，不抛错。
- [ ] frontend `test` script 与 test dependencies 只服务真实 view-model/component 行为，不复制 layout/filter 实现到测试。

**Verification:**

- [ ] `(cwd: research-graph/frontend) bun run test`
- [ ] `(cwd: research-graph/frontend) bun run build`
- [ ] 浏览器性能测试记录 5k/10k fixture 的 filter/focus 响应和 layout invocation count
- [ ] keyboard/a11y focused test 通过

**Dependencies:** Task 2、Checkpoint A

**Files:**

- `research-graph/frontend/src/pages/GraphView.tsx`
- `research-graph/frontend/src/components/GraphCanvas.tsx`
- `research-graph/frontend/src/lib/evidence.ts`（新增纯 view-model helpers）
- `research-graph/frontend/src/lib/evidence.test.ts`（新增）
- `research-graph/frontend/package.json`
- `research-graph/frontend/bun.lock`（生成）

**Scope:** M — 3 个 implementation files、1 个 focused test 与 test manifest/lock

### Task 4：扩展现有详情面板、证据状态与来源跳转

**Description:** 在 `NodePanel/ProvenancePanel` 展示 artifact version/status、review verdict/severity、annotation summary、lineage 与 source link；deep link 通过现有同源 gateway 打开 Files/Inspector 或 RG node，不直接访问磁盘/sidecar。

**Acceptance:**

- [ ] artifact detail 显示 stable external ref、project-relative path、content version、current/stale/missing、renderer kind 与 provenance edges。
- [ ] claim/review 显示 supports/refutes、severity、evidence summary 和目标节点；annotation 只按需加载权威 Plan 21 detail，不复制存储。
- [ ] “Open source/artifact” 使用 typed route/deep link，在现有 FileView/Plan 21 Inspector 打开；路径被删/改名时显示 missing 而非 silent close。
- [ ] RG node URL 刷新、前进/后退与分享后恢复 graph + focus；invalid node 保留 graph 并显示可恢复错误。
- [ ] detail request 竞态、graph 切换和 projection lag 不显示上一个 node 数据；失败与 empty 分开。
- [ ] 浏览器只访问 Plans 03/04 同源 gateway，不持 sidecar token、不读 absolute path、不调用 `/api/atlas/*`。

**Verification:**

- [ ] `(cwd: research-graph/frontend) bun run test`
- [ ] `(cwd: research-graph/frontend) bun run build`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/research-graph-evidence.spec.ts`
- [ ] network capture 证明只使用同源 gateway，Atlas/动态 sidecar origin 为零请求

**Dependencies:** Task 3；Plan 21 Task 5 Inspector；Plan 04 gateway

**Files:**

- `research-graph/frontend/src/components/NodePanel.tsx`
- `research-graph/frontend/src/components/ProvenancePanel.tsx`
- `research-graph/frontend/src/lib/api.ts`
- `research-graph/frontend/src/pages/GraphView.tsx`
- `frontend/workspace/e2e/research-graph-evidence.spec.ts`（新增）

**Scope:** M — 4 个 implementation files、1 个 cross-surface E2E

### Task 5：锁定 graph uniqueness、性能、回退与证据闭环

**Description:** 从真实 project artifact/provenance 创建 projection，验证 RG filter→focus→detail→source→inspector→back 的完整闭环；覆盖重放、变化/删除、无 evidence、sidecar 重启和 flag rollback。

**Acceptance:**

- [ ] project artifact、run、source、claim/review 投影到现有绑定 graph，filter/focus/neighbor/detail/source 全链路可用。
- [ ] projection 重放/并发/sidecar restart 后无重复 node/edge，URL focus 与 inspector ref 稳定。
- [ ] 修改/删除 artifact 后 RG 显示 stale/missing，历史 evidence/edge 保留；重新投影后状态恢复 current。
- [ ] 无 project artifacts、无 local provenance 或 feature flag off 时 RG 的旧 dashboard/graph/node 行为不变且可直接回退。
- [ ] 5k/10k graph 满足冻结性能预算，无无限 request/layout loop、listener leak 或失控 DOM。
- [ ] repository scan 证明没有 `EvidenceGraph.tsx`、第二套 graph store/route/tab/database 或恢复的 Atlas surface。

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests`
- [ ] `(cwd: research-graph/frontend) bun run test && bun run build`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/research-graph-evidence.spec.ts e2e/project-artifacts.spec.ts`
- [ ] `(cwd: repository root) bun run typecheck`
- [ ] `rg -n 'EvidenceGraph|evidenceGraphStore|/evidence-graph|createAtlasAPI' research-graph frontend/workspace/src backend/cli/src` 无禁止项新增命中

**Dependencies:** Task 4

**Files:**

- `research-graph/backend/tests/test_evidence_projection.py`
- `research-graph/frontend/src/lib/evidence.test.ts`
- `frontend/workspace/e2e/research-graph-evidence.spec.ts`
- `frontend/workspace/e2e/project-artifacts.spec.ts`
- `tasks/plans/22-research-graph-evidence-interactions.md`（记录证据）

**Scope:** M — backend/frontend/cross-surface regression 与计划证据

## Checkpoint B

- [ ] Research Graph 是唯一可见 graph，所有 evidence interactions 使用现有 graph/node/edge contract。
- [ ] projection 幂等且 fail closed；重复、更新、删除、重启无 duplicate/dangling/静默证据丢失。
- [ ] filter/focus/neighbor/detail/deep link 在真实浏览器可访问、可恢复并满足性能预算。
- [ ] 无 evidence 的旧项目行为不变，projection/UI 可独立回退。
- [ ] Atlas product surface、动态 sidecar browser access 和第二套 graph storage/UI 均不存在。

## Compatibility and rollback

- projection schema/metadata additive；旧 RG frontend 忽略未知 evidence fields，旧 graph/node/edge 继续可用。
- evidence interaction 受单一 RG feature flag/shadow telemetry 控制时，flag off 只隐藏新 controls，不改变 graph facts。
- 回退 frontend 后 projection nodes 仍是合法普通 RG nodes；不得需要 DB destructive migration。
- 回退 projection adapter 不删除已投影 node/edge；可由 status/ref 区分来源并后续审计。
- Plan 21 Inspector 和 project artifact API 不依赖 Plan 22 才能工作；RG 不可用时 Files/Inspector 仍可访问本地 evidence。

## Definition of done

- [ ] Tasks 1–5 与 Checkpoint A/B 全部完成并记录证据。
- [ ] EvidenceGraph 的核心交互已迁入现有 RG GraphView/GraphCanvas/NodePanel，而非复制旧组件。
- [ ] artifact/provenance projection 幂等、可重试、可诊断，stale/missing 不静默丢失。
- [ ] 没有第二套 graph database、route namespace、frontend store、tab 或 Atlas surface。
- [ ] RG backend tests、frontend tests/build、workspace E2E 与根级 typecheck 通过。
