import { describe, expect, test } from "bun:test"
import { runSkillLoad, type SkillPatch } from "./skill-load"

type Skill = { name: string }

type LoadState = {
  skill: Skill[]
  skill_status: "loading" | "ready" | "error"
  skill_error?: string
}

// Applies a patch the way Solid's setStore merges a partial — only the patched
// keys change, so a patch that omits `skill` leaves the existing array intact.
function recorder(seed: Skill[] = []) {
  const state: LoadState = { skill: seed, skill_status: "loading" }
  const patches: SkillPatch<Skill>[] = []
  const set = (patch: SkillPatch<Skill>) => {
    patches.push(patch)
    Object.assign(state, patch)
  }
  return { state, patches, set }
}

describe("runSkillLoad", () => {
  test("start keeps the existing skill array and only flips status to loading", async () => {
    const rec = recorder([{ name: "old" }])
    let resolve!: (res: { data: Skill[] }) => void
    const pending = new Promise<{ data: Skill[] }>((r) => (resolve = r))
    const run = runSkillLoad({ set: rec.set, fetch: () => pending })
    // The start patch is applied synchronously before the fetch suspends.
    expect(rec.state.skill_status).toBe("loading")
    expect(rec.state.skill).toEqual([{ name: "old" }])
    resolve({ data: [{ name: "new" }] })
    await run
    expect(rec.state.skill_status).toBe("ready")
    expect(rec.state.skill).toEqual([{ name: "new" }])
    expect(rec.state.skill_error).toBeUndefined()
    expect(rec.patches[0]).toEqual({ skill_status: "loading" })
  })

  test("failure keeps the old array and records a readable error", async () => {
    const rec = recorder([{ name: "old" }])
    await runSkillLoad({ set: rec.set, fetch: () => Promise.reject(new Error("backend exploded")) })
    expect(rec.state.skill_status).toBe("error")
    expect(rec.state.skill).toEqual([{ name: "old" }])
    expect(rec.state.skill_error).toBe("backend exploded")
  })

  test("a non-Error rejection is normalized to its string form", async () => {
    const rec = recorder([{ name: "old" }])
    await runSkillLoad({ set: rec.set, fetch: () => Promise.reject("boom") })
    expect(rec.state.skill_error).toBe("boom")
    expect(rec.state.skill_status).toBe("error")
  })

  test("retry reuses the same coordinator and clears the prior error on success", async () => {
    const rec = recorder([{ name: "old" }])
    let failing = true
    await runSkillLoad({
      set: rec.set,
      fetch: () => (failing ? Promise.reject(new Error("first fail")) : Promise.resolve({ data: [{ name: "fresh" }] })),
    })
    expect(rec.state.skill_status).toBe("error")
    expect(rec.state.skill_error).toBe("first fail")
    failing = false
    await runSkillLoad({ set: rec.set, fetch: () => Promise.resolve({ data: [{ name: "fresh" }] }) })
    expect(rec.state.skill_status).toBe("ready")
    expect(rec.state.skill_error).toBeUndefined()
    expect(rec.state.skill).toEqual([{ name: "fresh" }])
  })
})
