# 08 — 视觉语义系统、截图回归与无障碍基线

- **Status:** 📝 Planned
- **Priority:** P1（token 基础）/ P2（全矩阵 gate）
- **Dependencies:** Tasks 1–3 可先行；截图与 a11y 基线依赖 05、06、07 完成，避免把过渡态固化为 golden
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 8；承接 `docs/plans/05-ux-polish.md` 的 design-system convergence

## Current state

- 工作台同时消费 `@synsci/ui` theme CSS variables 与 `frontend/workspace/src/styles/tokens.ts`/`atlas.css` 的历史工作台 token 层；`atlas.css` 是兼容文件名，不代表 Atlas 产品面仍需保留。
- `tokens.ts` 当前把 `FONT_SANS`、`FONT_SERIF`、`FONT_MONO`、`FONT_UI_SANS` 都指向 Computer Modern；虽然已有 `FONT_CODE`，旧命名仍会诱导代码把 serif UI 文本当成 mono。
- spacing、radius、focus、motion 只有零散常量或 inline literal；Home、Session 和 Settings 代表面存在大量重复的 `4px/8px/12px/120ms`。
- `atlas.css` 已实现 mobile drawer 与 `prefers-reduced-motion`，本轮应保护这些行为而非重新设计。
- Playwright 仅配置单一 Desktop Chromium；仓库没有 `toHaveScreenshot`、稳定 golden、axe 扫描或系统化 light/dark × 360/768/1440 基线。
- e2e 已有真实 backend、seeded session 和确定性模型，可在不 mock UI/API 的前提下构造稳定页面。

## Problem

在没有语义 token 的情况下直接“美化”，会继续堆叠 inline 值；在没有截图/无障碍基线时批量迁移 token，又无法量化是否破坏暗色、移动端、焦点和 reduced motion。两部分应放在同一计划中按依赖串联，但必须是独立任务和提交：先定义/小范围采用 token，再单独建立回归保护。

## Goals

1. 建立 content/ui/code 字体语义以及 spacing、radius、focus、motion token，桥接而不是复制 `@synsci/ui` 主题值。
2. 只在 Home、Session、Settings 三个代表面验证 token；不做全量换肤。
3. 建立 light/dark × 360/768/1440 的稳定 screenshot golden，并把 Linux CI 作为权威渲染环境。
4. 对 Home、Session、Settings 增加 WCAG AA/axe smoke、键盘路径与 reduced-motion/mobile drawer 回归。
5. 让 token 迁移和测试 gate 都能分阶段回退，不因 golden 波动阻塞所有非 UI 工作。

## Non-goals

- 不重设计品牌、logo、信息架构、Landing page 或 Research Graph iframe 内部 UI。
- 不在一个计划内消灭所有 inline style 或旧 `FONT_MONO` 调用。
- 不引入第二套基础色板；品牌/状态色继续来自 `@synsci/ui` theme。
- 不用 screenshot 替代行为断言；05–07 的功能 e2e 仍是事实来源。
- 不在测试中隐藏真实错误、mock backend 或用任意延时“等页面稳定”。

## Proposed design

### Semantic token bridge

- 字体：`FONT_UI`（导航/控件）、`FONT_CONTENT`（长文/报告）、`FONT_CODE`（代码/路径/数值）；旧别名暂时保留并标记 deprecated。
- CSS：`--font-ui/content/code`、`--space-1..6`、`--radius-control/card/modal`、`--duration-fast/normal`、`--ease-standard`、`--focus-ring`。
- 颜色：历史工作台 semantic aliases 只引用现有 `--color-*`/kit theme variables，不复制 light/dark hex。
- JS token object 只用于 inline style 无法直接消费 class 的位置，值仍解析到 CSS variable。

### Visual matrix

专用 `visual-shells.spec.ts` 参数化三个表面、三个 viewport（360×800、768×1024、1440×900）和 light/dark，共 18 张基础 golden。测试显式等待 `document.fonts.ready`、目标数据状态和动画结束条件；不依赖固定 sleep。Linux Chromium golden 为 CI 权威，其他平台快照不覆盖 Linux 文件。

### Accessibility and rollout

用 `@axe-core/playwright` 扫描代表面，阻止 serious/critical 违规，并对焦点环、Dialog 键盘路径、mobile drawer 与 reduced motion 添加显式行为断言。截图/a11y job 先在现有 e2e workflow 手动/夜间稳定两轮，再以 frontend path filter 加入 PR gate。

## Implementation tasks

### Task 1：定义语义 token 契约与兼容别名

**Description:** 在 TS 与 CSS 两层建立单向桥接，明确三类字体和 spacing/radius/focus/motion；保留旧 export 作为兼容别名，不在此任务迁移页面。

