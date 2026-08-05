# 08 — 视觉语义系统、截图回归与无障碍基线

- **Status:** 🟡 In progress（Tasks 1–4 已实现并完成定向验证；Tasks 5–6 等待 07、正式 golden 与 gate）
- **Priority:** P1（token 基础）/ P2（全矩阵 gate）
- **Dependencies:** 05、06 已完成，Tasks 1–4 可先行；正式 golden 与 required gate 等待 07 完成。等待期间只上传非阻断观察截图，不提交“临时 golden”
- **Source:** `tasks/plan.md` Phase 1 / 原 Task 8；承接 `docs/plans/05-ux-polish.md` 的 design-system convergence

## Current state（实施前基线）

- 工作台同时消费 `@synsci/ui` theme CSS variables 与 `frontend/workspace/src/styles/tokens.ts`/`atlas.css` 的历史工作台 token 层；`atlas.css` 是兼容文件名，不代表 Atlas 产品面仍需保留。
- `tokens.ts` 当前把 `FONT_SANS`、`FONT_SERIF`、`FONT_MONO`、`FONT_UI_SANS` 都指向 Computer Modern；虽然已有 `FONT_CODE`，旧命名仍会诱导代码把 serif UI 文本当成 mono。
- spacing、radius、focus、motion 只有零散常量或 inline literal；Home、Session 和 Settings 代表面存在大量重复的 `4px/8px/12px/120ms`。
- `atlas.css` 已实现 mobile drawer 与 `prefers-reduced-motion`，本轮应保护这些行为而非重新设计。
- `@synsci/ui` 已提供 `--font-family-*`、`--spacing`、`--radius-*`、`--duration-*`、`--ease-*` 与 `--shadow-xs-border-focus`；`atlas.css` 仍以本地 px 值覆盖部分 spacing/radius/font 变量，迁移必须消除这些双轨定义，而不是再加一组数值。
- Playwright 仅配置单一 Desktop Chromium，当前 `workers: 1`、CI `retries: 2`，现有 e2e job 上限 60 分钟；直接把 visual/a11y 塞进同一 project 会放大时长与重试噪声。
- 主题 context 默认 `ColorScheme = system`，由 `prefers-color-scheme` 解析 light/dark，再把 `data-theme`、`data-color-scheme` 与 injected theme style 写到根元素；仅依赖当前默认值会让未来默认模式变化时暗色矩阵静默失效。
- Session 默认打开 Research Graph 右面板，消息 Markdown/代码/数学会异步加载 Shiki 与 KaTeX，侧栏时间为相对时间，prompt dock 和右面板状态也受持久化数据影响；通用 seeded session 不足以直接作为稳定 golden fixture。
- 仓库尚无 `toHaveScreenshot`、稳定 golden、axe 扫描或系统化 light/dark × 360/768/1440 基线。
- e2e 已有真实 backend、seeded session 和确定性模型，可在不 mock UI/API 的前提下构造稳定页面。

## Problem

在没有语义 token 的情况下直接“美化”，会继续堆叠 inline 值；在没有截图/无障碍基线时批量迁移 token，又无法量化是否破坏暗色、移动端、焦点和 reduced motion。两部分应放在同一计划中按依赖串联，但必须是独立任务和提交：先定义/小范围采用 token，再单独建立回归保护。

## Goals

1. 建立 content/ui/code 字体语义以及 spacing、radius、focus、motion token，桥接而不是复制 `@synsci/ui` 主题值。
2. 只在 Home、Session、Settings 三个代表面验证 token；不做全量换肤。
3. 建立 light/dark × 360/768/1440 的 18 张基础 screenshot golden，加上 Session 移动 drawer 打开态的 2 张交互 golden，并把 Linux CI 作为权威渲染环境。
4. 对 Home、Session、Settings 增加 WCAG AA/axe smoke、键盘路径与 reduced-motion/mobile drawer 回归。
5. 让 token 迁移和测试 gate 都能分阶段回退，不因 golden 波动阻塞所有非 UI 工作。

## Non-goals

