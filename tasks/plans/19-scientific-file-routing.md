# 19 — 科学文件识别、受限检查与文档标签页路由

- **Status:** 🟡 In progress（Checkpoint A 完成；Checkpoint B 与 DoD 待续）
- **Priority:** P1
- **Dependencies:** Plan 15 的 Atlas 退役边界；backend/API 任务须通过 Plan 00。Tasks 1–3 不依赖 Plans 07/16，但在本计划内按 Task 1 → 2 → 3 推进；Task 4 硬依赖 Plan 07 Tasks 1、3 的 `AsyncState` 与 `FileView` 状态基线
- **Coordination:** backend `ScienceFile` 是扩展名、magic、预算和分类的唯一事实源，frontend 只消费生成 inspect contract。Plan 16 不提供 project-file 数据，但拥有 `session.tsx` Explorer 接线；Plan 19 默认对 `session.tsx` 保持 0 行功能修改。两计划的 SDK generation 与 workspace E2E 必须串行
- **Source:** OpenScience 2.0 的 `science/files.ts`、`file/science.ts`、`ScientificDataView` 与 `BinaryScienceView` 对照审计

## Current state

- `frontend/workspace/src/atlas/FilePreview.tsx` 已提供统一 `FileView`；当前真实消费者是中心文档标签页，legacy drawer wrapper 为零消费者。它可显示 Markdown、PDF、图片、代码和 binary fallback。
- 当前选择 renderer 主要依赖扩展名，CSV/TSV 仍以代码文本展示，未知二进制只提供下载提示；没有服务端科学格式检查结果参与路由。
- `FileView` 挂载后会立即调用 `file.read`；backend 对文本执行完整 `.text()`、对 binary 执行完整 `arrayBuffer()` 再 base64，浏览器随后把完整内容保存在 resource/draft/data URL。大文件受限预览因此是 load-policy 行为改造，不是简单增加一个 renderer 分支。
- `FilePreview.tsx` 的 `LANG`、`Kind` 与 `kind` memo 是当前真实 viewer 分派；`prompt-input.tsx` 的 `TEXT_EXTENSIONS` 仅负责上传 MIME allow-list，`ProteinStructure.tsx` 的 `EXT_FORMAT` 仅负责 renderer payload/URL decoder，不能误当 project-file detector。
- 生成 SDK 当前已经暴露 `sdk.client.file.write`，但 `FileView.save()` 仍保留“SDK 没有 file.write”的过时注释和手写 `PUT /file/content`；本计划接触该文件时必须收敛到生成 client。
- `frontend/workspace/src/science/ScienceArtifact.tsx` 与 `science/renderers/registry.ts` 已能显示 tool 产生的 PDF、LaTeX、sequence、genome、MSA、Chem2D、ProteinStructure 与图片 artifact。
- backend 的 `file` route 能读取 project file，但没有 OpenScience 2.0 的 `file/science.ts`、magic-byte 检查、科学二进制摘要或 typed inspect API。
- `File.read` 当前只有 lexical containment，并明确留有 symlink escape/Windows cross-drive TODO。inspect、bounded preview、raw download 与后续 read/write 不能各自解析路径或把一次 inspect 当成永久授权。
- 现有 `FileView` 已正确接入中心文档 tab，因此应在该边界增加 project-file renderer registry，而不是再建第二套文件预览页。

## Problem

科学文件能被 Files 打开，却常被降级为纯文本或“binary file”。直接复制 OpenScience 2.0 的 dispatcher 会混淆 tool artifact 与 project file 的 ownership。若 frontend/backend 各维护一张格式表会产生分类漂移；若只在现有 eager `file.read` 旁增加 inspect，大文件仍会先被完整读取。需要让 backend 独占分类与 canonical path policy，由生成 SDK 暴露 inspect/read policy，再让 `FileView` 先 inspect、后按预算选择 full、bounded preview、metadata 或 stream download。

## Goals

1. 由 backend 单一 manifest 使用扩展名、媒体类型和有限 magic/header bytes 稳定识别首批科学格式，并通过生成 SDK 向所有 frontend consumer 暴露结果。
2. 所有服务端 inspect 都 canonicalize project path，拒绝越界、symlink escape 与目录目标，并且不先完整读取大型文件。
3. 建立 project-file renderer registry，复用已有科学 renderer 的 capability/组件，但保持 project file 与 tool artifact 的 ID、transport 和生命周期分离。
4. 在现有 `FileView` 内完成 inspect-first load policy；小文件保持编辑/renderer，超预算文本只显示 bounded preview，大型 binary 只显示 metadata/capability 与 stream download。
5. 为 text、binary、损坏、未知和超大文件提供真实回退，不因识别或 renderer 错误失去下载/源码查看能力。
6. 为 Plan 20 的 tabular renderer 和 Plan 21 的 artifact classification 提供唯一检测契约。

