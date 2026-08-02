# MedHorizon 优化总清单

> 详细验收、验证命令和预计文件以各子计划为准。只有子任务验证、计划 Checkpoint 和 Definition of done 均完成后，才勾选计划级条目。

## Wave 0：后端合并护栏

### [00 — CI 与测试前置护栏](plans/00-ci-test-guardrails.md)

- [x] 冻结共享 CI 与 release 的根依赖安装
- [x] 增加显式、单入口的后端 coverage 命令
- [ ] 记录稳定基线并固定保守 coverage floor
- [x] 让 PR Test job 单次执行测试与 coverage report
- [x] 完成普通与 coverage focused 验证
- [ ] 完成负向阈值与 Linux PR CI 验证
- [ ] 完成 Plan 00 Definition of done

Plan 00 是后端/运行时代码的合并门槛；纯 UI 实施可与其并行，但在合入前仍须通过适用的全局检查。

## 独立横向计划：工具运行时资源效率

### [18 — Tool 执行运行时与资源效率优化](plans/18-tool-runtime-optimization.md)

- [ ] 冻结真实 Python/R、kernel、用户 shell、大输出与 fan-out 基线，并定义隐私安全 ProcessReceipt
- [ ] 消除重复 tool ID、dead profile declaration 与 origin capability 漂移
- [ ] 用 ProcessSupervisor 接管 Bash 和一次性 Python/R，统一 deadline、thread cap、bounded output 与 kill-tree
- [ ] 收敛 notebook/rkernel 的 timer、session release、串行执行、全局 cap、redaction 与 rich output 生命周期
- [ ] 落地 ephemeral-first 路由、scoped subprocess env、strict sandbox 与统一用户 shell 路径
- [ ] 让 Batch 只消费当前 selected invoker，并以有界并发拒绝 stateful/heavy 工具
- [ ] 硬化 WebFetch 的逐跳 redirect/SSRF 校验、body deadline 与 5 MiB stream budget
- [ ] 让 Read/Grep 在输入源头 bounded，不再先读取完整文件或完整匹配输出
- [ ] 通过 Plan 18 Measured release gates 与 Checkpoint
- [ ] 完成 Plan 18 Definition of done

### Plan 18 checkpoint

- [ ] one-shot success/failure/cancel/timeout 后 2 秒内无存活后代，kernel 在 TTL/session delete 后完全释放
- [ ] 默认 deadline、线程与 global/session/scientific lane 上限由代码强制，20+ fan-out 无 permit/listener/process leak
- [ ] Bash/notebook/rkernel/用户 shell 的 stdout、stderr、metadata、receipt 与 spill 均为 0 secret 泄漏
- [ ] 100 MiB process output、Read/Grep 输入与 WebFetch body 均在源头 bounded，内存不随总输入/输出线性增长
- [ ] effective tool IDs 与 profile 一致，Batch capability bypass 为 0
- [ ] flag off/shadow/bash/scientific/shell/on 与 scoped env 回退均已演练

## 本地科学工作台与证据闭环

### [19 — 科学文件识别、受限检查与文档标签页路由](plans/19-scientific-file-routing.md)

- [ ] 冻结 project-file 分类、扩展名/magic 优先级、renderer capability 与 inspect 预算
- [ ] 实现 canonical、bounded server-side science inspect API 并生成 SDK
- [ ] 建立 project-file renderer registry，复用现有 science renderer 且不混 tool/session artifact identity
- [ ] 在统一 FileView 接入 drawer 与中心文档 tab 自动路由、错误恢复和大文件 fallback
- [ ] 用真实 CSV/FASTA/VCF/PDB/HDF5/unknown fixtures 锁定全链路与零 Atlas 请求
- [ ] 通过 Plan 19 Checkpoint A/B
- [ ] 完成 Plan 19 Definition of done

### Plan 19 checkpoint