- 不重设计品牌、logo、信息架构、Landing page 或 Research Graph iframe 内部 UI。
- 不在一个计划内消灭所有 inline style 或旧 `FONT_MONO` 调用。
- 不引入第二套基础色板；品牌/状态色继续来自 `@synsci/ui` theme。
- 不用 screenshot 替代行为断言；05–07 的功能 e2e 仍是事实来源。
- 不在测试中隐藏真实错误、mock backend 或用任意延时“等页面稳定”。
- 本轮不把 Windows `forced-colors`/高对比度模式设为阻断 gate；先记录为后续无障碍债，但新 focus token 不得移除系统 outline 兜底。

## Proposed design

### Semantic token bridge

- 字体：`FONT_UI`（导航/控件）、`FONT_CONTENT`（长文/报告）、`FONT_CODE`（代码/路径/数值）；旧别名暂时保留并标记 deprecated。TS 常量只返回对应 CSS variable，不再复制字体栈。
- 字体 fallback 固定为：UI → `var(--font-family-sans, "Computer Modern", "Latin Modern Roman", Georgia, "Times New Roman", serif)`；content → `var(--font-family-serif, "Computer Modern", "Latin Modern Roman", Georgia, "Times New Roman", serif)`；code → `var(--font-family-mono, "IBM Plex Mono", "IBM Plex Mono Fallback", ui-monospace, monospace)`。三类元素都进入 golden，另由真实浏览器 token contract 测试检查 computed stack 的顺序。
- spacing 不持有本地原子值：`--space-1..8` 分别映射 `calc(var(--spacing) * 1/2/3/4/6/8/12/16)`；radius 映射 `--radius-control: var(--radius-md)`、`--radius-card: var(--radius-lg)`、`--radius-modal: var(--radius-xl)`。
- motion 直接桥接 kit：`--motion-fast: var(--duration-fast)`、`--motion-normal: var(--duration-slow)`、`--motion-ease: var(--ease-standard)`、`--motion-enter-ease: var(--ease-out-expo)`；不在工作台重定义 kit 的原始 duration/easing。`prefers-reduced-motion: reduce` 只把工作台 motion alias 压到 `1ms`。
- focus 使用 `--focus-ring: var(--shadow-xs-border-focus)`，保留多层 outline/box-shadow 形状提示，不只依靠颜色。
- 颜色：历史工作台 semantic aliases 只引用现有 `--color-*`/kit theme variables，不复制 light/dark hex。
- JS token object 只用于 inline style 无法直接消费 class 的位置，值仍解析到 CSS variable。

映射的所有上游变量均由 `frontend/ui/src/styles/theme.css` 持有；Task 1 的 token contract 测试在 light/dark/reduced-motion 三种上下文中验证变量非空与映射关系，防止本地层悄悄重新拥有原子尺度。

### Visual matrix

专用 `visual-shells.spec.ts` 参数化三个表面、三个 viewport（360×800、768×1024、1440×900）和 light/dark，共 18 张基础 golden；Session 在 360 下另有 light/dark drawer-open 两张交互 golden，共 20 张。Home 与 Settings 没有同构 drawer，不制造虚假状态凑矩阵。

共享 `waitForVisualReady(page, root)` 依次等待 `document.fonts.ready`、表面 `data-visual-ready`/数据 selector、`root.getAnimations({ subtree: true })` 无 `pending`/`running` 动画，并确认连续两个 animation frame 的 root bounds 不变。CSS transition 由 Web Animations API 统一观察；只有无法被该 API 暴露的 JS 动效才允许增加 `data-animating`，并必须在 helper 旁写明原因。测试不使用固定 sleep，也不让各 spec 自行实现稳定化逻辑。

light/dark 不是截图命名参数而已：每个 scheme 的 `test.describe` 显式使用 `test.use({ colorScheme: "light" | "dark" })`，并在首个导航前把应用的 `openscience-color-scheme` 固定为 `system`。ready helper 必须断言根元素最终的 `data-theme` 非空、`data-color-scheme` 等于期望 scheme、computed `color-scheme` 一致；任一不符即失败，不能生成“名为 dark、实际为 light”的 golden。

