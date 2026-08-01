# 10 - Subagent 调度、取消与超时

**Status:** Planned  
**Priority:** P1  
**Dependencies:** `01-task-result-contract.md`；`09-orchestrator-mvp.md` 的 agent/worker 注册。评测与默认启用分别由 plans 11、12 承接。

## Current state

- `backend/cli/src/tool/task.ts` 只对 `biology/ml/physics` 使用一个进程内 `HierarchicalSemaphore`，默认 compute cap 为 2，并在模块加载时读取 `OPENSCIENCE_MAX_COMPUTE_SUBAGENTS`。
- `backend/cli/src/util/semaphore.ts` 已提供 FIFO、abort-aware permit、nested child 接管父 permit 和 sibling 串行语义，相关单测已覆盖关键嵌套场景。
- TaskTool 已监听父 `AbortSignal` 并调用 `SessionPrompt.cancel(child)`；这是可复用基础，不是从零实现取消。
- TaskTool metadata 只有 child `sessionId`、`model` 与已观察到的 child tool summary，没有 queued/running/terminal 运行契约、排队耗时或 timeout。
- `backend/cli/src/scheduler/index.ts` 是周期 timer scheduler，不适合承载 child admission；把 agent 调度塞进去会混淆生命周期。

## Problem

只有 compute worker 受限，普通 child 可无限扇出；没有全局/父会话双重上限、统一 timeout 和不可逆终态。取消虽然会向正在运行的 child 传播，但排队、迟到完成、终态原因和耗时没有统一语义，无法可靠评测或展示。

## Goals

1. 同时限制全局 child、单个 root session 和 compute lane，并保持 FIFO、嵌套无死锁。
2. 统一 `queued → running → terminal` 生命周期；terminal 使用 TaskResult 的判别联合。
3. 父取消同时移除排队 waiter 并终止运行 child；timeout 终止底层 prompt/tool。
4. terminal 状态不可从 cancelled/timeout/failure 回跳 success，迟到事件只记录不覆盖。
5. 输出非敏感的 wait/run duration、worker、parent/child session 与原因，供 eval/UI 复用。

## Non-goals

- 不实现跨进程/分布式队列、持久化 DAG、优先级抢占或自动重试策略。
- 不改造周期任务 `Scheduler`。
- 不在本计划内决定 worker 路由、默认 orchestrator 范围或 UI 视觉。
- 不用 mock 复制 TaskTool/SessionPrompt 逻辑来证明调度正确。

## Proposed design

### TaskRun contract

新增一个 Zod schema + 推断类型，metadata 最小形状为：

```text
runID, worker, parentSessionID, childSessionID
status: queued | running | success | partial | failure | cancelled | timeout
queuedAt, startedAt?, endedAt?, waitMs?, runMs?
code?, message?
```

状态通过纯 reducer 转移；只有 `queued → running|cancelled|timeout`、`running → terminal` 合法。重复同一 terminal 更新幂等，其他 terminal 覆盖被拒绝并记录诊断。

### Admission controller

新增专用 `TaskScheduler`（放在 tool/agent runtime 边界，不复用 interval scheduler）。一个 admission queue 原子检查 global、root-session、compute 三个维度，避免“先持有全局 permit、再等待 compute permit”的锁顺序死锁。嵌套 session 继续复用 `HierarchicalSemaphore` 的 permit-transfer 语义。

建议配置先放在实验开关下：

```jsonc
{
  "experimental": {
    "task_scheduler": {
      "enabled": false,
      "global_limit": 8,
      "session_limit": 4,
      "compute_limit": 2,
      "timeout_ms": 900000,
    },
  },
}
```

### Compatibility and rollback

- `experimental.task_scheduler.enabled=false` 保留现有 compute-only 行为，作为首轮 soak 的即时回退。
- `OPENSCIENCE_MAX_COMPUTE_SUBAGENTS` 在至少一个兼容周期内继续覆盖 `compute_limit`，并记录 deprecation，不突然改变现有部署。
- TaskTool 的 `metadata.summary/sessionId/model` 原字段保留；新 `run` 字段是 additive，旧 UI 继续工作。
- 取消/timeout 使用统一 TaskResult；旧调用方不认识新 metadata 时仍能读取文本 output 和 child session ID。
- 回滚新 scheduler 不删除 child session 或历史 part；只切回 legacy admission path。

## Implementation tasks

### Task 1: 建立 TaskRun 状态机

**Description:** 定义 TaskRun schema、合法转移、时间计算和 terminal guard，作为 scheduler、TaskTool、eval、UI 的单一契约。

**Acceptance:**

- [ ] 五种 terminal 结果与统一 TaskResult 完全对齐。
- [ ] cancelled/timeout/failure 后的 success 更新被拒绝；重复同终态更新幂等。
- [ ] waitMs/runMs 由单调顺序的时间戳计算，缺失阶段不会生成负数。
- [ ] schema 不包含 prompt、tool arguments、结果 body 或凭据。

**Verification:**

- [ ] reducer 表驱动测试覆盖所有合法/非法转移和迟到完成。
- [ ] Zod parse 测试覆盖旧 metadata 缺少 `run` 时的兼容分支。

**Dependencies:** 统一 TaskResult schema。  
**Files:** `backend/cli/src/tool/task-state.ts`、`backend/cli/test/tool/task-state.test.ts`。  
**Scope:** S（2 files）

