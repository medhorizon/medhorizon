# 05 — UI 反馈通道清理：死 Composer 与单一 Toast

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** 15 已完成并冻结 Atlas 退役边界；可与 06、07 的基础任务并行
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 5；在 `tasks/plans/15-atlas-surface-retirement.md` 落地后刷新 `docs/plans/05-ux-polish.md` 中已过时的 Composer 与 Toast 结论

## Current state

- Plan 15 已完成 Atlas 产品面退役：Atlas Canvas、artifact UI、账户与 managed billing UI 已不可达；Stage、Research Graph 和 `atlas/` 下的共享组件继续保留。其 Playwright 与全量 backend coverage 仍有 CI/Linux 验证残留，但不改变本计划的代码边界。
- 当前会话输入器是 `frontend/workspace/src/components/prompt-input.tsx`，由 `frontend/workspace/src/pages/session.tsx` 直接渲染。
- `frontend/workspace/src/atlas/Composer.tsx` 约 1900 行，文件仍存在，但当前源码和 e2e 没有 import 或 JSX 引用；其中模型选择、技能选择和 setup 分支都不是线上路径。
- Plan 15 已新增 `frontend/workspace/script/atlas-reachability.test.ts`，通过 Vite/Rollup 的 `chunk.modules` 验证退役模块不进入 production graph；现有 denylist 尚未包含 `Composer.tsx`。
- `frontend/workspace/src/atlas/Toast.tsx` 是共享工作台 Toast facade，不是 Atlas 产品面。它当前自建全局 signal、计时器、Portal 和样式，`home.tsx` 与 `session.tsx` 各挂一个 `ToastContainer`。
- 当前源码只有 facade 内部使用 `push`/`dismiss` 返回值；业务调用方使用 `info/success/warning/error`，因此可直接采用 kit ID，不需要保留旧字符串 ID 映射。
- 当前没有 facade 之外的 `toast.warning(...)` 调用方；为未来调用直接硬编码 `[警告]` 会引入语言和重复前缀问题，但完全降级为普通标题又会丢失严重度线索。
- 工作台另一批调用已经使用 `@synsci/ui/toast` 的 `showToast`，但 `AppBaseProviders` 尚未渲染 `Toast.Region`。因此仓库同时存在两个队列、两个 API 和不完整的 kit host 接线。
- `@synsci/ui/toast` 已提供 Region、关闭按钮、统一样式和生命周期，可作为唯一事实源；其公开 variant 只有 `default`、`success`、`error`、`loading`，没有 `warning`。
- 当前 `g-composer` 只在死 `Composer.tsx` 和 `atlas.css` 的两组规则中出现；`session.tsx` 没有 Composer import，但两处注释仍用 `composer`/`Composer` 指代线上 `PromptInput`。

## Problem

死 Composer 增加搜索噪音和维护成本，也可能让后续 Agent 误改不可达实现。双 Toast 系统则使同一页面出现重复 host、不同的超时/退出行为和不一致的无障碍语义。两项都属于反馈通道清理，但删除死代码与迁移线上通知必须保持独立边界，并继承 Plan 15 的 allowlist，不能借清理 `atlas/` 路径误删共享能力。

## Goals

1. 复用 Plan 15 的 production reachability collector，证明 `atlas/Composer.tsx` 不可达后只删除该文件，不迁移其中功能。
2. 应用生命周期内只存在一个 `@synsci/ui` Toast Region 和一个队列。
3. 保留现有 `toast.push/dismiss/info/success/warning/error` 方法形状，通过薄兼容层迁移；warning 在 kit 支持专属 variant 前具有轻量、语言中立的严重度标识。
4. 用真实工作台交互证明通知只显示一次、可关闭、会自动消失，并且跨 Home/Session 导航不重复挂载。
5. Stage、Research Graph 及 Plan 15 明确保留的共享工作台组件在清理后仍可达。

## Non-goals