**Acceptance:**

- [ ] `FONT_UI`、`FONT_CONTENT`、`FONT_CODE` 含义明确；`FONT_MONO` 不再被文档描述为推荐 UI 字体。
- [ ] spacing、radius、focus、motion 有命名 token，且值来自 CSS variable/kit theme，不复制第二套 light/dark 色值。
- [ ] reduced-motion 覆盖 token duration，现有 drawer 规则不被删除。
- [ ] 旧 `FONT_SANS/SERIF/MONO/UI_SANS` export 暂时可编译，并带迁移说明。

**Verification:**

- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] `bun run --cwd frontend/workspace build`
- [ ] light/dark 下检查 token computed values 均非空；`prefers-reduced-motion: reduce` 下 motion token 接近 0。

**Dependencies:** 无

**Files:**

- `frontend/workspace/src/styles/tokens.ts`
- `frontend/workspace/src/styles/atlas.css`

**Scope:** M

### Task 2：在 Home 与 Session 壳层采用 token

**Description:** 迁移 AppHeader、Home 主壳和 Session 主壳的字体、间距、圆角、focus 与 motion literal；只改壳层和交互控件，不深入 Message renderer 或科学文件 viewer。

**Acceptance:**

- [ ] 导航/按钮使用 UI 字体，路径/代码/数值使用 code 字体，长文区域保留 content 字体。
- [ ] 代表控件的 spacing/radius/focus/motion 不再硬编码重复值。
- [ ] focus-visible 清晰且不只依靠颜色；PromptInput 自有 focus 规则仍有效。
- [ ] 360/768/1440 下 header、prompt dock、中心区没有遮挡或不可达操作。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/home.spec.ts e2e/session.spec.ts e2e/sidebar.spec.ts e2e/prompt.spec.ts`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 仅键盘完成 Home 打开项目、Session 聚焦 prompt 与打开主要导航。

**Dependencies:** Task 1；不依赖 screenshot task

**Files:**

- `frontend/workspace/src/atlas/AppHeader.tsx`
- `frontend/workspace/src/pages/home.tsx`
- `frontend/workspace/src/pages/session.tsx`

**Scope:** M

### Task 3：在 Settings 壳层与共享 primitive 采用 token

**Description:** 迁移 Settings dialog、导航和 `_shared.tsx` 原语。具体面板继续复用共享 primitive，避免逐面板大爆炸；06 的 dialog 行为先稳定后再截 baseline。

**Acceptance:**

- [ ] Settings 标题、label、field、row、card、导航 focus 使用语义 token。
- [ ] light/dark 中边框、错误、disabled、danger 对比度可读；不新增面板级重复色值。
- [ ] dialog 在 360px 为可滚动/可操作布局，在 768/1440 不出现横向溢出。
- [ ] 本任务不改变 Settings API 调用或保存行为。

**Verification:**

- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/settings.spec.ts e2e/settings-panels.spec.ts`
- [ ] `bun run --cwd frontend/workspace typecheck`
- [ ] 浏览器检查 360/768/1440 与 light/dark 六种组合。

**Dependencies:** Task 1；06 完成后执行最终视觉验收

**Files:**

- `frontend/workspace/src/components/settings/_shared.tsx`
- `frontend/workspace/src/components/settings/nav.tsx`
- `frontend/workspace/src/components/dialog-settings.tsx`

**Scope:** M

### Task 4：建立 18 张代表面 screenshot golden

**Description:** 增加专用视觉 helper/spec 和稳定 snapshot path。使用真实 seed 数据，等待 fonts/data readiness，参数化 Home/Session/Settings × 三 viewport × 两主题；golden 更新必须是显式命令。

**Acceptance:**

- [ ] 18 个命名 snapshot 全部存在：`{home,session,settings}-{360,768,1440}-{light,dark}.png`。
- [ ] 测试不使用任意 sleep、网络 mock、隐藏错误 banner 或动态改写产品 CSS。
- [ ] 截图前等待 self-hosted fonts 与目标 ready selector；光标/时间等不可控区域用 Playwright mask 且逐项注释原因。
- [ ] CI 失败输出 expected/actual/diff；普通测试运行不会自动更新 golden。
- [ ] mobile drawer 与桌面 pane 的可见状态由真实交互建立，不靠直接改 DOM class。

**Verification:**

- [ ] 首次权威生成：`bun run --cwd frontend/workspace test:e2e -- e2e/visual-shells.spec.ts --update-snapshots`
- [ ] 干净复跑：`bun run --cwd frontend/workspace test:e2e -- e2e/visual-shells.spec.ts`
- [ ] 连续两次 Linux Chromium 运行无 diff。

**Dependencies:** Tasks 1–3；05、06、07 完成

**Files:**

