import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

describe("onboard atlas retirement", () => {
  const onboard = readFileSync(path.join(import.meta.dir, "../../src/cli/onboard.ts"), "utf-8")

  test("does not offer Atlas managed, wallet top-up, or @synsci/atlas install", () => {
    expect(onboard).not.toMatch(/label:\s*"Atlas managed"/)
    expect(onboard).not.toContain("@synsci/atlas")
    expect(onboard).not.toContain("offerAtlasCli")
    expect(onboard).not.toContain("onboardManaged")
    expect(onboard).not.toContain("value: \"managed\"")
    expect(onboard).toContain("Your own keys")
    expect(onboard).toContain("Local models")
    expect(onboard).toContain("Not now")
    expect(onboard).toContain('initialValue: "byok"')
  })

  test("isConfigured ignores Atlas session authentication", () => {
    expect(onboard).not.toMatch(/isConfigured[\s\S]*isAuthenticated/)
    expect(onboard).toContain("hasProviderEnv()")
  })
})
