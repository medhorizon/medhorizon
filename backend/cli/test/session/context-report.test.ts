import { describe, expect, test } from "bun:test"
import { SessionTelemetry } from "../../src/session/telemetry"
import { Token } from "../../src/util/token"
import { buildProfileReport } from "../../src/session/context-report"

describe("session.context-report", () => {
  test("measures schema definitions in stable id order without retaining payloads", () => {
    const result = SessionTelemetry.measureSchemas([
      { id: "zeta", description: "Z", schema: { type: "object", properties: { z: { type: "string" } } } },
      { id: "alpha", description: "A", schema: { type: "object", properties: { a: { type: "string" } } } },
    ])

    expect(result.count).toBe(2)
    expect(result.items.map((item) => item.id)).toEqual(["alpha", "zeta"])
    expect(result.items[0]).toEqual({
      id: "alpha",
      bytes: expect.any(Number),
      tokens: expect.any(Number),
    })
    expect(result.bytes).toBe(result.items.reduce((sum, item) => sum + item.bytes, 0))
    expect(result.tokens).toBe(result.items.reduce((sum, item) => sum + item.tokens, 0))
    expect(result.items[0].tokens).toBe(
      Token.estimate(
        JSON.stringify({
          name: "alpha",
          description: "A",
          parameters: { type: "object", properties: { a: { type: "string" } } },
        }),
      ),
    )
  })

  test("uses the worst measured under-estimation plus ten percent", () => {
    expect(
      SessionTelemetry.correctionFactor([
        { estimate: 100, actual: 110 },
        { estimate: 200, actual: 250 },
      ]),
    ).toBeCloseTo(1.375)
    expect(SessionTelemetry.correctionFactor([])).toBe(1)
    expect(SessionTelemetry.correctionFactor([{ estimate: 100, actual: 90 }])).toBe(1)
  })

  test("marks legacy research baseline-only and applies corrected budgets", () => {
    const report = buildProfileReport({
      agent: "research",
      model: { providerID: "test", modelID: "model" },
      prompt: { bytes: 800, tokens: 200 },
      schemas: { count: 1, bytes: 4000, tokens: 1000, items: [{ id: "stage", bytes: 4000, tokens: 1000 }] },
      calibration: [{ family: "provider-a", model: "model-a", source: "provider", estimate: 100, actual: 120 }],
    })

    expect(report.baseline_only).toBe(true)
    expect(report.editable).toBe(false)
    expect(report.budget_enforced).toBe(false)
    expect(report.fixed_overhead.corrected_tokens).toBe(1584)
    expect(report.calibration[0].relative_error).toBeCloseTo(0.2)
  })
})