Session 使用 worker-scoped 专用固定 fixture：通过真实 SDK 与确定性模型只创建一次固定标题和固定 Markdown 内容，所有组合只读复用；内容同时包含普通长文、Shiki 代码块与 KaTeX 公式。截图前等待 `.shiki`、`.katex`、session idle 与 prompt dock ready，清空并 blur prompt，关闭所有浮层；Research Graph 右面板通过真实“hide panel”操作折叠并断言 iframe 不可见。Home/Session 的相对时间使用稳定 selector 加入命名 mask，不掩盖消息正文、错误状态或 prompt dock。

Linux Chromium golden 为唯一权威。普通 CI 只能比较；更新由专用 `workflow_dispatch` Linux job 以 `VISUAL_BASELINE_UPDATE=1 bun run --cwd frontend/workspace visual:update` 生成并上传候选 artifact，人工审阅后再提交，workflow 本身不 push。更新脚本同时要求 Linux 与显式环境变量，Windows/macOS 直接失败。snapshot 目录的 `README.md` 记录镜像/browser 版本、生成命令、审阅流程和 mask registry；mask 只用稳定 selector，不用坐标，每项在 `visual.ts` 中带名称与原因。

### Accessibility and rollout

用 `@axe-core/playwright` 扫描代表面，且必须在同一 `waitForVisualReady` 之后运行；只阻止 serious/critical 违规，其余按规则、表面和影响分级输出债务报告。对焦点环、Dialog 键盘路径、mobile drawer 与 reduced motion 添加显式行为断言。axe 无法覆盖图片/渐变背景上的全部文本对比度，因此 golden 审阅清单增加人工 WCAG AA 对比度检查；Windows `forced-colors` 另记后续债。

Tasks 1–4 与 axe smoke 不等待 07；在 07 完成前，夜间/手动运行只上传当前截图 artifact 作观察，不建立可比较 baseline。07 完成后再生成正式 golden，连续两轮稳定才通过 frontend path filter 升为 PR gate。这样保留早期信号，又避免“临时”基线长期滞留。

### Execution isolation and budget

新增独立 `visual-a11y` Playwright project，只匹配 `visual-shells` 与 `accessibility` specs；保持组内 `workers: 1`/串行并设 `retries: 0`，现有行为 project 保留原重试策略、继续承载轻量 token-contract，并明确忽略两类重型 spec。`test`/`test:e2e:behavior` 只选行为 project，`test:e2e:visual`/`visual:update` 只选 visual-a11y，避免默认运行全部 projects。CI 使用独立 `visual-a11y` job，与行为 e2e 并行运行、独立上传 artifacts，`timeout-minutes` 固定为 10。正式 gate 前须在冷 Linux runner 上连续两轮于 10 分钟内完成；超时先优化 fixture/导航复用，不能把 visual/a11y 重新并入 60 分钟行为 job。

## Progress（2026-08-03）

- Tasks 1–3 的 token/壳层迁移与 Task 4 的稳定化、axe、键盘和 reduced-motion smoke 已实现。定向证据：token contract 4/4、Home/Session 行为 8/8、Settings 行为 2/2；visual-a11y 观察运行 23/23（约 2.3 分钟，含 light/dark axe、18 个壳层场景、2 个 drawer 状态和 reduced-motion）。上述命令均以 600000ms（10 分钟）超时执行。
- 正式 20 张 Linux golden、候选更新审阅和 required gate 仍待 07 完成及两轮冷 runner 稳定观察；观察模式只上传 artifact，不把过渡截图写入 baseline。

## Implementation tasks

### Task 1：定义语义 token 契约与兼容别名

**Description:** 在 TS 与 CSS 两层建立单向桥接，明确三类字体和 spacing/radius/focus/motion；保留旧 export 作为兼容别名，不在此任务迁移页面。

**Acceptance:**

- [x] `FONT_UI`、`FONT_CONTENT`、`FONT_CODE` 含义明确；`FONT_MONO` 不再被文档描述为推荐 UI 字体。
- [x] `--font-ui/content/code`、`--space-1..8`、`--radius-control/card/modal`、`--motion-*` 与 `--focus-ring` 按上表精确桥接 kit 变量；工作台不再以 px/rem/cubic-bezier 重新拥有同一原子值。
- [x] UI/content/code fallback 栈顺序固定，且实际页面中三类代表元素的 computed `font-family` 均非空。
- [x] reduced-motion 覆盖 token duration，现有 drawer 规则不被删除。
- [x] 旧 `FONT_SANS/SERIF/MONO/UI_SANS` export 暂时可编译，并带迁移说明。

