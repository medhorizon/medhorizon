import { describe, expect, test } from "bun:test"
import { BATCH_CONCURRENCY, validateBatchCall } from "../../src/tool/batch"

describe("batch policy", () => {
  const available = new Map([
    ["read", {}],
    ["grep", {}],
    ["glob", {}],
    ["list", {}],
    ["bash", {}],
  ])

  test("allows only selected read-only tools", () => {
    for (const name of ["read", "grep", "glob", "list"]) {
      expect(() => validateBatchCall(name, available)).not.toThrow()
    }
  })

  test("rejects stateful, mutating, and nested tools", () => {
    for (const name of ["bash", "write", "edit", "task", "notebook", "rkernel", "artifact", "batch"]) {
      expect(() => validateBatchCall(name, available)).toThrow()
    }
  })

  test("selected toolset cannot be bypassed", () => {
    expect(() => validateBatchCall("read", new Map())).toThrow(/not in registry/)
    expect(() => validateBatchCall("mcp_read", new Map([["mcp_read", {}]]))).toThrow(/not allowed/)
  })

  test("keeps a bounded worker pool", () => {
    expect(BATCH_CONCURRENCY).toBe(4)
  })
})
