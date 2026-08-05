# 07 — 异步资源状态原语与真实错误语义

- **Status:** 🔨 In progress
- **Priority:** P1
- **Dependencies:** 无；08 的截图基线应在本计划完成后建立
- **Coordination:** 本计划拥有 `FileExplorer.tsx` 与 `FilePreview.tsx` 的状态迁移。Plan 16 Task 4 等待本计划 Task 1，并只在薄 Files adapter 兼容最终 `FileExplorer` export；Plan 19 Task 4 等待本计划 Tasks 1、3 后再修改 `FilePreview.tsx`。三计划的 workspace E2E 共用 `.env.local`，必须串行
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 7；替代 `docs/plans/05-ux-polish.md` 中已经部分修复的旧问题清单
- **Baseline:** 当前实施分支为 `release/v0.3.15`（2026-08-02 实测）

## Current state

- `tasks/plan.md` 已声明 `@synsci/ui` 是 Toast、Dialog、AsyncState 等交互原语的唯一事实源，因此 AsyncState 不能落在 workspace 私有目录。
- 当前可达且属于本计划的表面是：
  - `FileExplorer`：由 `pages/session.tsx` 的 Files tab 挂载；
  - `FileView`（定义于 `FilePreview.tsx`）：由中心文件 tab 挂载，是实际读取/renderer 入口；
  - `FolderPicker`：由 Home 和 Command Palette 的打开目录流程挂载；
  - `SkillLibraryDialog`：由 `RightPane.tsx` 的 `skill library` 按钮挂载；
  - `SkillsPage`：由 `pages/session.tsx` 的 Skills tab 挂载。
- `OpenScienceFileTree`、`FilePreview` legacy drawer wrapper 和 inline `SkillsBrowser` 在仓库内都只有定义、没有消费者；只有 `FilePreview.tsx` 中的 `FileView` 与 `SkillsBrowser.tsx` 中的 `SkillLibraryDialog` 被调用。不得为了满足计划而重新挂载这些遗留 UI，也不能为不可达组件编写虚假 E2E。
- `FileExplorer` 对所有 list 异常都返回 `[]`；只有 403/FDA 另存了 permission 文案，其他错误会被显示成空目录。`FolderPicker` 虽已有 error/retry，但其 resource 仍在 catch 后返回空数组。
- 可达的 `FileView` 已显示读取错误；迁移重点是复用共享 shell，并明确 initial loading、stale refresh、成功空文件、unsupported binary 与真实 error 的边界，不改零消费者 drawer wrapper。
- `global-sync.tsx` 的两个 skill 加载入口都使用 `.catch(() => {})`。整体 `sync.data.status` 最终仍可进入 `complete`，store 没有 skill 专属 loading/error 字段，因此 `SkillLibraryDialog` 无法仅靠现有数据恢复真实错误。
- `SkillsPage` 使用独立 Solid resource，但 `skills() ?? []` 会把 loading/error 折叠为空数组；现有 `e2e/skills.spec.ts` 只覆盖这个页面，不会打开 `SkillLibraryDialog`。
- `StagesPanel.tsx` 的 `sync.session.stages(id).catch(() => {})` 是成立的另一处吞错，但它属于 session-stage 数据契约，不属于本计划的文件/文件夹/技能迁移范围；在本计划 Progress 中登记后单独排期，避免借 AsyncState 扩大为所有异步页面重构。
- 根 `bunfig.toml` 把 test root 指向不存在的 `./do-not-run-tests-from-root`；所有 focused Bun test 必须使用 `--cwd`。
- `e2e-local.ts` 会读写并在 finally 恢复共享的 `frontend/workspace/.env.local`。任何两个本地 E2E invocation 并行执行都会竞争该文件，因此本计划所有 E2E 必须进入同一串行 lane，优先合并为一次 Playwright invocation。
- workspace 与 UI kit 都没有真实 DOM 组件测试先例，也没有 Testing Library。AsyncState 测试将直接使用 `solid-js/web` 的 `render`、真实 DOM 查询和事件分派，不为一个小原语新增测试框架。

## Problem