- [ ] 所有 project path canonical containment 与 inspect 输入/输出预算有真实负向测试
- [ ] drawer/中心 tab 只经过一个 FileView/renderer contract，普通 Markdown/PDF/图片/代码行为不回归
- [ ] project file、tool artifact 与 session artifact 只共享 renderer capability，不混 identity/transport/ownership
- [ ] Plan 20/21 可消费同一 classification contract，无第二份扩展名表或 Atlas surface

### [20 — 交互式 CSV/TSV 数据表工作台](plans/20-interactive-data-table.md)

- [ ] 冻结 CSV/TSV parser、schema/type inference、client/stream mode 与 operation capability
- [ ] 实现 quoted multiline 安全的流式 page/scan API、stale cursor 与生成 SDK
- [ ] 实现可访问的分页/虚拟化 table、bounded DOM 与可恢复资源状态
- [ ] 增加精确筛选/稳定排序/schema/列统计及范围明确的导出
- [ ] 通过真实小/中/100 MiB CSV/TSV FileView E2E
- [ ] 通过 Plan 20 Checkpoint A/B
- [ ] 完成 Plan 20 Definition of done

### Plan 20 checkpoint

- [ ] BOM、CRLF、quoted delimiter/quote/multiline、重复/空 header、ragged/malformed fixtures 结果稳定
- [ ] client mode 操作覆盖完整数据；stream mode 不把 sample/partial 伪报为完整 total/filter/sort/stats/export
- [ ] server read、network response、browser state 和 DOM 都有可测上限，大文件不完整加载
- [ ] DataTable 只作为 Plan 19 registry renderer 接入，不创建第二套 Files/tab/state

### [21 — Project Artifact discovery、manifest、inspector 与 provenance](plans/21-project-artifact-evidence.md)

- [ ] 冻结 discovery/exclude、stable artifact ID、content version、rename 与 stale/missing contract
- [ ] 实现 bounded scanner、streaming hash 与 deterministic complete/incomplete manifest
- [ ] 增加分页 catalog、detail、manifest、Git/local provenance API 并生成 SDK
- [ ] 实现 project-scoped、versioned annotations 与 recoverable revision/tombstone
- [ ] 作为独立 `project-artifacts` provider 接入 Plan 16 Explorer core 与上下文 Inspector
- [ ] 通过真实 discover→inspect→annotate→manifest→provenance E2E
- [ ] 通过 Plan 21 Checkpoint A/B
- [ ] 完成 Plan 21 Definition of done

### Plan 21 checkpoint

- [ ] project/session/tool/RG identity 与事实源保持分离，只通过 typed ref 关联
- [ ] scanner 拒绝 traversal/symlink external，manifest 路径排序/digest 可复现且 incomplete 不伪装 verified
- [ ] annotation 与 provenance 在内容变化、rename/delete 时显示 stale/missing，不静默迁移或丢证据
- [ ] Project Artifacts 复用 Explorer/FileView，不恢复 Atlas artifact UI/API 或创建第二套 viewer/graph

### [22 — 将 EvidenceGraph 交互迁移到现有 Research Graph](plans/22-research-graph-evidence-interactions.md)

- [ ] 冻结现有 RG baseline、evidence projection/read model、external ref 与 deep-link contract
- [ ] 在现有 RG graph/node/edge API/store 实现幂等、事务化 evidence projection
- [ ] 在现有 GraphView/GraphCanvas 增加 filter、search、focus、neighbor exploration 与 reset
- [ ] 扩展 NodePanel/ProvenancePanel 的 evidence detail、stale/missing 和同源 source/inspector 跳转
- [ ] 通过真实闭环、重放/并发/重启、5k/10k 性能、无 evidence 回退与 graph uniqueness 验证
- [ ] 通过 Plan 22 Checkpoint A/B
- [ ] 完成 Plan 22 Definition of done

### Plan 22 checkpoint

- [ ] projection 始终写入 Plans 03/04 绑定的现有 RG graph，无 binding 时 fail closed
- [ ] 重放、并发、partial failure、source update/delete 无 duplicate/dangling/静默证据丢失
- [ ] 所有 filter/focus/detail/deep link 使用现有 graph/node/edge contract 与同源 gateway
- [ ] 仓库没有第二套 graph database、route namespace、frontend store/tab 或恢复的 Atlas/EvidenceGraph surface

