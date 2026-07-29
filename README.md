<div align="center">

<img src="assets/wordmark.svg" alt="Medho" width="440">

### 支持可控节点与人机协作的 AI Agent 工作台

基于 [synthetic-sciences/openscience](https://github.com/synthetic-sciences/openscience) 修改

<br/>

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[安装](#安装) · [快速开始](#快速开始) · [可控节点](#可控节点stage-graph) · [自定义指南](./CUSTOMIZATION.md)

</div>

---

Medho 是一个 AI 科研工作台。你给它一个目标，它会完成文献阅读、假设形成、代码编写与运行、实验执行、数据库查询，最后生成报告——就像一个有能力的协作者那样工作。

在原版 OpenScience 的基础上，Medho 新增了**可控节点（Stage Graph）**系统：将长任务拆分为多个阶段，支持在关键节点暂停等待人类确认，并可随时跳转到任意节点重新开始。

---

## 新增功能

### 🎯 可控节点（Stage Graph）

长任务（如：问题发现 → 证据搜集 → 代码执行 → 结果评价 → 可视化）的每个阶段都可以：

- **命名与标记**：每个阶段有独立名称、时间戳和快照
- **人机协作门控（HITL Gate）**：`gate: true` 参数让 agent 在进入该阶段前暂停，弹出确认对话框等待人类决定
- **阶段级 Diff**：自动计算并显示每个阶段修改了哪些代码（`+additions / -deletions`）
- **跳转重启**：在前端面板中点击任意阶段的"Restart from here"，系统会 fork 会话、恢复文件快照，并从该节点重新执行，同时保留之前所有节点的记忆

**agent 调用示例：**

```
stage(name="证据搜集", summary="发现了3个问题", gate=true)
```

弹出确认框：

```
Ready to enter stage "证据搜集"?

[ Continue ]   [ Stop here ]
```

**前端 Stages 面板：**

```
1. 问题发现    [completed]  10:30:22   +12/-3
2. 证据搜集    [completed]  10:35:18   +45/-8
3. 代码执行    [active]     10:40:05
                                  [ Restart from here ↩ ]
```

### 🔧 零侵入设计

所有新功能不修改核心框架（processor / llm / compaction），通过消息部件（append-only message parts）扩展状态，利用现有 `Question.ask` 基础设施实现门控，无需新增路由或 SSE 事件。

---

## 安装

### 🖥️ Windows（一键安装，推荐）

1. 下载 [`install.bat`](https://github.com/medhorizon/medhorizon/releases/latest/download/install.bat)
2. 双击运行，等待安装完成（约 1 分钟）
3. 双击桌面的 **Medho** 图标启动
4. 浏览器自动打开 → 填写 API Key → 开始使用

> 无需安装 Git、Node.js、Python 等任何依赖。

### 🍎 macOS / 🐧 Linux（一行命令）

```bash
curl -fsSL https://raw.githubusercontent.com/medhorizon/medhorizon/main/scripts/install.sh | bash
```

安装完成后运行：

```bash
medho
```

### 🛠️ 开发者安装（从源码构建）

需要 [Bun](https://bun.sh) 1.3+：

```bash
git clone https://github.com/medhorizon/medho.git
cd medho
bun install
cp .openscience/openscience.example.jsonc .openscience/openscience.jsonc
# 编辑 openscience.jsonc，填入你的 API key
```

---

## 快速开始

**启动后端：**

```bash
cd backend/cli
bun run dev
```

**启动前端：**

```bash
cd frontend/workspace
bun run dev
```

访问 http://localhost:3000

**设置 API key（任意一个）：**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# 或 OPENAI_API_KEY / GEMINI_API_KEY
```

---

## 可控节点（Stage Graph）

### agent 侧使用

在任务描述中指示 agent 使用 `stage` 工具划分阶段：

```
请完成以下科研任务，每个阶段前调用 stage 工具：
1. 问题发现（自动进入）
2. 证据搜集（gate=true，等我确认）
3. 代码执行（自动进入）
4. 结果评价（gate=true，等我确认）
5. 可视化（自动进入）
```

### 前端操作

右侧面板 → **Stages** 选项卡，可以：

- 查看所有阶段的进展与耗时
- 查看每个阶段的代码变更量
- 点击 **Restart from here** 从任意阶段重新开始

### 跳转行为

跳转会：

1. Fork 会话到目标节点（原会话不受影响）
2. 恢复该节点的文件快照（git 状态）
3. 保留之前所有阶段的消息历史（记忆）
4. 从目标阶段重新开始执行

---

## 自定义 Agent 与工作流

> 完整代码示例见 **[CUSTOMIZATION.md](./CUSTOMIZATION.md)**

---

### 1. 自定义 Agent 类型

**定义位置**：`.openscience/openscience.jsonc` 中的 `agent` 字段

```jsonc
{
  "agent": [
    {
      "name": "my-specialist",
      "mode": "subagent", // primary | subagent | all
      "model": "claude-opus-5",
      "prompt": "You are a specialist in...",
      "permission": { "level": "normal" },
      "temperature": 0.7,
      "steps": 50,
    },
  ],
}
```

**mode 说明**：

- `primary` — 只作为主 agent（用户直接交互）
- `subagent` — 只作为子 agent（被其他 agent 委托）
- `all` — 两种模式都可用

---

### 2. 自定义 Agent 提示词

**方法 A — 文件模板（推荐）**：

在 `backend/cli/src/agent/prompt/my-agent.txt` 中写提示词，然后在 `backend/cli/src/session/prompt.ts` 的 `insertReminders` 函数中添加：

```typescript
if (agent.name === "my-agent") {
  reminders.push({
    title: "My Agent Instructions",
    content: await readFile("src/agent/prompt/my-agent.txt", "utf-8"),
  })
}
```

**方法 B — 直接在配置中写**：

在 `.openscience/openscience.jsonc` 的 `agent[].prompt` 字段直接写完整提示词（适合短提示）。

---

### 3. 子 Agent 委托机制

**核心工具**：`backend/cli/src/tool/task.ts` 的 `TaskTool`

```typescript
const COMPUTE_SUBAGENTS = {
  biology: "biology-specialist",
  ml: "ml-specialist",
  physics: "physics-specialist",
  myDomain: "my-specialist", // 新增一行即可
}

// 委托调用
const result = await TaskTool.execute(
  {
    agentType: "ml",
    task: "Train a classifier on dataset X",
    context: { dataset: "path/to/data" },
  },
  ctx,
)
```

**并发控制**：

- 默认 `MAX_COMPUTE_SUBAGENTS = 2`
- 环境变量 `OPENSCIENCE_MAX_COMPUTE_SUBAGENTS` 可覆盖
- 实现：`HierarchicalSemaphore` 类

---

### 4. 工作流阶段控制（Stage Graph）

**Stage Tool — 可控节点**：

```typescript
// 自动进入
stage({ name: "证据搜集", summary: "发现了3个问题" })

// 启用门控：暂停等待人类确认
stage({ name: "代码执行", summary: "已搜集5个测试案例", gate: true })
```

**跳转到指定节点**（通过 SDK）：

```typescript
await SessionStage.jump({ sessionID: "xxx", partID: "stage-part-id" })
```

前端会自动：

1. Fork 会话到目标节点
2. 恢复该节点的 snapshot（文件状态）
3. 保留之前节点的记忆（消息历史）

---

### 5. 自定义工具

在 `backend/cli/src/tool/my-tool.ts` 创建工具：

```typescript
import { Tool } from "./tool"
import z from "zod"

export const MyTool = Tool.define({
  id: "my_tool",
  description: "My custom tool does X",
  parameters: z.object({
    input: z.string().describe("Input parameter"),
  }),
  async execute(params, ctx) {
    await ctx.ask({ permission: "my_tool", patterns: ["*"], always: ["*"], metadata: {} })
    return {
      title: "Tool executed",
      output: `Result: ${params.input}`,
      metadata: {},
    }
  },
})
```

在 `backend/cli/src/tool/registry.ts` 注册：

```typescript
import { MyTool } from "./my-tool"
export const TOOLS = [...existingTools, MyTool]
```

---

### 6. 权限控制

在 agent 定义中配置 Permission Rulesets：

```jsonc
{
  "agent": [
    {
      "name": "restricted-agent",
      "permission": {
        "level": "ask",
        "rules": {
          "bash": "block",
          "file_write": {
            "level": "ask",
            "patterns": ["src/**"],
          },
          "file_read": "auto",
        },
      },
    },
  ],
}
```

**权限级别**：

- `auto` — 自动允许
- `ask` — 每次询问用户
- `block` — 完全禁止

**新权限类型无需修改代码** — `permission` 字段是自由字符串，ruleset 在运行时匹配。

---

### 7. Plugin 与 Skill 系统

**Plugin（MCP 集成）**，在 `.openscience/openscience.jsonc` 中：

```jsonc
{
  "plugins": {
    "my-mcp-server": {
      "type": "local",
      "command": ["node", "path/to/server.js"],
      "environment": { "API_KEY": "xxx" },
    },
  },
}
```

**Skill（可复用工作流）**，在 `.openscience/skills/my-workflow.md` 中：

```markdown
---
name: my-workflow
description: Custom workflow for...
---

1. Use stage(name="Step1", gate=true) to pause before starting
2. Do the work...
3. Use stage(name="Review", gate=true) for human review
```

调用：`/my-workflow` 或通过 SDK。

---

### 8. 修改建议 — 最小侵入原则

根据"不动大框架"的约束，推荐扩展点：

**✅ 零侵入（推荐）**：

- 添加新 agent 定义（`.openscience/openscience.jsonc`）
- 添加新工具（`tool/` 下新文件 + `registry.ts` 一行注册）
- 添加 prompt 文件（`agent/prompt/*.txt`）
- 添加 skill（`.openscience/skills/*.md`）

**⚠️ 轻度侵入（仅修改 1-2 处）**：

- 在 `session/prompt.ts` 的 `insertReminders` 添加新 agent 的提示逻辑
- 在 `tool/task.ts` 的 `COMPUTE_SUBAGENTS` 添加新的委托类型

**❌ 避免修改（核心框架）**：

- `processor.ts`、`llm.ts`、`compaction.ts`（核心循环）
- `snapshot/`、`permission/next.ts`（基础设施）

---

## 原版功能（保留完整）

- **完整科研循环**：文献综述、假设、代码、实验、分析、报告，一次会话完成
- **研究 Agent**：默认 `research` agent，加上 `biology`、`physics`、`ml` 专家子 agent
- **290+ 技能**：训练（DeepSpeed、PEFT、TRL）、评估、数据集处理、分子生物学、化学信息学、LaTeX、云计算（Modal、Tinker）
- **科学数据库工具**：UniProt、PDB、Ensembl、ChEMBL、PubChem、arXiv、OpenAlex、Semantic Scholar 等 30+ 数据库
- **完整工作台**：文件树、编辑器、终端、会话历史、分子/结构/基因组/图表内联渲染
- **可扩展**：LSP、MCP 服务器、插件、自定义 agent 和命令、TypeScript SDK

---

## 项目结构

```
medho/
├── backend/cli/src/
│   ├── session/
│   │   └── stage.ts          # Stage 核心逻辑（新增）
│   ├── tool/
│   │   ├── stage.ts          # Stage 工具（新增）
│   │   └── registry.ts
│   ├── agent/prompt/         # Agent 提示词模板
│   ├── snapshot/             # 文件快照系统
│   └── server/               # HTTP API
├── frontend/workspace/src/
│   └── atlas/
│       └── StagesPanel.tsx   # Stages 面板（新增）
├── tooling/sdk/              # TypeScript SDK
├── .openscience/
│   ├── openscience.jsonc     # 项目配置（自定义 agent/plugin/skill）
│   └── skills/               # 可复用工作流
├── CUSTOMIZATION.md          # 自定义详细指南
└── README.md
```

---

## 开发

```bash
bun install
bun dev                              # 从源码运行工作台
bun run typecheck                    # 类型检查
bun run --cwd backend/cli test       # 运行测试（含 Stage 测试）
bun run --cwd backend/cli build      # 构建二进制
```

---

## 安全说明

Agent 不在沙箱中运行。权限系统让你了解 agent 的操作，但不是隔离边界。如需隔离，请在容器或虚拟机中运行。

---

## 来源与许可

本项目基于 [synthetic-sciences/openscience](https://github.com/synthetic-sciences/openscience)（Apache License 2.0）修改。

主要新增功能：Stage Graph 可控节点系统、人机协作门控、阶段级 Diff 可视化。

Apache License 2.0 · 详见 [LICENSE](LICENSE)
