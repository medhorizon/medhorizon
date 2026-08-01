# 13 - Session turn pipeline 架构拆分

**Status:** Planned  
**Priority:** P2  
**Dependencies:** `11-orchestrator-evaluation.md` 已固定行为基线；建议在 orchestrator/runtime 行为稳定后实施。

## Current state

- `backend/cli/src/session/prompt.ts` 约 2,397 行，同时负责 input schema、消息创建、busy/cancel 状态、turn loop、compaction/retry、模型解析、直接 subtask 执行、tool schema 构造、上下文/系统 prompt、shell/command、title。
- `resolveTools()` 位于同文件，组合 native/plugin/MCP selection、schema conversion、permission context、plugin before/after hooks 与 tool metadata 更新。
- pending `SubtaskPart` 在 loop 中有一条手工 TaskTool invoke 路径，代码已有 `TODO: centralize "invoke tool" logic`；它与普通 processor tool path 必须保持 hook/part 语义一致。
- `prompt.ts` 导入 `TaskTool`，而 `tool/task.ts` 又导入 `SessionPrompt` 来创建/取消 child，形成双向模块依赖。
- 已有 message、compaction、retry、permission、telemetry 等 focused tests，但缺少覆盖完整 turn 事件顺序的 characterization contract。

## Problem

Orchestrator、TaskResult 或新 provider 行为很容易继续向 `prompt.ts` 增加 agent-name 分支。双向依赖和两条 tool invoke 路径让取消、plugin hooks、event order 与 finalize 更难验证；直接“大拆文件”又可能静默改变 prompt、事件、compaction 或权限语义。

## Goals

1. 先用 characterization tests 固定可观察行为，再按依赖方向逐步抽取。
2. 建立 `prompt facade → turn control → context/tools/finalize` 的单向内部边界。
3. 打破 `SessionPrompt ↔ TaskTool` 直接模块环；child runner 通过窄内部 port 注入。
4. 普通 tool call 与 pending subtask 共用同一个 invoke contract，plugin hooks 恰好一次。
5. 保持公开 API、SDK schema、prompt 文本、permission、MessageV2 part 与 bus event 顺序兼容。

## Non-goals

- 不改变模型输出、prompt 内容、compaction 阈值、retry 策略或计费规则。
- 不顺带实现 Orchestrator 路由、TaskScheduler 或新功能。
- 不重写 MessageV2/SessionProcessor，也不切换框架/状态库。
- 不在抽取时做大规模命名/风格清理或删除不理解的分支。

## Proposed design

### Target modules

```text
session/prompt.ts            public compatibility facade
session/turn/control.ts      loop state and transition decisions
session/turn/context.ts      history/reminders/artifacts/system/composition
session/turn/tools.ts        selection, context, invocation and hook envelope
session/turn/finalize.ts     terminal message/error/status/callback completion
session/turn/runner.ts       narrow child/session execution port
```

依赖只指向下层模块；`tool/task.ts` 使用注入到 `Tool.Context` 的窄 runner/cancel port，不再 import `session/prompt.ts`。公共 `SessionPrompt` exports 保持：`PromptInput/prompt/loop/cancel/assertNotBusy/resolvePromptParts`、Shell/Command API、`modelTier` 与 `OUTPUT_TOKEN_MAX`。

### Characterization trace

测试收集真实 Bus/MessageV2 事件的规范化 trace（去除随机 ID/时间），至少固定：text-only、tool success/error、permission、subtask、cancel、retry、overflow compaction、empty/doom-loop。断言相对顺序和恰好一次语义，不把整个内部实现序列化为脆弱 snapshot。

### Compatibility and rollback

- 每次只移动一个边界，`prompt.ts` facade 与 server routes 不改签名；不需要 SDK regenerate。
- 每个 commit 前后运行同一 characterization trace；不一致即停止，不用兼容 shim 掩盖。
- 新内部模块无持久化数据或 config migration；每个 extraction commit 可独立 revert。
- 若 narrow runner port 引发 provider/plugin 回归，可临时恢复 TaskTool 的 legacy bridge，但必须保留 contract tests，不能长期双路径漂移。

