# 20 — 交互式 CSV/TSV 数据表工作台

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** Plan 19 的 `table` classification/renderer contract；backend/API 任务须通过 Plan 00；视觉回归应协调 Plan 08
- **Coordination:** 只作为 Plan 19 project-file registry 的一个 renderer；不自建 file tab、artifact identity 或全局数据层
- **Source:** OpenScience 2.0 的 `DataTableView.tsx` 与 `data/table.ts`，并补强其 5,000 行截断和全文解析的大文件边界

## Current state

- CSV/TSV 当前由 `FileView` 当作代码文本显示，没有分页、排序、筛选、schema、列统计或筛选结果导出。
- OpenScience 2.0 已提供浏览器端 parser、100 行分页、全列搜索、排序、schema、数值摘要/分布和导出，但会先接收完整文本并在 parse 后截断到 5,000 行。
- Plan 19 将提供统一 `table` capability、project-safe inspect 和 `FileView` renderer registry；本计划无需再判断扩展名或创建第二个文件页。
- repo 尚未固定 CSV parser 依赖，也没有适合超大 delimited file 的 server-side page/scan contract。

## Problem

仅把上游 `DataTableView` 复制进来可以改善小文件体验，却会让大型 CSV/TSV 完整进入服务端内存、网络、浏览器 state 和 DOM，并让“5,000 行预览”与真实总行数、排序/筛选语义混淆。需要把 parser correctness、交互状态和大文件执行模式分开：小文件可本地即时交互，大文件必须流式分页，超出可精确处理预算的操作要 server-side 或明确禁用，绝不能默默只对截断样本排序后声称是全表结果。

## Goals

1. 正确解析 RFC 4180 常见 CSV 与 TSV，包括 BOM、CRLF、quoted delimiter、escaped quote、quoted multiline、空列、重复/缺失 header 和 ragged rows。
2. 提供可访问的分页/虚拟化表格、sticky header/row index、排序、全局筛选、列类型、missing/unique 和数值摘要。
3. 根据文件与预算显式选择 `client` 或 `stream` mode；UI 始终展示当前 mode、已扫描范围和操作能力。
4. 大文件分页在源头流式读取；未知总行数、受限筛选或不可用排序必须诚实表达。
5. 导出只导出用户明确选择的范围：当前筛选结果、当前页或原文件；不把截断样本伪装成完整导出。
6. 作为现有文档标签页 renderer 工作，保留 Files、centerTabs 与下载路径。

## Non-goals

- 不在 v1 实现 Excel、Parquet、Arrow、JSON/JSONL 或数据库查询；后续需独立格式 adapter。
- 不提供 spreadsheet 编辑、公式、单元格写回、协同编辑或数据清洗 pipeline。
- 不在浏览器对超出预算的整表建立完整索引、完整唯一值集合或完整排序副本。
- 不以 canvas 绘制取代语义 table；如使用 row virtualization，仍需键盘和 screen-reader 可访问路径。
- 不把 table selection 写入 artifact/provenance；Plan 21/22 可在稳定 selection contract 后另接。
- 不复制 OpenScience 2.0 的 Atlas CSS/class 或 RightPane 集成。

## Execution modes

| Mode   | Eligibility                            | Exact operations                               |
| ------ | -------------------------------------- | ---------------------------------------------- |
| client | 文件 bytes/rows/columns 均低于冻结预算 | 全表筛选、稳定排序、schema、统计、筛选结果导出 |
| stream | 文件超过 client 预算或总量未知         | cursor page、原文件下载、受限 schema sample    |

`stream` mode 的 filter/sort 只有在 server 能于固定 scan/deadline/temporary-memory 预算内给出完整精确结果时才启用；否则 capability 返回 `disabled` 与原因。禁止返回“partial matches”却使用普通总数/导出文案。若未来增加索引或后台作业，应作为新的执行模式和计划，不暗改 v1 语义。

## Implementation tasks

### Task 1：冻结 parser、schema、能力和预算契约

**Description:** 选择或实现可流式复用的 CSV/TSV parser kernel，定义 header normalization、row shape、type inference、统计、error position、client/stream threshold 与 operation capabilities；用真实 fixture 固定行为。

**Acceptance:**