**Verification:**

- [x] `bun run --cwd frontend/workspace typecheck`
- [x] `bun run --cwd frontend/workspace build`
- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/token-contract.spec.ts`
- [x] token contract 在 light/dark 下检查映射与 computed values；`prefers-reduced-motion: reduce` 下 `--motion-fast/normal` 为 `1ms`。

**Dependencies:** 无

**Files:**

- `frontend/workspace/src/styles/tokens.ts`
- `frontend/workspace/src/styles/atlas.css`
- `frontend/workspace/e2e/token-contract.spec.ts`（新增）

**Scope:** M

### Task 2：在 Home 与 Session 壳层采用 token

**Description:** 迁移 AppHeader、Home 主壳和 Session 主壳的字体、间距、圆角、focus 与 motion literal；只改壳层和交互控件，不深入 Message renderer 或科学文件 viewer。

**Acceptance:**

- [x] 导航/按钮使用 UI 字体，路径/代码/数值使用 code 字体，长文区域保留 content 字体。
- [x] 代表控件的 spacing/radius/focus/motion 不再硬编码重复值。
- [x] focus-visible 清晰且不只依靠颜色；PromptInput 自有 focus 规则仍有效。
- [x] 360/768/1440 下 header、prompt dock、中心区没有遮挡或不可达操作。
- [x] Home/Session 提供稳定的 surface-ready selector；相对时间节点有专用 `data-slot` 可供 mask registry 引用，不按文本或坐标定位。

**Verification:**

- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/home.spec.ts e2e/session.spec.ts e2e/sidebar.spec.ts e2e/prompt.spec.ts`（8/8）
- [x] `bun run --cwd frontend/workspace typecheck`
- [x] 仅键盘完成 Home 打开项目、Session 聚焦 prompt 与打开主要导航。

**Dependencies:** Task 1；不依赖 screenshot task

**Files:**

- `frontend/workspace/src/atlas/AppHeader.tsx`
- `frontend/workspace/src/pages/home.tsx`
- `frontend/workspace/src/pages/session.tsx`

**Scope:** M

### Task 3：在 Settings 壳层与共享 primitive 采用 token

**Description:** 迁移 Settings dialog、导航和 `_shared.tsx` 原语。具体面板继续复用共享 primitive，避免逐面板大爆炸；06 的 dialog 行为先稳定后再截 baseline。

**Acceptance:**

- [x] Settings 标题、label、field、row、card、导航 focus 使用语义 token。
- [x] light/dark 中边框、错误、disabled、danger 对比度可读；不新增面板级重复色值。
- [x] dialog 在 360px 为可滚动/可操作布局，在 768/1440 不出现横向溢出。
- [x] 本任务不改变 Settings API 调用或保存行为。
- [x] Settings dialog 提供稳定的 surface-ready selector，不以固定延时判定可截图/可扫描。

**Verification:**

- [x] `bun run --cwd frontend/workspace test:e2e -- e2e/settings.spec.ts e2e/settings-panels.spec.ts`（2/2）
- [x] `bun run --cwd frontend/workspace typecheck`
- [x] 浏览器检查 360/768/1440 与 light/dark 六种组合。

**Dependencies:** Task 1；06 已完成

**Files:**

- `frontend/workspace/src/components/settings/_shared.tsx`
- `frontend/workspace/src/components/settings/nav.tsx`
- `frontend/workspace/src/components/dialog-settings.tsx`

**Scope:** M

### Task 4：提前建立稳定化、axe 与交互 smoke

**Description:** 在 07 完成前先落地共享稳定化 helper、代表面 axe 扫描和键盘/reduced-motion 行为断言。visual spec 此阶段可在 manual/nightly 观察模式上传当前截图 artifact，但不提交或比较临时 baseline。

