# Medho 自定义指南

本文档详细说明如何自定义 agent 协作功能与工作流，方便在新对话中分模块修改。

---

## 目录

1. [自定义 Agent 类型](#1-自定义-agent-类型)
2. [自定义 Agent 提示词](#2-自定义-agent-提示词)
3. [子 Agent 委托机制](#3-子-agent-委托机制)
4. [工作流阶段控制](#4-工作流阶段控制)
5. [自定义工具](#5-自定义工具)
6. [权限控制](#6-权限控制)
7. [Plugin 与 Skill 系统](#7-plugin-与-skill-系统)
8. [修改建议 — 最小侵入原则](#8-修改建议--最小侵入原则)
9. [实战示例](#9-实战示例--代码审查工作流)

---

## 1. 自定义 Agent 类型

### 配置文件位置
`.openscience/openscience.jsonc` 中的 `agent` 字段

### 基本结构
```jsonc
{
  "agent": [
    {
      "name": "my-specialist",           // agent 名称（唯一标识）
      "mode": "subagent",                 // primary | subagent | all
      "model": "claude-opus-5",           // 使用的模型
      "prompt": "You are a specialist in...", // 自定义系统提示
      "permission": {
        "level": "normal"                 // auto | ask | block
      },
      "temperature": 0.7,                 // 采样温度 (0-1)
      "steps": 50,                        // 最大步数限制
      "hidden": false                     // 是否在 UI 中隐藏
    }
  ]
}
```

### Mode 说明
- **`primary`** — 只作为主 agent（用户直接交互）
- **`subagent`** — 只作为子 agent（被其他 agent 委托）
- **`all`** — 两种模式都可用

### 创建命令（可选）
```bash
cd backend/cli
bun src/cli/cmd/agent.ts create --name my-agent --model claude-sonnet-5
```

### 相关文件
- 配置：`.openscience/openscience.jsonc`
- Agent 定义类型：`backend/cli/src/agent/agent.ts`
- Agent 加载逻辑：`backend/cli/src/agent/index.ts`

---

## 2. 自定义 Agent 提示词

### 方法 A：文件模板（推荐）

**步骤 1** — 创建提示词文件  
在 `backend/cli/src/agent/prompt/` 下创建 `my-agent.txt`：

```text
You are a specialist in domain X.

Your responsibilities:
1. Task A
2. Task B
3. Task C

Guidelines:
- Be precise
- Focus on Y
- Always verify Z
```

**步骤 2** — 注册提示词  
编辑 `backend/cli/src/session/prompt.ts`，在 `insertReminders` 函数中添加：

```typescript
if (agent.name === "my-agent") {
  reminders.push({
    title: "My Agent Instructions",
    content: await readFile("src/agent/prompt/my-agent.txt", "utf-8"),
  })
}
```

### 方法 B：直接在配置中写
在 `.openscience/openscience.jsonc` 的 `agent[].prompt` 字段直接写完整提示词（适合短提示）。

### 相关文件
- 提示词模板目录：`backend/cli/src/agent/prompt/`
- 提示词注入逻辑：`backend/cli/src/session/prompt.ts` → `insertReminders()`
- 现有示例：`code-reviewer.txt`, `general-purpose.txt`

---

## 3. 子 Agent 委托机制

### 核心工具
`backend/cli/src/tool/task.ts` 的 `TaskTool`

### 并发控制
- **默认限制**：`MAX_COMPUTE_SUBAGENTS = 2`（同时最多 2 个子 agent）
- **环境变量覆盖**：`OPENSCIENCE_MAX_COMPUTE_SUBAGENTS`
- **实现机制**：`HierarchicalSemaphore` 类

### 预定义计算 Agent
```typescript
const COMPUTE_SUBAGENTS = {
  biology: "biology-specialist", 
  ml: "ml-specialist",
  physics: "physics-specialist"
}
```

### 使用示例
```typescript
// 在 agent 工具调用中
const result = await TaskTool.execute({
  agentType: "ml",                    // 使用预定义的 ml-specialist
  task: "Train a classifier on dataset X",
  context: { dataset: "path/to/data" } // 传递上下文
}, ctx)
```

### 添加新的委托类型

**步骤 1** — 定义 agent（见第 1 节）

**步骤 2** — 在 `backend/cli/src/tool/task.ts` 中添加：
```typescript
const COMPUTE_SUBAGENTS = {
  biology: "biology-specialist",
  ml: "ml-specialist",
  physics: "physics-specialist",
  myDomain: "my-specialist"  // 新增
}
```

### 相关文件
- 委托工具：`backend/cli/src/tool/task.ts`
- 并发控制：`HierarchicalSemaphore` 类（同文件）
- Agent 执行入口：`backend/cli/src/session/execute.ts`

---

## 4. 工作流阶段控制

### Stage Tool（可控节点）

**新功能特性**：
- 阶段划分与命名
- 人机协作门控（HITL gate）
- 阶段间快照与 diff
- 跳转重启功能

### 基本用法
```typescript
// 在 agent 工具调用中
await stage({
  name: "证据搜集",
  summary: "发现了 3 个问题需要进一步验证",  // 上一阶段总结（可选）
  gate: true                                  // 是否暂停等待人类确认
})
```

### Gate 参数说明
- `gate: false`（默认）— 自动进入该阶段
- `gate: true` — 暂停并弹出确认对话框：
  - 用户选择 "Continue" → 继续执行
  - 用户选择 "Stop here" 或关闭对话框 → 中止执行

### 跳转到指定阶段
```typescript
// 通过 SDK
import { SessionStage } from "@openscience/sdk"

await SessionStage.jump({
  sessionID: "xxx",
  partID: "stage-part-id"  // 目标阶段的 part ID
})
```

**跳转行为**：
1. Fork 会话到目标节点（保留之前的消息历史）
2. 恢复该节点的 snapshot（文件状态）
3. 从目标阶段重新开始执行

### 前端界面
- **位置**：右侧面板 → "Stages" 选项卡
- **显示内容**：
  - 阶段时间线
  - 每个阶段的名称、状态、时间戳
  - 阶段间代码 diff（+additions / -deletions）
- **交互**：点击 "Restart from here" 按钮跳转到该阶段

### 相关文件
- 后端核心：`backend/cli/src/session/stage.ts`
- Stage 工具：`backend/cli/src/tool/stage.ts`
- 工具描述：`backend/cli/src/tool/stage.txt`
- 前端组件：`frontend/workspace/src/atlas/StagesPanel.tsx`
- 消息类型：`backend/cli/src/session/message-v2.ts` → `StagePart`
- API 路由：`backend/cli/src/server/routes/session.ts` → `/session/:id/stage/*`
- 测试：`backend/cli/test/session-stage.test.ts`

---

## 5. 自定义工具

### 创建新工具

**步骤 1** — 创建工具文件  
在 `backend/cli/src/tool/` 下创建 `my-tool.ts`：

```typescript
import { Tool } from "./tool"
import z from "zod"

export const MyTool = Tool.define({
  id: "my_tool",
  description: "My custom tool does X, Y, and Z",
  
  parameters: z.object({
    input: z.string().describe("Input parameter description"),
    optional: z.number().optional().describe("Optional parameter"),
  }),
  
  async execute(params, ctx) {
    // ctx 提供的上下文：
    // - ctx.sessionID: 当前会话 ID
    // - ctx.messageID: 当前消息 ID
    // - ctx.callID: 当前工具调用 ID
    // - ctx.ask(): 权限检查函数
    
    // 权限检查示例
    await ctx.ask({ 
      permission: "my_tool",
      patterns: ["*"],
      always: ["*"],
      metadata: {}
    })
    
    // 执行工具逻辑
    const result = doSomething(params.input)
    
    // 返回结果
    return {
      title: "Tool executed successfully",
      output: `Result: ${result}`,
      metadata: { 
        customField: "value",
        processed: params.input
      }
    }
  }
})
```

**步骤 2** — 注册工具  
编辑 `backend/cli/src/tool/registry.ts`：

```typescript
import { MyTool } from "./my-tool"

export const TOOLS = [
  // ... 现有工具
  BashTool,
  ReadTool,
  // ... 
  MyTool,  // 新增
]
```

**步骤 3**（可选）— 添加工具描述文件  
创建 `backend/cli/src/tool/my-tool.txt` 用于详细说明。

### Tool.define 签名
```typescript
Tool.define<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: {
    description: string,
    parameters: Parameters,
    execute: (params: z.infer<Parameters>, ctx: ToolContext) => Promise<{
      title: string,
      output: string,
      metadata?: Result
    }>
  }
)
```

### 相关文件
- 工具基类：`backend/cli/src/tool/tool.ts`
- 工具注册表：`backend/cli/src/tool/registry.ts`
- 现有工具示例：`bash.ts`, `read.ts`, `write.ts`, `stage.ts`
- 工具执行上下文：`backend/cli/src/session/execute.ts` → `ToolContext`

---

## 6. 权限控制

### Permission Rulesets

在 agent 定义中配置权限：

```jsonc
{
  "agent": [{
    "name": "restricted-agent",
    "permission": {
      "level": "ask",           // auto | ask | block
      "rules": {
        "bash": "block",        // 完全禁止 bash
        "file_write": {
          "level": "ask",       // 每次询问
          "patterns": ["src/**"]  // 只能修改 src/ 下的文件
        },
        "file_read": {
          "level": "auto",
          "patterns": ["**/*.md", "**/*.txt"]  // 自动允许读取文档
        }
      }
    }
  }]
}
```

### 权限级别
- **`auto`** — 自动允许，不询问用户
- **`ask`** — 每次执行前询问用户
- **`block`** — 完全禁止，拒绝执行

### 工具中的权限检查
```typescript
await ctx.ask({ 
  permission: "file_write",         // 权限名称（自由字符串）
  patterns: ["src/main.ts"],        // 匹配的文件/资源
  always: [],                       // 始终允许的模式
  metadata: { operation: "update" } // 附加元数据
})
```

### 重要特性
- **权限名称是自由字符串** — 无需修改代码枚举，直接在工具中使用新权限名
- **Pattern 匹配** — 支持 glob 模式（`*`, `**`, `?`）
- **运行时检查** — ruleset 在执行时动态匹配

### 相关文件
- 权限系统核心：`backend/cli/src/permission/`
- 权限检查入口：`backend/cli/src/permission/next.ts`
- Agent 配置类型：`backend/cli/src/agent/agent.ts` → `Permission`
- 工具上下文：`backend/cli/src/session/execute.ts` → `ctx.ask()`

---

## 7. Plugin 与 Skill 系统

### Plugin（MCP 集成）

**配置位置**：`.openscience/openscience.jsonc`

```jsonc
{
  "plugins": {
    "my-mcp-server": {
      "type": "local",
      "command": ["node", "path/to/server.js"],
      "environment": { 
        "API_KEY": "your_key",
        "TIMEOUT": "30000"
      },
      "timeout": 60000
    },
    "remote-service": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "auth": {
        "type": "bearer",
        "token": "xxx"
      }
    }
  }
}
```

**Plugin 类型**：
- `local` — 本地进程（stdio 通信）
- `remote` — 远程 HTTP 服务

### Skill（可复用工作流）

**创建 Skill**  
在 `.openscience/skills/` 下创建 `my-workflow.md`：

```markdown
---
name: my-workflow
description: Custom workflow for iterative development
agent: general-purpose
---

# My Custom Workflow

## Overview
This workflow helps with X, Y, and Z.

## Steps

1. **Discovery Phase**
   - Use `stage(name="Discovery", gate=true)` to pause before starting
   - Search codebase for relevant files
   - Summarize findings

2. **Implementation Phase**
   - Use `stage(name="Implementation")` to mark the boundary
   - Make code changes
   - Run tests

3. **Review Phase**
   - Use `stage(name="Review", gate=true)` for human review
   - Generate diff summary
   - Wait for approval

## Guidelines
- Always use gates before risky operations
- Preserve file snapshots at each stage
- Provide clear summaries
```

**调用 Skill**：
- 命令行：`/my-workflow`
- SDK：`await Skill.execute({ name: "my-workflow", args: "..." })`

### 相关文件
- Plugin 配置：`.openscience/openscience.jsonc` → `plugins`
- Plugin 加载：`backend/cli/src/plugin/`
- Skill 目录：`.openscience/skills/`
- Skill 解析：`backend/cli/src/skill/`

---

## 8. 修改建议 — 最小侵入原则

基于项目约束（"不动大框架"），推荐的扩展方式：

### ✅ 零侵入（推荐）

这些修改不触及核心框架，可以自由添加：

| 修改类型 | 文件位置 | 说明 |
|---------|---------|------|
| 新 Agent 定义 | `.openscience/openscience.jsonc` | 添加 `agent` 数组项 |
| 新工具 | `backend/cli/src/tool/my-tool.ts` + `registry.ts` | 新文件 + 一行注册 |
| Prompt 模板 | `backend/cli/src/agent/prompt/my-agent.txt` | 独立文本文件 |
| Skill 工作流 | `.openscience/skills/my-workflow.md` | 独立 markdown |
| Plugin 集成 | `.openscience/openscience.jsonc` → `plugins` | 配置项 |

### ⚠️ 轻度侵入（谨慎）

这些修改需要编辑 1-2 个现有文件，但不改变核心逻辑：

| 修改类型 | 文件位置 | 修改点 |
|---------|---------|-------|
| Agent 提示词注入 | `backend/cli/src/session/prompt.ts` | `insertReminders()` 函数添加 if 分支 |
| 新委托类型 | `backend/cli/src/tool/task.ts` | `COMPUTE_SUBAGENTS` 常量添加一项 |
| 前端新面板 | `frontend/workspace/src/atlas/` | 新组件 + `RightPane.tsx` 添加 tab |

### ❌ 避免修改（核心框架）

这些文件是系统核心，不要修改：

| 文件 | 原因 |
|-----|------|
| `backend/cli/src/session/processor.ts` | Agent 主循环 |
| `backend/cli/src/session/prompt.ts` | 除了 `insertReminders()` 外的其他部分 |
| `backend/cli/src/llm/llm.ts` | LLM 调用层 |
| `backend/cli/src/session/compaction.ts` | 上下文压缩 |
| `backend/cli/src/snapshot/` | 快照系统 |
| `backend/cli/src/permission/next.ts` | 权限检查核心 |
| `backend/cli/src/server/server.ts` | HTTP 服务器主体 |

---

## 9. 实战示例 — 代码审查工作流

完整展示如何组合各个模块创建一个实用工作流。

### 目标
创建一个自动化代码审查流程：
1. 用户提交代码
2. 系统自动分析潜在问题
3. 人工确认是否需要修复
4. 自动生成修复建议
5. 应用修复后重新审查

### 步骤 1：定义审查 Agent

编辑 `.openscience/openscience.jsonc`：

```jsonc
{
  "agent": [
    {
      "name": "code-reviewer",
      "mode": "subagent",
      "model": "claude-opus-5",
      "prompt": "You are a senior code reviewer specializing in security, performance, and maintainability.",
      "permission": {
        "level": "ask",
        "rules": {
          "file_write": "block",  // 审查 agent 只读，不能修改代码
          "file_read": "auto",
          "bash": "block"
        }
      },
      "temperature": 0.3,
      "steps": 30
    },
    {
      "name": "code-fixer",
      "mode": "subagent",
      "model": "claude-sonnet-5",
      "prompt": "You are a code refactoring specialist. Apply fixes precisely as instructed.",
      "permission": {
        "level": "ask",
        "rules": {
          "file_write": {
            "level": "ask",
            "patterns": ["src/**", "test/**"]
          },
          "file_read": "auto"
        }
      },
      "temperature": 0.5,
      "steps": 20
    }
  ]
}
```

### 步骤 2：创建审查工具

创建 `backend/cli/src/tool/code-review.ts`：

```typescript
import { Tool } from "./tool"
import { StageTool } from "./stage"
import { TaskTool } from "./task"
import z from "zod"

export const CodeReviewTool = Tool.define({
  id: "code_review",
  description: "Conduct a comprehensive code review with optional auto-fix",
  
  parameters: z.object({
    files: z.array(z.string()).describe("Files to review"),
    autoFix: z.boolean().optional().describe("Automatically apply fixes after review"),
    severity: z.enum(["all", "high", "critical"]).optional().describe("Minimum severity to report"),
  }),
  
  async execute(params, ctx) {
    const results: string[] = []
    
    // Stage 1: Analysis
    await StageTool.execute({
      name: "Code Analysis",
      gate: false
    }, ctx)
    
    const reviewResult = await TaskTool.execute({
      agentType: "code-reviewer",
      task: `Review these files for security, performance, and maintainability issues: ${params.files.join(", ")}`,
      context: { 
        files: params.files,
        severity: params.severity || "all"
      }
    }, ctx)
    
    results.push(`Found ${reviewResult.issuesCount} issues`)
    
    // Stage 2: Human Review Gate
    if (reviewResult.issuesCount > 0) {
      await StageTool.execute({
        name: "Review Findings",
        summary: `Found ${reviewResult.issuesCount} issues across ${params.files.length} files`,
        gate: true  // 人工确认是否继续修复
      }, ctx)
      
      // Stage 3: Auto-fix (if enabled and approved)
      if (params.autoFix) {
        await StageTool.execute({
          name: "Apply Fixes",
          gate: false
        }, ctx)
        
        const fixResult = await TaskTool.execute({
          agentType: "code-fixer",
          task: `Apply fixes for the following issues: ${reviewResult.issues.join("; ")}`,
          context: {
            files: params.files,
            issues: reviewResult.issues
          }
        }, ctx)
        
        results.push(`Applied ${fixResult.fixedCount} fixes`)
        
        // Stage 4: Verification
        await StageTool.execute({
          name: "Verification",
          summary: `Applied ${fixResult.fixedCount} fixes`,
          gate: true  // 人工验证修复结果
        }, ctx)
      }
    }
    
    return {
      title: "Code Review Complete",
      output: results.join("\n"),
      metadata: {
        filesReviewed: params.files.length,
        issuesFound: reviewResult.issuesCount,
        issuesFixed: params.autoFix ? reviewResult.fixedCount : 0
      }
    }
  }
})
```

### 步骤 3：注册工具

编辑 `backend/cli/src/tool/registry.ts`：

```typescript
import { CodeReviewTool } from "./code-review"

export const TOOLS = [
  // ... existing tools
  CodeReviewTool,
]
```

### 步骤 4：创建 Skill（可选）

创建 `.openscience/skills/review-pr.md`：

```markdown
---
name: review-pr
description: Review all changes in the current PR
agent: general-purpose
---

# PR Review Workflow

1. Get list of changed files from git
2. Call `code_review` tool with `autoFix: false` first
3. Review findings with the user
4. If approved, run again with `autoFix: true`
5. Generate PR comment summary
```

### 使用方式

**方式 1：直接调用工具**
```typescript
// 在 agent 对话中
code_review({
  files: ["src/auth.ts", "src/api.ts"],
  autoFix: true,
  severity: "high"
})
```

**方式 2：调用 Skill**
```bash
/review-pr
```

**方式 3：通过 SDK**
```typescript
import { CodeReviewTool } from "@openscience/sdk"

await CodeReviewTool.execute({
  files: ["src/**/*.ts"],
  autoFix: false,
  severity: "critical"
})
```

### 工作流执行效果

1. **Stage 1: Code Analysis**  
   - code-reviewer agent 分析所有文件
   - 生成问题报告（安全、性能、可维护性）
   
2. **Stage 2: Review Findings** 🚪 [GATE]  
   - 暂停，展示发现的问题
   - 用户选择：Continue（继续修复）或 Stop（仅查看）
   
3. **Stage 3: Apply Fixes**（如果 autoFix=true 且用户批准）  
   - code-fixer agent 应用修复
   - 保存文件快照
   
4. **Stage 4: Verification** 🚪 [GATE]  
   - 展示修复后的 diff
   - 用户确认修复质量
   - 如果不满意，可以跳回 Stage 2 重新选择

### 前端界面展示

在 Stages 面板中会看到：

```
1. Code Analysis          [completed]  2024-01-15 10:30:22
   +0 / -0

2. Review Findings       [completed]  2024-01-15 10:31:05
   +0 / -0
   
3. Apply Fixes           [completed]  2024-01-15 10:32:18
   +45 / -23

4. Verification          [active]     2024-01-15 10:33:01
   (current stage)
```

点击任意阶段的 "Restart from here" 可以跳回重新执行。

---

## 总结

通过组合以上模块，你可以：

1. **定义专用 Agent**（审查 agent、修复 agent、测试 agent...）
2. **创建自定义工具**（code_review, deploy, benchmark...）
3. **设计多阶段工作流**（stage + gate 实现人机协作关键点）
4. **控制权限**（审查 agent 只读，修复 agent 可写特定目录）
5. **封装为 Skill**（一键调用完整流程）

所有这些都遵循**最小侵入原则**，不修改核心框架，便于维护和升级。

---

## 快速查找表

| 需求 | 修改文件 | 章节 |
|-----|---------|------|
| 添加新 agent 类型 | `.openscience/openscience.jsonc` | §1 |
| 自定义 agent 提示词 | `backend/cli/src/agent/prompt/*.txt` + `session/prompt.ts` | §2 |
| 添加子 agent 委托类型 | `backend/cli/src/tool/task.ts` | §3 |
| 使用 stage + gate | 工具调用 `stage({name, gate})` | §4 |
| 创建新工具 | `backend/cli/src/tool/my-tool.ts` + `registry.ts` | §5 |
| 配置权限 | `.openscience/openscience.jsonc` → `agent[].permission` | §6 |
| 集成 MCP plugin | `.openscience/openscience.jsonc` → `plugins` | §7 |
| 创建可复用工作流 | `.openscience/skills/my-workflow.md` | §7 |

---

**项目来源**：本项目基于 [synthetic-sciences/openscience](https://github.com/synthetic-sciences/openscience) 修改。