## Wave A：基础契约与低耦合清理

### [01 — TaskResult 可靠结果契约](plans/01-task-result-contract.md)

- [x] 定义 canonical schema 与 invariants
- [x] 增加 strict decoder 与 legacy adapter
- [x] 让 TaskTool 对所有 caller 返回同一结果形状
- [x] 固定兼容、telemetry 与 rollout 行为
- [x] 通过 Plan 01 Checkpoint
- [x] 完成 Plan 01 Definition of done

### [02 — Agent context 优化收尾](plans/02-agent-context-closeout.md)

- [ ] 冻结 deterministic profile baseline
- [ ] 只缩减测得的 schema outlier
- [ ] 用真实 MCP server soak manifest cache
- [ ] 通过 Research Graph soak result bounding
- [ ] 验证 compaction 并关闭 docs plan 13
- [ ] 通过 Plan 02 Checkpoint
- [ ] 完成 Plan 02 Definition of done

### [03 — Research Graph sidecar supervisor](plans/03-research-graph-supervisor.md)

- [ ] 版本化 health/capability contract
- [ ] 为 sidecar entry 增加动态 loopback discovery
- [ ] 实现 single-flight supervisor state machine
- [ ] 增加黑盒 lifecycle/diagnostics 覆盖
- [ ] 通过 Plan 03 Checkpoint
- [ ] 完成 Plan 03 Definition of done

### [05 — UI 反馈通道清理](plans/05-ui-feedback-cleanup.md)

- [x] 确认可达性并删除死 Composer
- [x] 在应用根安装唯一 Toast Region
- [x] 将旧工作台 Toast facade 收窄为 `@synsci/ui` 薄兼容层，并保留 Stage/Research Graph 调用点
- [x] 增加真实 Toast 生命周期回归
- [x] 通过 Plan 05 Checkpoint
- [ ] 完成 Plan 05 Definition of done（backend 全量 `bun test` 因既有 Windows 环境失败/挂起未勾选；见计划 Progress）

### [06 — Settings Dialog 收敛](plans/06-settings-dialogs.md)

- [ ] 硬化共享 Promise dialog 原语
- [ ] 迁移 OAuth code 与 Storage path 输入
- [ ] 迁移 Connectors、Credentials、General 确认
- [ ] 迁移 Memory、Network、Specialists 确认
- [ ] 通过 Plan 06 Checkpoint
- [ ] 完成 Plan 06 Definition of done

### [07 — 异步资源状态统一](plans/07-async-resource-states.md)

- [ ] 实现并测试 AsyncState 展示原语
- [ ] 迁移两棵文件树并停止错误转空
- [ ] 迁移文件预览与 FolderPicker 状态
- [ ] 区分技能同步中、空库与无搜索结果
- [ ] 通过 Plan 07 Checkpoint
- [ ] 完成 Plan 07 Definition of done

### [15 — Atlas 产品面退役](plans/15-atlas-surface-retirement.md)

- [x] 冻结动态/静态 Atlas 调用图，并真实验证 `atlas_graph`、`atlas_stage`、`atlas_sync` 目标
- [x] 隐藏 Atlas Canvas/artifacts，默认右栏切到 Research Graph、Files 回到 host
- [x] 将首次设置与 Settings 收窄为 BYOK/local
- [x] 先固定 flag-on characterization，再用单一非 UI flag 默认关闭 Atlas 自动 login/sync/wallet/CLI 行为
- [x] 隔离 Codex token push/status/revoke、Atlas project CLI 等 direct managed consumers
- [x] 移除默认 Agent/skill 中的 Atlas 产品引导，保留 Stage 与本地 Research Graph 指令
- [x] 隔离 `/api/atlas` 与 managed account/billing routes
- [x] 用 Rollup 模块报告、legacy 状态 E2E 和 loopback capture 验证替代工作流及默认零 Atlas 外部请求
- [x] 通过 Plan 15 Checkpoint
- [ ] 完成 Plan 15 Definition of done（待 CI 补跑 Playwright E2E + 全量 coverage）