用户无法稳定区分“首次加载”“后台刷新”“成功但为空”和“请求失败”。错误被转换为空数组时没有 retry；各页面独立实现状态 DOM 又会持续产生 copy、ARIA 和布局差异。旧计划还把共享原语放错层级，并把不可达组件当成迁移目标，导致验收无法真实执行。

## Goals

1. 在 `@synsci/ui` 建立纯展示型 AsyncState，统一 loading、refreshing、empty、error、ready 五种语义。
2. 只迁移真实可达的 FileExplorer、FileView（位于 `FilePreview.tsx`）、FolderPicker、SkillLibraryDialog 和 SkillsPage。
3. 让目标表面保留真实错误并提供可用 retry；成功空数据才允许映射为 empty。
4. 保持 stale data、搜索输入、选择和滚动；后台刷新不替换内容、不抢焦点、不产生重复 live announcement。
5. 用明确 props、ARIA 与 copy 表消除实施歧义；测试真实组件和本地 backend，避免用 Playwright network mock 复制 resource 逻辑。

## Non-goals

- 不重新挂载、迁移或顺带删除不可达的 `OpenScienceFileTree`、`FilePreview` drawer wrapper 与 inline `SkillsBrowser`；其删除属于产品面 retirement/dead-code cleanup。
- 不在本计划修复 `StagesPanel` 或其他 session resource；为其另建小型 follow-up，至少包含 error state、retry 与 session 切换竞态。
- 不改 SDK/API 契约，不引入新的全局请求缓存或状态管理库。
- 不把 AsyncState 变成负责 fetch 的“万能资源组件”，也不让 UI kit import workspace context、SDK 或 Atlas token。
- 不重做文件树布局、文件预览编辑器、FolderPicker 导航或技能搜索算法。
- 不改视觉 token 或建立截图基线；见 08。
- 不处理 Research Graph iframe/API 状态。

## Proposed design

### Kit-owned presentational contract

在 `frontend/ui/src/components/async-state.tsx` 实现，通过现有 wildcard export 以 `@synsci/ui/async-state` 消费。Props 使用判别联合，不需要未使用的泛型 `T`：

```ts
type AsyncBase = {
  label: string
  compact?: boolean
}

export type AsyncStateProps = AsyncBase &
  (
    | { state: "loading"; message?: string }
    | { state: "refreshing"; message?: string; children: JSX.Element }
    | { state: "empty"; message?: string }
    | {
        state: "error"
        title?: string
        detail?: string
        retry?: () => void
        retryLabel?: string
        children?: JSX.Element
      }
    | { state: "ready"; children: JSX.Element; loadedMessage?: string }
  )
```

- 原语只渲染状态外壳，调用方负责把 `resource.loading/latest/error/refetch` 或 sync store 映射成判别联合。
- `refreshing` 和 refresh error 可以保留 children；error 有 stale children 时错误提示作为非覆盖 banner，不能清空已有内容。
- kit 只复用自身 `Spinner`、Button 与样式，不 import workspace 的 `AsciiSpinner`、context 或领域 icon。
- `label` 提供状态区域的可访问名称；`detail` 只接受调用方已经归一化的可读文本，AsyncState 不解析 SDK error shape。

### ARIA lifecycle

- initial `loading` 使用 `role="status"`，默认 polite；同一次 loading 不重复更新 live 文本。
- `refreshing` 保留 children，在内容容器设置 `aria-busy="true"`；可见的 `updating…`/spinner 使用 `aria-hidden="true"`，不建立 live region，避免后台刷新打断读屏。
- `ready` 初次直接挂载时不播报。只有组件实际经历 `loading/error → ready` 且提供 `loadedMessage` 时，才临时渲染一次 sr-only `role="status"`；`refreshing → ready` 保持无声。
- error banner 使用 `role="alert"`。组件生成稳定 id，以 `aria-labelledby` 关联 error title、以 `aria-describedby` 关联 detail；无 detail 时不输出空引用。存在 stale children 时，children 必须位于 alert 外，避免读屏重复朗读整份旧内容。
- retry 是真实 Button；无 callback 时不渲染按钮。任何状态切换都不得自动聚焦状态 shell 或 retry。
- empty 和 query-no-match 默认不使用 live region；由用户输入即时造成的过滤结果不逐键播报。

### State derivation rules