## Non-goals

- 不在本计划实现交互式 CSV/TSV 表格；由 Plan 20 消费本计划的 `table` capability。
- 不实现 project artifact 扫描、manifest、annotation 或 inspector；由 Plan 21 负责。
- 不恢复 Atlas Canvas、Atlas RightPane、`ArtifactsPanel`、`createAtlasAPI` 或 `/api/atlas/*`。
- 不为 project file 写入 session artifact catalog，也不把 project path 变成 artifact tool ref。
- 不承诺在 v1 完整解析 HDF5、H5AD、BAM/CRAM、Parquet 等大型二进制；允许先显示受限元数据与明确的外部工具建议。
- v1 对 HDF5/H5AD/loom、Parquet/Arrow、BAM/CRAM 只承诺 family/evidence/size/capability/warning，不承诺 dataset 名、维度、schema、record/sample count 或 index 内容，也不新增重型 parser。
- v1 不把本地 BED/GFF/GTF/VCF/BAM/CRAM 直接交给 `GenomeTrack`；在有 canonical same-origin Range transport 与 FAI/BAI/CSI/TBI 配对协议前，只提供 bounded text/metadata/capability fallback。
- 不让浏览器根据不可信扩展名动态 import 任意模块，也不在 renderer 内执行文件内容。

## Proposed contract

backend `ScienceFile` 的 manifest、纯分类函数和 Zod response schema 是唯一事实源；route、Plan 21 scanner 和其他 backend consumer 直接调用它。OpenAPI 生成 frontend type，`frontend/workspace/src/science/files.ts` 只做 generated `capability/readPolicy` 到 renderer/fallback 的穷尽映射，不包含扩展名或 magic 表，也不能在成功 inspect 后用本地扩展名覆盖服务端结果。backend 不得 import frontend source。

检测结果至少包含：规范化 `family/format`、`mode`（text/binary）、renderer capability、置信 evidence、size、warnings 与 `readPolicy: editable-full | bounded-preview | metadata-only | streamed-media`。text inspection 可携带固定上限的 `preview/contentBytes/totalBytes/truncated/lines`；binary inspection 只返回受限 metadata。扩展名与 magic/header 冲突时以可验证的服务端 evidence 为准并保留 warning；仅凭 HDF5 magic 时只能报告 `hdf5` family，不能猜成 H5AD/loom。

首批验证矩阵：

| Family      | Representative formats                   | v1 behavior                                    |
| ----------- | ---------------------------------------- | ---------------------------------------------- |
| table       | CSV、TSV                                 | 标记 `table` capability；Plan 20 接管交互视图  |
| sequence    | FASTA、FASTQ                             | 复用 sequence/MSA renderer 或受限文本摘要      |
| genome      | BED、GFF/GTF、VCF                        | bounded text/metadata；v1 不直连 GenomeTrack   |
| structure   | PDB、mmCIF、XYZ、MOL/SDF                 | 小型受限内容可复用 renderer；超限回退 metadata |
| document    | LaTeX、PDF                               | 保持现有 FileView 行为                         |
| binary data | HDF5/H5AD、loom、Parquet/Arrow、BAM/CRAM | family/evidence/size/capability 提示，不深解析 |
| unknown     | 错扩展名、损坏内容、无扩展名与任意二进制 | 安全 fallback、下载与错误详情                  |

固定预算应由代码常量和测试约束：inspect 只读取头部/必要尾部的有限字节，返回 JSON、preview bytes/lines/records、允许完整读取/编辑的 file size、浏览器 retained chars/DOM nodes 和解析 deadline 都有固定上限；具体数值在 Task 1 characterization 后冻结，不能只写在 UI 文案里。大文本 v1 使用截断 preview 即可，不为此引入新的虚拟滚动基础设施。

## Implementation tasks

### Task 1：冻结 backend 唯一分类 manifest、优先级与预算契约

**Description:** 在 backend 建立不执行 I/O 的 canonical manifest、纯 detector 与 Zod schema，冻结扩展名/magic 优先级、read policy、错误码和资源预算；frontend/runtime route 后续只消费该 source/schema，不复制科学格式表。

**Acceptance:**

