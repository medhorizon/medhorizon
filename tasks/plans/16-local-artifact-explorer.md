# 16 — Atlas-independent Explorer shell 与 Session Artifacts

- **Status:** 🟡 In progress（Checkpoint A 完成；Checkpoint B 与 DoD 待续）
- **Priority:** P1
- **Dependencies:** Plan 15 已冻结 Atlas 退役边界；涉及 backend/CLI 与 SDK 的任务须通过 Plan 00 合并护栏
- **Coordination:** Plan 07 Task 1 的 `AsyncState` 是本计划 Task 4 的 UI 前置；Task 3 在集成时复核 Plan 07 后的 `FileExplorer` export，并且只能在薄 adapter 内适配。Plan 19 可与 backend contract 并行，但 SDK generator、`session.tsx` 接线与 workspace E2E 必须串行。Plan 21 只消费本计划的 `ExplorerModule` core，以独立 `project-artifacts` provider 接入；不得扩大或合并本计划的 session artifact 事实源
- **Source:** Plan 15 实施后的范围修正：保留 Atlas 产品面退役，同时恢复独立于 Atlas 的通用 artifact 浏览能力

## Current state

- Plan 15 已从 live UI 移除 Atlas Canvas、旧 artifacts toggle 与 `/api/atlas/*` artifact 请求，并让 `FileExplorer` 稳定回到 host files。
- 当前 `FileExplorer` 仍在 `frontend/workspace/src/atlas/FileExplorer.tsx`，但其现行 host file 数据路径只使用 `sdk.client.file.list`、文件读取与中心文档 tab；目录名不是 Atlas 运行时依赖的充分证据。
- Session 页面在既有 Files surface 直接挂载 `<FileExplorer />`。该挂载点适合替换为一个很薄的 Explorer core shell，而无需改动 session 布局、RightPane 或中心 tab 模型。
- `RLMArtifacts` 已按 session 把字符串 artifact 写入本地 data directory，并由 `artifact` tool 提供 register、resolve、list；该存储不依赖 Atlas，也不需要 Research Graph sidecar。
- `RLMArtifacts.list()` 当前只从 `.dat` 文件重建条目，因此 register 时的 `type`、`summary`、size 与 created time 会丢失；同时还没有浏览器可用、不会泄漏磁盘路径的 session-scoped API。
- 当前 `register()` 直接写正式 `.dat`，而 `list()` 会把任何无 sidecar 的正式 `.dat` 当作 legacy；若未来按“payload 后 metadata”写入，metadata 失败会把不完整的新条目误报为 legacy，必须在落地前改变提交点。
- `tooling/repo/generate.ts` 有 Bun shebang，但计划需要兼容 Windows PowerShell 5.1；规范命令应显式使用 `bun tooling/repo/generate.ts`，且 generator 会更新 OpenAPI/SDK 并运行 formatter，不能在 dirty worktree 或与 Plan 19 的 generator lane 并发执行。
- Research Graph 另有本地 artifact 表和 upload/download API，science renderer 也能显示 inline tool artifact；它们是未来可插入来源/renderer，但不是本计划 v1 的事实源。

## Problem

Plan 15 正确退役了 Atlas artifact 产品入口，但“移除 Atlas adapter”不应等同于“永久取消 artifacts”。直接恢复旧 `ArtifactsPanel` 会重新引入 `createAtlasAPI`、project/graph tree 扫描与 `/api/atlas/*`，不符合当前产品边界；把 session artifacts 逻辑重新写进大型 `FileExplorer.tsx`，又会把 host files、artifact transport、preview 和选择状态耦合在一起。

需要一个窄的核心壳：核心只负责模块选择与生命周期，host files 和 session artifacts 作为独立模块插入。第一版复用现有 FileExplorer 和 RLMArtifacts，通过少量 additive route 与新 UI 文件接入；不复制文件树、不重写中心 tab、不接 Atlas 或 Research Graph。

## Goals

