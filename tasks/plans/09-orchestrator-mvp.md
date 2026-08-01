# 09 - Orchestrator 与窄工具 Worker MVP

**Status:** Planned  
**Priority:** P1  
**Dependencies:** `01-task-result-contract.md`、`02-agent-context-closeout.md`、`04-research-graph-gateway.md`。默认启用还依赖 `10-subagent-scheduler.md` 与 `11-orchestrator-evaluation.md`。

## Current state

- `backend/cli/src/tool/profile.ts` 已有窄工具 profile，并已有 `GRAPH`；尚无 `ORCHESTRATOR`。
- `backend/cli/src/agent/agent.ts` 已注册 `research`、`explore`、`literature-review`、`task`、`ml`、`physics`、`biology`、`write`、`reviewer` 等 agent，但没有 `orchestrator` 或 `graph`。
- `backend/cli/src/tool/task.ts` 已能创建带 `parentID` 的 child session、检查 `task` 权限、继承模型并把 child session ID 返回给父会话。
- 默认 `research` 仍携带 science、compute、provenance、stage 与 `atlas_*` 等大工具集；委派存在，但父会话本身不薄。
- TaskTool 的结构化返回目前按调用方 agent 名称分支。Orchestrator 不能依赖新增另一个文本/XML 特例，必须消费统一 TaskResult。

## Problem

父 Agent 的工具 schema 和长 workflow prompt 每 turn 重复进入上下文。现有 subagent 只解决执行隔离，没有提供严格的“先选 worker，再执行”的父级协议，也缺少专用 graph worker。直接把 `research` 改薄会造成较大的兼容性和行为风险。

## Goals

1. 新增可显式选择、可回退的 primary `orchestrator`，父工具集仅包含路由与用户交互工具。
2. 用命名 worker + 固定 profile 路由，禁止 v1 动态拼装任意 toolset。
3. 新增窄 `graph` worker；复用现有 code、literature、compute、biology、write、review worker。
4. 父 Agent 只接收统一 TaskResult、artifact refs 和 child session ID，不接收未约束的 child transcript。
5. 父工具定义估算不超过 2,500 tokens，并保留 legacy `research` 作为默认和回退。

## Non-goals

- 不替换 MedHorizon session runtime，也不嵌入 Pi CLI/runtime。
- 不实现持久化 DAG、通用工作流引擎或任意工具 dispatcher。
- 不在本计划内实现并发调度、timeout、评测仪表盘或轨迹 UI。
- 不在评测门槛通过前把 `orchestrator` 设为默认 agent。
- 不删除或改写现有 `research`、`biology` 等 agent 的公开行为。

## Proposed design

### Parent profile

新增 `Profile.ORCHESTRATOR`：

```text
task
question
todoread
todowrite
invalid
```

不包含 `read`、`bash`、edit、science、compute、stage 或 `atlas_*`。profile 是 availability 边界；agent permission 再以 deny-by-default + 显式允许上述工具作为纵深保护。

### Worker catalog

Orchestrator prompt 只描述角色，不展开 worker 的工具 schema：

| Worker                  | 使用条件                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `explore`               | 只读代码库/文件系统侦察                                             |
| `task`                  | 一般编码、修改与命令执行                                            |
| `literature-review`     | 文献与 web evidence                                                 |
| `graph`                 | Stage 与本地 Research Graph 操作；可调用保留的 `atlas_*` 兼容工具名 |
| `ml` / `physics`        | notebook、R、计算与领域分析                                         |
| `biology`               | 生物数据库与生物信息流程                                            |
| `write`                 | 科学/技术写作与 artifact 输出                                       |
| `critique` / `reviewer` | 只读审查与证据追踪                                                  |

每个 brief 必须包含 goal、constraints、known context（路径/graph ID/artifact ref）和 definition of done。父 Agent 不传工具名列表，worker 不返回完整 transcript。

### Compatibility and rollback

- `research` 保持当前 toolset、prompt、名称与默认排序；`orchestrator` 只是新的可见 primary 选项。
- `Config.default_agent` 的既有行为不变；只有显式选中 `orchestrator` 才走新路径。
- `graph` 作为新的 subagent 添加，不改变现有 worker 名称或权限。
- 若 smoke/eval 失败，可从 agent registry 隐藏 `orchestrator`，无需迁移 session 数据；历史 task parts 仍由通用 task renderer 展示。
- TaskResult 或 Graph Gateway 不可用时不得静默回落为“成功文本”；该 worker 返回明确 failure/partial，用户可切回 `research`。

## Implementation tasks

### Task 1: 注册薄 Orchestrator

**Description:** 新增 `ORCHESTRATOR` profile、primary agent 与短 prompt；保持 `research` 的默认和配置覆盖语义不变。

**Acceptance:**

- [ ] 默认 orchestrator 工具 ID 严格为 `task/question/todoread/todowrite/invalid`。
- [ ] `read`、`bash`、edit、compute、stage、`atlas_*` 即使存在于 registry 也不会初始化或发送 schema。
- [ ] `Agent.defaultAgent()` 在没有显式配置时仍返回 `research`。
- [ ] 使用真实 ToolRegistry 计算的父 tool-schema 估算不超过 2,500 tokens。

**Verification:**

- [ ] 从 `backend/cli` 运行 `bun test test/agent/agent.test.ts test/tool/selection.test.ts test/permission-task.test.ts`。
- [ ] 增加一个使用真实 Agent/ToolRegistry 的 schema-budget 测试，不复制 selection 逻辑。