**Acceptance:**

- [x] `waitForVisualReady` 统一等待 fonts、表面 ready selector、Web Animations API 静止和连续两帧 bounds 稳定；各 spec 不复制等待逻辑，也不使用固定 sleep。
- [x] light/dark describe 均显式 `test.use({ colorScheme })`，导航前固定应用 scheme 为 `system`，并断言 `data-theme`、`data-color-scheme` 与 computed `color-scheme` 后才截图或运行 axe。
- [x] Home、Session、Settings 在显式 light/dark 和页面稳定后运行 axe，没有 serious/critical violation；其他等级写入结构化债务报告。
- [x] worker-scoped Session fixture 通过真实 SDK/确定性模型只创建一次固定标题/Markdown并只读复用，至少渲染一段长文、一个 `.shiki` 代码块与一个 `.katex` 公式；截图前均已 ready。
- [x] Session 截图前 prompt 为空且失焦、浮层关闭、session idle；Research Graph 通过真实“hide panel”操作折叠并断言 iframe 不可见。
- [x] Home/Session 相对时间通过命名 selector mask；mask 不覆盖消息正文、错误 banner、prompt dock 或整个 sidebar。
- [x] 新增 `visual-a11y` Playwright project 与 `test:e2e:behavior`、`test:e2e:visual`、`visual:update` 脚本；默认 `test` 只运行行为 project，visual project 只收集 visual/accessibility specs，token-contract 保持在轻量行为 project。
- [x] 仅键盘可进入/退出主要 dialog、操作 prompt、打开/关闭 Session 移动 drawer，关闭后焦点恢复到触发器。
- [x] `reducedMotion: reduce` 下 drawer/overlay 的 computed motion alias 为 `1ms`，功能与最终布局不变。
- [x] axe 可检测的文本/控件对比度通过；图片/渐变背景等自动化盲区进入人工 golden 审阅清单，Windows `forced-colors` 进入明确后续债。
- [x] 观察模式上传当前截图与 axe 报告但不创建 versioned golden，不会成为 PR required gate。

**Verification:**

- [x] 从仓库根运行 `bun install` 后，根目录 `bun.lock` 只有预期的 `@axe-core/playwright` 等依赖变化。
- [x] `bun run --cwd frontend/workspace test:e2e:visual -- e2e/accessibility.spec.ts`
- [x] manual/nightly 观察运行完成，artifact 中包含三个表面的截图与 axe 报告（visual-a11y 23/23，约 2.3 分钟）。

**Dependencies:** Tasks 1–3；05、06 已完成；不等待 07

**Files:**

- `frontend/workspace/e2e/visual.ts`（新增）
- `frontend/workspace/e2e/visual-shells.spec.ts`（新增）
- `frontend/workspace/e2e/accessibility.spec.ts`（新增）
- `frontend/workspace/playwright.config.ts`
- `frontend/workspace/package.json`
- `bun.lock`（仓库根）

**Scope:** M

### Task 5：冻结 20 张正式 screenshot golden

**Description:** 07 完成后，用 Task 4 的真实 seeded 数据和统一 ready helper 冻结 Home/Session/Settings 基础矩阵，再补 Session 360 drawer-open 的 light/dark 交互态；为 baseline 增加生成环境与 mask 文档。

**Acceptance:**

- [ ] 18 个基础 snapshot 存在：`{home,session,settings}-{360,768,1440}-{light,dark}.png`。
- [ ] 2 个补充 snapshot 存在：`session-360-{light,dark}-drawer-open.png`；drawer 由点击真实触发器打开，等待 transition 静止后截图，不直接改 DOM class。
- [ ] 每个 golden 名称中的 light/dark 都由显式 Playwright `colorScheme` 与根元素 scheme 断言证明，不依赖 ThemeProvider 当前默认值。
- [ ] Session 的 6 个基础 viewport/theme 组合与 2 个 drawer-open 组合复用同一固定 fixture、Shiki/KaTeX readiness、prompt 状态和折叠 graph 契约。
- [ ] 测试不使用任意 sleep、网络 mock、隐藏错误 banner 或动态改写产品 CSS。
- [ ] 光标/时间等不可控区域只通过 `visual.ts` 的命名 mask registry 处理；每项使用稳定 selector 并记录原因，禁止坐标 mask。
- [ ] snapshot `README.md` 记录 Linux 镜像、Chromium/Playwright 版本、生成命令、20 张矩阵、人工对比度检查和 mask registry。
- [ ] 普通测试与普通 CI 不能更新 golden；更新脚本在非 Linux 或缺少 `VISUAL_BASELINE_UPDATE=1` 时失败。