### [16 — 本地 Explorer 与 Session Artifacts](plans/16-local-artifact-explorer.md)

- [ ] 冻结 RLMArtifacts 基线、legacy 行为与 Atlas-independent 模块边界
- [ ] 增加 session artifact metadata、分页 list、bounded preview、download API 并生成 SDK
- [ ] 建立 Explorer core shell，以单一 compatibility adapter 插入现有 FileExplorer
- [ ] 插入 Session Artifacts 列表、preview/download 模块
- [ ] 通过真实 register→list→preview→download E2E 与零 Atlas 请求断言
- [ ] 通过 Plan 16 Checkpoint A/B
- [ ] 完成 Plan 16 Definition of done

### Wave A checkpoint

- [x] TaskResult 缺结构、空输出、失败、取消、超时均不会成为 success
- [ ] profile/schema baseline 可重复，cache/result-bound feature flag 保持安全默认
- [ ] sidecar health 能识别正确服务、协议与实例
- [ ] workspace 仅有一个 Toast host，且不存在 `window.prompt/window.confirm`
- [ ] loading/refreshing/empty/error/ready 语义互斥且 error 可 retry
- [x] Atlas 产品入口不可见且默认无外部请求；Stage、Research Graph 与 BYOK/local 仍可用（E2E 待 CI 补跑）
- [ ] Explorer 默认保持 host Files，并可插入本地 session artifacts；两条路径均不依赖 Atlas

## Wave B：Research Graph 同源边界

### [04 — Research Graph 同源 gateway](plans/04-research-graph-gateway.md)

- [ ] 构建 backend-only reverse proxy
- [ ] 让嵌入 Research Graph UI 支持路径前缀
- [ ] 增加权威 session→graph resolution
- [ ] 生成 SDK 并迁移 workspace pane
- [ ] 增加 gateway contract 与浏览器 E2E
- [ ] 通过 Plan 04 Checkpoint
- [ ] 完成 Plan 04 Definition of done

### Wave B checkpoint

- [ ] 浏览器不直接访问 sidecar 端口、不持有 capability token
- [ ] session binding 不再做标题猜测或逐 graph tree 扫描
- [ ] gateway contract、SDK consumer 与浏览器 E2E 通过

## Wave C：视觉基线与 Orchestrator MVP

### [08 — 视觉系统与回归基线](plans/08-visual-system-and-regression.md)

- [ ] 定义语义 token 与兼容 alias
- [ ] 在 Home/Session 壳层采用 token
- [ ] 在 Settings/共享 primitive 采用 token
- [ ] 建立 18 张代表面 screenshot golden
- [ ] 增加 axe、键盘、reduced-motion 与 CI gate
- [ ] 通过 Plan 08 Checkpoint
- [ ] 完成 Plan 08 Definition of done

### [09 — Orchestrator 与窄工具 Worker MVP](plans/09-orchestrator-mvp.md)

- [ ] 注册薄 Orchestrator
- [ ] 固定路由和 brief/return 协议
- [ ] 注册窄 Graph worker
- [ ] 完成 legacy compatibility 与 direct/literature/code/graph smoke
- [ ] 通过 Plan 09 Checkpoint
- [ ] 完成 Plan 09 Definition of done

### Wave C checkpoint

- [ ] Home/Session/Settings 的 light/dark、360/768/1440 基线已评审
- [ ] 核心交互满足键盘、焦点、对比度和 reduced-motion 门槛
- [ ] Orchestrator 父 tool schema 不超过 2,500 tokens
- [ ] legacy `research` 仍为默认且可直接回退
- [ ] literature/code/graph 三类真实委派保留 child session 与 artifact/graph refs

## Wave D：调度

### [10 — Subagent 调度、取消与超时](plans/10-subagent-scheduler.md)

- [ ] 建立 TaskRun 状态机
- [ ] 实现全局/会话/compute admission 与公平性
- [ ] 接入 TaskTool 取消与 timeout
- [ ] 增加可观测性并完成 feature-flag soak
- [ ] 通过 Plan 10 Checkpoint
- [ ] 完成 Plan 10 Definition of done

