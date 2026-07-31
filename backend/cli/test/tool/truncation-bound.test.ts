import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Truncate } from "../../src/tool/truncation"

describe("Truncate.bound", () => {
  const prior = process.env.OPENSCIENCE_TOOL_RESULT_BOUND

  beforeEach(() => {
    process.env.OPENSCIENCE_TOOL_RESULT_BOUND = "1"
  })

  afterEach(() => {
    if (prior === undefined) delete process.env.OPENSCIENCE_TOOL_RESULT_BOUND
    else process.env.OPENSCIENCE_TOOL_RESULT_BOUND = prior
  })

  test("log truncation retains severity lines under tail budget", async () => {
    const noise = Array.from({ length: 200 }, (_, index) => `info line ${index}`).join("\n")
    const text = `${noise}\nERROR: disk full\n${Array.from({ length: 50 }, (_, index) => `tail ${index}`).join("\n")}`
    const result = await Truncate.bound(text, { tool: "bash", maxLines: 5, maxBytes: 400 })

    expect(result.content).toContain("ERROR: disk full")
    expect(result.content).toContain("tail 49")
  })

  test("search truncation keeps all hit ids/titles with next_page metadata", async () => {
    const hits = Array.from({ length: 10 }, (_, index) => ({
      id: `doi:${index}`,
      title: `Paper ${index}`,
      abstract: "x".repeat(500),
    }))
    const text = JSON.stringify({ results: hits })
    const result = await Truncate.bound(text, { tool: "websearch", maxBytes: 500 })

    expect(result.truncated).toBe(true)
    expect(result.content).toContain("truncated: true")
    expect(result.content).toContain("total: 10")
    for (const index of [0, 9]) {
      expect(result.content).toContain(`doi:${index}`)
      expect(result.content).toContain(`Paper ${index}`)
    }
    expect(result.content).toContain("next_page")
    if (!result.truncated) throw new Error("expected truncated")
    const full = await Bun.file(result.outputPath).text()
    expect(full).toBe(text)
  })

  test("structured keep-list preserves atlas graph ids inline", async () => {
    const graph = {
      graph_id: "g1",
      nodes: [
        { id: "n1", label: "A", body: "x".repeat(5000) },
        { id: "n2", label: "B", body: "y".repeat(5000) },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", narrative: "z".repeat(5000) }],
    }
    const text = JSON.stringify(graph)
    const result = await Truncate.bound(text, { tool: "atlas_graph", maxBytes: 800 })

    expect(result.content).toContain('"graph_id": "g1"')
    expect(result.content).toContain('"id": "n1"')
    expect(result.content).toContain('"id": "e1"')
    expect(result.content).toContain('"source": "n1"')
    expect(result.content).not.toContain("x".repeat(100))
  })

  test("spilled artifact path is readable via read contract", async () => {
    const text = `${"x".repeat(120)}\n`.repeat(500)
    const result = await Truncate.bound(text, { tool: "bash", maxLines: 3, maxBytes: 100 })

    expect(result.truncated).toBe(true)
    if (!result.truncated) throw new Error("expected truncated")
    expect(result.content).toContain("truncated: true")
    expect(await Bun.file(result.outputPath).exists()).toBe(true)
    expect(await Bun.file(result.outputPath).text()).toBe(text)
  })

  test("stage meta.medhorizon_stage is never stripped", async () => {
    const payload = {
      meta: { medhorizon_stage: 3, notes: "n".repeat(8000) },
      stage: 3,
      narrative: "m".repeat(8000),
    }
    const text = JSON.stringify(payload)
    const result = await Truncate.bound(text, { tool: "stage", maxBytes: 600 })

    expect(result.content).toContain('"medhorizon_stage": 3')
    expect(result.content).toContain('"stage": 3')
  })
})