Solid resource 的默认优先级：

1. `error` 且无 `latest` → error；
2. `error` 且有 `latest` → error + stale children；
3. `loading` 且无 `latest` → loading；
4. `loading` 且有 `latest` → refreshing + stale children；
5. 请求成功且数据为空 → empty；
6. 请求成功且有数据 → ready。

搜索过滤为第二层 UI 状态：资源 ready 且全集非空、但 query 结果为空时显示 “no matching …”，不能把它当成资源 empty 或 error。

### Skill-specific sync state

给内部 project sync state 增加最小字段 `skill_status: "loading" | "ready" | "error"` 与可选 `skill_error`，并让 bootstrap 与 `skill.updated` 共用一个 loader：

- load 开始：设置 `skill_status = "loading"`，保留现有 skill 数组；
- 成功：更新 skill、清空 error、设置 ready；
- 失败：保留旧数组、记录可读 error、设置 error；不得再静默 catch；
- 通过 `sync.skill.refetch()` 暴露同一个 loader 给 UI retry，不复制 SDK 调用。

实际 bootstrap 中，整体 status 在阻塞请求结束后先成为 `partial`，skills 属于随后等待的请求。因此在专属状态落地后以 `skill_status` 为事实源；映射 `partial` 的兼容原则仍明确为：已有 skill 数据时是 refreshing，无数据时是 loading，绝不能直接判为 empty。`sync.data.status === "complete"` 不再被当成 skill 成功的证据。

### Copy matrix

文案统一使用简短 lowercase，但领域错误保留足够信息：

| Semantic            | Kit default       | Files                    | File preview              | Folder picker           | Skills                 |
| ------------------- | ----------------- | ------------------------ | ------------------------- | ----------------------- | ---------------------- |
| initial loading     | `loading…`        | `loading files…`         | `loading file…`           | `loading folders…`      | `loading skills…`      |
| background refresh  | `updating…`       | `updating files…`        | `updating file…`          | `updating folders…`     | `updating skills…`     |
| successful empty    | `nothing here`    | `no files here`          | `empty file`              | `no folders here`       | `no skills available`  |
| query has no match  | caller-owned      | `no matching files`      | n/a                       | `no matching folders`   | `no matching skills`   |
| error title         | `couldn't load`   | `can't read this folder` | `couldn't open this file` | `couldn't list folders` | `couldn't load skills` |
| retry               | `retry`           | `retry`                  | `retry`                   | `retry`                 | `retry`                |
| loaded announcement | optional `loaded` | `files loaded`           | `file loaded`             | `folders loaded`        | `skills loaded`        |

FDA permission guidance、实际 error detail、binary/unsupported 说明不被默认 copy 覆盖。`empty file` 只描述读取成功后的零长度内容，现有 edit/source 控件仍可用。

### E2E serialization policy

所有 `bun run --cwd frontend/workspace test:e2e` 命令必须串行。Tasks 2–5 可并行准备互不重叠的 production 修改，但并行 agent 不得各自启动 `e2e-local.ts`；浏览器验收在 Checkpoint 用一次 invocation 统一执行。`e2e/file-open.spec.ts` 同时覆盖 FileExplorer → FileView 与编辑流程，因此明确列入 Tasks 2、3，并使这两个 Task 的测试改动按 Task 2 → Task 3 顺序落地。

## Implementation tasks

### Task 1：在 UI kit 实现并测试 AsyncState

**Description:** 按上述判别联合在 `@synsci/ui` 新增组件、样式和真实 DOM 测试。测试用 `solid-js/web` render 到 jsdom host，直接查询 DOM/ARIA 并派发 click，不新增 Testing Library 或测试专用生产分支。

**Acceptance:**

- [ ] Props 只能表达五种合法状态；refreshing/error 可保留 stale children，ready/refreshing 必须提供 children。
- [ ] loading、silent refreshing、一次性 loaded announcement、error label/description、empty 与 retry 行为符合 ARIA lifecycle。
- [ ] retry 快速点击的调用次数由 consumer busy policy决定；AsyncState 不隐藏回调异常、不自动 fetch、不管理业务状态。
- [ ] 组件只依赖 UI kit/Solid，使用 kit Spinner/Button，能够通过 `@synsci/ui/async-state` 导入。