### [14 — Atlas Canvas 架构拆分（Superseded）](plans/14-graph-ui-architecture.md)

- [x] 产品方向已改为隐藏/关闭 Atlas，由 Plan 15 取代；原 Canvas 重构任务不执行

### Wave D checkpoint

- [ ] child/compute cap、排队公平性、取消、timeout 和 late completion 均有真实测试
- [ ] terminal 状态不可逆，permit 无泄漏，敏感 prompt/tool body 不进入 telemetry

## Wave E：Orchestrator 上线门槛

### [11 — Orchestrator 回归评测](plans/11-orchestrator-evaluation.md)

- [ ] 定义 versioned case schema 与 deterministic scorer
- [ ] 实现真实 SessionPrompt/TaskTool eval runner
- [ ] 生成 legacy/orchestrator 成对报告与门槛判定
- [ ] 接入受控 CI 或定时 lane
- [ ] 通过 Plan 11 Checkpoint
- [ ] 完成 Plan 11 Definition of done

### Wave E checkpoint

- [ ] direct/code/literature/graph/fan-out/partial-failure/cancel/long-context 场景可重复运行
- [ ] seeded failure/cancel/timeout terminal accuracy 为 100%
- [ ] parent schema、provider input、compaction、完成率和权限越界满足计划门槛
- [ ] 失败报告能定位 child session、tool call 和 scorer 原因

## Wave F：灰度与后置重构

### [12 — Orchestration 运行轨迹 UI](plans/12-orchestration-ui.md)

- [ ] 建立 TaskRun metadata parser 与 view model
- [ ] 实现可访问的 TaskTrajectory 组件
- [ ] 接入现有 task renderer 与 child navigation
- [ ] 完成 parent/child E2E 和灰度保护
- [ ] 通过 Plan 12 Checkpoint
- [ ] 完成 Plan 12 Definition of done

### [13 — Session turn pipeline 拆分](plans/13-session-turn-pipeline.md)

- [ ] 固定 turn 事件与结果契约
- [ ] 打破 TaskTool→SessionPrompt 模块环
- [ ] 抽取 tool resolution 与统一 invoke envelope
- [ ] 抽取 turn context assembly
- [ ] 抽取 control/finalize 并收窄 facade
- [ ] 通过 Plan 13 Checkpoint
- [ ] 完成 Plan 13 Definition of done

### Final checkpoint

- [ ] Orchestration UI 只消费现有 TaskTool/TaskRun 事实源，不建立第二套运行图
- [ ] 可选 Agent 灰度、指标与 legacy `research` 回退已演练
- [ ] session turn 拆分不改变公开 API、事件相对顺序、prompt 或 terminal 行为
- [ ] 所有 focused tests、workspace E2E、Research Graph tests 通过
- [ ] 默认配置无 Atlas 产品 UI、自动云行为或外部请求，Stage/Research Graph 回归通过
- [ ] 本地 session artifacts 可在 Explorer 中分页浏览、bounded preview 与下载，且不恢复 Atlas artifact 产品入口
- [ ] 独立 Python/R 默认走 ephemeral process；persistent kernel、Batch 和外围 I/O 工具满足 Plan 18 的资源与安全门槛
- [ ] 科学文件在统一 FileView 自动识别并受限预览，CSV/TSV 小文件精确交互且大文件不完整加载/伪报 sample 结果
- [ ] Project Artifacts 可发现、inspect、annotation、生成可复现 manifest 并查看 provenance，且与 Session Artifacts 保持独立事实源
- [ ] Evidence 投影幂等进入唯一 Research Graph，stale/missing 可见且无第二套 graph database/API/store/tab
- [ ] `bun run typecheck` 与 build 通过
- [ ] `cd backend/cli && bun test` 完整通过并记录耗时
- [ ] API 变化后已从仓库根运行 `./tooling/repo/generate.ts`
- [ ] 所有计划 Status、Progress、兼容/回滚证据和必要 ADR 已更新
