import { describe, expect, test } from "bun:test"
import { MAX_SECRET_BYTES, createRedactor } from "../../src/process/redaction"

describe("streaming process redaction", () => {
  test("redacts a secret at every chunk split", () => {
    const secret = "redaction-canary-0123456789"

    for (let split = 0; split <= secret.length; split++) {
      const redactor = createRedactor([secret])
      const output = redactor.push(`prefix ${secret.slice(0, split)}`) + redactor.push(`${secret.slice(split)} suffix`) + redactor.flush()

      expect(output).toBe("prefix [REDACTED] suffix")
    }
  })

  test("handles overlapping and multibyte secrets without leaking either value", () => {
    const redactor = createRedactor(["秘密令牌", "令牌"])
    const output = redactor.push("a 秘密") + redactor.push("令牌 b") + redactor.flush()

    expect(output).toBe("a [REDACTED] b")
    expect(output).not.toContain("秘密令牌")
    expect(output).not.toContain("令牌")
  })

  test("rejects a secret above the registered byte limit", () => {
    expect(() => createRedactor(["x".repeat(MAX_SECRET_BYTES + 1)])).toThrow(/16 KiB/)
  })

  test("does not retain a tail when no secrets are registered", () => {
    const redactor = createRedactor([])

    expect(redactor.push("hello")).toBe("hello")
    expect(redactor.flush()).toBe("")
  })
})