**Verification:**

- [ ] `bun run --cwd frontend/ui test:dom`（vitest 运行 14 个真实 DOM 测试）
- [ ] `bun run --cwd frontend/ui typecheck`
- [ ] 手工检查测试 teardown 后无遗留 host/live region，且没有引入 Testing Library。

**Dependencies:** 无

**Files:**

- `frontend/ui/src/components/async-state.tsx`（新增）
- `frontend/ui/src/components/async-state.css`（新增）
- `frontend/ui/src/components/async-state.test.tsx`（新增；UI kit 首个真实 DOM render test）
- `frontend/ui/vitest.config.ts`（新增；DOM 组件测试 runner，仅 solidPlugin + jsdom + browser condition）
- 根 `package.json` catalog 与 `frontend/ui/package.json`（新增 `vitest` devDep 与 `test:dom` script；见 Progress 的 bun JSX 限制说明）

**Scope:** M

### Task 2：迁移可达的 FileExplorer 并停止 error → empty

**Description:** 只迁移 session Files tab 使用的 FileExplorer。非权限异常进入 resource error；403/FDA 继续显示专门指导。把初载、刷新、空目录、过滤无结果、error 与 ready 映射到 kit AsyncState。

**Acceptance:**

- [ ] 只有成功的空 list 显示 `no files here`；普通异常和 403/FDA 都不会返回空数组伪装成功。
- [ ] refresh error 保留上一批 rows 并显示可重试错误；initial error 显示错误 shell，retry 复用 refresh key/resource 入口。
- [ ] refreshing 保留 rows、展开/路径、过滤、选择和滚动；过滤零结果使用 `no matching files`。
- [ ] 不修改或重新挂载 `OpenScienceFileTree`。

**Verification:**

- [ ] `rg -n 'return \[\] as FileNode\[\]' frontend/workspace/src/atlas/FileExplorer.tsx` 仅允许明确的“无 directory 输入”成功边界，不得出现在 catch 中。
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 将 `e2e/file-tree.spec.ts e2e/file-open.spec.ts` 纳入 Checkpoint 的单进程 E2E；使用真实空目录、缺失/不可读路径和恢复后的 retry，不使用 `page.route`。

**Dependencies:** Task 1

**Files:**

- `frontend/workspace/src/atlas/FileExplorer.tsx`
- `frontend/workspace/e2e/file-tree.spec.ts`
- `frontend/workspace/e2e/file-open.spec.ts`

**Scope:** M

### Task 3：迁移可达的 FileView 与 FolderPicker

**Description:** 复用 kit shell 收敛已有 FileView error 与 FolderPicker error/retry。保持 FileView renderer/edit/save 契约、FolderPicker Web/Tauri 导航以及当前 120ms stale-refresh 行为；`FilePreview.tsx` 只是承载可达 FileView 的文件，本 Task 不迁移同文件内零消费者的 drawer wrapper。

**Acceptance:**

- [ ] FileView 区分 initial loading、refreshing、read error、成功空文本、binary/unsupported 与 ready；read error 可 retry。
- [ ] FolderPicker 失败使用 resource error，不再 catch 后返回空数组；refresh/error 保留上一目录 entries，成功空目录才显示 empty。
- [ ] binary/unsupported 是成功读取后的 capability 状态，不标为 error；空文本仍可进入 edit/source 流程。
- [ ] 保存失败继续走现有 toast，读取状态迁移不改变 save/reset/close、最近目录与 Tauri picker 契约。
- [ ] 不为验证状态迁移而重新挂载 legacy `FilePreview` drawer；文件 E2E 继续从中心 FileView tab 进入。

**Verification:**

- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 将 `e2e/file-viewer.spec.ts e2e/file-open.spec.ts e2e/folder-picker.spec.ts` 纳入 Checkpoint；覆盖真实存在、空、binary、缺失文件及真实空目录。
- [ ] Task 3 的 `file-open.spec.ts` 修改在 Task 2 后落地；不得与 Task 2 并发编辑或并发运行 E2E。

**Dependencies:** Tasks 1、2（共享 `file-open.spec.ts` 与串行验证边界）

**Files:**