## Implementation tasks

### Task 1: 固定 turn 事件与结果契约

**Description:** 新增真实 session characterization harness，规范化随机字段并断言关键事件/part/status 相对顺序。

**Acceptance:**

- [ ] 覆盖 text、tool、subtask、permission、cancel、retry、overflow/compaction、terminal error。
- [ ] 断言 plugin before/after、tool part running→terminal、message completed、flush、idle 的恰好一次和相对顺序。
- [ ] harness 订阅真实 Bus/Storage/Session 流，不复制 loop 判定。
- [ ] trace 只规范化 ID/时间等非语义字段，不隐藏 status、finish、error 或 event type。

**Verification:**

- [ ] 从 `backend/cli` 运行新 contract suite 两次，输出稳定。
- [ ] 人工交换一个关键事件或重复 hook 时，测试必须失败。

**Dependencies:** Plan 11 baseline 可用。  
**Files:** `backend/cli/test/session/prompt-contract.test.ts`、`backend/cli/test/session/fixture/turn-trace.ts`、`backend/cli/test/session/fixture/turn-cases.ts`。  
**Scope:** M（3 files）

### Task 2: 打破 TaskTool 与 SessionPrompt 模块环

**Description:** 定义窄 child/session runner port，经 Tool.Context 或内部执行上下文注入 prompt/cancel/resolve-parts 能力；TaskTool 不再导入 SessionPrompt。

**Acceptance:**

- [ ] `backend/cli/src/tool/task.ts` 不再 import `session/prompt.ts`。
- [ ] child create/continue、model inheritance、parent abort、permission 与 output 行为不变。
- [ ] runner port 只暴露 TaskTool 实际需要的方法，不泄露整个 SessionPrompt namespace。
- [ ] nested TaskTool 与 direct SubtaskPart characterization trace 不变。

**Verification:**

- [ ] dependency grep/test 阻止 `tool/task.ts → session/prompt.ts` 回归。
- [ ] 运行 TaskTool integration、permission-task、cancel 和 TaskRun suites。

**Dependencies:** Task 1。  
**Files:** `backend/cli/src/tool/tool.ts`、`backend/cli/src/tool/task.ts`、`backend/cli/src/session/turn/runner.ts`、`backend/cli/src/session/prompt.ts`、相邻测试。  
**Scope:** M（5 hand-written files）

### Task 3: 抽取 tool resolution 与统一 invoke envelope

**Description:** 把 native/plugin/MCP selection、schema conversion、Tool.Context 和 plugin hook envelope 移入 `turn/tools.ts`；pending subtask 复用相同 invoke helper。

**Acceptance:**

- [ ] selection precedence、permission deny、pre-init filtering、MCP cache/bound、telemetry origins 完全不变。
- [ ] 普通 tool 与 pending subtask 都只触发一次 before/after，并生成相同 running/completed/error part 语义。
- [ ] invoke helper 不包含 agent-name 路由分支；差异通过 Agent/Profile/TaskResult 输入表达。
- [ ] `prompt.ts` 不再构造 AI tool schema 或手写 plugin invoke envelope。

**Verification:**

- [ ] Task 1 traces 全部相同。
- [ ] 运行 `test/session/llm.test.ts`、tool selection/registry、MCP、TaskTool 与 plugin hook focused tests。

**Dependencies:** Task 2。  
**Files:** `backend/cli/src/session/turn/tools.ts`、`backend/cli/src/session/prompt.ts`、`backend/cli/src/session/processor.ts`（仅为复用 envelope 时）、`backend/cli/test/session/turn-tools.test.ts`。  
**Scope:** M（4 files）

### Task 4: 抽取 turn context assembly

**Description:** 把 compacted history、queued user reminders、artifact/skill/memory/system prompt、model messages 与 composition telemetry 的准备移到纯度更高的 context module。

