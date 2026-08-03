# 06 — Settings Dialog 收敛与原生 prompt/confirm 清理

- **Status:** 🟡 In progress（Task 1 完成并提交 `05f8cf3`；Tasks 2–4 并行中）
- **Priority:** P1
- **Dependencies:** 业务迁移依赖 Task 1；Tasks 2–4 文件无重叠，可在 Task 1 后并行；可与 05、07 并行
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 6；细化 `docs/plans/05-ux-polish.md` 的 Settings 交互项
- **Baseline:** 当前实施分支为 `release/v0.3.15`（2026-08-02 实测），不是 `main`

## Current state

- `frontend/workspace/src/atlas/dialogs.tsx` 已提供 Promise 风格的 `confirmDialog`、`promptDialog` 和 `alertDialog`，返回值分别为 `boolean`、`string | null` 和 `void`。
- 现有 helper 已用 `settled` 守卫避免按钮与 `onClose` 的简单重复 settle，但 `done()` 会再次调用 `dialog.close()`，关闭通知与主动关闭仍相互重入；异步 submit、busy 期间关闭以及 dialog 被另一个 `show()` 替换的竞态尚无契约测试。
- helper 当前使用 `lite` 自绘 `<div>/<button>/<input>`，没有完整复用 `@synsci/ui/dialog`、Button 和 TextField 的焦点陷阱、disabled、校验和错误状态。
- `frontend/ui/src/context/dialog.tsx` 的 `ShowOptions` 只有 `onClose` / `lite`。Escape、backdrop、Kobalte close 和程序化关闭共用同一条无 veto 的 `close()`；`show()` 替换已有 dialog 时会直接 dispose，且不通知原 `onClose`，Promise helper 可能悬空。
- Settings 本身已经占用 DialogProvider 的唯一 `active`；若面板直接调用现有 `dialog.show()` 打开确认框，会替换并卸载整个 Settings。Promise helper 因此需要显式的 nested/stack 模式，不能只把 native confirm 换成当前单 active helper。
- 当前 Settings 实际有 **8** 处原生阻塞调用，而不是旧计划记录的 9 处：
  - `Connectors.tsx`：删除 connector 的 `window.confirm`、OAuth code 的 `window.prompt`；
  - `Credentials.tsx`：两处凭据/Provider key 删除确认；
  - `Memory.tsx`：清空记忆；
  - `Network.tsx`：清空 allowed domains；
  - `Specialists.tsx`：删除自定义 specialist；
  - `Storage.tsx`：Web 环境下输入迁移路径。
- `General.tsx` 当前没有 `window.confirm`，不应为满足旧清单而产生无意义改动。
- MCP OAuth 当前顺序是 `auth.start` → `window.open` → `window.prompt`；迁移必须继续先打开 popup，再显示应用 Dialog，并显式恢复 Authenticate 按钮焦点。
- 各调用方在 mutation 成功后已有同步动作：例如 Connectors 的 config store 更新与 `refresh()`、Credentials 的 service 更新/SDK dispose、Storage 的 `load()`、Specialists 的 `refetch()`。这些顺序是现有可观察契约。
- `frontend/workspace/e2e/settings-providers.spec.ts` 当前用 `page.once("dialog")` 接受原生 Credentials confirm；迁移后若不在同批修改，该测试会等待不存在的浏览器 dialog 而超时。
- 根 `bunfig.toml` 把 test root 指向不存在的 `./do-not-run-tests-from-root`；focused Bun test 必须显式使用 `bun test --cwd frontend/...`，不能从根直接运行。
- workspace 的 14 个现有单测没有渲染 DialogProvider + Kobalte 的先例；workspace 使用 happy-dom，而 `frontend/ui` 已通过自身 `bunfig.toml` 预载 jsdom。模拟 DOM 适合状态/挂载 smoke，真实焦点陷阱、backdrop 和可见刷新必须由 Playwright 判定。
- `promptDialog` 的既有默认契约是：点击确认可返回空字符串 `""`，只有取消/关闭返回 `null`。OAuth/Storage 可以通过可选 `validate` 拒绝空值，但共享 helper 不得全局把空字符串改成 `null`。