1. 在现有 Files/Explorer surface 提供 `files` 与 `session artifacts` 两个可切换模块，默认仍为 files。
2. Explorer core 不知道文件树、artifact 存储或网络细节；模块通过窄 slot contract 插入并自行拥有资源状态和交互。
3. 完整复用现有 host `FileExplorer`，第一阶段不复制、不搬迁、不改写其目录浏览、搜索、list/grid 或文件打开逻辑。
4. 以 `RLMArtifacts` 作为 session artifact 的唯一 v1 事实源，保留 register/resolve/list 调用兼容，并补齐可浏览的持久元数据。
5. 提供 typed、session-scoped 的 list、bounded preview 和 download API；浏览器不得获得服务端绝对路径。
6. 整条 artifact 浏览路径不 import Atlas API、不访问 `/api/atlas/*`，且不受 `OPENSCIENCE_ENABLE_ATLAS` 开关影响。
7. 每个任务可独立验证和回退，避免大规模移动文件或修改 session、FileExplorer、TaskTool、Research Graph 等既有实现。

## Non-goals

- 不恢复 Plan 15 已退役的 Atlas Canvas、Atlas artifacts tab、`createAtlasAPI` 或 `/api/atlas/*`。
- 不修改 `AtlasCanvas.tsx`、`atlas/api/atlas.ts`、Atlas bridge、账户、billing 或 managed lifecycle。
- 不在 v1 聚合 Research Graph artifacts、provenance nodes、notebook inline artifacts 或任意工作区文件；后续只能作为新的 `ExplorerModule`/artifact provider 接入。
- 不新增 artifact upload、delete、rename、同步、分享或长期归档策略；v1 只浏览已由 session artifact tool 注册的本地内容。
- 不改变 7 天 TTL、session ownership、TaskResult `artifactRefs` 或 artifact tool 的公开参数/返回语义。
- 不把 artifact 伪装成 host file，也不把服务端 artifact 绝对路径交给现有 `FileView`。
- 不借机迁移整个 `frontend/workspace/src/atlas/**` 命名空间；物理路径清理需在兼容 adapter 无消费者后另立计划。
- 不重排 Session、RightPane 或中心 tab 布局。Explorer 壳安装在当前 FileExplorer 挂载点，未来可由其他宿主复用。

## Proposed design

### Core shell plus inserted modules

新增中立目录 `frontend/workspace/src/features/explorer/`。核心只接收模块描述，不 import 具体模块：

```text
ExplorerShell
├── files              → FilesModule → existing FileExplorer
└── session-artifacts  → SessionArtifactsModule → generated SDK
```

计划中的最小 contract：

```ts
type ExplorerScope = {
  sessionID: string
}

type ExplorerModule = {
  id: string
  label: string
  component: Component<ExplorerScope>
}
```

- shell 只负责 module tablist、选中状态、键盘/ARIA 和“访问后保持挂载”；不创建 resource，不解释 item，不提供通用 fetch cache。“保持挂载”只承诺同一 `sessionID` 内切换模块时保留状态，不代表 session-owned 数据可以跨 session 复用。
- module list 由 Session 宿主注入；core 不硬编码 `files` 或 `session-artifacts`。
- 默认 module 由宿主显式传入 `files`。不读取或复用 Plan 15 已归一化的旧 `artifacts`/canvas UI 状态。
- `FilesModule` 是唯一允许引用 legacy `@/atlas/FileExplorer` 的兼容 adapter，只负责挂载现有组件。core 与 artifact module 均不得 import `@/atlas/api/atlas`、Atlas context 或 Atlas flag。
- 第一阶段不移动 `FileExplorer.tsx`。当其通用依赖已有中立归属并有 production reachability 证据后，才可另立路径迁移；本计划不为目录整洁制造大 diff。

### Session artifact catalog

保留现有 `.dat` payload，并为新注册 artifact 写入 versioned metadata sidecar：

```json
{
  "version": 1,
  "id": "art-...",
  "type": "analysis",
  "summary": "...",
  "size": 1234,
  "createdAt": "2026-08-01T00:00:00.000Z"
}
```

