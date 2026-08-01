import { describe, expect, test } from "bun:test"
import { RLMState } from "../../src/session/rlm/state"
import { TaskResultCode } from "../../src/tool/task-result"

describe("RLMState.parseExecutorOutput", () => {
  test("delegates to TaskResult and never defaults missing structure to success", () => {
    const missing = RLMState.parseExecutorOutput("just prose", "ses_1")
    expect(missing.status).toBe("partial")
    expect(missing.code).toBe(TaskResultCode.unstructured_result)
    expect(missing.findings[0]).toBe("just prose")
    expect(missing.sessionID).toBe("ses_1")
  })

  test("empty output is failure/empty_result", () => {
    const empty = RLMState.parseExecutorOutput("  ", "ses_1")
    expect(empty.status).toBe("failure")
    expect(empty.code).toBe(TaskResultCode.empty_result)
  })

  test("reads legacy rlm_result and canonical task_result", () => {
    const rlm = RLMState.parseExecutorOutput(
      `<rlm_result><status>success</status><findings>["a"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>["art"]</artifact_refs><suggestions>[]</suggestions></rlm_result>`,
      "ses_1",
    )
    expect(rlm.status).toBe("success")
    expect(rlm.findings).toEqual(["a"])
    expect(rlm.artifactRefs).toEqual(["art"])

    const canonical = RLMState.parseExecutorOutput(
      `<task_result>${JSON.stringify({
        status: "failure",
        code: "boom",
        message: "nope",
        findings: [],
        failures: ["x"],
        assumptions: [],
        artifactRefs: [],
        suggestions: [],
        parameters: {},
      })}</task_result>`,
      "ses_1",
    )
    expect(canonical.status).toBe("failure")
    expect(canonical.code).toBe("boom")
    expect(canonical.message).toBe("nope")
  })

  test("malformed canonical is not salvaged by a lower-priority rlm success", () => {
    const mixed = RLMState.parseExecutorOutput(
      `<task_result>{bad</task_result><rlm_result><status>success</status><findings>["x"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>[]</artifact_refs><suggestions>[]</suggestions></rlm_result>`,
      "ses_1",
    )
    expect(mixed.status).toBe("failure")
    expect(mixed.code).toBe(TaskResultCode.malformed_result)
  })

  test("cancelled/timeout TaskResults collapse to failure in CompressedResult", () => {
    // parseExecutorOutput only sees text; cancelled/timeout are TaskTool terminals.
    // Ensure failure-like declared statuses still map cleanly.
    const declared = RLMState.parseExecutorOutput(
      `<task_result>${JSON.stringify({
        status: "cancelled",
        code: "cancelled",
        message: "stop",
        findings: [],
        failures: [],
        assumptions: [],
        artifactRefs: [],
        suggestions: [],
        parameters: {},
      })}</task_result>`,
      "ses_1",
    )
    expect(declared.status).toBe("failure")
    expect(declared.code).toBe("cancelled")
  })
})