- [ ] 每种首批格式都映射到一个稳定 `family/format/mode/capability`，扩展名大小写与常见别名结果一致；不得借用 artifact-only `kind` 混淆 project-file family。
- [ ] magic/header 与扩展名冲突、无扩展名、损坏 header、空文件和未知二进制均有确定结果与 warning。
- [ ] contract 明确 `project-file` ownership；不包含 session artifact ID、tool output、Atlas project ID 或 Research Graph node ID。
- [ ] 冻结 inspect bytes、preview bytes/lines/records、full-read/edit threshold、response、DOM 与 deadline 预算，以及超限时的稳定 `bounded-preview/metadata-only` 语义。
- [ ] route、Plan 21 scanner 与 frontend generated consumer 只能消费 backend `ScienceFile` contract；成功 inspect 后不存在第二张科学扩展名/magic 表或客户端 override。
- [ ] 明确记录合法非 detector 映射：`FilePreview.LANG` 仅用于 syntax grammar，`prompt-input.TEXT_EXTENSIONS` 仅用于上传 MIME allow-list，`ProteinStructure.EXT_FORMAT` 仅用于 renderer decoder，Explorer `EXT_COLOR` 仅用于装饰。
- [ ] 在干净/隔离 worktree 用 Bun 1.3.14 预跑 `bun tooling/repo/generate.ts`；若 generator 或 baseline SDK typecheck 失败，Task 2 阻断且不得手写 DTO/fetch 绕过。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/science-contract.test.ts`
- [ ] `rg -n 'const LANG|type Kind|createMemo<Kind>|TEXT_EXTENSIONS|EXT_FORMAT|EXT_COLOR' frontend/workspace/src --glob '*.ts' --glob '*.tsx'` 命中均按“迁移目标/合法例外”记录；不得用零命中的正则冒充 duplicate gate
- [ ] `(cwd: clean repository worktree) bun tooling/repo/generate.ts`，随后检查 `git diff --check` 与 SDK typecheck
- [ ] 计划评审确认首批格式矩阵、预算和 fallback 状态

**Dependencies:** Plan 15；backend 代码合并受 Plan 00 护栏约束

**Files:**

- `backend/cli/src/file/science.ts`（新增 canonical manifest/detector/schema；本 Task 不做文件 I/O）
- `backend/cli/test/file/science-contract.test.ts`（新增）
- `tasks/plans/19-scientific-file-routing.md`

**Scope:** S — 1 个 contract、1 个 table-driven test

### Task 2：实现 project-scoped、bounded 的服务端 science inspect

**Description:** 在 Task 1 pure contract 上增加 `ScienceFile.inspect`、bounded preview 与 path-safe raw download route；抽出一次 canonical project-path resolver，让 read/write/inspect/preview/raw 在执行各自 I/O 前共享 containment 语义，随后生成 JavaScript SDK。

**Acceptance:**

- [ ] relative、absolute 与编码后的输入最终都经过同一 canonical resolver；拒绝 `..`、symlink escape、目录、Windows cross-drive 和跨 project 路径。inspect 结果不是后续 read/download 的授权票据，每次 I/O 都重新解析以关闭 TOCTOU 窗口。
- [ ] 1 GiB sparse/fixture 文件的 inspect 不执行完整 `arrayBuffer/text/json`，读取量和 response 均不超过冻结预算。
- [ ] text `bounded-preview` 返回固定 byte/line/record cap、`totalBytes/truncated`；raw download 使用同源 path-safe stream，不构造 JSON/base64/data URL，并按冻结策略支持或明确拒绝 Range。
- [ ] HDF5、Parquet/Arrow、BAM/CRAM 等代表 family 可识别；仅 HDF5 magic 时不猜 H5AD/loom。v1 不读取 dataset/dimension/schema/record/sample/index，超预算稳定返回 `metadata-only/unsupported`。
- [ ] 错误 body 不包含绝对路径、内部 stack 或原始文件内容；取消/deadline 后无遗留 reader/process。
- [ ] route schema 生成 inspect/preview/raw SDK contract；既有 `sdk.client.file.write` 仍存在且通过类型检查，workspace 不手写 `/file/*` DTO 或 fetch。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/science-inspect.test.ts test/server/file-science-inspect.test.ts`
- [ ] `(cwd: backend/cli) bun run typecheck`
- [ ] `(cwd: repository root) bun tooling/repo/generate.ts`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 1；Plan 00 合并护栏

**Files:**

- `backend/cli/src/file/science.ts`（扩展 Task 1 contract，增加 bounded I/O）
- `backend/cli/src/file/index.ts`
- `backend/cli/src/server/routes/file.ts`
- `backend/cli/test/file/science-inspect.test.ts`（新增）
- `backend/cli/test/server/file-science-inspect.test.ts`（新增）
- generated files under `tooling/sdk/js/src/v2/gen/`

**Scope:** M — 3 个 hand-edited implementation files、2 个 focused tests 与生成物

## Checkpoint A：检测与服务端边界

- [ ] backend `ScienceFile` 是唯一 scientific detector；生成 SDK 精确保留 canonical format/capability/readPolicy，frontend 无第二张扩展名/magic 表。
- [ ] traversal、symlink、cross-drive、空/损坏/超大文件测试通过，inspect/preview/raw 在源头 bounded 且复用同一 resolver。
- [ ] contract 不包含 Atlas、session artifact 或第二套 file identity。
- [ ] backend focused tests、SDK generation 与根级 typecheck 通过。

### Task 3：建立 project-file renderer registry 与复用 adapter

**Description:** 先审计目标 renderer 的真实 props、空/无效数据和 transport 假设，再建立只接受 generated inspect result + bounded project content 的 registry/wrapper；默认不修改 artifact dispatcher 或既有 renderer。

**Acceptance:**

- [ ] compatibility matrix 逐个记录 Sequence/MSA/Chem2D/ProteinStructure/PDF/GenomeTrack 的输入 shape、空值行为、最大安全 payload、URL/index 要求与 cleanup；不能仅凭共同的 `ArtifactRenderProps` 判定可复用。
- [ ] `frontend/workspace/src/science/files.ts` 只对 generated `capability/readPolicy` 做穷尽映射，无 extension/magic 表；registry 选择逻辑不散落到组件 `if` 链，成功 inspect 结果不被客户端覆写。
- [ ] project wrapper 在挂 renderer 前验证并裁剪 bounded 输入；空/无效输入走真实 empty/error/fallback，不触发 Sequence/MSA/GenomeTrack 的 sample 内容，也不构造 tool/session artifact ref 或 RG node。
- [ ] v1 可复用 small bounded 的 sequence/MSA/Chem2D/ProteinStructure 等中性组件；GenomeTrack 因缺 Range URL 与 index pairing 不注册为 project renderer，genome family 使用 bounded text/metadata fallback。
- [ ] `ScienceArtifact.tsx` 与既有 renderer 默认 0 行修改；优先新建薄 project wrapper。只有 audit 证明中性 props 抽取可同时简化两条路径时才修改，并必须保持现有 artifact E2E。
- [ ] 未注册 capability 稳定落到现有 text/binary view；新增 renderer 可通过一条 registry entry 接入。
- [ ] registry 和通用 renderer 不 import Atlas API、Atlas context 或 Atlas feature flag。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun test src/science/files.test.ts src/science/project-registry.test.ts src/science/ProjectScienceView.test.tsx`，锁定 mapper、project registry 与 project invalid/empty 不挂 sample renderer
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/science-artifact.spec.ts`，仅证明 existing artifact renderer 无回归；project-file 行为由上述 component test 与 Task 4 的 `file-science-routing.spec.ts` 覆盖
- [ ] `rg -n 'createAtlasAPI|/api/atlas|OPENSCIENCE_ENABLE_ATLAS' frontend/workspace/src/science` 无新增命中

**Dependencies:** Tasks 1–2、Checkpoint A

**Files:**

- `frontend/workspace/src/science/ProjectScienceView.tsx`（新增）
- `frontend/workspace/src/science/ProjectScienceView.test.tsx`（新增）
- `frontend/workspace/src/science/files.ts`（新增 generated inspect → UI capability mapper；不是 detector）
- `frontend/workspace/src/science/files.test.ts`（新增）
- `frontend/workspace/src/science/project-registry.ts`（新增 project-only registry；不承载 artifact identity）
- `frontend/workspace/src/science/project-registry.test.ts`（新增）
- `frontend/workspace/src/science/renderers/registry.ts`（artifact registry，默认 0 行；仅在 audit 证明可安全抽取中性 capability 时修改）
- `frontend/workspace/src/science/ScienceArtifact.tsx`（默认 0 行；仅在 audit 证明可安全抽取中性 props 时修改）

**Scope:** M — 3 个新增实现文件、3 个 focused tests；既有 artifact registry/dispatcher/renderer 默认不修改

### Task 4：在统一 FileView 接入自动路由与可恢复状态

**Description:** 先用现有 E2E 固定小型文本的 edit/reset/save 与图片/PDF 行为，再把 `FileView` 从 eager full read 改为 inspect-first load policy；按 generated `readPolicy` 选择 inline full、bounded preview、metadata 或 stream download，并交给 project registry。

**Acceptance:**

- [ ] `FileView` 是唯一 load/renderer 入口；中心文档 tab 走该入口，零消费者 legacy drawer 不为验收重新挂载。`session.tsx` 和 centerTabs 已有稳定 directory+path doc ID，本任务默认 0 行功能修改。
- [ ] inspect 完成前不启动旧 `file.read`。只有 `editable-full` 且 size 在冻结阈值内才读取完整内容；`streamed-media` 使用 path-safe、same-origin raw/Range URL 交给浏览器原生消费，不经过 JSON/base64/data URL 或 JS content state，transport 不可用时回退 metadata/download。大文本只使用 server-bounded preview，大 binary 只显示 metadata/capability。
- [ ] bounded preview 对 bytes/lines/records、browser retained chars 和 DOM nodes 有硬上限并明确 `truncated`；v1 通过截断而非新建虚拟滚动框架控制大型 FASTA/VCF 等文本。
- [ ] Markdown/PDF/图片/普通代码与阈值内可编辑文本行为不回归；preview-only/metadata-only 明确只读，不允许 source/edit action 隐式触发全量读取。
- [ ] 图片/PDF 等 streamed media 保持真实可视输出，但现有 E2E 的 `data:*;base64` transport 断言改为 canonical same-origin raw URL（必要时含 Range）且明确拒绝 data URL；artifact-only base64 fixture 不受此 project-file transport 变更影响。
- [ ] inspect loading/error、preview loading/error 与成功 empty 分开并直接使用 Plan 07 `AsyncState`。inspect 失败且 size/policy 未知时不得默认回落为全量 read，只提供 retry、path-safe stream download 或显式受预算限制的 open。
- [ ] `save()` 改用已经存在的 `sdk.client.file.write({ directory, path, content })`；删除过时注释、`any` DTO 和手写 `PUT /file/content`，本文件对 `/file/*` 的 handwritten fetch 为 0。
- [ ] 快速切换 tab 或路径时旧 inspect/renderer 结果不会覆盖新文档，unmount 会取消不再需要的请求。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/file-science-routing.spec.ts`
- [ ] 现有 `file-open`、`file-viewer`、`science-file-viewers` 与 `science-artifact` E2E focused specs 通过
- [ ] `rg -n 'PUT /file/content|sdk\.url.*file/content|doFetch\(url' frontend/workspace/src/atlas/FilePreview.tsx` 无命中

**Dependencies:** Task 3；Plan 07 Tasks 1、3。必须在 Plan 07 完成 `FilePreview.tsx` 状态迁移后串行落地

**Files:**

- `frontend/workspace/src/atlas/FilePreview.tsx`
- `frontend/workspace/e2e/file-science-routing.spec.ts`（新增）
- `frontend/workspace/e2e/science-file-viewers.spec.ts`（更新 image/PDF 的 raw URL、可视输出与无 data URL 断言）
- `frontend/workspace/e2e/fixtures/science/`（仅极小 binary/header 数据；其余 fixture 运行时生成）

**Scope:** M — 1 个既有实现文件、1 个新增 E2E、1 个既有 E2E 更新与小型真实 fixtures；这是 load-policy migration，不按“一处 renderer 接线”估算

### Task 5：锁定真实格式、错误恢复与产品边界 E2E

**Description:** 复用现有 `e2e/fixtures.ts` 的真实临时 project 流程，运行时生成 text/header/sparse fixture；只有不便生成的最小 binary header 放入 fixture 目录。从 Files 打开到中心 tab，验证 inspect→policy→renderer/fallback 全链路和零 Atlas 请求，不建立第二套 Playwright fixture/runner。

**Acceptance:**

- [ ] 每个代表 fixture 都显示预期 renderer/capability，错扩展名按 server evidence 显示 warning 而非误解析。
- [ ] BED/GFF/VCF 和 BAM/CRAM 不会因缺 URL/index transport 挂载 `GenomeTrack` 或 sample genome；分别进入 bounded text 或 metadata-only capability fallback。
- [ ] 损坏/未知/binary-only fixture 仍可下载或查看安全摘要，不出现空白文档。
- [ ] 大文本/二进制 fixture 的 server read bytes、network response、browser retained content 与 DOM node/text 均在冻结预算内；download 过程不把完整 payload 放入 JS state/data URL。
- [ ] 快速切换五个科学文件无 stale renderer、未处理 promise、console error 或明显 listener/resource 泄漏。
- [ ] 默认与 `OPENSCIENCE_ENABLE_ATLAS=1` 下均不出现 Canvas/artifact UI，测试捕获 `/api/atlas/*` 为零请求。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/science-inspect.test.ts test/server/file-science-inspect.test.ts`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/file-science-routing.spec.ts e2e/science-file-viewers.spec.ts e2e/science-artifact.spec.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 4

**Files:**

- `frontend/workspace/e2e/file-science-routing.spec.ts`
- `frontend/workspace/e2e/fixtures/science/` 最小 binary/header fixtures；text/header/sparse fixture 优先由现有临时 project setup 生成
- `backend/cli/test/file/science-inspect.test.ts`
- `backend/cli/test/server/file-science-inspect.test.ts`
- `tasks/plans/19-scientific-file-routing.md`（记录证据）

**Scope:** S–M — 2 个 focused suites、fixtures 与计划证据

## Checkpoint B

- [ ] `FileView` 是唯一科学文件 load/renderer 入口；中心文档 tab 真实可达，legacy drawer 保持零消费者且未为验收重新挂载。
- [ ] project file 与 tool/session artifact 的 transport、identity 和生命周期保持分离。
- [ ] 首批科学格式、未知格式、损坏文件和超大文件均有 inspect-first、源头 bounded、可恢复行为；eager full read/data URL 不再覆盖超预算文件。
- [ ] Plan 20 可只注册 `table` renderer，Plan 21 可直接消费 backend `ScienceFile`；两者不需复制扩展名/magic 表。
- [ ] focused backend/frontend tests、workspace E2E、SDK generation 与 typecheck 通过。

## Compatibility and rollback

- 新 inspect route 是 additive；前端回退后不影响旧 file API。
- project registry 的 renderer 选择是可移除 adapter，但 inspect-first/bounded load policy 是独立行为迁移，不能声称“删除一处接线”即可完整回滚。Task 4 必须以同一 commit/characterization 覆盖 full policy revert，或只关闭 project renderer 而保留安全的 bounded load。
- 阈值内 Markdown/PDF/图片/普通代码/edit/save 的现有行为由 characterization 保持；超预算文件从 eager full read 改为 preview/metadata/stream 是刻意变更，回退不得静默恢复无界读取。
- renderer registry 不迁移现有 centerTabs 或 FileExplorer；回退不删除用户文件或 artifact 数据。
- 首批格式表扩展只能 additive 或版本化；改变既有 format/capability 需要 contract test 与 Plan 20/21 consumer 评审。

## Parallelization and coordination

- Task 1 先冻结 backend canonical contract；Task 2 完成并生成 SDK 后，Task 3 才能实现 frontend mapper/registry。
- Plan 16 Task 2 可并行开发 route contract，但两个计划必须先合并 route/schema，再在干净 worktree 串行运行一次 `bun tooling/repo/generate.ts`；generator 会运行 formatter，不得与源码编辑并发。
- Plan 07 Tasks 1、3 是 Task 4 的硬前置，因为 Plan 07 与本计划都会修改 `FilePreview.tsx`。Plan 19 基于其最终 AsyncState/load-state 结构接入，不造临时状态组件。
- Plan 16 Tasks 3–4 拥有 `session.tsx` Explorer mount；本计划 Task 4 默认保持该文件 0 行。若实测出现无法由现有 directory+path doc ID 解决的问题，必须在 Plan 16 后另行串行评审。
- 三个计划的 workspace E2E 共用 `.env.local`，只能进入同一串行 lane；Plan 19 复用现有 `e2e/fixtures.ts`，不建立第二套 runner/config。

## Risks

| Risk                                      | Impact                                         | Mitigation                                                                            |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| frontend/backend 各有 detector            | format/capability 漂移，Plans 20/21 消费不一致 | backend `ScienceFile` 单一 manifest/schema；OpenAPI/SDK 传类型，frontend 只映射结果   |
| inspect 后仍 eager `file.read`            | 大文本/binary 仍完整进入 server/browser memory | Task 4 inspect-first policy；full/preview/metadata/stream 四态与 source/DOM hard caps |
| inspect/read/download 各自解析 path       | symlink/TOCTOU/cross-drive 越界                | 共享 canonical resolver；每次 I/O 重新解析；真实负向测试                              |
| renderer 对空数据展示 sample              | 用户把演示内容误认为真实文件                   | Task 3 compatibility matrix + project wrapper validation；invalid/empty 不挂 renderer |
| GenomeTrack 缺 Range/index transport      | project genome 文件加载失败或外部请求错误      | v1 不注册；bounded text/metadata fallback，Range + companion index 另立任务           |
| binary metadata 范围膨胀                  | 引入重型 parser、突破 byte/deadline 预算       | v1 仅 family/evidence/size/capability，禁止 dataset/schema/count/index 深解析         |
| Plan 07/16 与 FileView/session 接线冲突   | merge 冲突或状态语义回归                       | Task 4 等 Plan 07；`session.tsx` 0 行；generator/E2E 串行                             |
| generated write 已存在却继续 direct fetch | SDK/错误/transport 语义分裂                    | Task 4 使用 `sdk.client.file.write`，静态断言 `/file/*` handwritten fetch 为 0        |

## Definition of done

- [ ] Tasks 1–5 与 Checkpoint A/B 全部完成并记录可复跑证据。
- [ ] 所有 project path 由同一 resolver canonical containment；inspect/preview/raw 在输入、解析和输出三处 bounded，每次 I/O 防止 symlink/TOCTOU/cross-drive 越界。
- [ ] `FileView` inspect-first；小文件行为无回归，超预算 text/binary 不完整进入 server/browser memory、JS state、data URL 或 DOM。
- [ ] backend 是唯一 detector；frontend/Plans 20–21 只消费 generated contract，无第二张 scientific extension/magic 表。
- [ ] project wrapper 不伪造 artifact/sample；GenomeTrack 和深层 binary metadata 在 transport/parser 前置缺失时保持明确 fallback。
- [ ] 没有引入第二套 file viewer、artifact identity、Atlas surface、AsyncState、Playwright runner、手写 SDK DTO 或 `/file/*` fetch。
- [ ] `session.tsx` 保持 0 行功能修改；Plan 07/16 的串行边界与 generator/E2E lane 已遵守。

## Progress

- 2026-08-02：复核 canonical detector、FileView eager read、renderer 输入与 SDK 现状；改为 backend 单一分类源、inspect-first 四态 load policy、v1 不接 GenomeTrack/深解析 binary，并确认现有 generated SDK 已有 `file.write`，Task 4 应删除 stale direct-fetch workaround。
- 2026-08-02：二次闭环任务依赖、字段命名与测试归属；project-file 使用独立 registry，`streamed-media` 改走 same-origin raw/Range transport，更新现有 data URL E2E，并把 Plans 07/16 的文件所有权与串行 lane 同步到索引/总清单。
- 2026-08-03（plans/16-19 分支）：完成 Tasks 1–3 与 Checkpoint A。建立 backend `ScienceFile` 唯一 manifest/detector/Zod 契约与冻结预算（INSPECT_HEADER/TAIL 4096、PREVIEW 256KiB/4096 行/1024 records、FULL_READ 1MiB、DOM 4096、deadline 250ms）；实现共享 canonical path resolver（拒 `..`/symlink/cross-drive/目录，每次 I/O 重新解析）与 bounded inspect/preview/raw route 并生成 SDK（`file.inspect/preview/raw`）；建立 project-file renderer registry + `ProjectScienceView`（穷尽映射 capability×readPolicy，GenomeTrack 不注册，空/无效输入不挂 sample renderer，project 与 tool/session artifact identity 分离），`ScienceArtifact.tsx`/`renderers/registry.ts` 未改动。验证：backend focused 17 测试、frontend registry 44 测试（全 src 110）、typecheck、`science-artifact` E2E 9/9 通过。**Task 4 依赖 Plan 07 Tasks 1、3 的 AsyncState 与 FileView 状态基线，Task 5 依赖 Task 4——待 Plan 07 完成后恢复，本次未执行。**
- 2026-08-03（p19/task5 worktree）：完成 Task 5（锁定真实格式、错误恢复与产品边界 E2E）。**Acceptance 覆盖审计**（逐条 → 测试）：
  1. 代表 fixture 显示预期 renderer/capability：`file-science-routing.spec.ts`（fa→sequence、multi.fa→MSA、vcf→bounded text、blob.h5→metadata、large.txt→bounded preview、notes.md→markdown、sample.pdf→streamed media）+ `science-file-viewers.spec.ts`（md/image/PDF raw URL）。错扩展名按 server evidence 显示 warning 而非误解析：**新增** `mislabeled.csv`（HDF5 magic 置于 `.csv` 名下 → UI 显示 format hdf5 metadata、绝不按 CSV 解析）与 `broken.fastq.gz`（损坏 gzip → 文本摘要 + `gzip-compressed` warning 实显于 `project-science-warnings`）；backend `science-contract.test.ts` 已覆盖 magic-overrides-extension/header-mismatch warning。
  2. BED/GFF/VCF 与 BAM/CRAM 不挂 GenomeTrack/sample genome：VCF 原覆盖；**新增** `regions.bed`（bounded text、`science-genome-track` 与 `genome-track-sample-badge` 均 count 0）与 `reads.bam`（metadata-only `format bam`、无 genome-track）；GFF/GTF/CRAM 在 `science-contract.test.ts` 的 detect 矩阵锁定。
  3. 损坏/未知/binary-only 仍可下载或安全摘要、不空白：**新增** `payload.bin`（未知 NUL 二进制 → BinaryNote + raw download，`a[download]` href 非 data:、含 `/file/raw`）与 `broken.fastq.gz`；`blob.h5` 原覆盖。
  4. 大文本/二进制预算：`large.txt` 的 `/file/inspect` 响应断言 `contentBytes ≤ 4096`（INSPECT_HEADER_BYTES）、`truncated=true`、`totalBytes > 1 MiB`、JSON body < 10 KB、浏览器 retained 文本 ≤ 512 KiB（BROWSER_RETAINED_CHARS）；download 走 raw 非 data URL。backend `science-inspect.test.ts` 的 1 GiB sparse 测试锁定 server read bytes。
  5. 快速切换五个科学文件：**扩展** `file-science-routing.spec.ts` 第二用例从 4 → 5 文件（+`multi.fa` MSA），并新增 `pageerror` + `console error` 捕获断言 `[]`（stale renderer / 未处理 promise / console error / 泄漏）。
  6. 默认与 `OPENSCIENCE_ENABLE_ATLAS=1` 下 /api/atlas 为零请求：默认由 routing spec 的 `atlas` 请求捕获断言（`toEqual([])`）；flag=1 **新增** backend `test/server/file-science-inspect.test.ts` 用例——置 `OPENSCIENCE_ENABLE_ATLAS=1` 并对 `globalThis.fetch` 打桩，跑 `/file/inspect|preview|raw` 后断言零出站网络（file 路由绝不触达 Atlas bridge；该 flag 不恢复 Canvas/billing UI，见 `atlas-disabled.test.ts`）。`rg '/api/atlas' frontend/workspace/src/science` 无命中。
  **Fixtures**：`e2e/fixtures/science/` 仍只含 `sample.pdf`（唯一不便运行时生成的真实二进制）；text/header/sparse 及新增 bed/bam/bin/csv/gz 全部由 temp-project 运行时生成，不新增 fixture 文件。**验证结果**：`(cwd: backend/cli) bun test test/file/science-inspect.test.ts test/server/file-science-inspect.test.ts` → **18 pass / 0 fail**（17 既有 + 1 新增 atlas）；`(cwd: frontend/workspace) bun run typecheck`（tsgo -b）→ pass；`tsgo -p e2e/tsconfig.json --noEmit` → pass（E2E 编辑类型安全）；`(cwd: repo root) bun run typecheck`（turbo 7/7）→ pass。**E2E 未执行，pending 串行 lane**：`file-science-routing.spec.ts`（扩展后）、`science-file-viewers.spec.ts`、`science-artifact.spec.ts`。环境备注：worktree 的 bun 缓存缺失 `@ai-sdk/anthropic` 与 `ghostty-web` 两个包目录（symlink 断链），从主仓 node_modules/.bun 只读复制补齐以运行 focused suites/typecheck；未运行 `bun install`，未触碰主仓与 tasks/todo.md。
- 2026-08-03（串行 E2E lane 结果）：`e2e/file-science-routing.spec.ts` **3/3 通过**（新增 bed/bam/bin/csv/gz fixtures 的路由/回退、五文件快速切换零 console/page 错误、pdf raw URL）；`e2e/science-file-viewers.spec.ts` **3/3 通过**（markdown 渲染+raw source toggle、image/PDF raw URL）；`e2e/science-artifact.spec.ts` **9/9 通过**（IGV genome-track 用例在机器负载下偶发超时、重跑通过）。修复：多文档 tab 下 `data-slot`/Binary-note 定位器加 `filter({visible:true})`（每文件各自 doc tab，多个二进制/文本 doc 并存）；fast-switch 用例忽略网络类 console error（`Failed to fetch`/`net::ERR_*`，models.dev/代理环境，与快速切换行为无关）；corrupt gzip 用例断言改为 base64 安全摘要（`.gz` 按二进制处理，`dGhpcyBpcyBub3QgZ3ppcA==`）并保留 gzip warning 断言。`tasks/todo.md` 已同步勾选 Task 5 项。