**Acceptance:**

- [ ] 输入明确为 session/messages/agent/model/config，输出为 system/messages/composition/tool inputs；无隐藏全局写入。
- [ ] artifact、RSI、skill routing、plan/build reminder、image retention 与 compute billing 提示不变。
- [ ] provider 最终收到的 system/messages 序列在 characterization fixture 中逐项一致。
- [ ] context module 不执行 turn loop、tool invoke 或 terminal finalize。

**Verification:**

- [ ] context focused tests 覆盖 research/compute/plan、compacted history、queued user message、recent images。
- [ ] telemetry composition tests 与 Task 1 traces 通过。

**Dependencies:** Task 3。  
**Files:** `backend/cli/src/session/turn/context.ts`、`backend/cli/src/session/prompt.ts`、`backend/cli/test/session/turn-context.test.ts`、`backend/cli/test/session/composition.test.ts`。  
**Scope:** M（4 files）

### Task 5: 抽取 control/finalize 并收窄 facade

**Description:** 将 loop transition、overflow/doom-loop/compaction 决策与 terminal finalize 分开；`prompt.ts` 仅保留输入/命令 facade 和编排入口。

**Acceptance:**

- [ ] `control.ts` 的 transition 可由状态输入测试，不直接拼 UI/API response。
- [ ] `finalize.ts` 统一 terminal error/message、callbacks、pending-part flush、prune 与 idle 顺序。
- [ ] cancel/retry/overflow/compaction circuit breaker 与现有测试无回归。
- [ ] `prompt.ts` 不再出现新增 agent-name 分支，公开 exports 与 server route schema 不变。

**Verification:**

- [ ] Task 1 trace、session/compaction/retry/empty/text-loop/permission 全部通过。
- [ ] 从 `backend/cli` 运行 `bun run typecheck` 与完整 `bun test`，对 Windows 环境性失败单独记录。

**Dependencies:** Task 4。  
**Files:** `backend/cli/src/session/turn/control.ts`、`backend/cli/src/session/turn/finalize.ts`、`backend/cli/src/session/prompt.ts`、`backend/cli/test/session/turn-control.test.ts`、`backend/cli/test/session/turn-finalize.test.ts`。  
**Scope:** M（5 files）

## Checkpoint

- [ ] `prompt.ts` 是兼容 facade，核心职责已沿单向依赖拆开。
- [ ] TaskTool 不再反向 import SessionPrompt，普通/pending subtask 共用 invoke envelope。
- [ ] 所有 characterization traces 与公开 API/schema 不变。
- [ ] typecheck、focused suites、完整 backend test 已运行并记录。
- [ ] 每个 extraction commit 可独立回滚，无数据迁移。

## Risks

| Risk                                     | Impact                   | Mitigation                                                    |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| “只移动代码”改变事件顺序                 | UI/SDK race、状态假 idle | 先建 trace；每 commit 比对相对顺序                            |
| 循环依赖转成隐蔽 service locator         | 更难理解/测试            | 窄 typed runner port，显式注入，不暴露 namespace              |
| 统一 tool envelope 改变 hooks/permission | 安全与 plugin 回归       | before/after exactly-once contract + permission focused tests |
| 抽取时顺带改 prompt                      | 模型行为漂移             | system/messages golden；本计划禁止 prompt 优化                |
| 文件变多但边界不清                       | 复杂度只是搬家           | 明确 dependency direction；模块禁止反向 import                |

## Definition of done

- [ ] Tasks 1–5 与 checkpoint 全部通过。
- [ ] 公共 SessionPrompt API、server routes、SDK 与持久化消息兼容。
- [ ] 行为/事件 regression tests 在每个 commit 可独立通过。
- [ ] 无新增 agent-name 分支、双 tool invoke envelope 或 SessionPrompt↔TaskTool 环。
- [ ] 架构图/模块职责在本计划 Progress 或相邻文档中更新。