- `frontend/workspace/src/atlas/FilePreview.tsx`
- `frontend/workspace/src/atlas/FolderPicker.tsx`
- `frontend/workspace/e2e/file-viewer.spec.ts`
- `frontend/workspace/e2e/file-open.spec.ts`
- `frontend/workspace/e2e/folder-picker.spec.ts`（新增）

**Scope:** M

### Task 4：补齐 skill sync 错误契约并迁移 SkillLibraryDialog

**Description:** 在 global/project sync 中建立 skill 专属 loading/error/ready 与单一 refetch 入口，替换 bootstrap 和 `skill.updated` 的 silent catch；然后只迁移真实可达的 SkillLibraryDialog。新增独立 E2E 从 RightPane 的 `skill library` 按钮打开 Dialog。

**Acceptance:**

- [ ] bootstrap 与 `skill.updated` 共用 loader；失败保留旧 skills、记录真实错误且整体 sync 可以完成，不再有 skill `.catch(() => {})`。
- [ ] `sync.skill.refetch()` 复用相同 loader；retry 不复制 SDK 调用，成功后清除旧 error。
- [ ] loading/partial 时：有旧 skills → refreshing，无旧 skills → loading；error 不映射 empty，ready 空库与 query 无结果使用不同 copy。
- [ ] Dialog bootstrap/refresh 后搜索焦点、列表和 open state 保留；不修改零消费者 inline `SkillsBrowser`。

**Verification:**

- [ ] `rg -n '\.catch\(\(\) => \{\}\)' frontend/workspace/src/context/global-sync.tsx` 不再命中 skill fetch 链。
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 将新增 `e2e/skill-library-dialog.spec.ts` 纳入 Checkpoint；测试必须通过 RightPane 按钮打开 `Skill Library`，不得复用只覆盖 SkillsPage 的断言冒充 Dialog 测试。
- [ ] seeded skills 的 ready/search/pick 使用真实 local backend；错误协调器用实际实现的 focused test/characterization 覆盖，不以 `page.route` 复制 store 逻辑。

**Dependencies:** Task 1；production 修改可与 Tasks 2、3、5 并行，E2E 必须串行

**Files:**

- `frontend/workspace/src/context/global-sync.tsx`
- `frontend/workspace/src/context/sync.tsx`
- `frontend/workspace/src/atlas/SkillsBrowser.tsx`（只修改 `SkillLibraryDialog` 及可复用的纯过滤 helper，不恢复 inline 入口）
- `frontend/workspace/e2e/skill-library-dialog.spec.ts`（新增）

**Scope:** M

### Task 5：迁移真实 SkillsPage resource 状态

**Description:** 修复 Skills tab 自己的 `skills() ?? []` error → empty 转换，使用 resource `loading/latest/error/refetch` 映射 kit AsyncState；保留 enable/disable、创建技能、分类和搜索行为。既有 `e2e/skills.spec.ts` 继续只验证这个页面。

**Acceptance:**

- [ ] loading/error 不再通过 `skills() ?? []` 变成空库；refreshing 保留技能 rows、搜索、分类与焦点。
- [ ] 成功空库显示 `no skills available`；非空库过滤为零才显示 `no matching skills`；error 有真实 detail 与 retry。
- [ ] toggle/create 成功和失败语义不变，AsyncState 不接管 mutation busy/toast。

**Verification:**

- [ ] `rg -n 'skills\(\) \?\? \[\]' frontend/workspace/src/atlas/SkillsPage.tsx` 无命中。
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 将 `e2e/skills.spec.ts` 纳入 Checkpoint；继续从 Skills tab 进入，验证 ready/search/create/toggle，不把它当作 SkillLibraryDialog 覆盖。

**Dependencies:** Task 1；可与 Task 4 并行准备 production 修改，E2E 必须串行

**Files:**

- `frontend/workspace/src/atlas/SkillsPage.tsx`
- `frontend/workspace/e2e/skills.spec.ts`

**Scope:** S

## Checkpoint

