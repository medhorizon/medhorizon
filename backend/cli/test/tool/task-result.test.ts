import { describe, expect, test, beforeEach } from "bun:test"
import {
  TaskResultSchema,
  TaskResultCode,
  success,
  partial,
  failure,
  cancelled,
  timeout,
  serialize,
  encode,
  decode,
  applyTerminal,
  terminalCause,
  resetTelemetry,
  telemetry,
  emptyArrays,
} from "../../src/tool/task-result"

const SID = "ses_child_auth"

beforeEach(() => {
  resetTelemetry()
})

describe("task-result schema", () => {
  test("union contains exactly success, partial, failure, cancelled, timeout", () => {
    const statuses = TaskResultSchema.options.map((opt) => opt.shape.status.value)
    const expected = ["cancelled", "failure", "partial", "success", "timeout"] as const
    expect([...statuses].sort()).toEqual([...expected].sort())
  })

  test("failure-like variants require code and message", () => {
    expect(() =>
      TaskResultSchema.parse({
        status: "partial",
        sessionID: SID,
        ...emptyArrays(),
      }),
    ).toThrow()
    expect(() =>
      TaskResultSchema.parse({
        status: "failure",
        code: "x",
        sessionID: SID,
        ...emptyArrays(),
      }),
    ).toThrow()
    expect(
      TaskResultSchema.parse({
        status: "failure",
        code: "x",
        message: "y",
        sessionID: SID,
        ...emptyArrays(),
      }).status,
    ).toBe("failure")
  })

  test("all variants preserve arrays, artifact refs, and sessionID", () => {
    const fields = {
      findings: ["a"],
      failures: ["b"],
      assumptions: ["c"],
      artifactRefs: ["art-1"],
      suggestions: ["d"],
      parameters: { k: 1 },
    }
    for (const result of [
      success(SID, fields),
      partial(SID, "code", "msg", fields),
      failure(SID, "code", "msg", fields),
      cancelled(SID, "msg", fields),
      timeout(SID, "msg", fields),
    ]) {
      expect(result.sessionID).toBe(SID)
      expect(result.findings).toEqual(["a"])
      expect(result.artifactRefs).toEqual(["art-1"])
      expect(result.parameters).toEqual({ k: 1 })
    }
  })

  test("model-supplied session ID cannot replace TaskTool-owned ID via constructors", () => {
    const result = success("owned", { findings: ["x"] })
    expect(result.sessionID).toBe("owned")
    expect(result.sessionID).not.toBe("spoofed")
  })

  test("serialization is deterministic and round-trips through the schema", () => {
    const result = partial(SID, TaskResultCode.invalid_result, "bad", {
      findings: ["f"],
      artifactRefs: ["art-9"],
    })
    const once = serialize(result)
    const twice = serialize(result)
    expect(once).toBe(twice)
    const parsed = TaskResultSchema.parse(JSON.parse(once))
    expect(parsed).toEqual(result)
  })
})