- 不重写 `PromptInput`，不从死 Composer 搬运功能；Task 1 不顺手清理样式，稳定后仅由 Task 5 删除已证明孤立的规则和过时注释。
- 不删除 Plan 15 记录的 `AtlasCanvas.tsx`、`atlas/api/atlas.ts`、`components/settings/Billing.tsx` 或旧 Atlas skill；这些候选需要独立的证据与计划。
- 不清理 `RightPane`、legacy store 或整个 `frontend/workspace/src/atlas/**` 目录。
- 不修改 Stage、Research Graph、Home、Session、FilePreview 或 Skills 的业务行为；只移除页面级 Toast host/import。
- 不扩展 `@synsci/ui` 的 variant，不改 Toast 视觉 token、样式或截图基线；视觉语义增强留给 08。
- 不处理 Settings 原生 dialog；见 06。不建立 AsyncState；见 07。
- 不把 Plan 15 尚未完成的全量 coverage 吸收到本计划；只补跑与本次共享 UI 边界直接相关的回归。

## Plan 15 handoff boundary

| Surface                                                 | Plan 5 decision                           |
| ------------------------------------------------------- | ----------------------------------------- |
| `atlas/Composer.tsx`                                    | 用现有 Rollup collector 补证后删除        |
| `atlas/Toast.tsx`                                       | 保留路径与 facade，内部切到 kit queue     |
| Stage / Research Graph / FilePreview / Skills / icons   | 保留；作为回归保护对象                    |
| Atlas Canvas / artifact API / Billing / old Atlas skill | 不处理；仍属于 Plan 15 cleanup candidates |

## Proposed design

### Reuse the production graph proof

先把 `Composer.tsx` 加入 `script/atlas-reachability.test.ts` 的 retired-module denylist，并在删除前运行一次，确认当前 production graph 已不包含它；再删除文件并重跑同一测试，使该断言成为长期回归护栏。不新增 analyzer、第二份 Vite 配置或基于压缩产物字符串的脆弱 grep。

静态搜索和路由检查只作为辅助证据。Task 1 默认只删除 `Composer.tsx`，避免把死代码删除扩大为 PromptInput 重构；当前已确认的 `.g-composer` 孤立规则和两处注释歧义由 Task 5 在 Task 1 稳定后独立处理。

### One host, one queue

在 `AppBaseProviders` 内、Theme/I18n context 已建立且不会随 Home/Session 路由切换卸载的位置挂载一次 `Toast.Region`。`atlas/Toast.tsx` 保留为兼容 facade，但只把旧调用映射到 `showToast` / `toaster.dismiss`，不再拥有 signal、Portal、计时器、DOM 容器或 ID 映射表。

映射规则冻结如下：

| Legacy kind | Kit options                                                     |
| ----------- | --------------------------------------------------------------- |
| `info`      | `variant: "default"`                                            |
| `success`   | `variant: "success"`                                            |
| `warning`   | `variant: "default"`；标题只添加一次 `⚠ ` 前缀，保留描述和时长 |
| `error`     | `variant: "error"`                                              |

`⚠ ` 是临时、语言中立的文本标识：比硬编码 `[警告]` 更适合当前多语言 context，也能在没有 warning 颜色的情况下保留可见/可朗读线索。映射层只在标题尚未以 `⚠` 开头时添加，避免重复；不修改 description。未来 kit 提供 warning variant 后，在独立 UI 任务中移除该前缀。

`ttl_ms` 未提供时显式使用旧默认值 `4500`；大于 0 时映射为 `duration`；小于等于 0 时映射为 `persistent: true`。参数转换集中到一个模块内纯映射函数，供 facade 和 focused test 复用；该函数不从 workspace barrel 导出。`push` 返回 kit 原生 toast ID，`dismiss` 直接转发给 kit；不为伪装旧字符串 ID 再维护一份状态。

## Implementation tasks

### Task 1：复用 Plan 15 护栏并删除死 Composer

**Description:** 将 `Composer.tsx` 加入既有 Rollup `chunk.modules` denylist，先验证当前 production graph 不可达，再只删除该文件。引用搜索、路由检查和 PromptInput e2e 用于防止误判；不默认修改 `session.tsx` 或 `atlas.css`。

**Acceptance:**