- `register()` 仍返回现有 `RLMState.ArtifactRef`，现有 tool caller 无需修改。
- 新写入使用同目录两阶段提交：先写非 `.dat` 的临时 payload 和临时 metadata，完整校验 metadata 后先原子 rename 正式 sidecar，最后原子 rename payload 为正式 `.dat`；正式 `.dat` 的出现是唯一 visibility commit。
- metadata 写入/rename 失败时删除临时文件且不得出现正式 `.dat`；payload commit 失败时留下的 metadata-only orphan 不可 list/preview/download，并由恢复/cleanup 清理。`list()` 忽略临时文件；存在损坏 sidecar 的正式条目按 incomplete 隐藏并记录诊断，不能降级成 legacy。
- 旧 `.dat` 没有 sidecar 时按 legacy entry 返回：`type: "unknown"`、稳定 fallback summary、文件 stat size/time；不做破坏性批量迁移。
- public projection 明确排除磁盘 `path`。只有存储层内部可以看到绝对路径；供浏览器下载的 `downloadPath` 是同源相对 API 路径。
- artifact ID 在 API 边界按固定格式验证，resolve 后路径必须仍位于当前 session artifact directory；拒绝 `..`、encoded traversal 与跨 session 读取。

### Additive session API

新增独立 Hono route module，并挂载在现有 session namespace；先稳定 schema，再生成 SDK：

