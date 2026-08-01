# 00 — CI 与测试前置护栏

**Status:** In progress  
**Priority:** P0  
**Dependencies:** 无；是后端/运行时代码的合并门槛，纯 UI 计划可并行实施。  
**Source:** 收敛 `docs/plans/01-ci-tests.md` 的剩余 CI 工作；models.dev fixture 与 nightly live-catalog 检查已落地，不重复实现。  
**Scope:** 配置级模块化接入；不修改 `backend/cli/src/**`、测试实现、公开 API 或 SDK。

## Outcome

以现有模块边界接入三层护栏：

1. 共享 Bun setup 负责根 lockfile 的冻结安装，release 复用同一入口。
2. `backend/cli` 暴露唯一 `test:coverage` 命令，普通/focused `test` 保持不变。
3. PR Test job 单次运行完整测试并输出覆盖率；取得稳定 Linux 基线后，再增加静态最低门槛。

当前已完成前两层和 report-only CI 接线。由于本机 Windows 全量 coverage 未成功结束，当前没有可信全量指标，不能猜测 floor；计划保持 `In progress`。

## Corrected decisions

- “覆盖率不得下降”定义为“不得低于评审通过的静态 floor”，不引入基线存储或自定义 diff parser。
- Bun coverage 只统计测试实际加载的文件；它是回归护栏，不证明未导入的新模块已被测试。
- 初始 floor 必须来自固定 Bun 版本下 2–3 次绿色 Linux coverage 运行，并按稳定最小值保守向下取整。
- 全量失败只在本计划内分类和留证；历史测试稳定性问题拆成独立 stabilization 任务，不扩张为产品代码重构。
- 不为 v1 引入 Codecov、新测试框架、sharding、`--parallel`、coverage 合并器或 `node_modules` 缓存。
- UI 工作不被 Plan 00 阻塞；后端/运行时代码合入前必须通过本护栏。

## Module boundaries

| 模块             | 单一职责                              | 文件                                   |
| ---------------- | ------------------------------------- | -------------------------------------- |
| Bun setup        | 固定 Bun 版本、缓存、冻结安装         | `.github/actions/setup-bun/action.yml` |
| Release consumer | 复用共享 setup，不复制版本/安装逻辑   | `.github/workflows/release.yml`        |
| Test command     | 保留 15 秒 timeout，显式启用 coverage | `backend/cli/package.json`             |
| Coverage policy  | 跳过测试文件，仅排除生成资产          | `backend/cli/bunfig.toml`              |
| PR consumer      | 一次执行测试与 coverage report        | `.github/workflows/ci.yml`             |

没有新增 wrapper、脚本、依赖或运行时抽象。

## Implementation tasks

### Task 1 — 冻结 CI 与 release 安装

**Status:** Implemented  
**Estimated scope:** S

- [x] 共享 setup 使用 `bun install --frozen-lockfile`。
- [x] release 移除 `bun-version: latest` 和独立普通安装，复用共享 setup。
- [x] 根 Bun 版本继续由 `package.json` 固定为 1.3.14。
- [x] 未修改 `bun.lock` 或独立 workspace 的 lockfile 策略。

**Verification:**

```powershell
# repository root
bun install --frozen-lockfile
rg -n "bun install" .github
```

发布矩阵首次真实运行仍需验证 Windows/macOS/Linux runner 上的共享 composite action；GitHub-hosted runner 均已有后续 Bash 步骤，因此没有新增 shell 前提。

### Task 2 — 增加 report-only coverage 入口

**Status:** Implemented  
**Estimated scope:** S

- [x] 保留 `test = bun test --timeout 15000`。
- [x] 新增 `test:coverage = bun test --coverage --coverage-reporter text --timeout 15000`。
- [x] `coverageSkipTestFiles = true`，避免测试代码抬高覆盖率。
- [x] 仅排除 CI 生成的 `src/web/assets.generated.ts`。
- [x] 不在 `bunfig.toml` 设置 `coverage = true`，focused tests 不自动启用 coverage。