## Problem

浏览器原生 prompt/confirm 会阻塞事件循环、脱离主题且无法表达异步 busy/error；直接换成 Promise Dialog 又会引入新的竞态：Escape、backdrop、取消按钮和异步完成可能同时关闭，重复请求、重复 settle 或遗留永不结束的 Promise。若把 API 移进 submit 时顺手改变成功回调/refetch 顺序，还会造成 Settings 列表不同步。

迁移还跨越多个相互独立面板。若 Connectors 的 prompt 与 confirm 分到两个批次，或多个批次反复修改同一 E2E 文件，回归将难以归因和回退。

## Goals

1. 以向后兼容的可选字段扩展 Dialog context，区分“用户请求关闭”和“程序化完成关闭”，并支持 Settings 上方的 nested dialog；确保 busy 可 veto、parent 不卸载、替换已有 dialog 不会悬空 Promise。
2. 建立基于 `@synsci/ui` 的 Promise dialog 契约，支持一次性 settle、焦点陷阱、Escape/backdrop、焦点恢复、校验、busy/disabled 和异步错误保留。
3. 清除 `frontend/workspace/src` 中全部 8 处 `window.prompt/window.confirm`，不修改无原生 dialog 的 General。
4. 将 API 放入 caller-owned submit callback 时，保留原 mutation、成功回调、store 更新、toast/banner 和 refetch 的顺序；只由 helper 接管 submit busy 与可读错误生命周期。
5. 以三个文件无重叠的业务批次迁移，每批有独立专项 E2E 和提交，可并行实施、单独验证和回退。

## Non-goals

- 不改变 MCP OAuth 协议、authorization URL、callback payload 或 popup 页面。
- 不改变凭据存储、Memory/Network schema 或 Storage 迁移 API。
- 不重排 Settings 导航，不统一所有面板字段布局或视觉 token。
- 不把普通 inline error 全部改成 Dialog/Toast，也不同时显示 dialog error 与重复 error toast。
- 不修改 `General.tsx`，除非实施时出现新的、可证明属于本计划的原生 dialog。
- 不引入第二个 Dialog manager、overlay/focus trap 实现或通用队列；只在现有 provider 内增加 opt-in stack 行为，默认 replacement 语义不变。
- 不改全局 Toast、AsyncState 或截图基线；分别见 05、07、08。

## Proposed design

### Additive Dialog context contract

保留现有 `show(element, options?)` 与 `close()` 调用方式，并向 `ShowOptions` 增加可选能力：

