# 07 — 异步资源状态原语与真实错误语义

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** 无；08 的截图基线应在本计划完成后建立
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 7；替代 `docs/plans/05-ux-polish.md` 中已经部分修复的旧问题清单

## Current state

- `FileExplorer.tsx` 已有 permission error 与 retry，`FilePreview.tsx` 已显示 resource error，`FolderPicker.tsx` 也已保留错误并提供 retry；这些是已落地行为，不应再次作为“缺失修复”排期。
- 上述页面与 `OpenScienceFileTree.tsx` 仍各自拼装 loading/empty/error DOM、字体、copy 和重试按钮；literal `loading…`、sentence-case 与 lowercase-mono 同时存在。
- `OpenScienceFileTree.tsx` 的根请求只对 403 设置 permission error，其余异常返回 `[]`；嵌套目录请求使用空 `catch {}`。真实失败仍可能被呈现成空目录。
- `SkillsBrowser.tsx` 直接读取 `sync.data.skill ?? []`。在 `sync.data.status === "loading"` 时，空数组被显示为 “no matching skills”，把未加载与真正空数据混为一谈。
- Solid resources 已提供 `loading/latest/error/refetch`，global/project sync 也已有 `status: loading | partial | complete`；缺的是统一的展示原语和明确映射，而不是新的数据层。

## Problem

用户无法稳定区分“仍在加载”“后台刷新”“确实为空”和“请求失败”。错误被转为空数组时，用户没有 retry；各页面独立实现状态 DOM 又会持续产生 copy、ARIA 和布局差异。若直接把数据获取搬进共享组件，则会把不同 SDK 资源耦合成新的大抽象。

## Goals

1. 建立纯展示型 `AsyncState` 原语，统一 initial loading、stale refresh、empty、error、ready 五种语义。
2. 让所有目标文件/文件夹/技能表面保留真实错误，并在可 refetch 时提供 retry。
3. 保持 stale data 可见；后台刷新不得把 ready 内容替换成全屏 loading 或造成焦点跳动。
4. 统一简短 lowercase copy 与 ARIA 策略，避免每次 resource tick 都被 `aria-live` 重复播报。
5. 测试真实实现和真实本地 backend，不用网络 mock 复制 resource 逻辑。

## Non-goals

- 不改 SDK/API 契约，不引入新的全局请求缓存或状态管理库。
- 不把 `AsyncState` 变成负责 fetch 的“万能资源组件”。
- 不重做文件树布局、文件预览编辑器或技能搜索算法。
- 不改视觉 token或建立截图基线；见 08。
- 不处理 Research Graph iframe/API 状态；其网关计划独立推进。

## Proposed design

### Presentational state model

在 `frontend/workspace/src/atlas/shared/AsyncState.tsx` 定义窄联合：

```text
loading     首次请求，尚无可展示数据
refreshing  已有 stale/ready 内容，后台请求进行中
empty       请求成功且集合/内容为空
error       请求失败；可选 retry
ready       有可展示内容
```

原语只接收已经归一化的 state、label、error、retry、compact 和 children；不接收 SDK client，不创建 resource。调用方仍根据 `resource.loading/latest/error` 或 `sync.data.status` 做映射。`refreshing` 在内容旁提供非阻塞 busy 提示；`error` 使用 `role="alert"`，loading 使用节制的 `status`，ready/empty 不反复 live announce。

### Error policy

- 只有成功响应的空数组可映射为 `empty`。
- permission/FDA 错误保留当前专门指导文案，并嵌入统一 error shell。
- 其他异常必须抛给 resource 或保存为 error signal，不能 `catch { return [] }`。
- retry 调用已有 `refetch`/refresh key；不在 UI 复制请求代码。

## Implementation tasks

### Task 1：实现并测试 AsyncState 展示原语

**Description:** 新增共享组件和针对五态、ARIA、retry 的组件测试。复用已有 `AsciiSpinner` 与 kit Button；保持 API 小且由类型推断约束。

**Acceptance:**

- [ ] 五种状态的 DOM 与语义互斥，`refreshing` 可同时保留 children。
- [ ] error 有可选可访问详情和 retry；无 retry callback 时不渲染伪按钮。
- [ ] loading/refreshing 不抢焦点，live region 只播报有意义的状态变化。
- [ ] 原语不 import SDK、context 或具体页面类型，也不创建 resource。

**Verification:**

- [ ] `bun test frontend/workspace/src/atlas/shared/AsyncState.test.tsx`
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** 无

**Files:**

- `frontend/workspace/src/atlas/shared/AsyncState.tsx`（新增）
- `frontend/workspace/src/atlas/shared/AsyncState.test.tsx`（新增）

**Scope:** M

### Task 2：迁移两棵文件树并停止错误转空

**Description:** 将 host FileExplorer 与 OpenScienceFileTree 映射到统一五态。保留 FDA 专门说明，同时让根目录和嵌套目录的非权限异常进入 error，而不是返回空数组。

**Acceptance:**

- [ ] 首次加载、stale refresh、成功空目录、403/FDA、普通错误和 ready 均可区分。
- [ ] `OpenScienceFileTree` 根/子目录不再存在吞掉异常的空 `catch`；普通失败不会显示 “No files here”。
- [ ] 两棵树的错误都可 retry，retry 复用原 resource/refetch 入口。
- [ ] 刷新期间已有 rows、展开状态、滚动和当前选择保持不变。

