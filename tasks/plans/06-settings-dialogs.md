# 06 — Settings Dialog 收敛与原生 prompt/confirm 清理

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** 无；业务迁移依赖本计划 Task 1；可与 05、07 并行
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 6；细化 `docs/plans/05-ux-polish.md` 的 Settings 交互项

## Current state

- `frontend/workspace/src/atlas/dialogs.tsx` 已提供 Promise 风格的 `confirmDialog`、`promptDialog` 和 `alertDialog`，并通过应用的 dialog context 展示。
- 该 helper 仍用自绘 `<div>/<button>/<input>`，没有完整复用 `@synsci/ui/dialog`、Button 和 TextField 的焦点、disabled 与错误状态能力。
- Settings 仍有 9 处原生阻塞调用：
  - `Connectors.tsx`：删除 connector 的 `window.confirm`、OAuth code 的 `window.prompt`；
  - `Credentials.tsx`：两处凭据/Provider key 删除确认；
  - `General.tsx`：断开本地 server；
  - `Memory.tsx`：清空记忆；
  - `Network.tsx`：清空 allowed domains；
  - `Specialists.tsx`：删除自定义 specialist；
  - `Storage.tsx`：Web 环境下输入迁移路径。
- 原生 dialog 脱离应用主题，无法表达异步 busy、保留服务端错误，也难以稳定测试焦点恢复。

## Problem

同类危险操作使用不同的确认体验；浏览器原生 prompt/confirm 会阻塞事件循环、无法统一文案与无障碍语义，并在 Web/Tauri 两种环境中表现不同。一次性修改所有 Settings 面板又会造成 7+ 文件的大提交和难以定位的回归。

## Goals

1. 建立一个基于 `@synsci/ui` 的 Promise dialog 契约，支持焦点陷阱、Escape、焦点恢复、校验、busy/disabled 与异步错误保留。
2. 分三批迁移输入型、连接/凭据型和其余危险操作；每批可独立验证、回退。
3. 清除 `frontend/workspace/src` 中所有 `window.prompt/window.confirm`。
4. 保持 OAuth、凭据删除、Storage 迁移等现有后端调用和成功/失败语义不变。

## Non-goals

- 不重排 Settings 导航，不统一所有面板的字段布局或视觉 token。
- 不把普通 inline error 全部改成 Toast。
- 不改变 MCP OAuth 协议、凭据存储或 Storage 迁移 API。
- 不改全局 Toast、AsyncState 或截图基线；分别见 05、07、08。

## Proposed design

### Shared dialog contract

`confirmDialog`、`promptDialog`、`alertDialog` 保持现有返回类型，新增可选的 `validate`、异步 `submit`、`danger`、`busyLabel` 与错误展示能力。Promise 只能 settle 一次；取消返回 `false/null`。提交期间禁用重复提交和 backdrop/Escape 关闭，异步失败时 dialog 保持打开并显示可读错误，成功后才关闭并恢复触发元素焦点。

实现复用 `@synsci/ui/dialog`、`@synsci/ui/button`、`@synsci/ui/text-field`，不在 helper 内创建新的 overlay/focus-trap 系统。调用方继续负责具体 SDK/API 动作；helper 只编排交互状态。

### Migration batches

先迁移两个输入型流程，再迁移会共同触碰 `Connectors.tsx` 的连接/凭据批次，最后并行迁移 Memory/Network/Specialists。这样避免两个 Agent 同时编辑同一个文件。

## Implementation tasks

### Task 1：硬化共享 Promise dialog 原语

**Description:** 用 kit 组件重构 helper，补齐一次性 settle、表单提交、校验、busy、错误保留、Escape/backdrop 规则和焦点恢复；用真实 DialogProvider 渲染测试覆盖键盘路径。

**Acceptance:**

- [ ] confirm、prompt、alert 保持现有返回类型和默认按钮文案。
- [ ] Tab/Shift+Tab 不离开 dialog；Escape/取消只 settle 一次；关闭后焦点回到触发按钮。
- [ ] prompt 空值/非法值可阻止提交并展示错误。
- [ ] 异步 submit 期间按钮 disabled；失败时错误保留且可重试，成功后才关闭。
- [ ] danger 操作使用明确标题、描述和危险按钮语义，而不是只靠颜色。

**Verification:**

- [ ] `bun test frontend/workspace/src/atlas/dialogs.test.tsx`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/dialogs.spec.ts`

**Dependencies:** 无

**Files:**

- `frontend/workspace/src/atlas/dialogs.tsx`
- `frontend/workspace/src/atlas/dialogs.test.tsx`（新增）
- `frontend/workspace/e2e/dialogs.spec.ts`（新增）

**Scope:** M

### Task 2：迁移输入型 OAuth code 与 Storage path

**Description:** 用 `promptDialog` 替换 MCP OAuth code 粘贴和 Web Storage 绝对路径输入。保留 Tauri 原生目录选择器为首选，仅 Web fallback 使用应用 dialog。

**Acceptance:**

- [ ] OAuth 浏览器打开后，应用内 dialog 接收 code；取消不会发起完成请求。
- [ ] code 为空时不能提交；失败时用户输入与错误仍留在 dialog 中。
- [ ] Web Storage path 进行非空/绝对路径校验；Tauri `openDirectoryPickerDialog` 路径不变。
- [ ] 两个文件中不再存在 `window.prompt`。

**Verification:**

- [ ] `rg -n 'window\.prompt' frontend/workspace/src/components/settings/Connectors.tsx frontend/workspace/src/components/settings/Storage.tsx` 无命中。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings.spec.ts e2e/settings-panels.spec.ts`
- [ ] Web 与提供 platform picker 的两条 Storage 分支均手动 smoke。