| Field / return                | Contract                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mode?: "replace" \| "stack"` | 默认 `replace` 保持现状；Promise helper 使用 `stack`，使 Settings parent 保持挂载且 top dialog 独占交互              |
| `canClose?: () => boolean`    | 仅约束 Escape、backdrop、Kobalte close 和 active-dialog replacement 等用户/外部关闭请求；省略时保持现有可关闭行为    |
| `returnFocus?: HTMLElement`   | top dialog 卸载后恢复焦点到 parent 内触发元素；目标已断开 DOM 时安全跳过，replacement 不抢新 dialog 焦点             |
| `show(...): boolean`          | `true` 表示成功挂载；当现有 busy dialog veto show/replacement 时返回 `false`，Promise helper 必须立即按取消值 settle |

context 内部把 `requestClose()` 与真正的 `close()` 分开：Escape/backdrop/Kobalte close/replacement 先查询 top dialog 的 `canClose`，而 helper 在成功或显式取消完成状态后使用程序化 `close()`。`active` getter 继续返回 top 以兼容旧消费者；`mode: "replace"` 保持现有替换语义，`mode: "stack"` 只为嵌套流程 push 一层。所有关闭来源最多通知一次 `onClose`；parent 在 child 关闭后仍保持原 state/scroll，replacement 在 dispose 旧 owner 前通知旧 dialog。

这些字段均为 additive；现有消费者不传时保持当前行为。Task 1 先用 characterization test 锁定普通 dialog 的打开、关闭和替换行为，再加入 guard，避免修复 Promise helper 时改变其他消费者。

### Promise dialog lifecycle

`confirmDialog`、`promptDialog`、`alertDialog` 保持原返回类型和默认按钮文案，选项只增加可选的 `validate`、异步 `submit`、`danger`、`busyLabel` 与 `returnFocus`。

- helper 使用一个幂等 `done` 状态作为唯一 settle owner；按钮路径负责“settle 后程序化 close”，context `onClose` 路径只 settle，不再次调用 close。
- `confirmDialog.submit` 为 `() => Promise<void>`；`promptDialog.submit` 为 `(value: string) => Promise<void>`。submit resolve 后才返回 `true`/输入值并关闭，reject 时 Promise dialog 本身不 settle，保留输入并显示错误供重试。
- submit pending 时 confirm/cancel/header close disabled，`canClose` 阻止 Escape、backdrop 与 replacement；快速双击只能启动一次 submit。
- `validate` 只处理输入边界，返回可读错误并阻止 submit。省略 `validate` 时，prompt 确认空输入仍 resolve `""`；只有取消/关闭返回 `null`。helper 不理解 SDK、refetch 或业务结果。
- helper 使用 `mode: "stack"`，改用真实 `@synsci/ui/dialog`、Button 和 TextField，不再自建 overlay/focus trap。

### Resolve lite-mode versus focus trapping up front

`lite` 没有 Kobalte root、backdrop、焦点陷阱或 modal 语义，不能满足本计划的可访问性目标；因此迁移后的 Promise helper **不使用 lite**。但 context 已记录 per-dialog Kobalte Portal 曾重排 body siblings，产生“页面刷新”观感，不能忽略该回归。

Task 1 先做 fail-fast browser characterization：在打开的 Settings 上 push 一个最小 non-lite child，记录 parent 是否保持挂载、body child 顺序/数量、页面与 Settings scroll、焦点和截图。若当前 Kobalte Portal 不再复现刷新，则保留标准 non-lite 路径；若仍复现，则在现有 DialogProvider 的稳定 stack mount 内承载 Kobalte root/overlay/content，避免每次向 body 新增/重排 Portal，同时继续使用 Kobalte 的 focus trap。不得退回 lite 再手写第二套焦点陷阱。

happy-dom/jsdom 只验证 close coordinator、stack mount 和 Promise settle smoke。Tab 环、Escape/backdrop、nested Settings 不闪烁及真实 returnFocus 以 `e2e/dialogs.spec.ts` 为权威门槛；测试环境不兼容时不得向生产代码加入仅供模拟 DOM 的分支。

### OAuth popup and focus order

Connectors 的 Authenticate click 先保存 `event.currentTarget`，完成 `auth.start` 后立即 `window.open(authUrl, ...)`，随后才调用 `promptDialog({ returnFocus: trigger })`。Dialog 打开后 code input 获得 autofocus；用户从 popup 返回应用时可直接粘贴。取消、callback 成功或失败后的最终关闭都把焦点恢复到仍在 DOM 中的 Authenticate 按钮。

不依赖 popup handle 完成 OAuth，也不在 Dialog 出现后再调用 `window.open`。popup 被浏览器策略拦截属于既有外部行为，本计划不新增自定义 popup 管理器。

### Submit ownership and refresh order

每个 caller 把原 API mutation 与原 post-success 动作作为同一个 submit callback 传入，顺序保持不变：

1. mutation；
2. 原 store/mutate/dispose 更新；
3. 原 `refresh` / `refetch` / `load`；
4. 原 success toast、banner 或表单关闭回调；
5. submit resolve，Dialog 才关闭。

helper 只管理 submit pending、重复提交屏蔽与错误展示。不得把 refetch 移到 `finally`、提前关闭 Dialog、自动再请求一次，或同时保留旧 API 调用路径。业务错误在 Dialog 中显示原始可读消息；成功侧效应和刷新时机不变。

### Three non-overlapping migration batches

| Batch      | Production files                                           | Dedicated E2E                                                                        |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A / Task 2 | `Connectors.tsx`（OAuth prompt + remove confirm 同批完成） | `settings-connectors-dialogs.spec.ts`                                                |
| B / Task 3 | `Storage.tsx`、`Credentials.tsx`                           | 新增 `settings-sensitive-dialogs.spec.ts`；同步迁移既有 `settings-providers.spec.ts` |
| C / Task 4 | `Memory.tsx`、`Network.tsx`、`Specialists.tsx`             | `settings-destructive-dialogs.spec.ts`                                               |

三个批次不共享 production 或测试文件；Task 1 合并后可在独立工作树并行，最终按 A/B/C 任意顺序合并。每个批次提交后仓库均可独立构建和运行。

## Implementation tasks

### Task 1：硬化 Dialog context 与 Promise helper 契约

**Description:** 先用 jsdom smoke 与 Playwright characterization 锁定现有 context，再增加可选 `mode: "stack"`、`canClose`、`returnFocus` 和 `show(): boolean`。先解决 non-lite Kobalte 的可见刷新门槛，再重构 Promise helper；纯单测覆盖 settle/submit 状态，真实浏览器覆盖 nested modal、焦点和关闭竞态。

**Acceptance:**

- [x] 现有未传新选项的 dialog 打开/关闭行为与 `show` 调用形状兼容；新增字段均可选。
- [x] `mode: "stack"` 打开 child 时 Settings parent 不卸载且 state/scroll 保留；关闭 child 后焦点回到 parent trigger，默认 `replace` 行为不变。
- [x] Escape、backdrop、header close、取消按钮、确认按钮和 active replacement 任意交错时，Promise 恰好 settle 一次；被替换或挂载失败的 helper 不会悬空。
- [ ] submit pending 时重复按钮只执行一次，Escape/backdrop/header close/replacement 均不能关闭；resolve 后关闭，reject 后保留输入和错误并允许重试。（实现已含 `canClose: () => !busy()` 与 busy guard；首个真实 submit 消费者在 Task 2/3，专项 E2E 随该批验收）
- [x] prompt 校验在边界执行；默认确认空输入返回 `""`、取消返回 `null`；confirm/prompt/alert 的原 Promise 返回形状不变。
- [x] Promise helper 使用 non-lite Kobalte 且通过“无 parent 闪烁/重排”浏览器门槛；不新增手写 focus trap 或测试专用生产分支。

**Verification:**

- [x] `bun test --cwd frontend/ui src/context/dialog.test.tsx` → 9 pass / 0 fail
- [x] `bun test --cwd frontend/workspace src/atlas/dialogs.test.ts` → 11 pass / 0 fail
- [x] `bun run --cwd frontend/ui typecheck` → exit 0
- [x] `bun run --cwd frontend/workspace typecheck` → exit 0
- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/dialogs.spec.ts` → 4 passed (23.4s)

