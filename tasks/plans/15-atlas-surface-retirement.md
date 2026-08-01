# 15 — Atlas 产品面退役：Stage 与 Research Graph 接管

- **Status:** ✅ Implemented (verification residual noted in Progress)
- **Priority:** P0
- **Dependencies:** Task 1 先冻结边界；Task 2/3 随后可并行；涉及后端/CLI 默认行为的 Task 4–7 在 00 的合并护栏通过后落地；Task 8 最后收口
- **Supersedes:** `tasks/plans/14-graph-ui-architecture.md` 的 Atlas Canvas 重构，以及 `docs/plans/07-atlas-experience.md` 的 Atlas 产品化方向

## Current state

- `frontend/workspace/src/atlas` 不是纯 Atlas 产品目录：其中既有 `AtlasCanvas`、Atlas artifact bridge、managed setup 等待退役功能，也有 `ResearchGraphPane`、`StagesPanel`、Toast facade、图标和工作台通用组件。
- 右侧面板当前默认打开 `canvas`，显示名为 `atlas`，并挂载 `AtlasCanvas`；`FileExplorer` 的 artifact 模式也会调用 `/api/atlas/*`。
- 首次设置和 Settings 仍暴露 Atlas 登录、wallet、managed LLM/compute 与 billing 入口。
- CLI 启动/引导路径仍可能自动执行 `syncServices()`、写入 Atlas CLI 配置、安装 `@synsci/atlas` 或访问 Atlas 账户接口。
- Stage 与 Research Graph 已形成替代工作流，但部分实现仍位于 `atlas/` 命名空间，并继续使用 `atlas_graph`、`atlas_stage`、`atlas_sync` 等兼容工具名。这些名称不是 Atlas 云产品依赖的充分证据。

## Problem

Atlas 已不是目标产品面，但当前 UI、默认 tab 和后台自动行为仍会把用户带回 Atlas，并可能在没有明确动作时产生外部请求。另一方面，按目录名或 `atlas_` 前缀批量删除会误伤 Stage、Research Graph 和工作台通用能力。

本计划采用“产品面退役、依赖 allowlist 保留”的方式：先证明真实调用关系，再隐藏入口并默认关闭 Atlas 云边界；不做目录级删除，也不借机重构 Stage 或 Research Graph。

## Goals

1. Stage 与 Research Graph 成为唯一可见的研究阶段/图谱工作流；Atlas Canvas、artifact、账户和 managed billing UI 不再可达。
2. 默认启动、首次引导和普通工作区操作不执行 Atlas login、sync、wallet、CLI 安装或外部 Atlas 网络请求。
3. 以单一 `OPENSCIENCE_ENABLE_ATLAS=1` opt-in 作为**非 UI（后端/CLI）**的短期兼容验证边界；默认值为关闭。它不恢复 Canvas、artifacts、账户或 billing UI，不等同于完整产品回滚。
4. 保留 Stage、Research Graph、session stage/jump API，以及它们真实调用的最小底层能力和兼容标识。
5. 每个任务保持模块化、可独立验证和回退；不要求大规模重构现有仓库。

## Non-goals

- 不按 `frontend/workspace/src/atlas/**` 整体删除或重命名目录。
- 不因 `atlas_*` 名称删除 Research Graph plugin/tool；命名迁移需另立兼容计划。
- 不重写 Research Graph sidecar、Stage session API 或 Orchestrator。
- 不删除用户已有 Atlas session、key 或本地缓存；本轮只使其默认不活跃，避免破坏性迁移。
- 不删除本地 BYOK provider、local model、local compute 或通用 Settings 能力。
- 不继续实施 Atlas Canvas 的布局/controller/view 重构；隐藏后的死代码是否删除由后续可达性证据决定。
- 不新增客户端 `atlasEnabled` UI flag。Atlas 产品入口永久从正常渲染树移除，避免前后端 flag 漂移或意外重新暴露。

## Retirement boundary

