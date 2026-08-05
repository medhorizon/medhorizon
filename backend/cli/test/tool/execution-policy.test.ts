import { describe, expect, test } from "bun:test"
import { CapabilityPolicy, CapabilityGrants, CapabilityList, Execution } from "../../src/process/policy"
import type { SourceProof } from "../../src/process/policy"

const identity = { sessionID: "session-a", turnID: "turn-a", agent: "research" }

function source(overrides: Partial<SourceProof> = {}): SourceProof {
  return {
    sourceID: "bundled:demo",
    digest: "a".repeat(64),
    declared: CapabilityPolicy.list.parse(["llm:openrouter"]),
    loaded: true,
    permissionApproved: true,
    ...identity,
    ...overrides,
  }
}

describe("scoped subprocess capability policy", () => {
  test("missing execution keeps all credential env hidden", () => {
    const result = CapabilityPolicy.resolve({ ...identity, grants: { direct: ["llm:openrouter"] } })
    expect(result.capabilities).toEqual([])
    expect(result.env).toEqual([])
  })

  test("direct grants map logical IDs to exact env names", () => {
    const result = CapabilityPolicy.resolve({
      ...identity,
      grants: { direct: ["llm:openrouter"] },
      execution: { capabilities: ["llm:openrouter"] },
    })
    expect(result.capabilities).toEqual(["llm:openrouter"])
    expect(result.env).toEqual(["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"])
  })

  test("unknown, wildcard, raw env, and duplicate requests fail closed", () => {
    for (const capabilities of [
      ["llm:unknown"],
      ["llm:*"],
      ["OPENROUTER_API_KEY"],
      ["llm:openrouter", "llm:openrouter"],
    ]) {
      expect(() =>
        CapabilityPolicy.resolve({
          ...identity,
          grants: { direct: capabilities },
          execution: { capabilities },
        }),
      ).toThrow()
    }
  })

  test("skill declaration and exact source grant are both required", () => {
    const grant = CapabilityPolicy.bindGrant({
      ...identity,
      sourceID: "bundled:demo",
      digest: "a".repeat(64),
      capabilities: ["llm:openrouter"],
    })
    const result = CapabilityPolicy.resolve({
      ...identity,
      source: source(),
      grant,
      grants: { skills: { "bundled:demo": ["llm:openrouter"] } },
      execution: { skill: "bundled:demo", capabilities: ["llm:openrouter"] },
    })
    expect(result.allowed).toBe(true)

    expect(() =>
      CapabilityPolicy.resolve({
        ...identity,
        source: source({ sourceID: "installed:other/demo" }),
        grant,
        grants: { skills: { "bundled:demo": ["llm:openrouter"] } },
        execution: { skill: "bundled:demo", capabilities: ["llm:openrouter"] },
      }),
    ).toThrow()

    expect(() =>
      CapabilityPolicy.resolve({
        ...identity,
        source: source({ digest: "b".repeat(64) }),
        grant,
        grants: { skills: { "bundled:demo": ["llm:openrouter"] } },
        execution: { skill: "bundled:demo", capabilities: ["llm:openrouter"] },
      }),
    ).toThrow()
  })

  test("source proof cannot be replayed across turn, agent, or permission state", () => {
    for (const proof of [
      source({ turnID: "turn-old" }),
      source({ agent: "ml" }),
      source({ loaded: false }),
      source({ permissionApproved: false }),
    ]) {
      expect(() =>
        CapabilityPolicy.resolve({
          ...identity,
          source: proof,
          grant: CapabilityPolicy.bindGrant({
            ...identity,
            sourceID: "bundled:demo",
            digest: "a".repeat(64),
            capabilities: ["llm:openrouter"],
          }),
          grants: { skills: { "bundled:demo": ["llm:openrouter"] } },
          execution: { skill: "bundled:demo", capabilities: ["llm:openrouter"] },
        }),
      ).toThrow()
    }
  })

  test("frontmatter and profile schemas reject unknown IDs and duplicate source records", () => {
    expect(CapabilityList.safeParse(["llm:unknown"]).success).toBe(false)
    expect(CapabilityList.safeParse(["llm:openrouter", "llm:openrouter"]).success).toBe(false)
    expect(Execution.safeParse({ capabilities: ["OPENROUTER_API_KEY"] }).success).toBe(false)
    expect(() =>
      CapabilityGrants.parse({
        skills: [
          { source: "bundled:demo", capabilities: ["llm:openrouter"] },
          { source: "bundled:demo", capabilities: ["llm:openrouter"] },
        ],
      }),
    ).toThrow()
  })

  test("a declaration cannot self-authorize without an agent grant", () => {
    expect(() =>
      CapabilityPolicy.resolve({
        ...identity,
        source: source(),
        grant: CapabilityPolicy.bindGrant({
          ...identity,
          sourceID: "bundled:demo",
          digest: "a".repeat(64),
          capabilities: ["llm:openrouter"],
        }),
        grants: {},
        execution: { skill: "bundled:demo", capabilities: ["llm:openrouter"] },
      }),
    ).toThrow()
  })
})