**Dependencies:** 无

**Files:**

- `frontend/ui/src/context/dialog.tsx`
- `frontend/ui/src/context/dialog.test.tsx`（新增）
- `frontend/workspace/src/atlas/dialogs.tsx`
- `frontend/workspace/src/atlas/dialogs.test.ts`（新增；测试生产 lifecycle/映射，不在 happy-dom 渲染 Kobalte）
- `frontend/workspace/e2e/dialogs.spec.ts`（新增）

**Scope:** M（2 个实现文件 + 3 个 focused test；不改其他 Dialog 消费者）

### Task 2：单文件迁移 Connectors 的 OAuth 与删除确认

**Description:** 在一个批次内替换 `Connectors.tsx` 的两处原生 dialog。OAuth 保持 popup-before-dialog 和显式 returnFocus；connector 删除把原 mutation、config store 更新、`refresh()` 与 `closeForm()` 顺序原样放入 submit。使用独立 E2E 文件覆盖两个流程。

**Acceptance:**

- [ ] OAuth popup 在 Dialog 前打开；code input 可直接粘贴，取消不调用 callback，callback 失败保留 code/error，关闭后焦点回到 Authenticate 按钮。
- [ ] OAuth callback 成功后仍 `await refresh()` 再关闭；auth start 与 callback 各只请求一次。
- [ ] connector 删除快速双击只发一个 remove；成功后仍依次更新 config store、`await refresh()`、按需 `closeForm()`，失败时 Dialog 保持打开。
- [ ] `Connectors.tsx` 不再存在 `window.prompt/window.confirm`，也不存在 Dialog 外的第二条 callback/remove 路径。