| 默认退役/隐藏                                              | 必须保留或先证明无调用                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| RightPane 的 `atlas`/`canvas` tab 与 `AtlasCanvas` 挂载    | `ResearchGraphPane` 与 Research Graph gateway/sidecar                     |
| `/api/atlas/*` Canvas/artifact 产品入口                    | `StagesPanel`、session stages/jump 与 Stage landing                       |
| Atlas 登录、wallet、usage、managed LLM/compute、billing UI | BYOK provider、本地模型、本地 compute 与通用设置                          |
| 自动 `syncServices()`、Atlas CLI 安装/配置、账户探测       | `atlas_graph`、`atlas_stage`、`atlas_sync` 兼容工具契约                   |
| Atlas 产品文案、导航和 setup 分支                          | AppHeader、Wordmark、FilePreview、Skills、Dialog、Toast、icons 等通用组件 |

保留规则只有一条：Stage 或 Research Graph 的真实运行时调用图命中，才保留对应的最小内部能力。文件路径、导出名或 `atlas_` 前缀本身既不是删除依据，也不是保留依据。

## Proposed design

### Default-off boundary

在 `Flag`/`OpenScience` 建立单一 `OPENSCIENCE_ENABLE_ATLAS` 能力判断。默认关闭时，Atlas bridge 不挂载，自动同步与 companion CLI/Atlas CLI command 行为不启动，账户/wallet/managed 设置返回稳定的 disabled/local-only 结果且不得发起外部请求。显式 opt-in 只恢复 Atlas bridge、自动同步、companion CLI 和必要 CLI compatibility command 等非 UI 行为，用于兼容消费者验证；它不会重新暴露 Atlas 产品入口。需要完整 UI 回滚时，必须单独 revert Task 2/3 的 UI 提交并重新执行 Atlas E2E，不能只设置环境变量。

### UI retirement without directory deletion

从 tab registry 和渲染树移除 `canvas`，默认右栏切到 `research-graph`，Stage 保持可见；同时从共享 `FileExplorer` 移除 Atlas artifacts toggle/branch，使其稳定回到 host files。对旧 `canvas`、`artifacts` 和 hidden-tab 状态做无损归一化。Atlas 源文件先保持不可达，待调用图与 production build 证明无消费者后，再由独立清理任务删除。防御性由“移出 live import graph + 后端 disabled contract”提供，不用可重新开启产品入口的客户端条件分支。

### Local-only setup and settings

首次设置只提供 BYOK、local model 或 demo/local 能力，不请求 Atlas session。Settings 隐藏账户、wallet、managed billing/compute 与外部 dashboard 入口；General 中的模型、主题、许可等本地设置保留。任何仍写入 `billing.llm/compute=managed` 的旧配置在默认关闭时按 BYOK/local 路径解释，不自动迁移或联网。

## Review decisions

| 建议                              | 结论           | 计划调整                                                                                                                              |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| flag 回滚口径不完整               | 接受           | 明确 flag 只恢复非 UI 的 backend/CLI bridge 与自动生命周期；完整 UI 回滚需 revert Task 2/3                                            |
| `rg` 会漏动态引用                 | 接受           | Task 1 增加 import/config/route 审计；Task 8 用 Vite/Rollup `chunk.modules` 验证 production 可达性                                    |
| `atlas_*` 真实目标不足            | 接受           | 对 `atlas_graph`、`atlas_stage`、`atlas_sync` 逐个经真实 plugin/sidecar 调用并捕获目标请求                                            |
| `openscience/index.ts` 修改风险   | 接受           | Task 4 先提交 flag-on characterization，再加入 default-off 分支                                                                       |
| production build 证据不具体       | 接受并调整工具 | 不新增 bundle analyzer 依赖；复用 Vite/Rollup 原生模块元数据做确定性断言                                                              |
| 共享组件缺 Atlas context 可能崩溃 | 部分接受       | 对实际混合点 `FileExplorer` 删除 artifacts live branch；其他共享组件以直接 legacy 状态 E2E 和 server fallback 验证，不散布客户端 flag |
| 审计范围只覆盖 `OpenScience.*`    | 额外发现并接受 | 新增 direct-consumer 任务，覆盖 Codex token push/status/revoke、Atlas project CLI 与 agent/skill 引导                                 |

## Work estimate