**Dependencies:** Task 1

**Files:**

- `frontend/workspace/src/components/settings/Connectors.tsx`
- `frontend/workspace/src/components/settings/Storage.tsx`

**Scope:** S

### Task 3：迁移 Connectors、Credentials 与 General 危险确认

**Description:** 迁移 connector 删除、两类凭据删除和本地 server 断开。将 API 调用放入 dialog 的异步提交阶段，避免确认框提前关闭后才显示脱节的错误。

**Acceptance:**

- [ ] 每个确认框准确展示目标名称/Provider 和不可逆影响。
- [ ] 快速双击不会重复发出删除/断开请求。
- [ ] API 失败时 dialog 保持打开并显示原始可读错误；成功后原有列表刷新和 toast 行为不变。
- [ ] 三个文件中不再存在 `window.confirm`。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings-providers.spec.ts e2e/settings-panels.spec.ts`
- [ ] 真实 backend 下逐一验证 connector 删除、凭据删除和断开 server 的取消/失败/成功路径；不得用网络 mock 复制业务逻辑。
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** Tasks 1、2（避免并行编辑 `Connectors.tsx`）

**Files:**

- `frontend/workspace/src/components/settings/Connectors.tsx`
- `frontend/workspace/src/components/settings/Credentials.tsx`
- `frontend/workspace/src/components/settings/General.tsx`

**Scope:** M

### Task 4：迁移 Memory、Network 与 Specialists 危险确认

**Description:** 迁移清空记忆、清空自定义域名和删除 specialist 三条独立流程；沿用 Task 1 的危险操作文案和异步状态契约。

**Acceptance:**

- [ ] Memory dialog 显示 global/project 作用域，并明确不可撤销。
- [ ] Network 与 Specialists dialog 显示将被移除的集合或实体名称。
- [ ] 取消、失败、成功均保持原数据刷新语义，不重复提交。
- [ ] 全部 workspace 源码不再出现 `window.prompt/window.confirm`。

**Verification:**

- [ ] `rg -n 'window\.(prompt|confirm)' frontend/workspace/src` 无命中。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings.spec.ts e2e/settings-panels.spec.ts`
- [ ] 仅键盘完成打开、取消、确认和焦点恢复 smoke。

**Dependencies:** Task 1；可与 Tasks 2、3 并行，但不要共享同一工作树提交

**Files:**

- `frontend/workspace/src/components/settings/Memory.tsx`
- `frontend/workspace/src/components/settings/Network.tsx`
- `frontend/workspace/src/components/settings/Specialists.tsx`

**Scope:** M

## Checkpoint

- [ ] Promise dialog 的键盘、焦点、busy、error 契约有组件测试和浏览器测试。
- [ ] `frontend/workspace/src` 中原生 prompt/confirm 为零。
- [ ] OAuth、Credentials、Storage、Memory、Network、Specialists 和 General 的真实取消/成功路径通过。
- [ ] 每个迁移批次均可独立回退，不需要回退共享 helper 的其他消费者。

## Compatibility and rollback

- 共享 helper 保持原 `Promise<boolean|string|null|void>` 返回形状；新能力通过可选字段增加，已有 `session.tsx`、`StagesPanel.tsx`、`AtlasCanvas.tsx` 调用无需同批迁移。
- 四个 Task 分开提交。若某个 Settings 流程回归，只回退该批调用方；Task 1 可继续服务其他已验证调用点。
- Tauri Storage picker 保持首选路径，应用 prompt 只替代 Web fallback，避免桌面端行为变化。
- 紧急回退允许恢复某一调用方旧逻辑，但不得长期保留双提交路径；回退后必须重新标记本计划未完成。

## Risks

| Risk                                    | Impact                  | Mitigation                                               |
| --------------------------------------- | ----------------------- | -------------------------------------------------------- |
| dialog close 与 Promise settle 互相递归 | 重复请求或悬空 Promise  | 集中 `done` guard，组件测试覆盖 Escape/backdrop/按钮竞态 |
| OAuth popup 与 dialog 焦点竞争          | code 无法粘贴或焦点丢失 | popup 打开后再 show dialog；关闭时恢复原触发元素         |
| 把 API 放入 submit 后改变刷新时机       | Settings 列表不同步     | 保留现有成功回调与 refetch，仅移动 busy/error 生命周期   |
| 大批量改 Settings 难回退                | 回归定位困难            | 按文件无重叠的三批提交和 targeted e2e                    |

## Definition of Done

- [ ] 所有 Task acceptance 与 verification 完成。
- [ ] `rg` 证明 workspace 无原生 prompt/confirm。
- [ ] `typecheck` 与 Settings targeted e2e 通过。
- [ ] 从 `backend/cli` 运行完整 `bun test` 通过。
- [ ] 没有用 mock 替代真实 Settings API 流程。
- [ ] 兼容与回退路径已在提交说明中记录。