- [ ] `bun run --cwd frontend/ui test:dom`（AsyncState 14 个真实 DOM 测试）
- [ ] `bun run --cwd frontend/ui typecheck`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 只启动一次本地 E2E runner：`bun run --cwd frontend/workspace test:e2e -- e2e/file-tree.spec.ts e2e/file-open.spec.ts e2e/file-viewer.spec.ts e2e/folder-picker.spec.ts e2e/skill-library-dialog.spec.ts e2e/skills.spec.ts`
- [ ] 可达目标表面都能区分 loading、refreshing、empty、error、ready；resource empty 与 query no-match 不混用。
- [ ] OpenScienceFileTree、FilePreview drawer 与 inline SkillsBrowser 仍为零消费者且未被本计划重新挂载；其验收项为零。
- [ ] FDA、binary、unsupported 等领域状态保留；refresh/error 不清空 stale data。
- [ ] `e2e-local.ts` 在整个验证期间只有一个进程写 `.env.local`，结束后原内容得到恢复。

## Compatibility and rollback

- AsyncState 作为 `@synsci/ui/async-state` 的 additive export，不改变既有 resource、SDK 或 context 调用。
- skill sync 只增加专属状态与 refetch；现有 `sync.data.skill` 数组和整体 `sync.data.status` 保持兼容，旧消费者无需同时迁移。
- Tasks 2、3、4、5 分批提交；Task 2/3 因共享 `file-open.spec.ts` 顺序提交，Task 4/5 production 文件互不重叠。
- 某一表面回归时可只回退其状态映射；若回退 skill sync，必须同时回退 SkillLibraryDialog retry，不能留下永远不可成功的按钮。
- copy 变更与状态语义在同批提交；产品若调整文案，可单独修改 copy，不回退错误保留。

## Risks

| Risk                                       | Impact                         | Mitigation                                                                                       |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| 迁移不可达组件                             | E2E 无入口、投入无用户价值     | 以 import/JSX 调用图为门槛；排除 OpenScienceFileTree、FilePreview drawer 与 inline SkillsBrowser |
| AsyncState 继续放在 workspace              | 与路线图唯一事实源冲突         | 在 `frontend/ui` 实现并通过 package wildcard export                                              |
| 判别联合仍允许非法 props                   | ready 无内容、error 无可读语义 | state-specific required fields；组件测试逐态 type/DOM 契约                                       |
| 首个 DOM render test 不稳定                | 测试泄漏、ARIA 误判            | UI jsdom + `solid-js/web` render + 手工查询；每例 dispose/remove host；不引入 Testing Library    |
| refreshing live region 过度播报            | 屏幕阅读器被后台更新打断       | visual indicator aria-hidden；只设 aria-busy；仅 loading/error→ready 可一次性 announce           |
| error detail 未关联                        | 读屏只听到泛化标题             | 稳定 ids + aria-labelledby/describedby；无 detail 不输出空引用                                   |
| FileExplorer/FolderPicker 继续 return `[]` | 真实错误仍伪装 empty           | resource error 优先级；catch 路径静态检查与真实缺失路径 E2E                                      |
| sync complete 掩盖 skill fetch 失败        | Dialog 显示空库且无法 retry    | skill 专属 status/error；共用 loader；complete 不作为 skill success                              |
| partial 被误判 empty                       | 技能 bootstrap 短暂闪空        | partial + stale = refreshing；partial + no data = loading；专属 status 为最终事实源              |
| 并行 E2E 竞争 `.env.local`                 | 配置损坏、串错 server、flaky   | 所有 specs 合并为单一 invocation；禁止 agent 并发启动 `e2e-local.ts`                             |
| Task 2/3 同改 `file-open.spec.ts`          | 合并冲突、回归归因困难         | 明确 Task 2 → Task 3 顺序；production 可独立，测试文件串行落地                                   |
| StagesPanel silent catch 被遗忘            | 阶段加载失败仍显示 empty       | 在 Non-goals/Progress 登记独立 follow-up，不伪装为本计划已解决                                   |

## Definition of Done