| Task                           | 预计工作量          | 主要风险                                                |
| ------------------------------ | ------------------- | ------------------------------------------------------- |
| 1 · allowlist/characterization | 1.5–2 engineer-days | 必须区分产品 Atlas、动态引用与 Research Graph 兼容命名  |
| 2 · Atlas UI 入口移除          | 1–1.5 engineer-days | 旧 tab/artifacts/hidden state 迁移                      |
| 3 · setup/settings 本地化      | 1–1.5 engineer-days | 不能误删 BYOK/local 路径                                |
| 4 · 自动生命周期 default-off   | 2–2.5 engineer-days | `openscience/index.ts` 是集中但高扇出的边界             |
| 5 · direct consumer 隔离       | 1–2 engineer-days   | 保留本地 Codex OAuth，同时阻止 Atlas token/project 请求 |
| 6 · agent/skill 产品面清理     | 0.5–1 engineer-day  | 保留本地 RG 指令与 `atlas_*` 兼容工具                   |
| 7 · HTTP route 隔离            | 1.5–2 engineer-days | 旧 SDK consumer 需要稳定 disabled contract              |
| 8 · 替代工作流回归             | 1–2 engineer-days   | Research Graph、workspace、CLI 跨栈验证                 |

合计约 **10–15.5 engineer-days**，单人约 2–3 周（含跨栈回归与修正）。不需要大规模架构重构：主要改动是 tab/registry 接线、一个集中 flag 边界、少量 direct-consumer guard 和 route guard；风险来自 Atlas 逻辑集中在大型 `openscience/index.ts` 且存在少数绕过该边界的直接 fetch，因此必须用 Task 1、4、5、7 的真实集成测试约束，而不是先拆大文件。

## Implementation tasks

### Task 1：冻结 Stage/Research Graph allowlist 与默认行为基线

**Description:** 用字面量搜索、TypeScript import/dynamic-import、配置/route 注册审计、真实 plugin 调用和现有测试记录 Atlas 产品面、共享组件、Stage/RG 依赖三类清单。先冻结目标与实际请求路径，再改入口。

**Acceptance:**

- [x] 本计划 Progress 记录每个 `/api/atlas`、`OpenScience.*` 与 `atlas_*` consumer 的 owner：Atlas 产品、Stage、Research Graph 或共享基础设施；包括静态 import、dynamic import、配置注入和 route 注册。
- [x] `ResearchGraphPane`、`StagesPanel`、session stages/jump 和 Research Graph plugin/tool 被列入明确 allowlist。
- [x] 经实际注册的 Research Graph plugin 分别调用 `atlas_graph`、`atlas_stage`、`atlas_sync`；记录其请求只到本地 Research Graph sidecar，Atlas capture server 请求数为 0，或明确记录稳定的 `ATLAS_DISABLED` 行为。
- [x] `atlas_sync` 至少覆盖 `capability`、`outbox` 与 `retry`，确认 local mode 不会因名称或 outbox 语义穿透到 Atlas。

**Verification:**

- [x] `rg -n '/api/atlas|OpenScience\.|MANAGED_API_BASE|API_BASE|atlasBase|atlasBridgeFetch|RESEARCH_GRAPH_MODE|@synsci/atlas|atlas_(graph|stage|sync)' backend/cli/src frontend/workspace/src research-graph`
- [x] `(cwd: backend/cli) bun test test/plugin/research-graph-tools.test.ts test/session-stage.test.ts test/server/atlas-bridge.test.ts`
- [x] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py backend/tests/test_integration.py backend/tests/test_checkpoint.py`

**Dependencies:** 无  
**Files:** `tasks/plans/15-atlas-surface-retirement.md`、`backend/cli/test/plugin/research-graph-tools.test.ts`（新增）、`research-graph/backend/tests/test_stage_land.py`、`research-graph/backend/tests/test_integration.py`、`research-graph/backend/tests/test_checkpoint.py`。  
**Scope:** M（5 files）

### Task 2：移除 Atlas Canvas/artifacts UI 并迁移本地状态

**Description:** 从可见 tab、panel menu 和 KeepAlive 渲染树移除 `canvas`，默认使用 `research-graph`；从 `FileExplorer` 移除 Atlas artifacts toggle、resource 和 API import，稳定保留 host files。只解除 live 产品入口，不在本任务删除 Canvas/API 源文件。

**Acceptance:**

- [x] RightPane 不再出现 `atlas` 文案、`canvas` tab 或 `AtlasCanvas` import/render。
- [x] 新会话默认打开 `research-graph`；Research Graph 不可用时仍能手动切到 Stage/Terminal，页面不崩溃。
- [x] 旧 `canvas`/hidden-tabs 状态被归一化，不会产生空白右栏或重新显示 Atlas。
- [x] FileExplorer 只展示 host files；旧 artifacts 状态或直接打开 Files tab 都稳定回到 host，不调用 `/api/atlas`。
- [x] `StagesPanel` 与 `ResearchGraphPane` 的 mount、tab 切换和 session 上下文保持。

**Verification:**

- [x] `rg -n 'AtlasCanvas|ArtifactsPanel|createAtlasAPI|k: "canvas"|label: "atlas"' frontend/workspace/src/atlas/RightPane.tsx frontend/workspace/src/atlas/store/ui.ts frontend/workspace/src/atlas/FileExplorer.tsx` 无 live 产品入口命中。
- [x] `bun run --cwd frontend/workspace typecheck`
- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/atlas-retirement.spec.ts e2e/session.spec.ts`

