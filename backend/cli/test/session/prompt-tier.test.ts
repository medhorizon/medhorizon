import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { SessionPrompt } from "../../src/session/prompt"

describe("SessionPrompt.modelTier", () => {
  const selected = { providerID: "openrouter", modelID: "anthropic/claude-opus-4.8" }

  test("keeps a tier when a command uses the selected model", () => {
    expect(SessionPrompt.modelTier("fast", selected, selected)).toBe("fast")
  })

  test("drops a tier when a command overrides the selected model", () => {
    expect(
      SessionPrompt.modelTier("fast", selected, {
        providerID: "anthropic",
        modelID: "claude-opus-4-8",
      }),
    ).toBeUndefined()
  })
})

describe("research prompt atlas retirement", () => {
  const research = readFileSync(path.join(import.meta.dir, "../../src/agent/prompt/research.txt"), "utf-8")

  test("keeps Stage / local Research Graph guidance and atlas_* compatibility tools", () => {
    expect(research).toContain("Research Graph")
    expect(research).toContain("atlas_graph")
    expect(research).toContain("atlas_stage")
    expect(research).toContain("local Research Graph compatibility tool")
    expect(research).toMatch(/Stage 1:\s*SCOPE/)
  })

  test("does not guide Atlas Canvas, login, wallet, or managed compute", () => {
    expect(research).not.toContain("initialize-atlas-graph")
    expect(research).toContain("Do not suggest Atlas Canvas, Atlas login, wallet top-up, managed compute")
    expect(research).not.toContain("npm i -g @synsci/atlas")
    expect(research).not.toContain("atlas doctor --format=json")
    expect(research).not.toMatch(/run `medhorizon project init`/i)
  })
})

