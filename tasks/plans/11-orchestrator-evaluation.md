# 11 - Orchestrator 回归评测与上线门槛

**Status:** Planned  
**Priority:** P1  
**Dependencies:** `01-task-result-contract.md`、`02-agent-context-closeout.md`、`09-orchestrator-mvp.md`、`10-subagent-scheduler.md`。UI 灰度依赖本计划结论。

## Current state

- 已有 `SessionTelemetry.Context/Usage/Compaction`，可以记录父会话 tool-schema tokens、provider usage 与 compaction。
- backend 有大量 focused tests，但没有版本化的 orchestrator task set、统一 runner、legacy-vs-orchestrator 报告或 release gate。
- `backend/cli/package.json` 只有 `test/typecheck/build/dev`，没有 `eval:orchestrator`。
- 普通单测能证明 selection/scheduler 契约，不能证明真实模型是否正确路由、汇合或消费 partial/failure。

## Problem

Orchestrator 会用额外 hop 换取更小父上下文。若没有可重复基线，就无法判断 token 节省是否抵消延迟/完成率损失，也无法防止 prompt/profile 变更造成 silent success、错误 worker、权限越界或 graph workflow 回归。

## Goals

1. 用真实 SessionPrompt、TaskTool、worker 与工具路径运行版本化 case set，不复制实现为 mock。
2. 覆盖 direct answer、code explore/edit、literature、graph、parallel fan-out/join、partial failure、cancel、timeout、long context。
3. 同时报告 completion、routing、terminal accuracy、permission violations、P50/P95、tokens、cost、retries、cancels 与 compaction。
4. 与同模型、同输入的 legacy `research` 基线成对比较。
5. 将明确门槛变为“能否开始 UI/默认灰度”的阻断条件，而不是主观判断。

## Non-goals

- 不做所有 provider/model 的公开排行榜，也不以一个模型结论代表所有模型。
- 不用 stubbed router、伪 TaskResult 或复制生产逻辑的 scorer 代替真实运行。
- 不要求普通 PR CI 持有外部模型密钥；模型 eval 可在受控/定时 lane 执行。
- 不自动把 orchestrator 改为默认；本计划只生成可审计结论。

## Proposed design

### Versioned case manifest

每个 case 使用可审阅 JSON/JSONL：

```text
id, version, tags, prompt, fixtures
expectedRoute / allowedRoutes
expectedTerminal
requiredRefs / forbiddenTools
timeoutMs, repetitions
```

failure/cancel/timeout case 通过真实可控操作触发：无效资源、真实排队后 abort、受控长运行后 timeout；不 monkey-patch TaskTool 结果。

### Runner and artifacts

Runner 从 `OPENSCIENCE_EVAL_MODEL=provider/model` 选择已配置模型，创建隔离 Instance/worktree，分别以 `research` 与 `orchestrator` 运行相同 case。原始 session 保留在 eval 临时目录，汇总输出 JSON + Markdown；报告只内联计数、ID 与截断错误，不复制敏感 prompt/tool body。

### Release thresholds

第一版阻断门槛：

- seeded failure/cancel/timeout terminal 识别率 = 100%；silent success = 0。
- permission violation = 0。
- 多步骤 case 父会话输入 tokens 中位数相对 legacy 下降至少 40%。
- completion rate 不低于 legacy 超过 5 个百分点。
- 每类 case 至少 5 次或达到预先声明的样本数；同时报告置信区间，不用单次结果下结论。
- P95 与成本只设可见预算，首轮 baseline 后再冻结数值；不能隐藏额外 hop。

### Compatibility and rollback

- Eval runner 是旁路、只读生产行为，不改变 session API 或 agent 默认值。
- 普通 `bun test` 不依赖模型凭据；缺 `OPENSCIENCE_EVAL_MODEL` 时 eval 命令明确失败/跳过，不能伪造通过。
- Release gate 可从 required 降为 advisory 作为 CI 回滚，但报告格式和历史基线保留。
- Case schema 以 `version` 演进；旧结果仍可解析，破坏性字段变更需新 major version。

## Implementation tasks

### Task 1: 定义 case schema 与确定性 scorer

**Description:** 建立版本化 manifest、结果 schema 和纯 scorer；scorer 只评估真实 run artifacts，不实现路由或 TaskResult 逻辑。

**Acceptance:**

- [ ] manifest 覆盖十类必测行为，并明确 allowed route、terminal、forbidden tools 与 timeout。
- [ ] scorer 能从 session/tool/telemetry IDs 计算 routing、terminal、refs、tokens、latency 与权限违规。
- [ ] 缺失数据计为失败/unknown，绝不默认为成功。
- [ ] case/result schema 带版本，错误 fixture 在运行前 fail fast。

**Verification:**

- [ ] 使用手写最小 result records 对 scorer 做表驱动测试；不复制生产执行逻辑。
- [ ] schema test 拒绝未知 terminal、负 duration、无 case ID 的记录。

**Dependencies:** TaskResult 与 TaskRun schema 稳定。  
**Files:** `backend/cli/eval/orchestrator/schema.ts`、`backend/cli/eval/orchestrator/cases.jsonl`、`backend/cli/eval/orchestrator/score.ts`、`backend/cli/test/eval/orchestrator-score.test.ts`。  
**Scope:** M（4 files）

