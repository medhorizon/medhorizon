# Bugfix 记录

MedHorizon / OpenScience 已落地缺陷修复的活文档。索引最新在上；下方为 RCA 与验收细节。

相关发布说明见根目录 `CHANGELOG.md`。网关侧临时运维笔记曾在 `.tools/`（勿提交）。

---

## 索引

| ID | 日期 | 标题 | 版本 / 范围 | 状态 |
| --- | --- | --- | --- | --- |
| [BF-001](#bf-001-streaming-tool_calls-截断导致-ai_jsonparseerror) | 2026-07-30 | Streaming `tool_calls` 截断 → `AI_JSONParseError` | MedHorizon **v0.3.9** + CPA 8317 | ✅ Fixed |
| [BF-002](#bf-002-streaming-tool_calls-缺-function-导致-ai_typevalidationerror) | 2026-07-31 | Streaming `tool_calls` 缺 `function` → `AI_TypeValidationError` | MedHorizon **v0.3.10** + CPA `plus-ssefix2` | ✅ Fixed |
| [BF-003](#bf-003-tool-calls-后空续写导致会话假空闲) | 2026-07-31 | `tool-calls` 后空续写 → 会话假空闲 | MedHorizon **v0.3.10** | ✅ Fixed |
| [BF-004](#bf-004-shiki-主题注册名与-name-不一致) | 2026-07-31 | Shiki 主题注册 key 与 `name` 不一致 | MedHorizon **v0.3.10** | ✅ Fixed |

---

## BF-001: Streaming `tool_calls` 截断导致 `AI_JSONParseError`

### 症状

会话中途报错：`AI_JSONParseError` / `Unterminated string` / incomplete JSON。常见于经 OpenAI-compatible 网关（如 `local-8317` → CPA）的流式 `tool_calls`。Atlas / stage / skill 调用会硬失败。

### 根因

上游 SSE `chat.completion.chunk` 的 `data:` 行在 JSON 未闭合时被冲刷（或连接中断），AI SDK 按完整 JSON 解析失败。MedHorizon 原先把该类错误当不可重试，会话直接结束。

### 修复

**客户端（v0.3.9）**

- `SessionRetry` 将 `AI_JSONParseError` / Unterminated string 视为可重试流故障。
- Provider fetch 包装 `text/event-stream`：截断的末行 `data:` 显式升为 `JSONParseError`（可重试），避免半包静默丢失。

**网关（CPA on `101.34.34.89:8317`，运维侧）**

- 临时 `sse-seal-proxy` 曾试过，已**完整回滚**；公网仍直连 CPA。
- 在 CPA 侧保证只 flush 完整 JSON SSE（见 BF-002 的 `plus-ssefix2`）。

### 关键文件

- `backend/cli/src/session/retry.ts`
- Provider SSE 包装（v0.3.9 变更集）

### 验收

- 截断 SSE 触发自动重试，而非立刻红字结束会话。
- `CHANGELOG` MedHorizon v0.3.9 Fixed 条目。

---

## BF-002: Streaming `tool_calls` 缺 `function` 导致 `AI_TypeValidationError`

### 症状

流式工具调用时：`AI_TypeValidationError` / Type validation failed（`function` expected object）。与 BF-001 同类上游流问题，但 JSON 本身可能合法、schema 不合法。

### 根因

CPA Cursor→OpenAI 转换曾发出仅含 `id` / `type`、不含 `function:{name,arguments}` 的 `tool_calls` 分片。AI SDK 要求首个可见 tool-call delta 即带完整 `function` 对象。

首轮 CPA 热修 `plus-ssefix` 仍可能发出 id-only 分片；二次热修为 **`v7.1.40.2-plus-ssefix2`**。

### 修复

**网关**

- `cursor_executor`：首个 `tool_calls` chunk 含 `id` + `type` + `function{name,arguments:""}`，后续只 shard `arguments`。
- `writeSSEDataJSON`：仅 flush 完整 JSON；不完整行丢弃并在 `[DONE]` 前发 error。
- 回滚：主机 `/opt/cli-proxy-api/ROLLBACK_SSEFIX.md`，备份 `bin-backup/CLIProxyAPIPlus.orig`。

**客户端（v0.3.10）**

- `SessionRetry.retryable` 增加 `AI_TypeValidationError` → 有界重试。

### 关键文件

- `backend/cli/src/session/retry.ts`
- `backend/cli/test/session/retry.test.ts`
- CPA 源码（主机 bind-mount，非本仓库）

### 验收

- 畸形 `tool_calls` schema 走重试文案：`Provider stream returned invalid tool-call schema; retrying`。
- 8317 实测：SSE 行均为合法 JSON，并以 `[DONE]` 结束。

---

## BF-003: `tool-calls` 后空续写导致会话假空闲

### 症状

模型已发出 `finish_reason: tool-calls` 且工具执行完成，下一跳 LLM 返回「成功」但 **无 text / tools / reasoning**（常见 `tokens=0`）。UI 显示会话空闲，用户以为任务结束；Research Graph / skill 流水线实际卡住（例如 session 仅有假设文本、0 个 tool part）。

### 根因

`SessionProcessor` 在工具续写后把空 assistant 当正常完成，未区分「模型结束」与「上游空包/截断后的假成功」。

### 修复（v0.3.10）

- 在工具续写路径检测空 assistant（`isEmptyAssistant` + `hasToolContinuation`）。
- 抛出 `MessageV2.APIError`，`metadata.code = EMPTY_ASSISTANT_TURN`，前几次 `isRetryable: true`，耗尽后给出明确错误（不再假空闲）。
- `SessionRetry` 识别 `EMPTY_ASSISTANT_TURN`；`message-v2` 对已规范化 APIError 透传。

### 关键文件

- `backend/cli/src/session/processor.ts`
- `backend/cli/src/session/retry.ts`
- `backend/cli/src/session/message-v2.ts`
- `backend/cli/test/session/empty-continue.test.ts`
- `backend/cli/test/session/retry.test.ts`
- `backend/cli/test/session/text-loop.test.ts`

### 验收

```bash
cd backend/cli && bun test test/session/empty-continue.test.ts test/session/retry.test.ts
```

- 空续写会重试；仍空则会话报错，而不是静默 idle。

---

## BF-004: Shiki 主题注册名与 `name` 不一致

### 症状

前端控制台：`themeName: OpenScience does not match theme.name: MedHorizon`（或同类 Shiki 校验失败），代码高亮异常。

### 根因

`registerCustomTheme("OpenScience", …)` 的注册 key 为 `OpenScience`，但主题对象 `name` 写成了 `MedHorizon`。

### 修复（v0.3.10）

- `frontend/ui/src/context/marked.tsx`：主题 `name` 改为 `"OpenScience"`，与注册 key 一致。

### 验收

- 打开含代码块的会话/文档，无上述 theme 报错，高亮正常。

---

## 维护约定

1. **新修复**：先在本文件「索引」表追加一行，再写同 ID 详述节（症状 / 根因 / 修复 / 文件 / 验收）。
2. **版本**：写清 MedHorizon 版本号；纯运维/网关修复标明主机与二进制版本，并注明「非本仓库」。
3. **勿把密钥、`.tools/` 临时脚本、未脱敏日志写进本文件。**
4. 对外用户可见摘要同步到 `CHANGELOG.md`；本文件保留 RCA 深度。