- [ ] 删除前，既有 reachability test 已证明 production graph 不包含 `Composer.tsx`，证据记录到本计划 Progress 或提交说明。
- [ ] `frontend/workspace/src/atlas/Composer.tsx` 已删除，源码和 e2e 中不存在 `atlas/Composer` import 或 `<Composer>`。
- [ ] reachability denylist 永久包含 `Composer.tsx`，同时继续保护 Plan 15 的三个 retired modules 和 Stage/Research Graph allowlist sanity check。
- [ ] `session.tsx` 仍由 `PromptInput` 提供发送、模型选择、技能入口和 setup gate；没有从 Composer 搬运重复实现。
- [ ] Task 1 提交不混入 `session.tsx` 或 `atlas.css` 清理；已确认的连锁残留留给独立 Task 5。

**Verification:**

- [ ] `rg -n 'atlas/Composer|<Composer' frontend/workspace/src frontend/workspace/e2e` 无命中。
- [ ] `(cwd: frontend/workspace) bun test script/atlas-reachability.test.ts`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] `bun run --cwd frontend/workspace build`
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/prompt.spec.ts e2e/model-picker.spec.ts e2e/skills.spec.ts e2e/setup-gate.spec.ts`

**Dependencies:** Plan 15 implemented

**Files:**

- `frontend/workspace/script/atlas-reachability.test.ts`
- `frontend/workspace/src/atlas/Composer.tsx`（删除）

**Scope:** S（1 个测试护栏小改 + 1 个已不可达文件删除）

### Task 2：在应用根安装唯一 Toast Region

**Description:** 在不会随 Home/Session 路由切换卸载的 `AppBaseProviders` 中挂载 kit Region，为现有 `showToast` 和兼容 facade 提供同一个渲染宿主。

**Acceptance:**

- [ ] 任意 Home/Session 路由下 DOM 中恰好有一个 `[data-component="toast-region"]`。
- [ ] Home → Session → Home 导航后 Region 不重复、不丢失。
- [ ] Region 位于现有 Theme/I18n provider 范围内，kit 的关闭按钮可取得翻译与主题。
- [ ] 不在路由、页面或 `atlas/Toast.tsx` 中增加第二个 Region。

**Verification:**

- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] Task 4 Playwright 逐路由断言 `page.locator('[data-component="toast-region"]')` 的数量恒为 1。

**Dependencies:** 无；可与 Task 1 独立实施

**Files:**

- `frontend/workspace/src/app.tsx`

**Scope:** XS（1 个根组件接线）

### Task 3：把旧工作台 Toast 改为 kit 薄兼容层

**Description:** 保留业务侧方法形状，用一个可测试的纯映射函数按冻结规则转发到 `showToast` / `toaster.dismiss`，删除自建队列与两个页面级容器。warning 标题添加一次语言中立的 `⚠ ` 标识；该任务不做全仓调用点重命名，也不修改 UI kit。

**Acceptance:**

- [ ] `atlas/Toast.tsx` 不再包含 `createSignal`、`Portal`、本地 toast 数组、自管 dismiss timer 或 JSX 容器。
- [ ] `home.tsx` 与 `session.tsx` 只删除 `ToastContainer` import/render，业务 `toast.*` 调用保持原位。
- [ ] `toast.push/dismiss/info/success/warning/error` 方法均可用；标题、描述、4500ms 默认值及 `ttl_ms <= 0` 持久语义符合冻结映射。
- [ ] warning 使用 `variant: "default"`，标题恰好包含一个前导 `⚠ `；已有前缀不重复，description 保持原文。
- [ ] `StagesPanel`、FilePreview、RightPane、Home、Session 等现有调用方未因路径含 `atlas/` 被删除或批量改写。
- [ ] 一个业务事件只在唯一 Region 中产生一个 toast。

**Verification:**

- [ ] `rg -n 'createSignal|<Portal|setTimeout' frontend/workspace/src/atlas/Toast.tsx` 无命中。
- [ ] `rg -n 'ToastContainer' frontend/workspace/src/atlas/Toast.tsx frontend/workspace/src/pages` 无命中。
- [ ] `(cwd: frontend/workspace) bun test src/atlas/Toast.test.ts`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] `bun run --cwd frontend/workspace build`

**Dependencies:** Task 2

**Files:**

- `frontend/workspace/src/atlas/Toast.tsx`
- `frontend/workspace/src/atlas/Toast.test.ts`（新增；直接测试生产映射函数，不 mock toaster）
- `frontend/workspace/src/pages/home.tsx`
- `frontend/workspace/src/pages/session.tsx`

**Scope:** M（1 个 facade 简化 + 1 个 focused test + 2 个页面删除 host 接线）

### Task 4：增加真实 Toast 生命周期回归

**Description:** 用现有 Home favorite/unfavorite 或 Session 操作触发真实通知，不通过 `page.evaluate` 直接调用 toaster，不拦截网络，也不复制生产逻辑。验证单 host、内容、关闭、自动消失和跨路由生命周期，并补跑 Plan 15 与共享 UI 边界相关的 Atlas retirement smoke。

**Acceptance:**

- [ ] 一次真实操作只出现一个 `[data-component="toast"]`，标题/描述与操作结果一致，且有可访问的关闭按钮。
- [ ] 点击关闭后 toast 离开 DOM；另一次通知在约 4500ms 后自动消失。
- [ ] toast 显示期间 Home → Session → Home 导航不会生成第二个 Region 或复制同一通知。
- [ ] Stage 与 Research Graph 仍是 Plan 15 保留的可见工作流；Atlas Canvas/产品入口不会因共享 Toast 迁移重新出现。
- [ ] 测试使用仓库真实 local provider/fixture，不新增 mock。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/toast.spec.ts`
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/home-projects.spec.ts e2e/session.spec.ts e2e/atlas-retirement.spec.ts`

**Dependencies:** Tasks 2、3

**Files:**

- `frontend/workspace/e2e/toast.spec.ts`（新增）

**Scope:** S（1 个 focused E2E 文件）

### Task 5：在 Composer 删除稳定后清理已证实的连锁残留

**Description:** Task 1 的 reachability、typecheck、build 和 targeted e2e 全部通过后，再做一个独立的小提交。删除 `atlas.css` 中只由 `.g-composer` 消费的两组规则，并把 `session.tsx` 中实际指向线上输入器的两处 `composer`/`Composer` 注释改称 `PromptInput`。审计 import，但当前没有 Composer import，不为“顺手清理”改动任何运行时代码或仍由 PromptInput 使用的选择器。

**Acceptance:**

- [ ] `frontend/workspace/src` 中不再出现 `g-composer`；只删除 `.g-composer textarea`、`.g-composer` 与 `.g-composer:focus-within` 对应的已孤立规则。
- [ ] `[data-component="prompt-input"]`、`[data-slot="prompt-controls"]` 和 `.session-scroller` 规则完整保留。
- [ ] `session.tsx` 两处输入器注释明确写为 `PromptInput`；无 Composer import、无无关 import/CSS 清理、无运行时代码变化。

**Verification:**

- [ ] `rg -n 'g-composer' frontend/workspace/src frontend/workspace/e2e` 无命中。
- [ ] `rg -n 'prompt-input|prompt-controls|session-scroller' frontend/workspace/src/styles/atlas.css` 仍命中线上选择器。
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] `bun run --cwd frontend/workspace build`
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/prompt.spec.ts e2e/session.spec.ts`

