# 12 - Orchestration 运行轨迹 UI 与灰度

**Status:** Planned  
**Priority:** P2  
**Dependencies:** `01-task-result-contract.md`、`09-orchestrator-mvp.md`、`10-subagent-scheduler.md` 的 TaskRun metadata，以及 `11-orchestrator-evaluation.md` 的上线门槛。

## Current state

- `frontend/ui/src/components/message-part.tsx` 已有专用 `task` renderer，可展示 child tool summary、child permission/question，并通过 `data.navigateToSession` 跳转 child session。
- TaskTool 已持续写入 `metadata.summary/sessionId/model`，前端无需新建第二套父子 graph 或轮询 child transcript。
- 当前 renderer 没有 queued/running/partial/failure/cancelled/timeout 的统一显示，也没有 wait/run duration 或 terminal reason。
- 会话已有统一 Stop/Abort 控件；TaskTool 已向 child 传播父 abort。UI 应验证并复用，不再造一套 task-card cancellation API。

## Problem

用户只能看到“某个 agent 正在委派”和 child 工具列表，无法快速判断谁在排队、运行了多久、最终是 partial/failure/cancel/timeout，失败时还需要阅读原始 tool JSON。若另造独立运行 graph，会与 MessageV2/TaskTool 状态产生双事实源。

## Goals

1. 在现有 task card 内显示 worker、queued/running/terminal、wait/run duration、简短失败原因与 child 跳转。
2. 复用 TaskTool part metadata、现有 child permission/question 和 session navigation。
3. success、partial、failure、cancelled、timeout 有可区分的视觉与无障碍语义，不能只依赖颜色。
4. 父会话 Stop 操作能在 2 秒内反映 child cancelled；terminal 状态不闪回 running/success。
5. Orchestrator 保持显式可选；评测门槛前不替换默认 research。

## Non-goals

- 不构建持久化 DAG、Gantt、独立 orchestration 后端或 child transcript 副本。
- 不在 card 内实现新的 child abort endpoint；取消复用 session abort。
- 不把完整 TaskResult failures/assumptions 或原始工具输出默认展开到主会话。
- 不在本计划内重新设计整个 SessionTurn、Toast 或全局视觉系统。

## Proposed design

### Single source of truth

`ToolPart.state.metadata.run`（plan 10）是运行摘要，`metadata.summary` 继续是 child tool 摘要，`metadata.sessionId` 继续负责 navigation。UI 使用安全 parser：新 metadata 存在时渲染轨迹；旧 metadata 或解析失败时退回当前 task renderer。

### TaskTrajectory component

新增小组件而非继续膨胀 `message-part.tsx`：

- header：worker + description + status badge；
- body：queued/wait、running duration、terminal duration/reason；
- details：复用现有 child tool summary 和 permission/question slot；
- action：已有 child session link；父会话运行时提示使用当前 Stop 控件。

`aria-live=polite` 只播报 meaningful transitions（running、terminal），不播报每个 tool summary 更新。图标 + 文本共同区分 terminal；reduced-motion 下禁用 pulse。

### Compatibility and rollback

- 新 `run` metadata 是 additive；旧 session/旧 backend 自动走现有渲染 fallback。
- 保留 `metadata.summary/sessionId/model` 和 `data.navigateToSession`，不改路由或 Session API。
- 组件集成可由一个 UI feature flag/metadata presence 关闭；回滚只恢复旧 task renderer，不影响 backend child execution。
- 未知未来状态显示为中性 “task status unavailable”，不错误映射为 success。

## Implementation tasks

### Task 1: 建立前端 metadata parser 与 view model

**Description:** 为 TaskRun metadata 写安全解析和纯 view-model 转换，兼容旧 session、未知字段和不完整时间戳。

**Acceptance:**

- [ ] 解析 queued/running/五种 terminal，并拒绝非法 terminal reversal/负 duration。
- [ ] 旧 metadata 缺少 `run` 时返回 legacy variant，不抛异常。
- [ ] unknown/malformed 显示 unknown，不默认 success。
- [ ] view model 不包含 prompt、tool args、完整 result body 或敏感路径。

**Verification:**

- [ ] 表驱动单测覆盖每个状态、旧 metadata、未知状态、缺时间戳与 malformed payload。
- [ ] 测试直接消费真实 TaskRun schema fixture，而不是复制后端转移逻辑。

**Dependencies:** Plan 10 TaskRun schema 定稿。  
**Files:** `frontend/ui/src/components/task-trajectory.tsx`、`frontend/ui/src/components/task-trajectory.test.tsx`。  
**Scope:** S（2 files）

### Task 2: 实现可访问的轨迹组件

**Description:** 渲染 worker、status、duration、reason、child link 与 progress semantics，并适配 light/dark/reduced-motion。

**Acceptance:**

