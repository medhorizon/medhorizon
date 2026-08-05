import { describe, expect, test } from "bun:test"
import { createReceipt, ExecutionPolicy, ProcessReceipt, reduceTerminal } from "../../src/process/types"

const base = {
  callID: "call-1",
  sessionID: "session-1",
  runtime: "python" as const,
  mode: "ephemeral" as const,
  lane: "scientific" as const,
  status: "success" as const,
  queuedAt: 100,
  startedAt: 110,
  endedAt: 140,
  waitMs: 10,
  runMs: 30,
  sandbox: "unavailable" as const,
  output: {
    inlineBytes: 12,
    totalBytes: 12,
    truncated: false,
    spilled: false,
  },
}

describe("process receipt contract", () => {
  test("creates a parseable receipt with an opaque random ID", () => {
    const first = createReceipt(base)
    const second = createReceipt(base)

    expect(ProcessReceipt.safeParse(first).success).toBe(true)
    expect(first.receiptID).toMatch(/^[0-9a-f]{32}$/)
    expect(second.receiptID).toMatch(/^[0-9a-f]{32}$/)
    expect(first.receiptID).not.toBe(second.receiptID)
    expect(first).not.toHaveProperty("command")
    expect(first).not.toHaveProperty("args")
    expect(first).not.toHaveProperty("env")
  })

  test("terminal reduction is immutable and never reopens a terminal state", () => {
    const cancelled = createReceipt({ ...base, status: "cancelled" })
    const lateSuccess = createReceipt({ ...base, status: "success" })

    expect(reduceTerminal(undefined, cancelled)).toBe(cancelled)
    expect(reduceTerminal(cancelled, lateSuccess)).toBe(cancelled)
    expect(reduceTerminal(cancelled, cancelled)).toBe(cancelled)
  })

  test("accepts only bounded execution policies without command material", () => {
    const policy = ExecutionPolicy.parse({
      runtime: "python",
      mode: "ephemeral",
      lane: "scientific",
      timeoutMs: 120_000,
      deadlineMs: 120_000,
      sandbox: "best-effort",
      env: { allow: ["PATH", "OMP_NUM_THREADS"], capabilities: [] },
    })

    expect(policy.timeoutMs).toBe(120_000)
    expect(policy.env.capabilities).toEqual([])
    expect(ExecutionPolicy.safeParse({ ...policy, timeoutMs: 0 }).success).toBe(false)
    expect(policy).not.toHaveProperty("command")
    expect(policy).not.toHaveProperty("args")
  })
})