- [ ] BOM、CRLF/LF、quoted delimiter、escaped quote、quoted multiline、尾随空列、空行、重复/空 header 与 ragged rows 均有确定输出。
- [ ] parse error 包含安全的 row/column/offset，不回显超长 cell 或绝对路径；encoding 非 UTF-8 时明确报错/降级。
- [ ] type inference 只基于明确 sample，返回 sample size/confidence；不会把混合 ID、前导零或 locale number 静默转成 number。
- [ ] client bytes/rows/columns、page size、cell length、schema sample、unique/statistics 与 render window 预算由代码常量约束。
- [ ] `TableCapabilities` 明确每项操作是 `client/server/disabled` 及原因，未知 `totalRows` 不伪造为截断行数。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun test src/data/table.test.ts`
- [ ] parser fixture matrix 包含 quoted multiline 与至少一个 malformed case
- [ ] 计划评审确认 client/stream threshold 和 disabled operation 文案

**Dependencies:** Plan 19 Task 1 contract

**Files:**

- `frontend/workspace/src/data/table.ts`（新增 shared contract/client adapter）
- `frontend/workspace/src/data/table.test.ts`（新增）
- `frontend/workspace/src/data/fixtures/`（小型真实 fixtures）
- `tasks/plans/20-interactive-data-table.md`

**Scope:** S–M — parser contract、table-driven tests 与 fixtures

### Task 2：实现大型 CSV/TSV 的流式 page/scan API

**Description:** 增加 project-scoped table endpoint，复用 Task 1 parser semantics，以 byte/row cursor 流式返回 header、page、sample schema、totalRows knowledge 和 capabilities；不会先完整读取或在内存构造全表。

**Acceptance:**

- [ ] route 只读取 Plan 19 已识别为 table 的 canonical project file，拒绝 traversal、symlink escape、目录和格式漂移。
- [ ] cursor 与 file identity/version 绑定；文件变化后旧 cursor 返回稳定 stale error，不从错误 offset 继续。
- [ ] page limit、column cap、cell cap、scan bytes、deadline 与 response bytes 在 server 强制；取消会及时关闭 stream。
- [ ] quoted multiline 跨 chunk/page boundary 仍解析正确，下一页不重复/丢失 row。
- [ ] filter/sort 只在 capability 为 server 且能精确完成时接受；超预算返回 `operation_unavailable`，不返回无标记 partial result。
- [ ] 生成 SDK；API error 不泄漏绝对路径或完整 cell 内容。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/table.test.ts test/server/file-table.test.ts`
- [ ] 真实 100 MiB fixture/sparse generator 证明 peak memory 与 response 不随总文件线性增长
- [ ] `(cwd: backend/cli) bun run typecheck`
- [ ] `(cwd: repository root) ./tooling/repo/generate.ts`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 1；Plan 19 Task 2；Plan 00 合并护栏

**Files:**

- `backend/cli/src/file/table.ts`（新增）
- `backend/cli/src/file/index.ts`
- `backend/cli/src/server/routes/file.ts`
- `backend/cli/test/file/table.test.ts`（新增）
- `backend/cli/test/server/file-table.test.ts`（新增；若文件预算超限则与 parser test 合并）

**Scope:** M — 3 个 implementation files、1–2 个 focused tests 与生成物

## Checkpoint A：数据正确性与大文件边界

- [ ] frontend client parser 与 backend stream parser 对共享 fixture 产生相同 headers/rows/errors。
- [ ] cursor 在 chunk boundary、quoted multiline、文件变更与取消场景正确。
- [ ] 100 MiB 文件不会完整进入 server/browser memory，response/DOM 有固定上限。
- [ ] client/stream mode 与 filter/sort/export capability 可由 contract 判断，无隐式 sample 语义。
- [ ] focused tests、SDK generation 与 typecheck 通过。

### Task 3：实现可访问的分页/虚拟化数据表基础视图

**Description:** 新建 `DataTableView`，按 capability 选择 client/stream data source，提供 sticky header、row index、列宽/溢出、分页或 row virtualization、loading/empty/error/stale 状态和键盘导航。

**Acceptance:**