**Verification:**

```powershell
# backend/cli
bun test test/util/semaphore.test.ts
bun run test:coverage -- test/util/semaphore.test.ts
```

### Task 3 — 在 PR CI 采集 Linux 基线

**Status:** Awaiting CI run  
**Estimated scope:** S

- [x] Test job 改用 `bun run --cwd backend/cli test:coverage`。
- [x] Test job 仍只完整执行一次后端套件。
- [ ] 在相同 commit、Ubuntu runner、Bun 1.3.14 上获得 2–3 次绿色运行。
- [ ] 记录每次 pass/fail/skip、wall time、functions 和 lines。
- [ ] 确认 coverage 后仍远低于现有 20 分钟 job timeout。

若 Linux 运行失败，记录测试名、错误、平台和 run URL，并按失败族拆出独立 stabilization 任务；本任务不修改产品运行时代码。

### Task 4 — 固定静态 coverage floor

**Status:** Pending Task 3  
**Estimated scope:** S

- [ ] 取绿色 Linux 运行的稳定最小值，并为轻微工具波动保留明确余量。
- [ ] 在 `backend/cli/bunfig.toml` 集中设置 Bun 原生 threshold。
- [ ] 当前分支完整 coverage 通过。
- [ ] 临时把 threshold 提到高于实测值，确认命令非零退出；随后恢复并用 `git diff` 确认无临时值。
- [ ] PR CI 在测试失败或低于 floor 时失败。

不得采用 focused、失败、parallel 或 shard 运行的覆盖率数字。

### Task 5 — 文档同步

**Status:** Implemented  
**Estimated scope:** XS

- [x] `CONTRIBUTING.md` 与 `docs/notes/verification.md` 只记录稳定命令和使用边界。
- [x] `docs/plans/01-ci-tests.md` 与 `docs/plans/README.md` 简要记录落地状态。
- [x] `tasks/plan.md`、`tasks/todo.md` 与 `tasks/plans/README.md` 加入 Plan 00。
- [x] 实测数据、推导、blocker 与剩余步骤只在本文件维护。

## Verification evidence

### Local environment

- 日期：2026-08-01
- OS：Windows（诊断环境，不作为 floor 权威环境）
- Bun：1.3.14

| 命令                                                   | 结果                                                                               | 用途                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `bun test test/util/semaphore.test.ts`                 | 9 pass / 0 fail，464 ms                                                            | 普通 focused 路径保持可用                                               |
| `bun run test:coverage -- test/util/semaphore.test.ts` | 9 pass / 0 fail，321 ms；functions 63.49%，lines 76.78%                            | 验证 coverage 命令与 test-file exclusion；仅加载 3 个源文件，不是 floor |
| 串行 `bun run test:coverage`                           | 304 秒未产出最终报告，终止并清理进程                                               | 明确本机 blocker；不能声明绿色或使用不完整数字                          |
| `--parallel=4` 诊断                                    | 46.23 秒；811 pass / 1 skip / 183 fail / 78 errors；functions 49.44%，lines 54.38% | 证明现有测试隔离不支持并行；结果无效，不进入配置                        |
| 4 shard 诊断                                           | shard 2 约 4 分钟仍未结束，已终止                                                  | 无可复核聚合报告；不引入 sharding                                       |

并行失败族包括缺少 CI Git identity、测试环境落入真实用户配置目录、非预期插件/网络行为，以及共享 env/global fetch/preload 的隔离冲突。这些是单独的测试稳定性工作，不在 Plan 00 内重构。

### Configuration checks

- `git diff --check`：通过。
- `bun install --frozen-lockfile`：通过；检查 954 个包，无 lockfile 变化，4.42 秒。
- `bun run typecheck`：7/7 workspace task 通过，1 分 23.835 秒。
- shared setup/release YAML 的 Prettier 检查：通过。
- 本轮 YAML、JSON 与 Markdown 的 Prettier 检查：通过。
- `.github` 中根 Bun 安装均为 frozen；独立 workspace 保留自己的 lockfile。
- 当前没有可信 Linux coverage 数值，因此未配置 threshold，也未执行 threshold 负向验证。

