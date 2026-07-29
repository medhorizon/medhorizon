# OpenScience 残留清单（MedHorizon / Medho）

本文档统计仓库中仍出现的 **OpenScience / SynSci / synsci / synsc** 相关内容，按「对外显示」与「核心架构」分类，并注明路径与作用，供后续去品牌 / 重命名时对照修改。

> 统计口径（约）：排除 `bun.lock`、`node_modules`、Landing 内嵌的预构建 docs bundle 后，含 `openscience` 约 **399** 个文件，含 `synsci`/`synsc` 约 **227** 个文件。分布大致为：`backend` ~232 · `frontend` ~119 · `tooling` ~22 · `docs` ~14 · `.github` ~8 · 根目录若干。
>
> 当前双品牌现状：GitHub README / `CUSTOMIZATION.md` / `scripts/install*` 已偏 **Medho**；Workspace UI、Landing、Docs、根目录 `install`、CLI、npm 包名仍以 **OpenScience / @synsci** 为主。

---

## 目录

1. [对外显示（用户可见）](#1-对外显示用户可见)
2. [核心架构（协议 / 路径 / 包名）](#2-核心架构协议--路径--包名)
3. [内部结构与命名](#3-内部结构与命名)
4. [生成物与 CI](#4-生成物与-ci)
5. [已改为 Medho 的部分](#5-已改为-medho-的部分)
6. [建议修改顺序](#6-建议修改顺序)

---

## 1. 对外显示（用户可见）

改这些即可让终端用户「看不见」OpenScience，多数不碰磁盘契约与协议。

### 1.1 图标 / Logo / Favicon

| 路径                                                                     | 作用                                                    | 用户如何看到                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `frontend/workspace/src/atlas/Wordmark.tsx`                              | 产品字标组件：图片 + 文案 `OpenScience`                 | Workspace 首页 / 会话顶栏品牌                                      |
| `frontend/workspace/public/openscience-logo.png`                         | Wordmark 引用的主 Logo                                  | 同上                                                               |
| `assets/wordmark.svg`                                                    | ASCII「OPEN SCIENCE」字标（`aria-label="OpenScience"`） | GitHub README 顶部图（`alt` 已写 Medho，SVG 内容仍是 OpenScience） |
| `backend/cli/src/cli/logo.ts`                                            | CLI ASCII 横幅                                          | `openscience --help` 等                                            |
| `frontend/ui/src/components/logo.tsx`                                    | SVG `Mark` / `Splash` / `Logo` 几何字标                 | UI 组件库；当前 Workspace 主路径多用 PNG Wordmark                  |
| `frontend/landing/src/pages/Landing.tsx`（`OsMark`）                     | Landing 站标 + Hero 大字 `openscience`                  | 营销站首屏                                                         |
| `frontend/workspace/public/atlas-favicon.svg`                            | Workspace 标签页图标                                    | 浏览器 tab                                                         |
| `frontend/ui/src/assets/favicon/*`                                       | 共享 favicon 套装（ico/png/svg、apple-touch、v3/v4）    | Workspace / 其它前端经 symlink 引用                                |
| `frontend/workspace/public/favicon-*`                                    | 指向 ui favicon 的符号链接                              | Workspace                                                          |
| `frontend/landing/public/favicon.svg`                                    | Landing favicon                                         | 营销站                                                             |
| `frontend/docs/public/favicon.svg`                                       | Docs favicon                                            | 文档站                                                             |
| `frontend/landing/public/docs/favicon.svg`                               | 打包进 Landing 的 docs favicon                          | `openscience.sh/docs` 镜像                                         |
| `frontend/workspace/public/site.webmanifest`                             | PWA `name` / `short_name` = `OpenScience`               | 「添加到主屏」名称                                                 |
| `frontend/ui/src/assets/favicon/site.webmanifest`                        | 同上                                                    | 共享清单                                                           |
| `frontend/ui/src/assets/images/social-share.png`（及 workspace symlink） | OG / Twitter 分享图                                     | 链接预览                                                           |
| `frontend/ui/src/components/provider-icons/sprite.svg`（`#synsci`）      | Provider `synsci` 的图标                                | 模型 / Provider 选择器                                             |
| `frontend/ui/src/theme/themes/openscience.json`                          | 主题 id `openscience`，显示名 `"OpenScience"`           | 主题选择器                                                         |
| `frontend/ui/src/theme/themes/openscience-1.json`                        | 主题 id `openscience-1`，显示名 `"OpenScience"`         | 同上                                                               |
| `frontend/ui/src/context/marked.tsx`                                     | 代码高亮主题注册名 `"OpenScience"`                      | Markdown 代码块主题名                                              |

### 1.2 UI 文案（i18n + 硬编码）

**主语言文件：** `frontend/workspace/src/i18n/en.ts`（约 16 处含 OpenScience / `openscience.json`）

**需同步修改的语言包（同 key）：**

`ar.ts` · `br.ts` · `da.ts` · `de.ts` · `es.ts` · `fr.ts` · `ja.ts` · `ko.ts` · `no.ts` · `pl.ts` · `ru.ts` · `th.ts` · `zh.ts` · `zht.ts`

| Key / 位置                           | 英文示例                                           | 作用                         |
| ------------------------------------ | -------------------------------------------------- | ---------------------------- |
| `provider.connect.*.suffix` 等       | `…use {{provider}} models in OpenScience.`         | 连接 Provider 说明           |
| `dialog.plugins.empty`               | `plugins configured in openscience.json`           | 插件空态                     |
| `dialog.server.description`          | `switch which OpenScience server…`                 | 切换服务器对话框             |
| `toast.update.description`           | `a new version of OpenScience…`                    | 更新提示                     |
| `error.page.report.prefix`           | `please report this error to the OpenScience team` | 错误页                       |
| `error.chain.checkConfig`            | `check your config (openscience.json)…`            | 错误链提示                   |
| `error.chain.mcpFailed`              | `…OpenScience does not support MCP…`               | MCP 失败说明                 |
| `sidebar.gettingStarted.line1`       | `OpenScience includes free models…`                | 新手引导                     |
| `app.name.desktop`                   | `OpenScience Desktop`                              | 桌面端产品名                 |
| `settings.general.row.*.description` | `…for OpenScience`                                 | 设置通用说明                 |
| `settings.updates.*`                 | `…when OpenScience launches` 等                    | 更新设置                     |
| `dialog.provider.synsci.note`        | （key 含 `synsci`）                                | Atlas / synsci Provider 备注 |

**硬编码 UI（非 i18n）：**

| 路径                                                     | 作用                          |
| -------------------------------------------------------- | ----------------------------- |
| `frontend/workspace/src/atlas/Wordmark.tsx`              | 字面量 `OpenScience`          |
| `frontend/workspace/src/pages/error.tsx`                 | 错误页品牌 + 上游 issues 链接 |
| `frontend/workspace/src/components/settings/Compute.tsx` | 文案提及 `~/.openscience/`    |
| 其它 settings / dialog / status 组件                     | 偶发硬编码或依赖 i18n key     |

### 1.3 Landing / Docs / README / 安装脚本文案

| 路径                                               | 作用                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/landing/src/pages/Landing.tsx`           | 营销全文：Hero、Install、FAQ、footer、`@synsci/openscience`、`openscience.sh`、Synthetic Sciences、`@SynScience`                |
| `frontend/landing/index.html`                      | `<title>` / OG / Twitter / JSON-LD：`OpenScience`                                                                               |
| `frontend/landing/public/install`                  | 与根目录同内容的 curl 安装脚本（OpenScience Installer）                                                                         |
| `frontend/landing/README.md`                       | 「Marketing site for OpenScience」（开发者向）                                                                                  |
| `frontend/docs/src/DocsApp.tsx`                    | 文档站导航品牌、章节名、npm 包名                                                                                                |
| `frontend/docs/src/content/openscience/*.mdx`      | 全套用户文档：产品名、命令、安装                                                                                                |
| `frontend/docs/src/content/openscience/docs.json`  | 文档站元数据 `"name": "OpenScience"`                                                                                            |
| `frontend/docs/index.html`                         | `<title>OpenScience Docs</title>`                                                                                               |
| `frontend/docs/README.md`                          | Docs 工程说明                                                                                                                   |
| `README.md`                                        | 已是 Medho 叙述，但仍引用上游 OpenScience，并嵌入 `assets/wordmark.svg`                                                         |
| `backend/cli/README.md`                            | `# @synsci/openscience`、安装与命令说明                                                                                         |
| `NOTICE`                                           | 版权头：OpenScience / Synthetic Sciences                                                                                        |
| `SECURITY.md` / `CONTRIBUTING.md` / `CHANGELOG.md` | 仓库级文案中的 OpenScience / 包名                                                                                               |
| `/workspace/install`                               | Banner「OpenScience Installer」；`APP=openscience`；安装到 `~/.openscience/bin`；指向 `synthetic-sciences/OpenScience` releases |

### 1.4 CLI 用户可见输出

| 路径                                                           | 作用                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `backend/cli/src/index.ts`                                     | `.scriptName("openscience")` + 调用 `UI.logo()`                                  |
| `backend/cli/src/cli/onboard.ts`                               | Welcome / setup 文案、`openscience login` 等提示                                 |
| `backend/cli/src/cli/cmd/connect.ts`                           | 登录 / Atlas 连接文案                                                            |
| `backend/cli/src/cli/cmd/uninstall.ts`                         | 「Uninstall OpenScience」、卸载 npm/brew/choco 提示                              |
| `backend/cli/src/cli/cmd/web.ts` 等                            | 「open the OpenScience workspace…」等描述                                        |
| `backend/cli/src/cli/error.ts`                                 | 错误建议中的 `openscience mcp auth`、`openscience.json`                          |
| `backend/cli/src/cli/cmd/{upgrade,serve,skill,pr,run,auth}.ts` | 命令 help / describe 中的产品名                                                  |
| `tooling/launcher/bin/synsci.mjs`                              | `npx synsci` 安装向导：ASCII logo、Installing OpenScience、`@synsci/openscience` |

### 1.5 Agent / Skill 中间接露出

| 路径                                                                                          | 作用                                                                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `backend/cli/src/session/prompt/{anthropic,beast,codex_header,gemini,qwen,copilot-gpt-5}.txt` | 系统提示自称 「Open Science CLI」 / 「OpenScience Dashboard」；可能影响模型对用户的自称 |
| 多个 `backend/cli/skills/**/SKILL.md`                                                         | `author: Synthetic Sciences` 等元数据；技能目录里偶发产品名                             |

### 1.6 用户会输入或看到的对外身份

| 标识                                         | 典型位置                                                                     | 作用                |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `@synsci/openscience`                        | `backend/cli/package.json`、Landing、Docs、install                           | npm 安装名          |
| 二进制 `openscience`                         | `backend/cli/package.json` `bin`、`backend/cli/bin/openscience`              | PATH 命令           |
| `synsci` / `npx synsci`                      | `tooling/launcher/package.json`                                              | 启动器 / 安装入口   |
| `@synsci/atlas`、`@synsci/cli`（deprecated） | onboard / launcher / publish                                                 | 伴生 CLI 与阴影检测 |
| HTML title                                   | `frontend/workspace/index.html` 等                                           | 浏览器标题          |
| 文案中的域名 / org                           | `openscience.sh`、`github.com/synthetic-sciences/openscience`、`@SynScience` | 文档与营销链接      |

---

## 2. 核心架构（协议 / 路径 / 包名）

改这些会影响已有安装、配置迁移、Atlas 线协议、SDK 与发布链路。**显示层清理可以不动这里；产品彻底独立时再分批处理。**

### 2.1 配置与数据目录（高风险）

| 标识                                           | 代表路径                                                                                    | 作用                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| XDG app 名 `"openscience"`                     | `backend/cli/src/global/index.ts`                                                           | 解析为 `~/.config/openscience`、`~/.local/share/openscience` 等 |
| Legacy `"synsc"`                               | 同上                                                                                        | 旧目录 / `synsc.json(c)` → `openscience.json(c)` 迁移           |
| `~/.openscience/bin`                           | 根目录 `install`；`tooling/launcher/bin/synsci.mjs`                                         | curl 安装与 PATH                                                |
| 项目目录 `.openscience` / `.synsc` / `.synsci` | `backend/cli/src/config/config.ts`；`server/routes/atlas-bridge.ts`；仓库内 `.openscience/` | 项目级配置、plans、Atlas pin                                    |
| Windows `ProgramData/openscience`              | `config.ts`                                                                                 | 托管 / 企业配置根                                               |

### 2.2 配置文件名（高风险）

| 文件名                                           | 代表路径                                      | 作用                       |
| ------------------------------------------------ | --------------------------------------------- | -------------------------- |
| `openscience.json` / `.jsonc`                    | `config.ts`；`.openscience/openscience.jsonc` | 主用户 / 项目配置          |
| `openscience-synced.json`                        | `global/index.ts`、`openscience/index.ts`     | 同步凭据 / Provider 白名单 |
| `openscience-session.json`                       | `openscience/index.ts`、launcher              | Atlas / 登录会话           |
| `openscience-skills.json`                        | `skill/install/*`、`cli/cmd/skill.ts`         | Skill 命名空间清单         |
| Legacy `synsc.json(c)`、`synsci-session.json` 等 | `global/index.ts` migrate                     | 兼容旧安装                 |

### 2.3 npm / 二进制 / monorepo 身份（高风险）

| 标识                                                                    | 代表路径                                                          | 作用                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| `@synsci/openscience`                                                   | `backend/cli/package.json`                                        | 已发布 CLI 元包        |
| `@synsci/openscience-<platform>`                                        | `tooling/repo/publish.ts`、安装相关测试                           | 分平台原生二进制包     |
| bin `openscience`                                                       | `backend/cli/package.json`、`script/build.ts`、`bin/openscience`  | 可执行入口             |
| launcher `synsci`                                                       | `tooling/launcher/package.json`、`bin/synsci.mjs`                 | `npx synsci`           |
| Workspace `@synsci/{monorepo,sdk,ui,workspace,plugin,script,util,docs}` | 根与各 `package.json`                                             | monorepo 包图与 import |
| 仓库 URL                                                                | 根 `package.json` `repository` → `synthetic-sciences/openscience` | npm / 元数据           |
| brew / scoop / choco 公式名 `openscience`                               | uninstall / publish                                               | 发行渠道               |

### 2.4 Provider ID `synsci`（协议级，极高风险）

> `CLAUDE.md` 注明：Provider ID `synsci` 为 Atlas wire contract，**不要随意改名**（除非同步改 Atlas / 网关）。

| 用途                                                 | 代表路径                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerID === "synsci"` / managed 路由             | `backend/cli/src/provider/provider.ts`、`transform.ts`、`tool/registry.ts`、`session/llm.ts`、`cli/cmd/models.ts`、`cli/cmd/auth.ts`、`acp/agent.ts` |
| 配置块 `provider.synsci`                             | `.openscience/openscience.jsonc`                                                                                                                     |
| 模型目录 fixture                                     | `backend/cli/test/tool/fixtures/models-api.json`                                                                                                     |
| UI 将 synsci 视为托管 Provider                       | `frontend/workspace/src/hooks/use-providers.ts`、`utils/model-cost.ts`、`atlas/SetupGate.tsx`、`dialog-select-model*.tsx`                            |
| HTTP 归因 `X-Title: synsci` / `originator: "synsci"` | `provider/provider.ts`、`plugin/codex.ts`                                                                                                            |
| i18n key `dialog.provider.synsci.*`                  | `frontend/workspace/src/i18n/*.ts`                                                                                                                   |

显示名在部分地方已是 **「Atlas」**，但协议 id 仍是 `synsci`。

### 2.5 环境变量（高风险）

| 前缀 / 变量                                                                                                                                                                                               | 代表路径                                                                 | 作用                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| `OPENSCIENCE_*`（`flag.ts` 中约 51 处）                                                                                                                                                                   | `backend/cli/src/flag/flag.ts`                                           | CLI Flag 面：功能开关、路径覆盖等 |
| `OPENSCIENCE_API_BASE` / `SYNSC_API_BASE` 等                                                                                                                                                              | `backend/cli/src/endpoints.ts`                                           | 托管 API 基址（含兼容别名）       |
| `SYNSC_AUTH_URL`、`SYNSC_CLI_KEY`、`SYNSC_API_KEY`                                                                                                                                                        | `openscience/index.ts`、`cli/cmd/connect.ts`、`onboard.ts`、`billing.ts` | 认证与计费                        |
| `OPENSCIENCE_API`                                                                                                                                                                                         | `share/share.ts`                                                         | Share API                         |
| `OPENSCIENCE_CORS_DOMAINS`、`OPENSCIENCE_ATLAS_TIMEOUT_MS`、`OPENSCIENCE_SKILL_TIMEOUT_MS`、`OPENSCIENCE_DATA_DIR`、`OPENSCIENCE_TEST_HOME`、`OPENSCIENCE_INSTALL_URL`、`OPENSCIENCE_VERSION` / `CHANNEL` | server / atlas / install / tests / build inject                          | 运行时与构建                      |
| `VITE_OPENSCIENCE_SERVER_*`                                                                                                                                                                               | `frontend/workspace/src/env.d.ts`、`app.tsx`、Playwright / CI            | 前端默认后端地址                  |
| 内核 IPC `__OPENSCIENCE_*__`                                                                                                                                                                              | `tool/notebook.ts`、`tool/rkernel.ts`、biology notebook                  | 主机 ↔ 内核协议标记              |

### 2.6 HTTP / SDK / 进程契约（高风险）

| 标识                                             | 代表路径                                                 | 作用            |
| ------------------------------------------------ | -------------------------------------------------------- | --------------- |
| `x-openscience-directory`                        | `server/server.ts`；`tooling/sdk/js/src/{,v2/}client.ts` | 多项目路由      |
| `x-openscience-internal`                         | `server/server.ts`                                       | 内部 fetch 鉴权 |
| `x-openscience-{project,session,request,client}` | `session/llm.ts`                                         | 托管代理元数据  |
| User-Agent `openscience/...`                     | `installation/index.ts`                                  | 客户端身份      |
| `http://openscience.internal`                    | `cli/cmd/run.ts`                                         | 进程内 SDK base |
| `spawn('openscience')` / listening 字符串        | SDK `server.ts`                                          | SDK 拉起 CLI    |
| `createOpenScienceClient` / `OpenScienceClient`  | `@synsci/sdk` 公开 API                                   | 外部集成面      |

### 2.7 前端持久化身份（中风险）

| 标识                                                                                                            | 代表路径                                                             | 作用                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| Theme ids `openscience` / `openscience-1`                                                                       | `frontend/ui/src/theme/themes/*`、`default-themes.ts`、`context.tsx` | 默认主题 id              |
| localStorage：`openscience-theme-id`、`openscience-color-scheme`、`openscience-theme-css-*`                     | `theme/context.tsx`；`public/openscience-theme-preload.js`           | 主题持久化 / FOUC 预加载 |
| 存储前缀 `openscience.` / `openscience.global.dat` / `openscience.workspace.*`                                  | `utils/persist.ts`                                                   | Workspace UI 状态        |
| `openscience.settings.dat:defaultServerUrl`、`openscience.setup.dismissed`、`openscience.stale-build.reload-at` | `entry.tsx`、`SetupDialog.tsx`、`stale-build-recovery.ts`            | 设置 / 引导 / 热更新     |
| DOM 事件 `openscience:open-file`                                                                                | `pages/session.tsx`                                                  | 跨组件打开文件契约       |
| Style id `openscience-theme` / preload                                                                          | theme loader                                                         | 主题注入                 |

---

## 3. 内部结构与命名

机械重命名面大；**若 §2 路径 / 协议保持不变，仅改源码符号通常不破坏已有用户磁盘数据。**

| 路径 / 符号                                                                                                             | 作用                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `backend/cli/src/openscience/`（`index.ts`、`preload-env.ts`、`dotenv.ts`、`synced-env-policy.ts`、`atlas-package.ts`） | Atlas / 会话 / 同步环境客户端模块                |
| `import { OpenScience } from "@/openscience"`                                                                           | CLI 内大量引用该命名空间                         |
| `backend/cli/test/openscience/` + `test/openscience-*.ts`                                                               | 对应测试                                         |
| `.openscience/{agent,command,skill,themes,openscience.jsonc}`                                                           | 本仓库已提交的项目配置树                         |
| `frontend/docs/src/content/openscience/`                                                                                | Docs 内容分区 key                                |
| `frontend/workspace/src/atlas/OpenScienceFileTree.tsx`                                                                  | 文件树组件名                                     |
| `frontend/workspace/src/utils/openscience-fetch.ts`                                                                     | fetch 包装                                       |
| MCP 名 `openscience` / `openscience-debug`                                                                              | `mcp/index.ts`、`cli/cmd/mcp.ts`                 |
| ACP `openscience-login` / command `synsci`                                                                              | `acp/agent.ts`                                   |
| Plugin skip：`openscience-*-auth`、`synsci-*-auth`                                                                      | `plugin/index.ts`                                |
| Science UA `openscience-science`                                                                                        | `science/connectors/http.ts` 等                  |
| Vite 插件名 `openscience-desktop:config`                                                                                | `frontend/workspace/vite.js`                     |
| Worker 名 `openscience-rdkit`                                                                                           | `Chem2D.tsx`                                     |
| GitHub app / bot `openscience-agent`                                                                                    | `cli/cmd/github.ts`、`tooling/repo/changelog.ts` |
| 各类临时目录前缀 `openscience-*`                                                                                        | kernel / sandbox / skills / e2e                  |

---

## 4. 生成物与 CI

改完源标识后应重新生成 / 发布，勿手改为主。

| 产物               | 路径                                                      | 说明                                                             |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- |
| OpenAPI            | `tooling/sdk/openapi.json`                                | title / 示例含 openscience；由 `./tooling/repo/generate.ts` 再生 |
| SDK gen            | `tooling/sdk/js/src/**/gen/*`                             | `OpenScienceClient` 等，勿手改                                   |
| Lockfile           | `bun.lock`                                                | 大量 `@synsci` / openscience 解析噪声                            |
| Docs 预构建 bundle | `frontend/landing/public/docs/assets/*.js`                | 由 `frontend/docs` 构建灌入                                      |
| 发布归档名         | `openscience-{linux,darwin}-*`（`script/publish.ts`）     | Release asset 命名                                               |
| CI                 | `.github/workflows/{publish,npm-test,release,e2e,ci}.yml` | 包名、二进制、`OPENSCIENCE_*` e2e env、`synsci@test` 等          |

---

## 5. 已改为 Medho 的部分

后续改品牌时可对齐这些已有命名，避免两套并存：

| 路径                                                | 现状                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `README.md`                                         | 产品叙述为 Medho；仍链到上游 OpenScience，并嵌入 OpenScience 字标 SVG                                |
| `CUSTOMIZATION.md`                                  | Medho 自定义指南；配置路径仍写 `.openscience/`、`OPENSCIENCE_*`、示例 import 偶见 `@openscience/sdk` |
| `scripts/install.sh`                                | Medho 安装；`INSTALL_DIR=$HOME/.local/medho`；二进制 `medho`                                         |
| `scripts/install.ps1` / `install.bat` / `start.bat` | Windows Medho 安装与启动                                                                             |
| 根目录 `install` / Landing `public/install`         | **仍是 OpenScience**，与 `scripts/install*` 并存                                                     |

---

## 6. 建议修改顺序

按破坏面从小到大：

1. **仅显示层**  
   Wordmark + `openscience-logo.png` → i18n 全语言 → HTML title / webmanifest → Landing / Docs 文案 → CLI logo / onboard / uninstall 提示 → `assets/wordmark.svg` / NOTICE 可见品牌。  
   _不动_ 配置路径、包名、provider id。

2. **用户命令面统一**  
   二进制 / 安装入口统一到 Medho（对齐已有 `scripts/install*`）；处理根 `install` 与 Landing 安装脚本双轨。

3. **配置路径迁移**  
   `openscience.json`、`~/.openscience`、`.openscience/` → 新名；保留双读 + 迁移，避免打断已有用户。

4. **最后再动协议与包**  
   `@synsci/*`、provider `synsci`、`x-openscience-*`、SDK `createOpenScienceClient`、`OPENSCIENCE_*` env。与 Atlas / 发布强耦合，需单独方案。

---

## 附录：快速检索命令

```bash
# 含 openscience 的文件（排除 lock / node_modules / 预构建 docs）
rg -l -i 'openscience' --glob '!bun.lock' --glob '!**/node_modules/**' --glob '!**/public/docs/assets/**' .

# synsci / synsc
rg -l -i 'synsci|synsc' --glob '!bun.lock' --glob '!**/node_modules/**' --glob '!**/public/docs/assets/**' .

# 环境变量 Flag 面
rg 'OPENSCIENCE_' backend/cli/src/flag/flag.ts

# 英文 UI 字符串
rg -n -i 'openscience' frontend/workspace/src/i18n/en.ts
```

---

_文档生成自仓库审计；修改时请以当前代码为准复检路径。_