- `frontend/workspace/playwright.config.ts`
- `frontend/workspace/e2e/visual.ts`（新增）
- `frontend/workspace/e2e/visual-shells.spec.ts`（新增）
- `frontend/workspace/e2e/visual-shells.spec.ts-snapshots/`（18 个命名 PNG，机械生成）

**Scope:** M（测试代码 3 文件；golden 为机械产物）

### Task 5：增加 axe、键盘、reduced-motion 与 CI gate

**Description:** 引入官方 Playwright axe binding，扫描代表面并补充非像素行为断言；将 visual/a11y 组接入现有 e2e workflow，先观察后用 frontend path filter 作为 PR gate。

**Acceptance:**

- [ ] Home、Session、Settings 在 light/dark 下没有 serious/critical axe violation；文本与交互控件满足 WCAG AA 对比度。
- [ ] 仅键盘可进入/退出主要 dialog、操作 prompt、打开/关闭移动 drawer，焦点顺序和恢复正确。
- [ ] `reducedMotion: reduce` 下现有 drawer/overlay 没有长动画，功能与最终布局不变。
- [ ] e2e workflow 在失败时上传 screenshot diff、trace 与 axe 报告；golden 更新不是 CI 自动行为。
- [ ] 两轮 nightly/manual 全绿后，frontend 相关 PR 必须通过 visual/a11y job；其他路径不承担无关 browser 成本。

**Verification:**

- [ ] `bun install` 后 lockfile 无意外依赖漂移。
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/accessibility.spec.ts`
- [ ] `bun run --cwd frontend/workspace test:e2e -- e2e/visual-shells.spec.ts`
- [ ] 手动触发 `.github/workflows/e2e.yml`，确认成功与故意 diff 失败两种 artifact。

**Dependencies:** Task 4；06、07 完成

**Files:**

- `frontend/workspace/e2e/accessibility.spec.ts`（新增）
- `frontend/workspace/package.json`
- `bun.lock`
- `.github/workflows/e2e.yml`

**Scope:** M

## Checkpoint

- [ ] token 定义与三组代表面迁移分开提交，旧 alias 仍保证未迁移页面兼容。
- [ ] 18 张 golden 在连续两次 Linux Chromium 运行中稳定。
- [ ] Home、Session、Settings 的 axe、键盘、mobile drawer 与 reduced-motion smoke 通过。
- [ ] snapshot 更新有明确人工评审流程；CI 只比较，不重写。

## Compatibility and rollback

- 旧字体常量和旧 CSS variable 在本阶段保留为 deprecated alias；待全仓调用完成后另立删除计划，不在本轮制造大爆炸。
- Tasks 2、3 按表面独立提交。视觉回归可只回退对应表面迁移，不回退 token contract。
- visual/a11y gate 先 nightly/manual 观察两轮；若环境噪声阻塞 PR，可暂时回退 required 状态并保留测试与 artifacts，修复稳定性后再启用。
- Linux golden 是权威；Windows/macOS 本地生成物不得覆盖 Linux baseline。需要跨平台 baseline 时另行显式增加项目。
- token 值变更必须伴随 snapshot diff 和设计审阅；紧急 rollback 优先恢复 token 值/表面提交，不批量接受新 golden。

## Risks

| Risk                                 | Impact          | Mitigation                                                     |
| ------------------------------------ | --------------- | -------------------------------------------------------------- |
| token 层变成第二套 theme             | light/dark 漂移 | 只做 semantic alias，颜色引用 kit variables                    |
| 字体/抗锯齿导致 snapshot 抖动        | CI 假失败       | self-hosted fonts、`document.fonts.ready`、Linux 权威 baseline |
| 18 张图评审负担大                    | diff 被机械接受 | 固定三表面/三 viewport/两主题，命名清晰，禁止自动更新          |
| 动态 session 内容不稳定              | golden 波动     | 使用 seeded session/确定性模型，mask 仅限有注释的不可控区域    |
| axe 一次暴露过多历史问题             | gate 无法落地   | serious/critical 先阻断，其余分级建债；不 blanket-disable rule |
| token 迁移破坏 mobile/reduced motion | 核心操作不可达  | 行为断言与截图分开，保留现有 drawer/motion 规则                |

## Definition of Done

- [ ] 所有 Task acceptance 与 verification 完成。
- [ ] `typecheck`、build、targeted behavior e2e、visual 和 accessibility suite 通过。
- [ ] 从 `backend/cli` 运行完整 `bun test` 通过。
- [ ] baseline diff 已经人工审阅，CI 没有自动更新 snapshot。
- [ ] 未迁移页面通过兼容 alias 保持行为，回退策略已验证。
- [ ] 没有新增网络 mock、第二套颜色主题或全量换肤提交。