**Dependencies:** Task 1 的全部验证通过；不依赖 Toast Tasks 2–4

**Files:**

- `frontend/workspace/src/styles/atlas.css`
- `frontend/workspace/src/pages/session.tsx`（仅更新两处注释；若实际内容已变化则跳过）

**Scope:** S（2 个文件的证据化删除/注释澄清；独立提交）

## Checkpoint

- [ ] production graph 不包含 `Composer.tsx`，且既有 Atlas retired-module denylist 与 Stage/Research Graph sanity check 均继续通过。
- [ ] `g-composer` 孤立 CSS 已在 Task 1 稳定后独立删除；PromptInput 的 live selectors 保留。
- [ ] 全应用只有 `@synsci/ui/toast` 队列和一个 Region；页面不再挂 Toast host。
- [ ] warning 使用 kit 默认 variant，但标题有且只有一个语言中立的 `⚠ ` 标识。
- [ ] Prompt、Home、Session、Toast 与 Atlas retirement targeted e2e 通过。
- [ ] Stage、Research Graph 和共享 `atlas/` 组件未被目录级清理误伤。
- [ ] 兼容 facade 保持简短，仅负责参数映射；没有第二个 store、timer、Portal 或 ID map。

## Compatibility and rollback

- `toast.*` facade 是本计划的兼容边界；业务调用方可在后续小批量直接改用 `showToast`，本计划不强制迁移。
- Task 1、Task 2、Task 3 分成独立提交。若 Toast 行为回归，只回退 host/facade 提交，不恢复死 Composer；若 Composer 删除回归，只回退 Task 1。
- `warning` 映射到 kit `default` 并添加一次 `⚠ ` 是已知过渡选择；它避免硬编码语言，也不修改 description。需要专属 warning 视觉时由 08 或独立 UI-kit 计划增加并移除前缀，不在本计划恢复自建队列。
- Task 5 必须在 Task 1 验证稳定后独立提交；若发现 `.g-composer` 仍有真实消费者，保留对应规则并把证据回填 Progress，而不是猜测性删除。
- Plan 15 的非 UI `OPENSCIENCE_ENABLE_ATLAS=1` 不会恢复 Atlas UI，也不影响本计划的 Composer/Toast 决策。
- 若 `atlas-retirement.spec.ts` 暴露 Plan 15 已有环境残留，单独记录并归属 Plan 15；除非失败由本次改动直接引起，否则不扩大 Plan 5 范围。

