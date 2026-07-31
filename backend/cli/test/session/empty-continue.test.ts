import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"

const part = (type: MessageV2.Part["type"], extra: Record<string, unknown> = {}): MessageV2.Part =>
  ({
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type,
    ...extra,
  }) as MessageV2.Part

describe("SessionProcessor.isEmptyAssistant", () => {
  test("true for no parts", () => {
    expect(SessionProcessor.isEmptyAssistant([])).toBe(true)
  })

  test("true for bookkeeping-only parts (step-start/finish)", () => {
    expect(
      SessionProcessor.isEmptyAssistant([
        part("step-start", { snapshot: "snap" }),
        part("step-finish", {
          reason: "stop",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ]),
    ).toBe(true)
  })

  test("false when text is present", () => {
    expect(SessionProcessor.isEmptyAssistant([part("text", { text: "hello" })])).toBe(false)
  })

  test("true when text is only whitespace", () => {
    expect(SessionProcessor.isEmptyAssistant([part("text", { text: "  \n" })])).toBe(true)
  })

  test("false when a tool part exists", () => {
    expect(
      SessionProcessor.isEmptyAssistant([
        part("tool", {
          tool: "bash",
          callID: "c1",
          state: { status: "pending", input: {}, raw: "" },
        }),
      ]),
    ).toBe(false)
  })

  test("false when reasoning has content", () => {
    expect(
      SessionProcessor.isEmptyAssistant([
        part("reasoning", { text: "thinking…", time: { start: 1 } }),
      ]),
    ).toBe(false)
  })
})

describe("SessionProcessor.hasToolContinuation", () => {
  test("false for a fresh user-only prompt", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "research HCC" }]
    expect(SessionProcessor.hasToolContinuation(messages)).toBe(false)
  })

  test("true when a tool-result message is present", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "skill", input: { name: "x" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "skill", output: { type: "text", value: "ok" } }],
      },
    ]
    expect(SessionProcessor.hasToolContinuation(messages)).toBe(true)
  })

  test("true when prior assistant content includes a tool-call", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "atlas_graph", input: { action: "list" } }],
      },
    ]
    expect(SessionProcessor.hasToolContinuation(messages)).toBe(true)
  })
})

describe("MessageV2.fromError empty continue passthrough", () => {
  test("keeps EMPTY_ASSISTANT_TURN APIError retryable flag", () => {
    const thrown = new MessageV2.APIError({
      message: "Provider returned an empty assistant turn after tool execution; retrying",
      isRetryable: true,
      metadata: { code: "EMPTY_ASSISTANT_TURN", message: "empty continue attempt 1/3" },
    })
    const result = MessageV2.fromError(thrown, { providerID: "synsci" }) as MessageV2.APIError
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    expect(result.data.isRetryable).toBe(true)
    expect(result.data.metadata?.code).toBe("EMPTY_ASSISTANT_TURN")
  })
})