describe("task-result decode", () => {
  test("valid canonical JSON and legacy tags normalize to the same TaskResult", () => {
    const canonical = `<task_result>${JSON.stringify({
      status: "success",
      findings: ["hit"],
      failures: [],
      assumptions: [],
      artifactRefs: ["art-1"],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const legacy = [
      "<task_result>",
      "<status>success</status>",
      `<findings>${JSON.stringify(["hit"])}</findings>`,
      "<failures>[]</failures>",
      "<assumptions>[]</assumptions>",
      "<parameters>{}</parameters>",
      `<artifact_refs>${JSON.stringify(["art-1"])}</artifact_refs>`,
      "<suggestions>[]</suggestions>",
      "</task_result>",
    ].join("\n")
    const a = decode(canonical, SID).result
    const b = decode(legacy, SID).result
    expect(a.status).toBe("success")
    expect(b.status).toBe("success")
    expect(a.findings).toEqual(b.findings)
    expect(a.artifactRefs).toEqual(b.artifactRefs)
    expect(a.sessionID).toBe(SID)
    expect(b.sessionID).toBe(SID)
  })

  test("canonical JSON outranks field-per-tag which outranks rlm_result", () => {
    const text = [
      `<rlm_result><status>success</status><findings>["rlm"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>[]</artifact_refs><suggestions>[]</suggestions></rlm_result>`,
      `<task_result><status>success</status><findings>["tags"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>[]</artifact_refs><suggestions>[]</suggestions></task_result>`,
      `<task_result>${JSON.stringify({
        status: "success",
        findings: ["json"],
        failures: [],
        assumptions: [],
        artifactRefs: [],
        suggestions: [],
        parameters: {},
      })}</task_result>`,
    ].join("\n")
    const { result, diagnostics } = decode(text, SID)
    expect(result.status).toBe("success")
    expect(result.findings).toEqual(["json"])
    expect(diagnostics.some((d) => d.kind === "ignored_envelope")).toBe(true)
  })

  test("malformed canonical does not fall back to lower-priority success", () => {
    const text = [
      `<task_result>{not-json</task_result>`,
      `<rlm_result><status>success</status><findings>["legacy-ok"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>[]</artifact_refs><suggestions>[]</suggestions></rlm_result>`,
    ].join("\n")
    const { result } = decode(text, SID)
    expect(result.status).toBe("failure")
    if (result.status !== "failure") throw new Error("expected failure")
    expect(result.code).toBe(TaskResultCode.malformed_result)
    expect(result.findings).not.toContain("legacy-ok")
  })

  test("duplicate conflicting canonical envelopes are ambiguous_result", () => {
    const a = `<task_result>${JSON.stringify({
      status: "success",
      findings: ["one"],
      failures: [],
      assumptions: [],
      artifactRefs: [],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const b = `<task_result>${JSON.stringify({
      status: "success",
      findings: ["two"],
      failures: [],
      assumptions: [],
      artifactRefs: [],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const { result } = decode(`${a}\n${b}`, SID)
    expect(result.status).toBe("partial")
    if (result.status !== "partial") throw new Error("expected partial")
    expect(result.code).toBe(TaskResultCode.ambiguous_result)
  })

  test("identical duplicate envelopes are accepted with duplicate diagnostic", () => {
    const block = `<task_result>${JSON.stringify({
      status: "success",
      findings: ["same"],
      failures: [],
      assumptions: [],
      artifactRefs: [],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const { result, diagnostics } = decode(`${block}\n${block}`, SID)
    expect(result.status).toBe("success")
    expect(diagnostics.some((d) => d.kind === "duplicate_envelope" && d.detail.includes("identical"))).toBe(true)
  })

  test("missing structure with non-empty text is partial/unstructured_result without truncation", () => {
    const prose = "x".repeat(5000)
    const { result } = decode(prose, SID)
    expect(result.status).toBe("partial")
    if (result.status !== "partial") throw new Error("expected partial")
    expect(result.code).toBe(TaskResultCode.unstructured_result)
    expect(result.findings[0]?.length).toBe(5000)
    expect(telemetry().unstructured).toBe(1)
  })

  test("empty output is failure/empty_result", () => {
    const { result } = decode("   \n\t  ", SID)
    expect(result.status).toBe("failure")
    if (result.status !== "failure") throw new Error("expected failure")
    expect(result.code).toBe(TaskResultCode.empty_result)
  })

  test("schema-invalid but recoverable JSON is partial/invalid_result", () => {
    const text = `<task_result>${JSON.stringify({
      status: "success",
      findings: 42,
      failures: [],
      assumptions: [],
      artifactRefs: ["kept"],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const { result } = decode(text, SID)
    expect(result.status).toBe("partial")
    if (result.status !== "partial") throw new Error("expected partial")
    expect(result.code).toBe(TaskResultCode.invalid_result)
    expect(result.artifactRefs).toEqual(["kept"])
  })

  test("unknown status never becomes success", () => {
    const text = `<task_result>${JSON.stringify({
      status: "wonky",
      findings: ["a"],
      failures: [],
      assumptions: [],
      artifactRefs: [],
      suggestions: [],
      parameters: {},
    })}</task_result>`
    const { result } = decode(text, SID)
    expect(result.status).toBe("partial")
    expect(result.status).not.toBe("success")
  })

  test("legacy rlm_result remains readable and increments legacy telemetry", () => {
    const text = `<rlm_result>
      <status>partial</status>
      <findings>["from-rlm"]</findings>
      <failures>["f1"]</failures>
      <assumptions>[]</assumptions>
      <parameters>{}</parameters>
      <artifact_refs>["art-r"]</artifact_refs>
      <suggestions>[]</suggestions>
      <code>legacy_partial</code>
      <message>still useful</message>
    </rlm_result>`
    const { result } = decode(text, SID)
    expect(result.status).toBe("partial")
    if (result.status !== "partial") throw new Error("expected partial")
    expect(result.findings).toEqual(["from-rlm"])
    expect(result.code).toBe("legacy_partial")
    expect(telemetry().legacyRlm).toBe(1)
  })

  test("authoritative session ID overwrites spoofed model session ID", () => {
    const text = `<task_result>${JSON.stringify({
      status: "success",
      findings: [],
      failures: [],
      assumptions: [],
      artifactRefs: [],
      suggestions: [],
      parameters: {},
      sessionID: "ses_spoofed",
    })}</task_result>`
    const { result, diagnostics } = decode(text, SID)
    expect(result.sessionID).toBe(SID)
    expect(result.sessionID).not.toBe("ses_spoofed")
    expect(diagnostics.some((d) => d.kind === "session_id_mismatch")).toBe(true)
  })

  test("legacy encode remains consumable by the new decoder (rollback)", () => {
    const original = failure(SID, TaskResultCode.execution_error, "boom", {
      findings: ["f"],
      artifactRefs: ["art-2"],
    })
    const wire = encode(original, { legacy: true })
    const { result } = decode(wire, SID)
    expect(result.status).toBe("failure")
    if (result.status !== "failure") throw new Error("expected failure")
    expect(result.code).toBe(TaskResultCode.execution_error)
    expect(result.message).toBe("boom")
    expect(result.artifactRefs).toEqual(["art-2"])
    expect(result.sessionID).toBe(SID)
  })

  test("cancellation and timeout override decoded success text", () => {
    const decoded = success(SID, { findings: ["late"] })
    expect(applyTerminal("cancelled", SID, decoded).status).toBe("cancelled")
    expect(applyTerminal("timeout", SID, decoded).status).toBe("timeout")
    expect(applyTerminal("timeout", SID, decoded).findings).toEqual(["late"])
  })

  test("terminalCause distinguishes timeout reason from generic abort", () => {
    const cancel = new AbortController()
    cancel.abort()
    expect(terminalCause(cancel.signal)).toBe("cancelled")

    const timed = new AbortController()
    timed.abort("timeout")
    expect(terminalCause(timed.signal)).toBe("timeout")

    const idle = new AbortController()
    expect(terminalCause(idle.signal)).toBeUndefined()
    expect(terminalCause(idle.signal, "timeout")).toBe("timeout")
  })
})