- [ ] Tasks 1–5 acceptance、verification 与 Checkpoint 全部完成。
- [ ] UI kit typecheck、AsyncState 真实 DOM test、workspace typecheck 和单进程 targeted E2E 通过。
- [ ] 可达目标中没有 silent catch 或 error → empty；成功空数据与搜索无结果有不同语义。
- [ ] `bun test --cwd backend/cli` 完整通过；不得从仓库根直接运行 `bun test`。
- [ ] 没有新增 Playwright network mock、第二套 AsyncState、Testing Library 或仅供测试的生产分支。
- [ ] 每个迁移批次有独立 rollback 边界，实施证据详细回填本计划 Progress。
- [ ] StagesPanel follow-up 已进入待办或独立计划，本计划不得宣称其吞错已修复。

## Progress

- 2026-08-02：复核组件 import/JSX 调用图，确认 `OpenScienceFileTree`、legacy `FilePreview` drawer 与 inline `SkillsBrowser` 为零消费者；将其移出迁移/E2E 范围，保留 `FileExplorer`、`FilePreview.tsx` 内的 FileView、FolderPicker、`SkillLibraryDialog` 与 `SkillsPage` 五个可达表面。
- 2026-08-02：确认 AsyncState 应归属 `@synsci/ui`；补充判别联合 Props、ARIA 生命周期、状态/copy 对照表和 UI jsdom 直接渲染测试方案。
- 2026-08-02：确认 skill fetch 的 silent catch 会让 overall sync complete 掩盖失败；Task 4 扩展到 `global-sync.tsx` / `sync.tsx`，增加 skill 专属状态与统一 refetch，并为 Dialog 新建独立 E2E。
- 2026-08-02：确认 `e2e-local.ts` 共享 `.env.local` 且 `file-open.spec.ts` 横跨 Tasks 2/3；将所有 E2E 合并到单一串行 invocation，并把该 spec 明确列入两批文件清单。
- 2026-08-02：`SkillsPage` 纳入独立 Task 5；`StagesPanel` 问题成立但涉及 session-stage 数据契约，登记为显式 follow-up，不在本计划中静默遗漏或扩大范围。
- 2026-08-02：补充 Plans 16/19 反向协调边界：本计划拥有 FileExplorer/FileView 状态迁移，16 仅在 adapter 兼容并等待共享 AsyncState，19 等 Task 3 后串行接入 inspect-first；三计划 E2E 不并发写 `.env.local`。
- 2026-08-03：Task 1 确认 bun test 无法执行 Solid JSX——bun 1.3.14 忽略 `jsxImportSource`，JSX 一律编译为 React 调用，且 `solid-js/web` 在 test condition 下解析到 server build（隔离复现确认）；按决策给 UI kit 引入 vitest（根 catalog + `test:dom` script），`vitest.config.ts` 仅含 vite-plugin-solid + jsdom + browser condition，未引入 Testing Library。AsyncState 组件在 vitest 下发现并修复 `<Show>` 子 accessor 误传问题（`onClick={retry}` → `onClick={retry()}` 取回调）；retry 抛异常通过 window `error` 事件断言。14 个 DOM 测试全部通过，`bun run --cwd frontend/ui typecheck` 通过，既有 `basic-tool.test.ts` 的 bun test 不受影响。Task 1 验证命令相应更新为 `bun run --cwd frontend/ui test:dom`。
- 2026-08-03：Checkpoint 首跑 16 通过 / 2 失败，根因是 Solid `resource.latest` 在 error 态下会 re-throw（`if (err && !pr) throw err`）——Task 2 的 FileExplorer 在 `sorted()` 与 `asyncState` memo 中直接读 `entries.latest`，导航到缺失目录时把 `path not found` 抛到应用级 ErrorBoundary（整个 app 白屏）。修复：改用与 FolderPicker/FilePreview/SkillsPage 一致的 `known` 快照 signal（`createEffect` 里 `!entries.error` 时 `setKnown(entries())`），`sorted()` 与 memo 改读快照。修复后 file-tree 5 个测试全绿，全量单进程 E2E 复跑通过。
- 2026-08-03：补充 Plan 07 审计发现的导航回归：`FileExplorer` 现在将 `known` 快照绑定到目录，只在同一目录的 refresh/error 中保留 stale rows；切换到新目录或失败路径时不再渲染、点击旧目录文件。新增 `file-tree.spec.ts` 真实目录回归用例。workspace typecheck 通过；isolated E2E harness 在 60 秒时限内未返回报告，因此 Checkpoint/Definition of Done 仍未勾选。