## Risks

| Risk                            | Impact                | Mitigation                                                                 |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| 动态引用未被普通搜索发现        | 删除后运行时缺功能    | 删除前后复用 Rollup `chunk.modules`、typecheck/build 与 prompt/setup e2e   |
| Region 放在路由内部             | 导航后重复或丢 toast  | 只挂在 `AppBaseProviders`；e2e 跨路由计数                                  |
| facade 参数映射丢失语义         | warning/TTL 行为变化  | warning 单次 `⚠ ` + 纯映射测试；显式 4500ms/persistent；生命周期 e2e      |
| warning 前缀硬编码或重复        | 多语言/可读性回归     | 使用语言中立 `⚠ `；只加一次；不修改 description；kit 支持后移除           |
| 为兼容旧 ID 引入映射状态        | 形成第二个隐式 store  | 直接使用 kit ID；`push`/`dismiss` 直接转发                                 |
| 删除名称含 composer 的 live CSS | PromptInput 视觉回归  | 仅删除无其他命中的 `.g-composer`；显式保留三个 live selector；targeted e2e |
| 按 `atlas/` 目录顺手删除        | Stage/RG/共享 UI 回归 | 继承 Plan 15 allowlist；Task 1 只删除 Composer；retirement smoke           |
| Plan 15 E2E 残留与本计划混淆    | 范围膨胀或错误归因    | 只修复由 Plan 5 diff 引起的失败，其余回填 Plan 15 Progress                 |

## Definition of Done

- [ ] Tasks 1–5 的 acceptance、Checkpoint 与 verification 完成。
- [ ] `typecheck`、workspace build、reachability test 和 targeted e2e 通过。
- [ ] 从 `backend/cli` 运行完整 `bun test` 通过。
- [ ] `git diff --check` 与 Markdown 格式检查通过。
- [ ] 没有新增 mock、bundle analyzer、第二个 toast store、页面级 Toast host 或无关 Atlas cleanup。
- [ ] 每个行为变更都有可独立回退的提交边界，实施结果详细回填本计划 Progress。

## Progress

- 2026-08-01：Plan 15 完成后刷新边界。确认 Composer 仍存在但无静态消费者；Toast 是 Plan 15 明确保留的共享组件；Task 1 改为复用既有 Rollup reachability collector；Plan 15 cleanup candidates 不并入本计划。
- 2026-08-01：采纳复审建议。warning 不硬编码 `[警告]`，改为单次语言中立 `⚠ ` 前缀并增加生产映射函数 focused test；新增独立 Task 5，在 Task 1 稳定后删除已确认仅由 Composer 使用的 `.g-composer` CSS，并澄清 `session.tsx` 的 PromptInput 注释。