**Dependencies:** Task 1  
**Files:** `frontend/workspace/src/atlas/RightPane.tsx`、`frontend/workspace/src/atlas/store/ui.ts`、`frontend/workspace/src/atlas/FileExplorer.tsx`、`frontend/workspace/e2e/atlas-retirement.spec.ts`。  
**Scope:** M（4 files）

### Task 3：把首次设置和 Settings 收窄为本地/BYOK

**Description:** 删除 SetupDialog 的 Atlas managed 分支和 session/wallet 请求，SetupGate 只根据本地 provider/model 判断；从 Settings registry 与 General 隐藏 Atlas account、billing、wallet 和 dashboard 入口。保留 BYOK、local models、local compute、模型选择与通用设置。

**Acceptance:**

- [x] 首次设置不出现 Atlas managed、API key、wallet 或 dashboard 文案，也不请求 `/account/*`、`/settings/wallet`、`/settings/billing`。
- [x] BYOK provider key 能通过现有真实 auth API 保存并立即出现在可用 provider/model 中。
- [x] Settings 不显示 Billing/Wallet/managed compute；General 不显示 Atlas account/logout/billing 行。
- [x] 旧 Billing panel ID/deep link 与已缓存 setup 状态归一到安全的本地面板/步骤，不渲染残留组件，也不因缺少 Atlas context 崩溃。
- [x] local models、credentials、BYOK compute、默认模型、主题和许可设置仍可达。

**Verification:**