- [ ] 小文件用 client mode；大文件只请求当前/相邻受限 page，不把所有已访问 page 永久累积在全局 state。
- [ ] table 有 caption/可访问名称、正确 header/cell 关系、键盘滚动与可见 focus；360/768/1440 宽度无不可恢复遮挡。
- [ ] page change、路径切换和 mode 切换取消旧请求；旧 page 不覆盖新文件。
- [ ] 空表、header-only、超列数、长 cell、parse error、route error 与 stale cursor 使用不同状态。
- [ ] DOM row/cell 数受 render window 约束；10k×100 fixture 不产生百万节点。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun test src/data/table.test.ts src/data/view.test.tsx`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] 浏览器性能记录或 E2E assertion 证明 DOM window 上限

**Dependencies:** Task 2、Checkpoint A

**Files:**

- `frontend/workspace/src/data/DataTableView.tsx`（新增）
- `frontend/workspace/src/data/source.ts`（新增 client/stream adapter）
- `frontend/workspace/src/data/view.test.tsx`（新增）
- `frontend/workspace/src/data/table.css`（仅在 token/utility 不足时新增）

**Scope:** M — 2–3 个实现文件、1 个 component test

### Task 4：增加筛选、排序、schema、列统计与明确导出

**Description:** 在基础视图上增加全列筛选、稳定三态排序、schema panel、missing/unique、数值 min/max/mean 与可选分布摘要；所有 action 由 capability 驱动并标明作用范围。

**Acceptance:**

- [ ] client mode 的筛选/排序覆盖完整已载入全表，排序稳定，空值和 number/date/string comparison 规则有测试。
- [ ] stream mode 对 unsupported filter/sort 使用 disabled control + 原因；支持时由 server 返回 exact result 和稳定 cursor。
- [ ] schema/统计明确标注 `full` 或 `sampled N rows`，sample 不显示成全表结论；无数值列时不显示伪分布。
- [ ] query/sort 变化重置 page/cursor，快速输入有 debounce/cancel，不产生 out-of-order results。
- [ ] export 菜单明确区分原文件、当前页和完整筛选结果；只有 exact capability 时提供完整筛选导出，CSV quoting 正确。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun test src/data/table.test.ts src/data/view.test.tsx`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] focused E2E 覆盖 filter→sort→page→export 与 sampled schema 文案

**Dependencies:** Task 3

**Files:**

- `frontend/workspace/src/data/DataTableView.tsx`
- `frontend/workspace/src/data/table.ts`
- `frontend/workspace/src/data/ColumnProfile.tsx`（新增）
- `frontend/workspace/src/data/view.test.tsx`
- `frontend/workspace/e2e/data-table.spec.ts`（新增）

**Scope:** M — 3 个 implementation files、unit/component test 与 E2E

### Task 5：接入 FileView 并锁定真实 CSV/TSV E2E

**Description:** 将 `DataTableView` 注册为 Plan 19 的 `table` renderer，用真实小/中/大型 CSV/TSV 验证 Files→文档 tab→交互→下载/导出的完整链路和普通代码 fallback。

**Acceptance:**

- [ ] CSV/TSV 在 drawer 与中心 tab 均自动打开表格；用户可显式切换到原始文本/下载，而不创建第二个 tab 模型。
- [ ] 小文件具备 exact filter/sort/schema/stats/export；大文件显示 stream mode、页能力与不支持操作原因。
- [ ] quoted multiline、BOM、重复 header、ragged row、空表、malformed、100 MiB 与路径切换 fixture 行为符合 contract。
- [ ] 原文件下载 bytes 不变；导出 filename/content type/quoting 正确，object URL 或 stream 在动作结束后释放。
- [ ] E2E 无 console error、stale page、百万 DOM node、Atlas 请求或完整大文件浏览器传输。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/table.test.ts test/server/file-table.test.ts`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/data-table.spec.ts e2e/file-science-routing.spec.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 4；Plan 19 Task 4

**Files:**

- `frontend/workspace/src/science/ProjectScienceView.tsx`
- `frontend/workspace/src/data/DataTableView.tsx`
- `frontend/workspace/e2e/data-table.spec.ts`
- `frontend/workspace/e2e/data/` fixtures/generator
- `tasks/plans/20-interactive-data-table.md`（记录证据）

**Scope:** M — 2 个实现文件、1 个 E2E 与受控 fixtures

## Checkpoint B

- [ ] CSV/TSV parser correctness 覆盖常见 quoting、newline、header 和 malformed 情况。
- [ ] 小文件交互精确，大文件 stream mode 不谎报 totals、filter/sort/schema/export 范围。
- [ ] server read、network response、browser state 与 DOM 均有可测上限。
- [ ] DataTable 只通过 Plan 19 registry 接入，Files/centerTabs/Atlas/RG 边界未改变。
- [ ] focused backend/frontend tests、真实 E2E、typecheck 与 SDK generation 通过。

## Compatibility and rollback

- table API 与 renderer 均为 additive；删除一条 registry entry 即回到原始代码文本 fallback。
- 原文件不被修改；导出生成新下载，不覆盖 project file。
- stream route 可在前端回退后保留；删除前需确认生成 SDK 无 consumer。
- 预算或 capability 收紧可安全禁用操作；放宽预算必须有新的性能证据，不仅修改常量。

## Definition of done

- [ ] Tasks 1–5 与 Checkpoint A/B 全部完成并记录证据。
- [ ] CSV/TSV 小文件拥有完整交互，大文件拥有诚实、bounded、可恢复的 stream 体验。
- [ ] parser、server cursor、UI capabilities 和 export 语义由共享 fixture/contract 保护。
- [ ] 没有完整大型文件读取、隐式 5,000 行全表假象、第二套 file tab 或 Atlas 依赖。
- [ ] 所有 focused tests、workspace E2E、SDK generation 与 typecheck 通过。