**Verification:**

- [ ] `rg -n 'catch\s*\{\s*\}|catch.*return \[\]' frontend/workspace/src/atlas/OpenScienceFileTree.tsx` 无吞错路径。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/file-tree.spec.ts e2e/file-open.spec.ts`
- [ ] e2e 通过测试沙箱中的真实空目录、真实缺失/不可读路径和恢复后的 retry 验证，不使用 `page.route` mock。

**Dependencies:** Task 1

**Files:**

- `frontend/workspace/src/atlas/FileExplorer.tsx`
- `frontend/workspace/src/atlas/OpenScienceFileTree.tsx`
- `frontend/workspace/e2e/file-tree.spec.ts`

**Scope:** M

### Task 3：迁移文件预览与 FolderPicker 状态

**Description:** 把已经存在的 FilePreview error 和 FolderPicker error/retry 放进统一状态 shell，保留编辑、stale refresh、Web/Tauri 路径和最近修复的 120ms 行为。

**Acceptance:**

- [ ] FilePreview 能区分 initial loading、read error、空文本/不支持预览和 ready；read error 可 retry。
- [ ] FolderPicker 失败仍显示真实错误与 retry，不回退为 empty；refreshing 时保留上一目录 entries。
- [ ] binary/unsupported 是成功读取后的内容能力状态，不被误标为请求 error。
- [ ] 保存失败仍走现有 toast，读取状态迁移不改变编辑/保存契约。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/file-viewer.spec.ts e2e/file-open.spec.ts`
- [ ] 用真实存在文件、空文件、binary 文件、缺失文件和真实空目录逐态 smoke。
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** Task 1；可与 Task 2 并行

**Files:**

- `frontend/workspace/src/atlas/FilePreview.tsx`
- `frontend/workspace/src/atlas/FolderPicker.tsx`
- `frontend/workspace/e2e/file-viewer.spec.ts`

**Scope:** M

### Task 4：让技能浏览器区分同步中、空库与无搜索结果

**Description:** 使用现有 `sync.data.status` 判断 bootstrap 状态；把“库为空”和“当前 query 无匹配”拆成不同 empty copy，两种 SkillsBrowser 入口共享同一映射。

**Acceptance:**

- [ ] `status === "loading"` 时显示 loading，不显示 “no matching skills”。
- [ ] sync partial/complete 且技能库为空时显示明确 empty；非空库搜索无结果时才显示 “no matching skills”。
- [ ] bootstrap 从 loading 到 ready 时焦点仍在搜索框，列表更新不关闭 popover/dialog。
- [ ] inline popover 与 SkillLibraryDialog 行为一致，不复制两套状态判断。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/skills.spec.ts`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 以真实 seeded skills 和空 skills 配置验证，不通过测试内复制过滤逻辑断言实现。

**Dependencies:** Task 1；可与 Tasks 2、3 并行

**Files:**

- `frontend/workspace/src/atlas/SkillsBrowser.tsx`
- `frontend/workspace/e2e/skills.spec.ts`

**Scope:** S

## Checkpoint

- [ ] 目标表面都能明确区分 initial loading、refreshing、empty、error、ready。
- [ ] OpenScienceFileTree 不再把异常转换为空数组；所有可恢复错误有 retry。
- [ ] FDA、binary、unsupported 等领域特定状态被保留，没有被粗暴压成通用 error。
- [ ] 文件树、预览、FolderPicker、技能 e2e 使用真实 backend/fixture 通过。

## Compatibility and rollback

- `AsyncState` 是 opt-in 展示原语，不改变 resource、SDK 或 context shape；每个表面可独立迁移与回退。
- Task 2、3、4 分开提交。某一表面回归时只回退其映射，其他表面和原语继续保留。
- 保留 `resource.latest` 与现有 refresh key/refetch，确保刷新、选择、滚动和编辑兼容。
- 旧 copy 在迁移提交中集中变更；若产品对文案有异议，可单独回退 copy，不回退真实错误语义。

## Risks

| Risk                             | Impact                  | Mitigation                                                      |
| -------------------------------- | ----------------------- | --------------------------------------------------------------- |
| 把 stale refresh 当首次 loading  | 列表闪空、焦点/滚动跳动 | 显式优先 `latest`，组件测试 refreshing+children                 |
| permission 特例被通用 error 覆盖 | macOS FDA 指引丢失      | 保留领域文案，仅共享外壳和 retry                                |
| sync partial 被误判为空          | 技能短暂闪 empty        | loading/partial/complete 明确映射，浏览器 bootstrap 测试        |
| e2e 依赖 OS 权限难稳定           | CI flaky                | 使用测试沙箱的真实缺失路径/可控目录；权限专例只做平台条件 smoke |
| 原语承担过多数据逻辑             | 新的跨资源耦合          | 禁止 import SDK/context，state 在调用方派生                     |

## Definition of Done

- [ ] 所有 Task acceptance 与 verification 完成。
- [ ] `typecheck`、组件测试和 targeted e2e 通过。
- [ ] 从 `backend/cli` 运行完整 `bun test` 通过。
- [ ] 没有新增网络 mock、静默 `catch {}` 或 error→empty 转换。
- [ ] 每个迁移批次有独立 rollback 边界。