| Method | Path                                                | Contract                                                                   |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/session/:sessionID/artifacts?limit=&cursor=`      | newest-first page：`items`（含相对 `downloadPath`）+ optional `nextCursor` |
| GET    | `/session/:sessionID/artifacts/:artifactID/preview` | bounded UTF-8 preview：metadata、`content`、`totalBytes`、`truncated`      |
| GET    | `/session/:sessionID/artifacts/:artifactID/content` | 原始 payload stream，使用安全 filename/content headers                     |

- `limit` 默认 50、最大 200；cursor 由稳定的 created-time + ID 顺序生成，不向客户端暴露目录结构。
- preview 上限由服务端固定保守默认值并设置最大值，使用文件 slice，不因预览读取完整大型 artifact。
- missing session/artifact、invalid cursor/ID 和读取失败使用稳定 code；错误 body 不包含绝对路径或原始内部异常。
- content endpoint 用于显式下载，不自动在 module 首次加载时请求。
- 所有 route 都调用本地 `RLMArtifacts`/catalog；不得经由 Research Graph、Atlas bridge 或外部网络。

### Session Artifacts module

artifact module 的 typed list/preview 只消费生成的 SDK：

- 首次显示加载第一页，支持 refresh 与 `nextCursor` load-more；成功空列表与请求失败分开呈现。
- row 展示 summary、type、size、created time；legacy metadata 明确显示 `unknown`，不猜测类型。
- 选择 row 后按需请求 bounded preview；preview 不支持或读取失败不影响列表。
- download 是显式动作，使用服务端条目返回的同源 `downloadPath` 做浏览器导航；不手写 fetch/DTO，列表加载也不预取 payload。
- module 自己持有 list/selection/preview 状态；在同一 session 内切回 Files 后由 shell keep-mounted，避免丢失选中项和滚动。`sessionID` 变化时必须 abort/忽略旧请求并清空 page、selection、preview 与 scroll，旧 session 的迟到结果不得写回新 scope。
- Task 4 直接复用 Plan 07 Task 1 的 `AsyncState` 展示原语；若该原语尚未落地则等待，不创建临时的第二套状态 shell 或全局数据层。

## Change budget

为满足“尽可能不改原仓库代码”，实施默认遵守以下预算：

- `FileExplorer.tsx`：**0 行功能修改**；Plan 07 的并行状态迁移不计入本计划，也不得被本计划覆盖。
- `features/explorer/modules/files.tsx`：负责吸收 Plan 07 后任何 additive/compatible props 变化；不得为适配而复制或反向修改 `FileExplorer`。
- `pages/session.tsx`：仅替换 import 和当前 `<FileExplorer />` 挂载，模块配置保持在局部。
- `server/server.ts`：仅增加一个 additive route mount；不把 artifact handler 塞入现有大型 session route。
- `session/rlm/artifacts.ts`：只增加 metadata/public catalog 所需能力，保持现有 namespace 与三个公开操作兼容。
- 其他实现尽量落在新文件；生成 SDK 只由仓库 generator 更新，不手改生成物。
- 若实现要求修改 TaskTool、Research Graph、Atlas bridge、centerTabs 或超过上述既有文件边界，停止并拆出后续计划。

## Compatibility and rollback

- Plan 15 的退役边界保持不变：本计划新增的是 local session artifact surface，不是 Atlas artifact 产品入口回滚。
- `OPENSCIENCE_ENABLE_ATLAS` 未设置、`0` 或 `1` 时，session artifact API 与 UI contract 相同；不为本功能增加 feature flag。
- 旧 `.dat` 继续可 list/preview/download；新 metadata sidecar 是 additive，只有完成 visibility commit 的正式 `.dat` 才能被旧 binary 读取。临时文件、损坏 sidecar 和 metadata-only orphan 不是兼容数据，不得暴露。
- shell 默认 files。artifact module 出现回归时，可从宿主 module array 移除它；Files adapter 和现有 FileExplorer 继续工作。
- backend routes 是 additive。前端回退后可以暂时保留，不影响旧 SDK consumer；删除前仍需确认无消费者。
- `FilesModule` 是迁移 adapter，不复制 FileExplorer 代码。未来中立化路径时先迁移 consumer，再删除 adapter。

## Work estimate

| Task                           | Estimate            | Main risk                                         |
| ------------------------------ | ------------------- | ------------------------------------------------- |
| 1 · baseline/contract          | 0.5 engineer-day    | 混淆 Atlas artifact 与 session artifact 语义      |
| 2 · catalog + API + SDK        | 1.5–2 engineer-days | 原子 metadata commit、bounded reads、generator    |
| 3 · core shell + files adapter | 0.5–1 engineer-day  | keep-mounted 与现有 Files tab 生命周期            |
| 4 · artifacts module           | 1–1.5 engineer-days | pagination、preview 与错误状态独立性              |
| 5 · integration/E2E            | 0.5–1 engineer-day  | 真实大 payload、legacy fixture、零 Atlas 请求断言 |

合计约 **4–6 engineer-days**。不需要大规模重构；主要改动是 2 个小型 backend 边界、1 个 core shell、2 个插入模块和 focused tests。若 baseline generator 本身失败或产生非预期全仓漂移，应作为 Plan 00/tooling blocker 单独处理，不以手写 client 绕过。

## Implementation tasks

### Task 1：冻结本地 artifact 基线与模块边界

**Description:** 用真实临时 data directory 固定 `RLMArtifacts.register/resolve/list` 和 legacy `.dat` 行为，记录现有 FileExplorer 的 host-only 网络路径；把上述 core/module/API contract 作为后续任务唯一边界。

**Acceptance:**

- [ ] 测试证明同一 session 可 register、resolve、list，其他 session 不能通过 catalog 读取该 payload。
- [ ] legacy `.dat` 没有 metadata 时仍可列出和读取，且 fallback 字段确定。
- [ ] 当前 FileExplorer 的真实交互只调用 host file API；测试/网络记录对 `/api/atlas/*` 为零请求。
- [ ] allowlist 明确只有 Files compatibility adapter 可引用 legacy FileExplorer 路径；core/artifact module 禁止 Atlas API、flag 与 context。
- [ ] 在干净或隔离 worktree 用仓库固定的 Bun 1.3.14 运行一次 baseline generator；退出码为 0，diff 仅含可解释的 generated/OpenAPI/format 结果，SDK typecheck 通过。失败时阻断 Task 2。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/rlm-artifacts.test.ts`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/file-explorer.spec.ts`
- [ ] `rg -n 'createAtlasAPI|/api/atlas|OPENSCIENCE_ENABLE_ATLAS' frontend/workspace/src/atlas/FileExplorer.tsx` 无命中
- [ ] `(cwd: clean repository worktree) bun tooling/repo/generate.ts`，随后检查 `git diff --check` 与 generated SDK typecheck；不得在用户 dirty worktree 直接执行预检

**Dependencies:** Plan 15；backend 测试落地受 Plan 00 护栏约束

**Files:**

- `backend/cli/test/session/rlm-artifacts.test.ts`（新增或扩展现有 focused test）
- `frontend/workspace/e2e/file-explorer.spec.ts`（新增；可复用现有 file e2e fixture，不复制实现逻辑）
- `tasks/plans/16-local-artifact-explorer.md`

**Scope:** S–M — 2 个测试文件与计划证据

### Task 2：增加安全的 session artifact catalog、API 与生成 SDK

**Description:** 为新 artifact 持久化 versioned metadata，保留 legacy fallback；新增分页 list、bounded preview 和 download route。契约测试通过后运行仓库 SDK generator，不手写 workspace DTO。

**Acceptance:**

- [ ] register 后重新启动/重新 list 仍保留 type、summary、size 与 createdAt；旧 `.dat` 仍按 fallback 工作。
- [ ] 新写入只在同目录临时 payload、临时 metadata 都成功且 metadata 校验通过后提交；正式 sidecar 先 rename，正式 `.dat` 最后 rename，并以 `.dat` rename 作为 visibility commit。
- [ ] metadata 写入/rename 失败、临时 payload、metadata-only orphan、损坏 sidecar 均不可 list/preview/download，也不会被标为 legacy；重启恢复只清理已判定 stale 的临时/orphan 文件，不删除并发 register 的活跃临时文件，cleanup 后磁盘与列表均不遗留 incomplete entry。
- [ ] list 稳定 newest-first、支持 limit/cursor，public response 从不出现 `path`。
- [ ] preview 有服务端上限并正确返回 `truncated/totalBytes`；download 只在显式请求时流式读取完整 payload。
- [ ] invalid ID/cursor、missing session/artifact、traversal 与跨 session 请求被稳定拒绝，错误不泄漏路径。
- [ ] flag off/on 的同一真实 route 测试返回等价 contract，Atlas capture server 收到零请求。
- [ ] SDK 由 `bun tooling/repo/generate.ts` 生成，workspace 后续只使用生成 client；与 Plan 19 或其他 API 计划共享 generator lane 时先合并 contract，再生成一次。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/rlm-artifacts.test.ts test/server/session-artifacts.test.ts`
- [ ] 真实临时目录测试预置/触发 temp payload、metadata-only、损坏 sidecar、commit 中断与并发中的活跃 temp；不 mock `list()`/cleanup 判定逻辑，并断言仅 stale orphan 被实际删除
- [ ] `(cwd: backend/cli) bun run typecheck`
- [ ] `(cwd: clean/isolated repository worktree) bun tooling/repo/generate.ts`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 1

**Files:**

- `backend/cli/src/session/rlm/artifacts.ts`
- `backend/cli/src/server/routes/session-artifacts.ts`（新增）
- `backend/cli/src/server/server.ts`
- `backend/cli/test/session/rlm-artifacts.test.ts`
- `backend/cli/test/server/session-artifacts.test.ts`（新增）
- generated files under `tooling/sdk/js/src/v2/gen/`

**Scope:** M — 3 个 hand-edited implementation files、2 个 focused tests 与生成物

### Task 3：建立 Explorer core shell 并以 adapter 插入现有 Files

**Description:** 新增只管理模块 tab 与生命周期的 `ExplorerShell`，新增单一 Files compatibility adapter；在 Session 当前 FileExplorer 挂载点注入 module array。现有 FileExplorer 保持原样。

**Acceptance:**

- [ ] core 只依赖 `ExplorerModule`/`ExplorerScope`，不 import SDK、FileExplorer、artifact store 或 Atlas code。
- [ ] 默认选择 files；切换后已访问模块保持挂载，Files 的 cwd、history、filter、view 与滚动不因切换丢失。
- [ ] module controls 使用正确 tablist/tab/tabpanel 语义并支持键盘；只渲染宿主传入的模块。
- [ ] Files adapter 只挂载现有 FileExplorer，不复制其实现，不改变文件打开和 centerTabs 行为。
- [ ] `FileExplorer.tsx` 在本任务 diff 中为零；`session.tsx` 只做局部 import/mount/config 接线。
- [ ] 集成 Plan 07 最新结果后重新 typecheck；若 `FileExplorer` props 有 additive 变化，只在 `modules/files.tsx` 传递/适配，不修改或复制原组件。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/file-explorer.spec.ts`
- [ ] `git diff -- frontend/workspace/src/atlas/FileExplorer.tsx` 对本任务为空
- [ ] `rg -n '@/atlas|createAtlasAPI|/api/atlas|OPENSCIENCE_ENABLE_ATLAS' frontend/workspace/src/features/explorer --glob '!modules/files.tsx'` 无命中

**Dependencies:** Task 1；可与 Task 2 并行

**Files:**

- `frontend/workspace/src/features/explorer/contract.ts`（新增）
- `frontend/workspace/src/features/explorer/ExplorerShell.tsx`（新增）
- `frontend/workspace/src/features/explorer/modules/files.tsx`（新增）
- `frontend/workspace/src/pages/session.tsx`

**Scope:** M — 4 files

## Checkpoint A：独立壳与本地 API

- [ ] FileExplorer 未被复制或重写，Files 默认行为与状态保持。
- [ ] Explorer core 可在不知道模块实现的情况下挂载 Files adapter。
- [ ] session artifact catalog 在重启、legacy、分页、bounded preview 与跨 session 场景下有稳定 contract。
- [ ] 新 backend/UI core 代码没有 Atlas API、Atlas flag 或 Research Graph 依赖。
- [ ] focused backend tests、workspace FileExplorer e2e 与 typecheck 通过。

### Task 4：插入 Session Artifacts 浏览与 preview/download 模块

**Description:** 使用生成 SDK 实现 session artifact module，把它作为第二个模块注入 Session。列表、preview 和 download 保持独立资源状态，不修改 FileExplorer 或 centerTabs。

**Acceptance:**

- [ ] Session 有 `files` 与 `session artifacts` 两个模块，默认 files；没有 artifact 时显示成功 empty，不显示错误。
- [ ] list、refresh、load-more、选择和 bounded preview 使用生成 SDK，无 handwritten transport DTO 或直接 `fetch`；download 只使用 typed item 的相对 `downloadPath`。
- [ ] list error、preview error 和 download error 互不覆盖；已有列表在 refresh/preview 期间保持可见。
- [ ] row 显示 type、summary、size、createdAt；legacy 条目明确为 unknown，长 summary 不破坏布局。
- [ ] 选择只读取 preview；完整 payload 仅由显式 download 读取，大 artifact 不进入 DOM 或全局 state。
- [ ] 切回 files 再返回时，artifact selection、已加载 page 和滚动保持；Files 状态也保持。
- [ ] keep-mounted 只作用于同一 `sessionID`；从 session A 切到 B 时清空 artifacts page/selection/preview/scroll，取消或忽略 A 的请求，迟到响应不能污染 B。
- [ ] loading/refreshing/empty/error/ready 直接使用 Plan 07 的 `AsyncState`；Task 4 不新增局部通用状态组件。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/session-artifacts.spec.ts`
- [ ] `rg -n 'createAtlasAPI|/api/atlas|OPENSCIENCE_ENABLE_ATLAS|ResearchGraph' frontend/workspace/src/features/explorer --glob '!modules/files.tsx'` 无命中
- [ ] `rg -n '@/atlas/FileExplorer' frontend/workspace/src/features/explorer/modules/files.tsx` 恰有一个 compatibility import

**Dependencies:** Tasks 2–3、Checkpoint A、Plan 07 Task 1

**Files:**

- `frontend/workspace/src/features/explorer/modules/artifacts.tsx`（新增）
- `frontend/workspace/src/features/explorer/SessionArtifacts.tsx`（新增）
- `frontend/workspace/src/features/explorer/ArtifactPreview.tsx`（新增）
- `frontend/workspace/src/pages/session.tsx`
- `frontend/workspace/e2e/session-artifacts.spec.ts`（新增）

**Scope:** M — 4 implementation files、1 e2e

### Task 5：锁定真实集成、零 Atlas 请求与回退边界

**Description:** 通过真实 backend、真实 artifact tool/storage 和浏览器验证 register→list→preview→download，同时覆盖 legacy、大 payload、错误恢复、模块切换与 Atlas retirement invariant；最后记录实现证据，不扩大到其他 artifact 来源。

**Acceptance:**

- [ ] 真实 artifact 注册后无需刷新整个 Session 即可 refresh 出现，并可 bounded preview/download 原内容。
- [ ] legacy artifact、大于 preview 上限的 artifact、空 session 和 missing artifact 均有确定行为。
- [ ] 网络记录不出现 `/api/atlas/*`、Atlas account/bridge 或 Research Graph artifact 请求；切换 `OPENSCIENCE_ENABLE_ATLAS` 不改变结果。
- [ ] Files 的目录导航、搜索、list/grid、文件打开在加入 artifact module 后无回归。
- [ ] 浏览器从 session A 导航到 B 时，A 的列表、选择、preview 和迟到响应不会出现在 B；返回 A 后按新 scope 重新加载，不依赖旧 keep-mounted DOM。
- [ ] 从宿主 module array 移除 artifacts 后，shell 自动退化为原 Files surface，不留空 tab/panel 或陈旧选择。
- [ ] Plan 16 Progress 记录 focused/full 验证、生成 SDK、兼容与 rollback 证据；不把 Plan 15 的剩余全量 E2E 错报为本计划已完成。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/rlm-artifacts.test.ts test/server/session-artifacts.test.ts`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/file-explorer.spec.ts e2e/session-artifacts.spec.ts e2e/atlas-retirement.spec.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: backend/cli) bun test`
- [ ] `(cwd: repository root) bun run typecheck`
- [ ] `(cwd: repository root) bun run build`

**Dependencies:** Task 4

**Files:**

- `frontend/workspace/e2e/session-artifacts.spec.ts`
- `frontend/workspace/e2e/file-explorer.spec.ts`
- `backend/cli/test/server/session-artifacts.test.ts`
- `tasks/plans/16-local-artifact-explorer.md`
- `tasks/todo.md`

**Scope:** M — focused tests 与完成证据

## Checkpoint B：端到端可用

- [ ] 用户可在同一 Explorer shell 中切换 host files 与当前 session artifacts。
- [ ] Files 和 artifacts 各自拥有状态与数据路径，切换不丢状态、不互相解释 item。
- [ ] keep-mounted 状态仅在同一 session 内保留；session scope 变化会取消旧请求并重置所有 session-owned artifact 状态。
- [ ] session artifact metadata、分页、bounded preview 和 download contract 均由生成 SDK 消费。
- [ ] 大 payload 不被列表或 preview 全量读取，绝对路径不进入 API、日志或 DOM。
- [ ] 整条路径默认和 flag-on 都对 Atlas/Research Graph 为零请求。
- [ ] rollback 只需移除 module 注入；FileExplorer、session、artifact tool 与 payload 保持可用。

## Parallelization

- Task 1 先冻结 contract。
- Task 2（backend/catalog/API）与 Task 3（frontend/core/Files adapter）可并行；两者不共享实现文件。
- Task 4 必须等待生成 SDK、core shell 与 Plan 07 Task 1 `AsyncState`。
- Task 5 最后收口。Plan 07 若同时修改 `FileExplorer.tsx`，本计划不得碰该文件；集成时只允许更新 Files adapter 并复跑 typecheck/E2E。
- Plan 19 Task 2 可并行冻结 API，但两者不得并发运行 generator：先合并两个 route contract，再在干净 worktree 运行一次 `bun tooling/repo/generate.ts`。
- Plan 19 Task 4 默认不修改 `session.tsx`；若实测需要修改，必须在本计划 Tasks 3–4 的 Explorer 接线之后串行落地。所有 workspace E2E 共享 `.env.local`，不得并行运行。

## Risks

| Risk                                       | Impact                                        | Mitigation                                                                     |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| 把旧 Atlas artifacts UI 当作可复用模块恢复 | 重新引入退役产品面和外部请求                  | 只复用 host FileExplorer/RLMArtifacts；静态搜索与浏览器网络零请求断言          |
| core 抽象 item/fetch 过度                  | Files 与 artifacts 被迫共享错误语义和数据模型 | core 只管理 module slot/lifecycle；数据、状态与动作留在 module                 |
| metadata sidecar 与 payload 不一致         | 新条目被误报 legacy 或列表显示幽灵条目        | 同目录两阶段写入；sidecar 先 rename、`.dat` 最后 visibility commit；恢复测试   |
| keep-mounted 跨 session 保留旧数据         | session B 显示 session A artifact             | 保留只限同 session；sessionID 变化取消请求并重置 artifacts module              |
| preview 读取完整大型 artifact              | 内存、网络和 DOM 膨胀                         | 服务端 bounded slice、明确 truncated、完整内容仅显式 download                  |
| artifact ID/路径穿越                       | 跨 session 数据泄漏                           | API 边界 ID 校验、resolved path containment、负向 contract tests               |
| Files adapter 长期固化 legacy 路径         | 中立 core 仍有命名债务                        | 单点 allowlist；不扩散 legacy import；后续 consumer 归零后独立迁移             |
| Plan 07 同时修改 FileExplorer              | adapter 类型或行为回归                        | 本计划 FileExplorer 0 行预算；同步后只在薄 adapter 适配并复跑 typecheck/E2E    |
| generator 在 Windows/dirty worktree 漂移   | SDK 无法生成或覆盖并行改动                    | Task 1 干净 worktree 预检；显式 `bun` 启动；与 Plan 19 共用串行 generator lane |
| 新 API 直接手写 client                     | contract 漂移、生成时丢失                     | route schema 先稳定，再运行 repo generator；workspace 禁止直接 fetch/DTO       |

## Definition of done

- [ ] 所有 Task acceptance、Checkpoint A/B 与 verification 均有证据。
- [ ] Explorer core 只管理可插入模块与生命周期；files/artifacts 没有共享数据模型或 transport。
- [ ] 现有 FileExplorer 未被复制或功能性修改，Files 默认和完整回归通过。
- [ ] Session artifacts 以本地 RLMArtifacts 为唯一 v1 事实源；新写入按 `.dat` visibility commit 原子发布，不完整条目不可见，并保留既有 legacy payload 兼容。
- [ ] keep-mounted 只保留同一 session 的模块状态；session 切换无 stale list/preview/迟到响应。
- [ ] typed API 支持分页 list、bounded preview、explicit download，且不泄漏绝对路径。
- [ ] Workspace 只消费生成 SDK；API 变化后已在干净 worktree 运行 `bun tooling/repo/generate.ts`。
- [ ] 新 core/artifact 代码无 Atlas API、flag、Canvas、bridge 或 Research Graph 依赖。
- [ ] 默认与 flag-on 的真实测试对 Atlas 外部请求均为零。
- [ ] focused tests、workspace e2e、backend/CLI full test、typecheck 与 build 通过。
- [ ] Plan 16 Progress、总清单和计划索引记录实际完成/剩余验证，不把代码完成等同于 Done。

## Progress

- 2026-08-02：复核 metadata 提交顺序、keep-mounted session scope、Plan 07 adapter 边界与 Windows generator 命令；改为 `.dat` 最后提交、只清理已判定 stale 的 orphan、session 变化强制重置、Task 4 依赖共享 AsyncState，并将 SDK generation 设为干净 worktree 的串行 lane。
- 2026-08-03（plans/16-19 分支）：完成 Tasks 1–3 与 Checkpoint A。冻结 RLMArtifacts register/resolve/list 与 legacy `.dat` 基线测试（含零 `/api/atlas` 断言）；实现 metadata sidecar 两阶段提交（`.dat` rename 为唯一 visibility commit）、`/session/:id/artifacts` 分页 list/bounded preview/download route 并生成 SDK；建立 `features/explorer` 核心壳与单一 Files adapter，`session.tsx` 仅接线，`FileExplorer.tsx` 零功能改动。验证：backend focused 80 测试、workspace/UI/SDK typecheck、根级 typecheck（7 包）、`file-explorer` E2E 均通过；SDK 在干净 worktree 串行生成。另修复 generator 的 Windows 可移植性（`generate.ts` 显式 `bun` 调用、`.prettierignore` 排除 Vite symlink-stub）。**Task 4 依赖 Plan 07 Task 1 `AsyncState`，Task 5 依赖 Task 4——两者待 Plan 07 完成后恢复，本次未执行。**