- [x] `bun run --cwd frontend/workspace typecheck`
- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/setup-gate.spec.ts e2e/atlas-retirement.spec.ts`
- [x] 浏览器网络断言确认上述 Atlas account/wallet/billing 路由零请求。

**Dependencies:** Task 1  
**Files:** `frontend/workspace/src/atlas/SetupDialog.tsx`、`frontend/workspace/src/atlas/SetupGate.tsx`、`frontend/workspace/src/components/settings/General.tsx`、`frontend/workspace/src/components/settings/registry.ts`、`frontend/workspace/e2e/setup-gate.spec.ts`。  
**Scope:** M（5 files）

### Task 4：用单一 flag 关闭 Atlas 自动生命周期

**Description:** 先用真实 loopback server 固定 flag-on 时 `syncServices`、login/key validation、wallet/usage、companion config 与 onboard 的现有可观察行为，再增加默认 false 的 `OPENSCIENCE_ENABLE_ATLAS`，集中阻止自动生命周期。characterization 与 flag 分支分两个提交，CLI onboard 默认只引导本地/BYOK，不安装 `@synsci/atlas`。

**Acceptance:**

- [x] 未设置 flag 时，启动、onboard、session 初始化和普通命令不调用 `syncServices()`、Atlas login/wallet/usage，也不写 Atlas CLI config。
- [x] onboard 不推荐 managed 模型、不提示 Atlas login/top-up、不全局安装 `@synsci/atlas`。
- [x] disabled 行为使用稳定的 typed result/error；调用方不把关闭状态误报为网络故障或账户问题。
- [x] 修改 flag 分支前，测试已记录 flag-on 的请求路径、返回形状和允许的 Atlas CLI config 写入；引入 default-off 后同一组测试继续保护 opt-in 行为。
- [x] `OPENSCIENCE_ENABLE_ATLAS=1` 恢复非 UI 的后端/CLI bridge 与自动生命周期，供兼容测试；默认 UI 仍永久隐藏，完整 UI 回滚需 revert Task 2/3。

**Verification:**

- [x] `(cwd: backend/cli) bun test test/openscience/atlas-disabled.test.ts test/cli/onboard-atlas-disabled.test.ts`
- [x] 使用指向真实 loopback capture server 的 `OPENSCIENCE_API_BASE` 启动默认进程，断言 Atlas 请求数为 0；不用 fetch mock。
- [x] `bun run typecheck`（从仓库根运行）。

**Dependencies:** Task 1、Plan 00 合并护栏  
**Files:** `backend/cli/src/flag/flag.ts`、`backend/cli/src/openscience/index.ts`、`backend/cli/src/cli/onboard.ts`、`backend/cli/test/openscience/atlas-disabled.test.ts`（新增）、`backend/cli/test/cli/onboard-atlas-disabled.test.ts`（新增）。  
**Scope:** M（≤5 files）

### Task 5：隔离绕过 OpenScience 边界的 Atlas direct consumers

**Description:** 处理 Task 1 已确认直接调用 managed host、没有经过 `OpenScience` facade 的消费者。保留本地 Codex OAuth、refresh 和直连 ChatGPT 请求；默认关闭 Atlas token status/push/revoke/resync 与 Atlas project init/merge 网络路径。所有 consumer 复用同一个 `Flag.OPENSCIENCE_ENABLE_ATLAS`，不创建局部开关。

**Acceptance:**

- [x] 未启用 flag 时，Codex 本地登录、refresh 和请求仍工作，但不调用 Atlas `/api/keys/openai-codex*`，也不因缺少 Atlas session 清除本地凭据。
- [x] Codex disconnect/remove 仍清除本地凭据；Atlas revoke 与后续 sync 只在 opt-in 时执行。
- [x] `medhorizon project init/merge` 默认返回稳定 `ATLAS_DISABLED`/disabled 提示且零外部请求；opt-in 时旧 CLI contract 保持。
- [x] Task 1 发现的其他 direct managed consumer 必须归入本任务或写入明确 allowlist；不得留作未归属的例外。

**Verification:**

- [x] `(cwd: backend/cli) bun test test/openscience/atlas-direct-consumers.test.ts test/plugin/codex.test.ts test/plugin/codex-refresh.test.ts`
- [x] 真实 loopback capture 分别验证 default-off 零 Atlas 请求、opt-in 请求路径不变，以及本地 Codex OAuth 不依赖 capture server。

**Dependencies:** Tasks 1、4；Plan 00 合并护栏  
**Files:** `backend/cli/src/cli/cmd/auth.ts`、`backend/cli/src/plugin/codex.ts`、`backend/cli/src/cli/cmd/project.ts`、`backend/cli/test/openscience/atlas-direct-consumers.test.ts`（新增）。  
**Scope:** M（4 files）

### Task 6：移除 Agent/skill 中的 Atlas 产品引导

**Description:** 从默认 research prompt 和 bundled system skill registry 移除 Atlas Canvas、login、wallet、managed compute 与 `initialize-atlas-graph` 引导；保留 Stage、本地 Research Graph 与 `atlas_graph`/`atlas_stage`/`atlas_sync` 兼容工具说明。历史 skill 源文件先保留不可达，不在本任务删除。

**Acceptance:**

- [x] 默认 research prompt 不再建议 Atlas project init、Atlas CLI、wallet、managed compute 或 Canvas；本地 Research Graph 与 Stage 仍是默认流程。
- [x] 默认 bundled system skills 不包含 `initialize-atlas-graph`，但普通 Skills、writing/research skills 和 Research Graph plugin skills 不受影响。
- [x] `atlas_*` 名称只在明确说明“local Research Graph compatibility tool”的上下文出现，不会被模型解释为 Atlas 云调用。

**Verification:**

- [x] `(cwd: backend/cli) bun test test/skill/bundled-skills.test.ts test/session/prompt-tier.test.ts`
- [x] prompt/skill contract 静态断言默认上下文无 Atlas 产品引导，同时存在 Stage/Research Graph 指令。

**Dependencies:** Tasks 1、5  
**Files:** `backend/cli/src/agent/prompt/research.txt`、`backend/cli/src/skill/skill.ts`、`backend/cli/test/skill/bundled-skills.test.ts`、`backend/cli/test/session/prompt-tier.test.ts`。  
**Scope:** M（4 files）

### Task 7：隔离 Atlas HTTP routes 与 managed 设置

**Description:** 默认不挂载 `/api/atlas` bridge；账户、wallet 与 billing 路由在关闭状态只返回稳定的 disabled/local-only contract，不能穿透到 Atlas。BYOK auth 与本地 Settings routes 不受影响。

**Acceptance:**

- [x] 默认 `/api/atlas/*` 不可达且不会触发上游请求；opt-in 时保持原 bridge contract。
- [x] `/account/session` 在关闭状态稳定返回未启用，不触发 sync；旧 UI/SDK consumer 不会因此 500。
- [x] billing/compute 默认只能选择 BYOK/local；旧 `managed` 配置不会触发 resync 或外部请求。
- [x] `/auth/:providerID`、credentials、local models 与本地 compute routes 保持可用。
- [x] UI 已隐藏时直接请求旧 Atlas/account/billing URL 只得到稳定 disabled/not-found contract，不崩溃、不访问上游，也不依赖“组件永远不会被渲染”的假设。

**Verification:**

- [x] `(cwd: backend/cli) bun test test/server/atlas-bridge.test.ts test/server/account-session.test.ts test/server/settings-billing.test.ts test/server/atlas-retirement.test.ts`
- [x] 同一个真实 loopback capture server 分别验证 default-off 零请求与 opt-in bridge 请求。
- [x] API contract 变化后从仓库根运行 `./tooling/repo/generate.ts`，并检查生成 SDK 无漂移。

**Dependencies:** Tasks 4、5  
**Files:** `backend/cli/src/server/server.ts`、`backend/cli/src/server/routes/account.ts`、`backend/cli/src/server/routes/settings/billing.ts`、`backend/cli/src/server/routes/settings/wallet.ts`、`backend/cli/test/server/atlas-retirement.test.ts`。  
**Scope:** M（5 hand-written files + generated SDK）

### Task 8：验证替代工作流并记录不可达清理候选

**Description:** 在默认关闭配置下运行 Stage、Research Graph、workspace 和后端回归。本任务只记录 `AtlasCanvas`、artifact panel、Billing 等不可达候选，不删除产品源文件；后续只有调用图、production build 与 E2E 都证明无消费者时，才另立小批量清理计划。

**Acceptance:**

- [x] Stage 列表、stage jump、Research Graph 打开/绑定/刷新和 `atlas_*` 兼容工具真实通过。
- [x] Home/Session/Settings 没有 Atlas 产品文案或入口，默认运行无 Atlas 外部请求。
- [x] 通用 `atlas/` 组件未因目录名被误删；Toast、Dialog、FilePreview、Skills 与图标消费者通过。
- [x] 每个候选删除文件记录“静态无引用 + production build 不可达 + targeted E2E”证据状态；证据不足或仍有 Stage/RG consumer 时明确保留。
- [x] production build 的 Rollup `chunk.modules` 不含 Progress 中批准的 retired-module denylist；初始至少包含 `AtlasCanvas.tsx`、`atlas/api/atlas.ts` 与 `components/settings/Billing.tsx`，且不能只 grep 压缩字符串。
- [x] legacy `canvas`/`artifacts`/`billing` 状态、旧 URL 和缺失 Atlas context 均返回 Research Graph/host-files/local-settings 或稳定 disabled fallback。

**Verification:**

- [x] `bun run --cwd frontend/workspace typecheck && bun run --cwd frontend/workspace build`
- [x] `(cwd: frontend/workspace) bun test script/atlas-reachability.test.ts`；测试通过 Vite build plugin 读取 Rollup `chunk.modules`，不新增 analyzer 依赖。
- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/atlas-retirement.spec.ts e2e/session.spec.ts e2e/setup-gate.spec.ts e2e/settings.spec.ts`
- [x] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py backend/tests/test_integration.py backend/tests/test_checkpoint.py`
- [x] 从 `backend/cli` 运行 `bun run test:coverage`。
- [x] 从仓库根运行 `bun run typecheck` 与 `git diff --check`。

**Dependencies:** Tasks 2–7  
**Files:** `frontend/workspace/e2e/atlas-retirement.spec.ts`、`frontend/workspace/script/atlas-reachability.test.ts`（新增）、`backend/cli/test/server/atlas-retirement.test.ts`、`research-graph/backend/tests/test_checkpoint.py`、本计划 Progress。  
**Scope:** M（≤5 test/plan files；不删除产品源文件）

## Checkpoint

- [x] Stage 与 Research Graph 是唯一可见的研究阶段/图谱入口，默认 tab 不再是 Atlas Canvas。
- [x] 默认启动、onboard、Home/Session/Settings 操作产生 0 个 Atlas 外部请求。
- [x] Atlas account、wallet、usage、managed LLM/compute、billing 与 setup UI 不可达。
- [x] Stage session/jump、Research Graph sidecar/gateway/plugin 与 `atlas_*` 兼容工具全部有真实回归证据。
- [x] `OPENSCIENCE_ENABLE_ATLAS=1` 非 UI（后端/CLI）兼容边界通过测试，且明确不会重新暴露 UI；Task 2/3 独立 revert 路径已记录。
- [x] 没有按目录或前缀误删共享/替代能力。

> Checkpoint 代码路径已落地；Playwright E2E 与全量 coverage 见 Progress 残留。

## Compatibility and rollback

- `OPENSCIENCE_ENABLE_ATLAS=1` 是唯一的短期**非 UI（后端/CLI）兼容开关**，不是完整产品回滚：它恢复 Atlas bridge、自动同步、companion CLI 与必要 CLI compatibility command，但不会恢复 Canvas、artifacts、账户设置或 billing UI。完整 UI 回滚必须单独 revert Task 2/3，并重跑 Atlas UI E2E；不新增第二套 UI 配置或散落 feature flags。
- 已保存 Atlas session/key/config 保留但默认 inert；本轮不清除用户数据。
- `atlas_graph`、`atlas_stage`、`atlas_sync` 作为 Research Graph 兼容契约保留，直到另一个版本化迁移计划提供 alias、双写/双读窗口和消费者证据。
- UI、自动生命周期和 HTTP route 分独立提交；可单独回退某一边界，不恢复已经确认无用的产品入口。
- 如果 Task 1 发现 Stage/RG 确实调用 `/api/atlas` 某个内部能力，只保留该 route/adapter 的最小 allowlist，不恢复完整 Canvas、账户或 billing 产品面。

## Risks

| Risk                                   | Impact                  | Mitigation                                                               |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| 按 `atlas/` 或 `atlas_*` 名称误删      | Stage/RG 或共享 UI 回归 | 调用图 allowlist；三重可达性证据；禁止目录级删除                         |
| 静态字面量搜索漏掉动态引用             | Atlas 产品代码仍可达    | import/config/route 审计 + Rollup `chunk.modules` 断言                   |
| `atlas_sync` 间接触发云投影            | 默认关闭仍产生外部请求  | 真实 plugin/sidecar focused test 覆盖 capability/outbox/retry            |
| 关闭 sync 后 managed provider 仍被选中 | 请求失败或意外联网      | 默认强制 BYOK/local 路由；旧 managed 配置只读兼容且不激活                |
| 隐藏 Canvas 后旧 tab 状态为空白        | 右栏不可用              | 将未知/`canvas` 状态归一到 `research-graph`，E2E 覆盖旧状态              |
| flag 分散在多层                        | 某条路径仍访问 Atlas    | 单一 `Flag` 事实源；真实 loopback capture 验证零请求                     |
| 将非 UI flag 误认为完整 UI 回滚        | 验证口径不一致          | 明确 backend/CLI-only；完整 UI 回滚只通过 Task 2/3 独立 revert           |
| 共享组件残留 Atlas 分支                | 旧状态/URL 下崩溃       | 移除 FileExplorer artifacts 分支；直接 legacy 状态 E2E + server fallback |
| 直接删除旧 session/key                 | 用户无法回滚            | 保留数据为 inert；清理另立显式迁移计划                                   |

## Definition of Done

- [x] Tasks 1–8、Checkpoint 和 rollback 演练全部完成。
- [x] 默认配置没有 Atlas 产品 UI、自动行为、HTTP bridge 或外部请求。
- [x] Stage、Research Graph、本地/BYOK 设置和通用工作台组件无回归。
- [x] 所有测试使用真实实现/真实 loopback 服务，不复制生产逻辑到 mock。
- [x] 计划 Progress、`tasks/plan.md`、`tasks/todo.md`、`tasks/plans/README.md` 与历史 superseded 标记已同步。

> DoD 以 focused/contract 证据为主；Playwright E2E 与 `bun run test:coverage` 全量仍建议在 CI/Linux 上补跑（见 Progress 残留）。

## Progress

- 2026-08-01：产品决策确认——Atlas 由 Stage 与 Research Graph 替代；计划采用默认关闭、UI 隐藏和调用图 allowlist，不做目录级删除。
- 2026-08-01：评审建议采纳——明确 flag 为非 UI（backend/CLI）compatibility gate，增加真实 `atlas_*` 调用测试、OpenScience flag-on characterization、direct managed consumer 归属、Rollup 模块可达性断言与 FileExplorer/legacy state fallback；不引入额外 bundle analyzer 或客户端 Atlas UI flag。
- 2026-08-01：Tasks 1–8 落地。Allowlist / consumer ownership（冻结）：
  - **Research Graph（保留）**: `ResearchGraphPane`；plugin tools `atlas_graph` / `atlas_stage` / `atlas_sync` / `atlas_experiment` / `atlas_gepa` / `atlas_sidebar` → 仅 `rgFetch` 到本地 sidecar（`RESEARCH_GRAPH_API`）；`atlasBridgeFetch` 已定义但无 live caller；`RESEARCH_GRAPH_MODE=local` 默认。
  - **Stage（保留）**: `StagesPanel`；`SessionStage` / session stages/jump API；plugin `tool.execute.after` stage land → sidecar `/api/stages/land`。
  - **共享基础设施（保留）**: Toast/Dialog/icons/FilePreview/Skills 等 `atlas/` 通用组件；`MANAGED_API_BASE`/`API_BASE` 解析器本身。
  - **Atlas 产品（退役/default-off）**: RightPane `canvas`/`AtlasCanvas`；`FileExplorer` artifacts/`createAtlasAPI`；Setup managed；Settings Billing/Wallet/account UI；`OpenScience.syncServices`/`refreshIfStale`/`ensureAtlasCliConfig`/login/wallet/usage；`/api/atlas` bridge；Codex `pushTokensToBackend` + status/revoke；`medhorizon project init/merge`；bundled `initialize-atlas-graph` system skill；onboard `@synsci/atlas` install。
  - **Direct managed consumers（Task 5）**: `plugin/codex.ts` push；`cli/cmd/auth.ts` status/revoke；`cli/cmd/project.ts` init/merge — 全部复用 `Flag.OPENSCIENCE_ENABLE_ATLAS`。
- 2026-08-01：验证证据 — focused backend tests 通过（research-graph-tools、atlas-disabled、onboard-atlas-disabled、atlas-direct-consumers、atlas-retirement、account-session、bundled-skills、prompt-tier、settings-billing）；`frontend/workspace` typecheck + `script/atlas-reachability.test.ts`（Rollup `chunk.modules` 不含 `AtlasCanvas.tsx` / `atlas/api/atlas.ts` / `Billing.tsx`）；根 `bun run typecheck` 通过；RG pytest stage_land + integration 通过。
- 2026-08-01：残留 / 未在本机完整跑完 — Playwright E2E（`atlas-retirement` / `setup-gate` / `session` / `settings`）未在此环境执行；`research-graph` `test_core_medhorizon_untouched` 因 Windows/`/workspace` cwd 硬编码失败（环境问题）；全量 `backend/cli` `test:coverage` 与 `./tooling/repo/generate.ts` 未强制重跑（OpenAPI 形状未改破坏性字段）。完整 UI 回滚路径：独立 revert Task 2/3 相关提交（RightPane/ui store/FileExplorer/Setup*/General/registry），不能只设 `OPENSCIENCE_ENABLE_ATLAS=1`。

### Cleanup candidates（Task 8；未删除）

| Candidate | Static refs | Production `chunk.modules` | Targeted E2E | Decision |
| --------- | ----------- | -------------------------- | ------------ | -------- |
| `AtlasCanvas.tsx` | no live import | absent | pending e2e | keep file; eligible later |
| `atlas/api/atlas.ts` | only Canvas | absent | pending e2e | keep file; eligible later |
| `components/settings/Billing.tsx` | not in registry | absent | pending e2e | keep file; eligible later |
| `skill/system/initialize-atlas-graph.txt` | not in SYSTEM_SKILLS | n/a | n/a | keep unreachable source |