**Verification:**

- [ ] 专用 Linux `workflow_dispatch` 以 `VISUAL_BASELINE_UPDATE=1 bun run --cwd frontend/workspace visual:update` 生成候选 baseline artifact，人工审阅后提交；workflow 不 push。
- [ ] `bun run --cwd frontend/workspace test:e2e:visual -- e2e/visual-shells.spec.ts`
- [ ] 连续两次 Linux Chromium 运行 20 张均无 diff，失败时输出 expected/actual/diff。

**Dependencies:** Tasks 2–4；07 完成

**Files:**

- `frontend/workspace/playwright.config.ts`
- `frontend/workspace/package.json`
- `frontend/workspace/e2e/visual-shells.spec.ts`
- `frontend/workspace/e2e/visual-shells.spec.ts-snapshots/`（20 个命名 PNG，机械生成）
- `frontend/workspace/e2e/visual-shells.spec.ts-snapshots/README.md`（新增）

**Scope:** M（测试/config/文档 3–4 文件；golden 为机械产物）

### Task 6：分阶段启用 visual/a11y CI gate

**Description:** 把观察、baseline 候选生成和只读比较拆成独立 `visual-a11y` Playwright project 与 CI job。该 job 和现有行为 e2e 并行、组内串行、总时限 10 分钟；先在 manual/nightly 连续观察两轮，再只对 frontend 相关 PR 启用 required gate。

**Acceptance:**

- [ ] 普通 PR/nightly job 只比较 golden；只有显式 manual update job 可设置 `VISUAL_BASELINE_UPDATE=1`，且只上传候选 artifact。
- [ ] 现有行为 job 通过 `test`/`test:e2e:behavior` 只选行为 project；独立 job 通过 `test:e2e:visual` 只选 `visual-a11y`，并固定 `workers: 1`、`retries: 0`。
- [ ] visual/a11y 使用独立 job 和 artifact 名称，与行为 job 并行；job `timeout-minutes: 10`，不执行行为 spec 或 backend suite。
- [ ] 失败时上传 screenshot expected/actual/diff、trace 与 axe 报告；低等级 axe 债不丢失但不阻断。
- [ ] 冷 Linux runner 连续两轮在 10 分钟内全绿后，frontend path filter 才启用 required gate；其他路径不承担无关 browser 成本。
- [ ] required 状态可独立降级而不删除测试、baseline 或 artifacts。

**Verification:**

- [ ] 手动触发 `.github/workflows/e2e.yml`，确认观察、只读成功、故意 visual diff 失败和 baseline 候选生成四条路径。
- [ ] 确认普通 CI 即使传入 `--update-snapshots` 也因缺少显式 update mode 失败。
- [ ] `bun run --cwd frontend/workspace test:e2e:visual` 只收集 visual/a11y project，不收集行为 specs。
- [ ] `bun run --cwd frontend/workspace test:e2e:behavior` 不收集 visual/accessibility specs，但会收集 targeted token-contract。
- [ ] workflow summary 分别记录 setup、20 张 golden、6 次 axe 扫描和总耗时；总耗时超过 10 分钟视为未通过。

**Dependencies:** Tasks 4、5

**Files:**

- `.github/workflows/e2e.yml`
- `frontend/workspace/package.json`

**Scope:** S

## Checkpoint

- [ ] token 定义与三组代表面迁移分开提交，旧 alias 仍保证未迁移页面兼容。
- [ ] 18 张基础 golden 与 2 张 Session drawer-open golden 在连续两次 Linux Chromium 运行中稳定。
- [ ] Home、Session、Settings 的 axe、键盘、mobile drawer 与 reduced-motion smoke 通过。
- [ ] snapshot 生成环境、mask 原因与人工对比度检查写入 README；普通 CI 只比较，不重写。