### Task 2: 实现真实 session eval runner

**Description:** 通过真实 Instance、SessionPrompt、Agent、TaskTool 和配置模型执行 case，捕获 SessionTelemetry 与 child session 链。

**Acceptance:**

- [ ] 同一 case 可选择 `research` 或 `orchestrator`，使用相同 provider/model 与 fixture。
- [ ] runner 可并行独立 case，但尊重 TaskScheduler 限制；单 case timeout 会真实 abort session。
- [ ] 每个 failure 可追踪到 case ID、parent/child session、tool call 和非敏感 reason code。
- [ ] runner 不 patch Agent/TaskTool/ToolRegistry；执行路径与产品一致。

**Verification:**

- [ ] 用已配置本地/受控模型跑 direct、code、cancel 三个 smoke。
- [ ] runner integration test 验证隔离目录、abort、结果落盘与失败退出码。

**Dependencies:** Task 1；plans 09–10 完成。  
**Files:** `backend/cli/eval/orchestrator/run.ts`、`backend/cli/eval/orchestrator/collect.ts`、`backend/cli/package.json`、`backend/cli/test/eval/orchestrator-runner.test.ts`。  
**Scope:** M（4 files）

### Task 3: 生成成对报告与门槛判定

**Description:** 将同 case 的 legacy/orchestrator run 配对，输出 machine-readable JSON、owner-readable Markdown 和明确 pass/fail。

**Acceptance:**

- [ ] 报告包含 completion、route、terminal accuracy、permission、P50/P95、parent/total tokens、cost、retry/cancel/compaction。
- [ ] 显示样本数、模型/配置、git revision、case-set version 与置信区间。
- [ ] 40% parent-token、≤5pp completion regression、100% terminal、0 permission violation 门槛可机器判定。
- [ ] 任一 case 缺 baseline、telemetry 或 child linkage 时 gate 失败，不从分母删除。

**Verification:**

- [ ] 固定 run records 的 golden report 测试。
- [ ] 人工制造 threshold 边界值，验证退出码和 Markdown/JSON 一致。

**Dependencies:** Task 2。  
**Files:** `backend/cli/eval/orchestrator/report.ts`、`backend/cli/eval/orchestrator/gate.ts`、`backend/cli/test/eval/orchestrator-report.test.ts`、`backend/cli/eval/orchestrator/README.md`。  
**Scope:** M（4 files）

### Task 4: 接入受控 CI/定时 lane

**Description:** 普通 PR 跑 schema/scorer/runner hermetic tests；有模型环境的 manual/scheduled lane 跑完整成对 eval 并保存 artifacts。

**Acceptance:**

- [ ] PR CI 不因缺外部模型凭据而误失败，也不会把“未运行”显示成“通过”。
- [ ] scheduled/manual job 固定 model/config/case-set version，上传 JSON/Markdown 和失败 session refs。
- [ ] prompt/profile/toolset/scheduler 变更会触发或明确要求完整 gate。
- [ ] gate 未通过时禁止将 orchestrator 设为默认，但不阻断 unrelated 普通测试。

**Verification:**

- [ ] 本地运行 `bun run eval:orchestrator -- --help`、schema tests 和一个 3-case smoke。
- [ ] 手动触发 CI job，验证 pass/fail/未配置三种状态与 artifact retention。

**Dependencies:** Task 3。  
**Files:** `.github/workflows/orchestrator-eval.yml`、`backend/cli/package.json`、`backend/cli/eval/orchestrator/README.md`。  
**Scope:** S（3 files）

## Checkpoint

- [ ] Case set、runner、report、gate 均版本化且可复跑。
- [ ] 真实 research/orchestrator 成对结果包含完整 lineage 与 telemetry。
- [ ] terminal accuracy 100%、permission violation 0、parent tokens 至少下降 40%、completion regression 不超过 5pp。
- [ ] 未运行与失败不会显示为通过。
- [ ] 只有 checkpoint 通过才允许 plan 12 的灰度和默认范围讨论。

## Risks

| Risk                      | Impact             | Mitigation                                                      |
| ------------------------- | ------------------ | --------------------------------------------------------------- |
| 模型随机性导致 flaky gate | 无法区分回归与方差 | repetitions、固定配置、置信区间、成对比较                       |
| Fixture 过度迎合 prompt   | 线上完成率虚高     | 多领域 task set、owner review、保留 failure cases               |
| 评测使用 mock 路径        | 通过但产品失败     | runner 禁止 patch production modules；真实 session/tool lineage |
| 成本或 CI 时长过高        | gate 被绕过        | PR 跑 hermetic checks，完整 eval 放受控 scheduled/manual lane   |
| 报告泄露内容              | 隐私/凭据风险      | 默认只保存 IDs/metrics/reason codes；原始 session 受控保留      |

## Definition of done

- [ ] Tasks 1–4 与 checkpoint 全部通过。
- [ ] Eval 命令、case schema、报告格式和 gate 有文档。
- [ ] 至少一轮完整成对 baseline 已保存并经 owner 审阅。
- [ ] 普通测试和 eval lane 的“失败/跳过/通过”语义清晰。
- [ ] 未达到门槛时 `research` 继续作为默认。