### Task 2: 实现多维 admission 与公平性

**Description:** 在 `HierarchicalSemaphore` 基础上实现专用 TaskScheduler，原子执行 global/session/compute admission，并由配置控制。

**Acceptance:**

- [ ] global、每 root session、compute peak 都不超过配置上限。
- [ ] 同一约束维度的 live waiter 保持 FIFO，无长期饥饿。
- [ ] nested child 可接管等待中的父 permit；parallel sibling 串行且不会绕过全局上限。
- [ ] 排队时 abort 会移除 waiter，不泄漏 permit；多个维度不会产生锁顺序死锁。

**Verification:**

- [ ] 扩展 `test/util/semaphore.test.ts` 并新增 TaskScheduler 并发 stress 测试。
- [ ] 使用真实 async work 验证 peak/fairness/abort；不 mock scheduler 自身判定。

**Dependencies:** Task 1。  
**Files:** `backend/cli/src/tool/task-scheduler.ts`、`backend/cli/src/util/semaphore.ts`、`backend/cli/src/config/config.ts`、`backend/cli/test/tool/task-scheduler.test.ts`、`backend/cli/test/util/semaphore.test.ts`。  
**Scope:** M（5 files）

### Task 3: 接入 TaskTool 取消与 timeout

**Description:** 让 TaskTool 在 child 创建后发布 queued/running/terminal metadata，组合父 abort 与 timeout signal，并在完成时经 terminal guard 落地结果。

**Acceptance:**

- [ ] 父取消后，queued child 立即出队；running child 在 2 秒内收到 cancel 并停止继续产出可接受结果。
- [ ] timeout 同时中止 SessionPrompt 与底层 tool signal，返回 `status=timeout`，并保留 child session ID。
- [ ] unsub、event listener、permit 在 success/throw/cancel/timeout 所有路径都释放一次。
- [ ] 迟到的 child completion 不会把 cancelled/timeout part 改成 completed/success。

**Verification:**

- [ ] 真实 TaskTool 集成测试覆盖 queued cancel、running cancel、timeout、late completion 和 nested compute。
- [ ] 从 `backend/cli` 运行 `bun test test/tool/task-scheduler.test.ts test/tool/task-state.test.ts test/util/semaphore.test.ts`。

**Dependencies:** Task 2；Orchestrator/worker 可被 Agent registry 获取。  
**Files:** `backend/cli/src/tool/task.ts`、`backend/cli/src/tool/task-scheduler.ts`、`backend/cli/test/tool/task-integration.test.ts`、`backend/cli/test/tool/task-cancel.test.ts`。  
**Scope:** M（4 files）

### Task 4: 增加可观测性并完成 flag soak

**Description:** 发布非敏感 lifecycle telemetry，核对 legacy/new 双路径，并记录启用前后的吞吐、等待和取消行为。

**Acceptance:**

- [ ] 每个 run 可关联 parent/child session、worker、waitMs、runMs、terminal reason。
- [ ] telemetry 不含 brief、prompt、tool args/result、路径内容或凭据。
- [ ] flag off 的 existing compute cap 行为保持，环境变量兼容测试通过。
- [ ] flag on 的 20+ fan-out soak 无 permit leak、饥饿或 terminal reversal。

**Verification:**

- [ ] telemetry event/metadata contract 测试。
- [ ] 分别以 flag off/on 运行 TaskTool integration 与 fan-out soak，并比较 peak、P95 wait、cancel latency。

**Dependencies:** Task 3。  
**Files:** `backend/cli/src/session/telemetry.ts`、`backend/cli/src/tool/task.ts`、`backend/cli/test/session/task-telemetry.test.ts`、本计划 Progress 记录。  
**Scope:** M（4 files）

## Checkpoint

- [ ] 三个并发上限、FIFO、nested transfer 与 abort 均有自动化证据。
- [ ] cancel/timeout 在 TaskResult、part metadata 和 telemetry 中一致。
- [ ] 无 terminal reversal、listener/permit leak 或迟到成功。
- [ ] flag off 可即时回滚，flag on soak 通过后才交给 plan 11 评测。

## Risks

| Risk                            | Impact                     | Mitigation                                                 |
| ------------------------------- | -------------------------- | ---------------------------------------------------------- |
| 多 semaphore 获取顺序死锁       | 所有 child 停滞            | 单 admission queue 原子检查多个计数；stress + nested tests |
| 取消与完成竞态                  | UI/父 Agent 看到假 success | 纯状态机 terminal guard；迟到事件只诊断                    |
| timeout 只停父 Promise 未停工具 | 资源泄漏/GPU 继续计费      | 组合 AbortSignal 传到 SessionPrompt/tool；2 秒取消断言     |
| 默认值压低现有吞吐              | 行为回归                   | flag 默认 off、metrics soak、环境变量兼容                  |
| metadata 泄露任务内容           | 隐私风险                   | schema 只允许 ID/status/duration/reason code；敏感字段测试 |

## Definition of done

- [ ] Tasks 1–4 与 checkpoint 全部通过。
- [ ] 新旧路径和环境变量兼容均有测试。
- [ ] focused tests 与 `backend/cli` 完整 `bun test` 已运行并记录。
- [ ] 取消、timeout、permission 与 compute workflow 无回归。
- [ ] flag 保持可回滚，默认值变更只能由 plan 11 的评测门槛批准。