## Compatibility and rollback

- 旧字体常量和旧 CSS variable 在本阶段保留为 deprecated alias；待全仓调用完成后另立删除计划，不在本轮制造大爆炸。
- Tasks 2、3 按表面独立提交。视觉回归可只回退对应表面迁移，不回退 token contract。
- 07 完成前只保留非阻断观察 artifact，不提交临时 golden；07 延迟不会阻塞 token、axe 和键盘/reduced-motion smoke。
- visual/a11y gate 先 nightly/manual 观察两轮；若环境噪声阻塞 PR，可暂时回退 required 状态并保留测试与 artifacts，修复稳定性后再启用。
- Linux golden 是权威；update 脚本同时校验平台与显式环境变量，Windows/macOS 本地生成物不能覆盖 Linux baseline。需要跨平台 baseline 时另行显式增加项目。
- token 值变更必须伴随 snapshot diff 和设计审阅；紧急 rollback 优先恢复 token 值/表面提交，不批量接受新 golden。

## Risks

| Risk                                 | Impact          | Mitigation                                                      |
| ------------------------------------ | --------------- | --------------------------------------------------------------- |
| token 层变成第二套 theme             | light/dark 漂移 | 按映射表桥接 kit variables；contract test 阻止本地原子值回流    |
| 字体/抗锯齿导致 snapshot 抖动        | CI 假失败       | self-hosted fonts、`document.fonts.ready`、Linux 权威 baseline  |
| 20 张图评审负担大                    | diff 被机械接受 | 18 张固定矩阵只补 2 张真实 drawer 态，README 清单化审阅         |
| 动态 session 内容不稳定              | golden 波动     | 固定 SDK fixture；等 Shiki/KaTeX；折叠 graph；仅 mask 相对时间  |
| CSS/JS 动画导致过早截图              | golden 波动     | 统一等待 Web Animations API 与两帧 bounds；特殊 JS 动效显式标记 |
| axe 一次暴露过多历史问题             | gate 无法落地   | serious/critical 先阻断，其余分级建债；不 blanket-disable rule  |
| visual/a11y 拖长或污染行为 e2e       | nightly 超时    | 独立串行 project/job、零重试、与行为 job 并行、10 分钟硬上限    |
| token 迁移破坏 mobile/reduced motion | 核心操作不可达  | 行为断言与截图分开，保留现有 drawer/motion 规则                 |

## Definition of Done

- [ ] 所有 Task acceptance 与 verification 完成。
- [ ] `typecheck`、build、targeted behavior e2e、visual 和 accessibility suite 通过。
- [ ] 独立 `visual-a11y` job 在冷 Linux runner 上 10 分钟内完成；现有 `ci.yml` 继续负责 backend 全量 suite，本 job 不重复运行。
- [ ] 仓库根 `bun.lock` 仅包含本计划引入的预期依赖变化。
- [ ] baseline diff 已经人工审阅，CI 没有自动更新 snapshot。
- [ ] snapshot README 已记录权威环境、更新命令、mask registry、20 张矩阵与人工对比度检查结果。
- [ ] 未迁移页面通过兼容 alias 保持行为，回退策略已验证。
- [ ] 没有新增网络 mock、第二套颜色主题或全量换肤提交。

## 并行计划收尾（2026-08-05）

- Plan 16/19 已在 `release/v0.3.20` 的 `cb5f3b4` 合并提交中完成整合；当前 `release/v0.3.19` 工作树不重复合并该分支，避免把已发布的 Research Graph/Explorer 差异带入本轮 dirty tree。
- Plan 18 仍为进行中状态，当前工作树包含其未提交的 runtime/tool 改动与临时测试产物；本轮不清理、不回滚、不将其与 Plan 08 混合提交。待 Plan 18 形成独立验证提交后，再按依赖顺序合并。
- P16/P19 的独立 task worktree 仍有未提交 `bun.lock` 变更（测试/生成副作用），未删除 worktree；需由对应任务 owner 确认后清理，防止丢失并行工作。