**Verification:**

- [ ] `rg -n 'window\.(prompt|confirm)' frontend/workspace/src/components/settings/Connectors.tsx` 无命中。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings-connectors-dialogs.spec.ts`
- [ ] 使用仓库 local backend/loopback 流程验证 popup → paste → callback、取消、失败、成功和单次请求；不拦截网络复制实现。
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** Task 1

**Files:**

- `frontend/workspace/src/components/settings/Connectors.tsx`
- `frontend/workspace/e2e/settings-connectors-dialogs.spec.ts`（新增）

**Scope:** S（1 个 production 文件 + 1 个专项 E2E）

### Task 3：迁移 Storage 输入与 Credentials 危险确认

**Description:** 用 `promptDialog` 替换 Web Storage path，用 `confirmDialog` 替换 Credentials 的两类删除。Tauri picker 保持首选。每个 submit 保留原 API、service state/SDK dispose、`load()`、status/banner 顺序；同时把既有 `settings-providers.spec.ts` 的原生 `page.once("dialog")` 改为操作应用内 nested Dialog，避免迁移后旧测试超时。

**Acceptance:**

- [ ] Web Storage path 进行非空和绝对路径校验，失败保留输入；Tauri `openDirectoryPickerDialog` 分支不变。
- [ ] Storage mutation 成功后仍先设置原 status，再 `await load()`，然后 Dialog 关闭；失败显示原可读错误，不发重复 POST。
- [ ] 两类 Credentials 删除准确展示目标；成功后仍执行原 `setServices` 或 `global.dispose()`，失败保留 Dialog，快速双击只请求一次。
- [ ] `settings-providers.spec.ts` 不再监听浏览器 `dialog` 事件；它在 Settings parent 保持挂载的前提下确认 child Dialog，并继续验证 provider key 被真实删除。
- [ ] 两个 production 文件不再存在 `window.prompt/window.confirm`，不修改 `General.tsx`。

**Verification:**

- [ ] `rg -n 'window\.(prompt|confirm)' frontend/workspace/src/components/settings/Storage.tsx frontend/workspace/src/components/settings/Credentials.tsx` 无命中。
- [ ] `rg -n 'page\.(once|on)\("dialog"' frontend/workspace/e2e/settings-providers.spec.ts` 无命中。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings-sensitive-dialogs.spec.ts e2e/settings-providers.spec.ts`
- [ ] Web fallback 与 Tauri picker 两条 Storage 分支 smoke；Credentials 使用测试 server 的临时凭据验证取消/失败/成功。
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** Task 1；与 Tasks 2、4 文件无重叠，可并行

**Files:**

- `frontend/workspace/src/components/settings/Storage.tsx`
- `frontend/workspace/src/components/settings/Credentials.tsx`
- `frontend/workspace/e2e/settings-sensitive-dialogs.spec.ts`（新增）
- `frontend/workspace/e2e/settings-providers.spec.ts`（同步替换原生 dialog listener）

**Scope:** M（2 个 production 文件 + 1 个专项 E2E + 1 个既有回归更新）

### Task 4：迁移 Memory、Network 与 Specialists 危险确认

**Description:** 迁移清空记忆、清空自定义域名和删除 specialist。沿用 Task 1 的危险操作与 submit 契约，保留各自 optimistic state、rollback、refetch 和 success toast 行为；专项 E2E 覆盖三条真实流程。

**Acceptance:**

- [ ] Memory Dialog 显示 global/project 作用域并明确不可撤销；原 `persist` 更新顺序和失败恢复不变。
- [ ] Network Dialog 展示将清空的 custom domain 数量；原 optimistic update/rollback 与 saving/error 生命周期不变。
- [ ] Specialists Dialog 展示名称；成功后仍 `await agentsCtl.refetch()` 再显示 success toast，失败保留可读错误，快速双击只请求一次。
- [ ] 三个 production 文件以及整个 workspace 源码不再存在 `window.prompt/window.confirm`。