- [ ] queued、running、success、partial、failure、cancelled、timeout 都有文本 + 图标，非只靠颜色。
- [ ] failure reason 只显示稳定 code/短 message；长内容链接到 child session。
- [ ] terminal transition 通过 `aria-live` 播报一次；持续 duration 不造成播报风暴或焦点跳动。
- [ ] keyboard 可打开 child session；360px 宽度无溢出/遮挡。

**Verification:**

- [ ] 组件测试覆盖可访问名称、keyboard、reduced-motion 与所有状态。
- [ ] light/dark + queued/running/terminal component screenshots。

**Dependencies:** Task 1。  
**Files:** `frontend/ui/src/components/task-trajectory.tsx`、`frontend/ui/src/components/task-trajectory.css`、`frontend/ui/src/components/task-trajectory.test.tsx`、`frontend/ui/src/components/message-part.css`。  
**Scope:** M（4 hand-written files；locale catalog 更新为机械变更）

### Task 3: 接入现有 task renderer

**Description:** 在 `message-part.tsx` 的 task registry 中使用 TaskTrajectory，同时保留 child permission/question 与 tool summary 行为。

**Acceptance:**

- [ ] metadata.run 存在时显示新轨迹；旧 task part 的视觉和导航保持当前行为。
- [ ] child permission/question 仍可在父 card 中响应，且不会被轨迹折叠隐藏。
- [ ] subtitle/child action 都使用现有 `navigateToSession`，无新 URL 拼接。
- [ ] 父 Stop 后 card 进入 cancelled，迟到完成不会闪成 success。

**Verification:**

- [ ] frontend/ui focused tests 覆盖 legacy、新 metadata、permission、question、navigation。
- [ ] workspace integration 以真实 SSE/part update 验证 running → terminal。

**Dependencies:** Task 2；plan 10 TaskTool metadata 已接入。  
**Files:** `frontend/ui/src/components/message-part.tsx`、`frontend/ui/src/components/message-part.css`、`frontend/ui/src/components/task-trajectory.tsx`、相邻测试。  
**Scope:** M（4 files）

### Task 4: 完成 parent/child E2E 与灰度保护

**Description:** 用 Playwright 验证真实 parent/child 委派、失败、取消、跳转和截图；把 agent 默认范围与 eval gate 绑定。

**Acceptance:**

- [ ] literature/code/graph/fan-out 至少各一条轨迹可见并可跳 child。
- [ ] partial/failure/cancelled/timeout 无需打开原始 JSON 即可识别。
- [ ] 父 Stop 后 child 在 2 秒内终止，UI terminal 与 backend TaskResult 一致。
- [ ] orchestrator 只作为可选 agent；gate 未通过时没有配置/代码把它设为默认。

**Verification:**

- [ ] Playwright parent/child E2E + 360/768/1440、light/dark screenshots。
- [ ] accessibility smoke 检查 status name、live region、keyboard navigation 和 reduced-motion。

**Dependencies:** Task 3；plan 11 gate 结果。  
**Files:** `frontend/workspace/e2e/orchestration.spec.ts`、`frontend/workspace/e2e/orchestration-a11y.spec.ts`、`frontend/workspace/src/pages/session.tsx`（仅在需要暴露既有 Stop 状态时）、截图基线。  
**Scope:** M（3 hand-written files + generated screenshots）

## Checkpoint

- [ ] 新旧 task metadata 均可渲染，旧 session 无回归。
- [ ] 用户能读出 worker、状态、耗时、失败原因并进入 child session。
- [ ] 取消、timeout 和迟到完成与 backend 契约一致。
- [ ] 核心视口/主题截图与 accessibility smoke 通过。
- [ ] Orchestrator 仍受 plan 11 gate 控制，未被提前设为默认。

## Risks

| Risk                            | Impact                | Mitigation                                                      |
| ------------------------------- | --------------------- | --------------------------------------------------------------- |
| UI 建立第二事实源               | backend/UI 状态不一致 | 只消费 ToolPart metadata；不轮询重建 run graph                  |
| streaming 更新造成抖动/播报风暴 | 可用性与 a11y 回归    | meaningful transition 才播报；duration 视觉更新不进 live region |
| 旧 session metadata 解析失败    | 历史记录打不开        | safe parser + legacy fallback + unknown state                   |
| card 信息过载                   | 主会话难阅读          | header 摘要，tool details 维持现有折叠；长失败去 child          |
| 新取消按钮产生权限/API 分叉     | 双重取消语义          | 复用父会话 Stop/Abort，不新增 endpoint                          |

## Definition of done

- [ ] Tasks 1–4 与 checkpoint 全部通过。
- [ ] UI unit/integration、Playwright、screenshots、a11y checks 已运行并记录。
- [ ] legacy session、permission/question、child navigation 与 parent stop 无回归。
- [ ] 兼容 fallback 和 UI rollback 已验证。
- [ ] 默认 agent 范围仍由 plan 11 的机器门槛决定。