**Dependencies:** Plan 13 tool profiles 与 pre-init filtering。  
**Files:** `backend/cli/src/tool/profile.ts`、`backend/cli/src/agent/agent.ts`、`backend/cli/src/agent/prompt/orchestrator.txt`、`backend/cli/test/agent/orchestrator.test.ts`。  
**Scope:** M（4 files）

### Task 2: 固定路由与 brief/return 协议

**Description:** 在 prompt 中加入精简 role catalog、委派判定、并行条件、brief 必填项以及 TaskResult 消费规则。

**Acceptance:**

- [ ] prompt 明确 trivial/direct-answer 任务无需委派，重工具工作必须委派。
- [ ] brief 包含 goal、constraints、known context、definition of done；缺关键上下文时使用 `question`。
- [ ] 父 Agent 只依据 TaskResult 的判别联合决定继续、重路由或最终回答，failure/cancel/timeout 不得被改写成 success。
- [ ] role catalog 不嵌入任何 worker JSON Schema，也不允许模型提供任意 toolset。

**Verification:**

- [ ] prompt contract 测试断言角色、必填 brief 字段和禁止项存在。
- [ ] 用真实 TaskResult parser 覆盖 success、partial、failure、cancelled、timeout 五种返回。

**Dependencies:** 统一 TaskResult 契约。  
**Files:** `backend/cli/src/agent/prompt/orchestrator.txt`、`backend/cli/src/tool/task.txt`、`backend/cli/test/agent/orchestrator-prompt.test.ts`。  
**Scope:** S（3 files）

### Task 3: 注册窄 Graph worker

**Description:** 新增 `graph` subagent，复用 `Profile.GRAPH`，只负责 session/graph/stage 的读取与变更。

**Acceptance:**

- [ ] `graph` 可被 TaskTool 枚举与权限过滤，不能作为默认 primary。
- [ ] 工具集只包含 `stage`、`atlas_*`、最小只读文件工具和 `invalid`；不包含 shell/edit/compute。
- [ ] prompt 要求保留 graph/node/edge/stage/provenance ID，并用 TaskResult artifact refs 返回。
- [ ] 本地 graph create/get + stage land smoke 成功；父 orchestrator 不携带 graph schema。

**Verification:**

- [ ] 从 `backend/cli` 运行 agent/profile focused tests。
- [ ] 在 Graph Gateway 可用时运行一条真实 TaskTool → `graph` worker smoke，并核对 child session 与 graph ID。

**Dependencies:** Task 1；同源 Graph Gateway；统一 TaskResult。  
**Files:** `backend/cli/src/agent/agent.ts`、`backend/cli/src/agent/prompt/graph.txt`、`backend/cli/test/agent/graph.test.ts`。  
**Scope:** S（3 files）

### Task 4: 完成兼容性与端到端 smoke

**Description:** 固定 legacy research 与新 orchestrator 的并存行为，并跑 direct、literature、code、graph 四条真实路径。

**Acceptance:**

- [ ] 旧配置未声明 orchestrator 时，agent 选择、权限提示和 research workflow 无变化。
- [ ] direct-answer 不产生 child；literature/code/graph 分别选中预期 worker。
- [ ] 每条委派均可从父 tool part 定位 child session，并保留 artifact/graph refs。
- [ ] smoke 结果记录父工具数、schema tokens、child 数和终态，不记录 prompt/tool body 或凭据。

**Verification:**

- [ ] 从 `backend/cli` 运行完整 `bun test`，记录环境性失败与本计划失败的区分。
- [ ] 运行四条配置真实模型的 smoke；结果作为 `11-orchestrator-evaluation.md` 的首个 baseline。

**Dependencies:** Tasks 1–3。  
**Files:** `backend/cli/test/agent/orchestrator-smoke.test.ts`、`backend/cli/test/fixture/orchestrator/README.md`、本计划 Progress 记录。  
**Scope:** S（3 files）

## Checkpoint

- [ ] Orchestrator 是可选 primary，legacy research 仍是默认与一键回退路径。
- [ ] Parent tool schema ≤ 2,500 tokens。
- [ ] Literature、code、graph worker 均通过真实委派 smoke。
- [ ] 没有 agent-name 特例绕过统一 TaskResult。
- [ ] 进入默认启用讨论前，继续执行 plans 10 与 11。

## Risks

| Risk                       | Impact               | Mitigation                                                              |
| -------------------------- | -------------------- | ----------------------------------------------------------------------- |
| 路由到错误 worker          | 多一轮延迟或任务失败 | 简短明确 role cards；只允许一次有证据的重路由；歧义时 `question`        |
| 用户配置扩大 parent 工具集 | 节省消失、父级越界   | shipped profile + availability budget 测试；telemetry 告警实际 tool IDs |
| Graph worker 丢失结构 ID   | 图谱不完整           | TaskResult keep-list；graph smoke 校验 node/edge/stage IDs              |
| Child 输出重新撑大父上下文 | compaction 提前      | 统一 TaskResult + artifact refs；禁止 transcript 回传                   |
| 多一跳带来延迟             | 简单任务变慢         | trivial/direct-answer 不委派；评测比较 P95                              |

## Definition of done

- [ ] 所有实施任务与 checkpoint 通过。
- [ ] 兼容/回退路径有自动化覆盖。
- [ ] 权限、plugin hooks、TaskResult 与 Graph workflow 无回归。
- [ ] 相关 focused tests 和 `backend/cli` 完整 `bun test` 已运行并记录。
- [ ] Orchestrator 仍未替换默认 research；默认范围只由 plan 11 的门槛决定。