**Verification:**

- [ ] `rg -n 'window\.(prompt|confirm)' frontend/workspace/src` 无命中。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings-destructive-dialogs.spec.ts`
- [ ] 使用测试 server 的临时 Memory/Network/Specialist 数据验证取消、失败、成功、refetch 和单次请求；不使用网络 mock。
- [ ] `bun run --cwd frontend/workspace typecheck`

**Dependencies:** Task 1；与 Tasks 2、3 文件无重叠，可并行

**Files:**

- `frontend/workspace/src/components/settings/Memory.tsx`
- `frontend/workspace/src/components/settings/Network.tsx`
- `frontend/workspace/src/components/settings/Specialists.tsx`
- `frontend/workspace/e2e/settings-destructive-dialogs.spec.ts`（新增）

**Scope:** M（3 个 production 文件 + 1 个专项 E2E）

## Checkpoint

- [ ] Dialog context 的普通关闭、busy veto、replacement、一次性 `onClose` 与 returnFocus 有组件测试。
- [ ] nested child 打开/关闭时 Settings parent、面板 state 与 scroll 保留；non-lite Kobalte 未产生可见刷新或 body sibling 重排。
- [ ] Promise helper 的 settle/submit 状态由纯单测覆盖；Escape/backdrop/按钮竞态、Tab 环和真实 focus restore 由 Playwright 覆盖。
- [ ] `frontend/workspace/src` 中 8 处原生 prompt/confirm 全部清零，General 保持未修改。
- [ ] `settings-providers.spec.ts` 已改用应用 Dialog，不再等待浏览器原生 `dialog` 事件。
- [ ] OAuth popup-before-dialog、code 保留和焦点恢复通过专项 E2E。
- [ ] 各 mutation 的成功回调、store 更新、toast/banner 与 refetch 顺序无漂移。
- [ ] 三个业务批次无文件重叠，每个 commit 可独立构建、验证和回退。

## Compatibility and rollback

- Dialog context 只增加可选 `mode` / `canClose` / `returnFocus` 和可忽略的 `show()` 布尔返回；默认仍为 `mode: "replace"`，未传选项的现有调用方保持原行为，不建立 v2 context。
- 共享 helper 保持原 `Promise<boolean|string|null|void>` 返回形状；新能力通过可选字段增加，已有 `session.tsx`、`StagesPanel.tsx`、`AtlasCanvas.tsx` 调用无需同批迁移。
- `promptDialog` 未提供 `validate` 时继续允许确认空字符串；OAuth/Storage 的非空规则只存在于各自 caller，避免破坏 AtlasCanvas 等既有消费者。
- Task 1 单独提交；业务迁移严格分为 A/Connectors、B/Storage+Credentials、C/Memory+Network+Specialists 三个无重叠提交，并各自携带专项 E2E。
- 若某批回归，只回退该 production 文件与对应 E2E；其他批次及已验证的共享 helper 不需要回退。
- Tauri Storage picker 保持首选路径，应用 prompt 只替代 Web fallback。
- 紧急回退不得长期恢复双提交路径；恢复某一原生 dialog 后必须把对应 Task 与全局零命中 Checkpoint 重新标为未完成。

## Risks

| Risk                           | Impact                               | Mitigation                                                                                                |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Dialog 关闭和 Promise 回调竞态 | 重复请求、重复 settle 或悬空 Promise | 幂等 `done`；区分 request/programmatic close；replacement 通知；组件测试交错 Escape/backdrop/按钮/resolve |
| busy veto 只写在 helper        | Escape/backdrop 仍能卸载组件         | context 增加 additive `canClose`；pending 测试覆盖所有外部关闭来源                                        |
| Settings child 替换 parent     | 面板状态丢失、删除后无法继续操作     | opt-in `mode: "stack"`；默认 replacement 不变；E2E 断言 parent/state/scroll 保留                          |
| non-lite Kobalte 重现页面刷新  | Settings 闪烁或 scroll 跳变          | Task 1 fail-fast characterization；必要时使用稳定 provider mount，保留 Kobalte、禁止回退手写 focus trap   |
| 模拟 DOM 与真实焦点行为不一致  | 单测通过但浏览器失效                 | workspace 只测纯 lifecycle；UI jsdom 仅 smoke；focus/backdrop/闪烁以 Playwright 为权威                    |
| OAuth popup 与 Dialog 焦点竞争 | code 无法粘贴或焦点丢失              | 捕获触发按钮；popup 先开、Dialog 后 show；显式 `returnFocus`；专项 E2E                                    |
| API 移入 submit 改变刷新时机   | 列表、状态或 toast 不同步            | caller-owned submit 保留 mutation → state → refetch → success 顺序；不把 refetch 移入 finally             |
| mutation 成功但 refetch 失败   | Dialog 留存后重试可能重复 mutation   | 不自动重试；显示原错误并由专项测试记录当前 API 的幂等/恢复行为，必要时刷新后再允许人工重试                |
| 批量改动难回退                 | 回归定位困难                         | 三个 production/E2E 文件均无重叠的批次提交；每批独立 typecheck 与专项 E2E                                 |
| 修改共享 context 影响旧消费者  | 非 Settings Dialog 回归              | 先 characterization；字段全可选；运行现有 Dialog/Setup/FolderPicker targeted smoke                        |

## Definition of Done

- [ ] Tasks 1–4 的 acceptance、Checkpoint 与 verification 全部完成。
- [ ] `rg` 证明 workspace 8 处原生 prompt/confirm 为零，且没有通过别名保留第二条路径。
- [ ] `frontend/ui` 与 workspace typecheck、Dialog component tests、三个 Settings 专项 E2E 通过。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/dialogs.spec.ts e2e/settings-connectors-dialogs.spec.ts e2e/settings-sensitive-dialogs.spec.ts e2e/settings-destructive-dialogs.spec.ts e2e/settings-providers.spec.ts e2e/settings.spec.ts e2e/settings-panels.spec.ts`
- [ ] `bun test --cwd backend/cli` 完整通过；不得从仓库根直接运行 `bun test`。
- [ ] 没有用 mock 替代真实 Settings API 流程，没有新增第二个 Dialog stack/queue。
- [ ] 共享契约与三个迁移批次均有独立提交和回退说明，实施证据详细回填本计划 Progress。

