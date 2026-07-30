import { describe, expect, test } from "bun:test"
import { JSONParseError } from "ai"
import { seal, wrap } from "../../src/util/sse"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"

async function read(stream: ReadableStream<Uint8Array>) {
  const parts: string[] = []
  const dec = new TextDecoder()
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parts.push(dec.decode(value))
  }
  return parts.join("")
}

describe("util.sse.seal", () => {
  test("forwards complete SSE lines across chunk boundaries", async () => {
    const src = new ReadableStream<Uint8Array>({
      start(ctl) {
        const enc = new TextEncoder()
        ctl.enqueue(enc.encode('data: {"id":"a","choi'))
        ctl.enqueue(enc.encode('ces":[]}\n\n'))
        ctl.enqueue(enc.encode("data: [DONE]\n\n"))
        ctl.close()
      },
    })
    const out = await read(seal(src))
    expect(out).toBe('data: {"id":"a","choices":[]}\n\ndata: [DONE]\n\n')
  })

  test("throws JSONParseError on truncated final data line", async () => {
    const src = new ReadableStream<Uint8Array>({
      start(ctl) {
        const enc = new TextEncoder()
        ctl.enqueue(enc.encode('data: {"id":"chatcmpl-x","choices":[{"delta":{"tool_calls":[{"id":"call-abc'))
        ctl.close()
      },
    })
    expect(read(seal(src))).rejects.toBeInstanceOf(JSONParseError)
  })
})

describe("util.sse.wrap", () => {
  test("leaves non-SSE responses untouched", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(new TextEncoder().encode('{"ok":true}'))
        ctl.close()
      },
    })
    const res = new Response(body, { headers: { "content-type": "application/json" } })
    expect(wrap(res)).toBe(res)
  })
})

describe("session.fromError stream JSON variants", () => {
  test("retries plain Error named AI_JSONParseError", () => {
    const error = Object.assign(new Error("JSON parsing failed: Unterminated string"), {
      name: "AI_JSONParseError",
    })
    const result = MessageV2.fromError(error, { providerID: "synsci" }) as MessageV2.APIError
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    expect(result.data.isRetryable).toBe(true)
    expect(SessionRetry.retryable(result)).toContain("incomplete JSON")
  })

  test("retries stringified AI_JSONParseError throws", () => {
    const result = MessageV2.fromError(
      'AI_JSONParseError: JSON parsing failed: Text: {"id":"x. Error message: Unterminated string',
      { providerID: "synsci" },
    ) as MessageV2.APIError
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    expect(SessionRetry.retryable(result)).toContain("incomplete JSON")
  })
})