## Checkpoints

### Checkpoint A — 可重复 report-only 路径

- [x] 共享 CI setup 与 release 使用 frozen root install。
- [x] 普通 focused tests 不自动启用 coverage。
- [x] 显式 coverage 命令跳过测试文件并排除生成资产。
- [x] CI 配置为单次运行完整套件并输出 coverage report。
- [x] 未修改产品运行时代码、测试实现、SDK 或 lockfile。

### Checkpoint B — 静态 floor 生效

- [ ] 2–3 次 Linux 全量 coverage 绿色且指标稳定。
- [ ] floor 来源、取整和余量有可追溯证据。
- [ ] 当前 floor 正向通过、提高后的负向验证失败。
- [ ] PR CI 与 release matrix 完整通过。

## Risks and mitigations

| Risk                              | Mitigation                                                                |
| --------------------------------- | ------------------------------------------------------------------------- |
| Frozen install 暴露 lockfile 漂移 | 修复并评审 manifest/lockfile；不退回普通安装                              |
| Windows 与 Linux 加载集合不同     | 只以固定 Linux+Bun CI 结果设 floor；Windows 仅诊断                        |
| 全量测试挂起或失败                | 按失败族拆 stabilization 计划；不在 Plan 00 重构产品代码                  |
| Bun 只统计已加载文件              | floor 只作为聚合回归护栏；业务计划继续负责 focused/characterization tests |
| 为通过门槛扩大排除项              | 排除仅限测试文件和明确生成资产；低覆盖业务模块不得排除                    |
| coverage 增加 CI 耗时             | 一次运行同时承担测试和报告；实测接近 20 分钟时再单独评估分片              |

## Compatibility and rollback

- 本计划不改变运行时、数据库、API、Agent 行为或前端交互。
- Task 1 可独立回退 shared setup/release 配置，但 frozen install 应作为长期护栏。
- report-only CI 若遇到 Bun 工具链故障，可临时恢复普通完整测试，同时建立有期限的 coverage 恢复任务。
- threshold 将作为独立切片接入；异常时可只回退 threshold，不删除有效测试或 report-only 命令。

## Definition of done

- [x] 根 CI 与 release 安装冻结，版本来源统一。
- [x] 普通/focused test 与显式 full coverage 命令分离。
- [x] PR Test job 单次执行完整测试与 coverage report。
- [ ] Linux 全量测试在固定环境连续绿色并记录数量、耗时和 Bun 版本。
- [ ] Bun 原生静态 floor 有基线证据，并通过正向与负向验证。
- [ ] PR CI 与 release matrix 验证通过。
- [x] 未修改产品运行时代码，未生成 SDK，未引入外部 coverage 服务或新测试框架。
- [x] 正式文档保持简短，task 文档与索引已同步。

## Remaining work and estimate

- Linux report-only CI 运行与失败分类：2–4 小时。
- 若绿色，重复基线、设置 floor、负向验证：2–4 小时。
- 若暴露既有稳定性问题：按失败族另建计划，Plan 00 不吸收其重构工作量。

## Progress

- 2026-08-01：完成计划评估；确认无需大规模重构，采用配置级模块化接入。
- 2026-08-01：共享 setup 改为 frozen install；release 复用共享 setup 并移除 `latest` Bun。
- 2026-08-01：增加 report-only `test:coverage`、test-file exclusion 和生成资产排除；focused 正常/coverage 均 9 pass。
- 2026-08-01：Windows 串行 full coverage 304 秒未结束；parallel/shard 仅用于诊断并已清理，结果不用于 floor。
- 2026-08-01：PR Test job 切到单次 report-only coverage；等待 Linux CI 形成稳定基线后再接入 threshold。
- 2026-08-01：复核 frozen install、focused/coverage exclusion、根 typecheck、Prettier 与 diff hygiene 均通过。