## Progress

- 2026-08-02：复核建议并审计当前代码。确认风险方向均成立；现有 `settled` 仅覆盖简单重入，busy veto 需要最小扩展共享 Dialog context；原生调用实际为 8 处且 General 无命中；将 Connectors 的 prompt/confirm 合并为单文件批次，并为三批业务迁移拆分无重叠专项 E2E。
- 2026-08-02：第二轮可执行性复核——确认当前分支为 `release/v0.3.15`、根 test guard 会阻止直接 `bun test`、`settings-providers.spec.ts` 依赖原生 confirm、默认 prompt 可返回 `""`，且 Settings 已占用唯一 active dialog。计划据此统一 `bun test --cwd`、把旧 provider spec 纳入 Task 3、增加 opt-in nested stack，并将 non-lite 页面刷新与真实焦点验证设为 Task 1 的 fail-fast Playwright 门槛。
- 2026-08-03：Task 1 完成。Dialog context 增加 `mode:"stack"`/`canClose`/`returnFocus`/`show(): boolean`，helper 改为 non-lite Kobalte + kit Dialog/Button/TextField。五个 gate 全部通过（owning session 亲自重跑）：ui context 9/9、workspace helpers 11/11、两个 typecheck exit 0、`e2e/dialogs.spec.ts` 4 passed。e2e body signature 断言 Settings（non-lite）打开/关闭不重排 #root、不丢 scroll、不留 residue；`/undo` 真实调用点 settle-on-Escape/cancel 与真实 revert/redo 通过。commit `05f8cf3`（plans/16-19）。`rg -n 'window\.(prompt|confirm)' frontend/workspace/src` 仍为 8 处生产调用点，待 Tasks 2–4 清零。
