import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../../src/global"
import { AtlasDisabled, OpenScience, atlasCloudEnabled } from "../../src/openscience"

const sessionFile = path.join(Global.Path.data, "medhorizon-session.json")
const realFetch = globalThis.fetch

describe("OPENSCIENCE_ENABLE_ATLAS lifecycle gate", () => {
  const prev = process.env.OPENSCIENCE_ENABLE_ATLAS

  afterEach(async () => {
    globalThis.fetch = realFetch
    await fs.rm(sessionFile, { force: true })
    if (prev === undefined) delete process.env.OPENSCIENCE_ENABLE_ATLAS
    else process.env.OPENSCIENCE_ENABLE_ATLAS = prev
  })

  test("default-off: syncServices / refreshIfStale / ensureAtlasCliConfig make zero Atlas requests", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    expect(atlasCloudEnabled()).toBe(false)

    const hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hits.push(String(input))
      return realFetch(input, init)
    }) as typeof fetch

    await Bun.write(sessionFile, JSON.stringify({ api_key: "thk_test.fake", user_id: "u1" }))

    expect(await OpenScience.syncServices()).toBeNull()
    await OpenScience.refreshIfStale()
    await OpenScience.ensureAtlasCliConfig()
    expect(await OpenScience.getBalance()).toBeNull()
    await OpenScience.flushPendingUsage()

    expect(hits).toEqual([])
  })

  test("default-off: loginWithKey throws typed ATLAS_DISABLED", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    try {
      await OpenScience.loginWithKey("thk_test.fake")
      expect.unreachable()
    } catch (err) {
      expect((err as { code?: string }).code).toBe(AtlasDisabled.code)
      expect(err instanceof Error && err.message).toContain("OPENSCIENCE_ENABLE_ATLAS")
    }
  })

  test("flag-on: syncServices still hits /api/cli/sync", async () => {
    process.env.OPENSCIENCE_ENABLE_ATLAS = "1"
    expect(atlasCloudEnabled()).toBe(true)

    const hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      hits.push(url)
      if (url.includes("/api/cli/sync")) {
        return Response.json({ user: { id: "u1" }, services: {} })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    await Bun.write(sessionFile, JSON.stringify({ api_key: "thk_test.fake", user_id: "u1" }))

    const result = await OpenScience.syncServices()
    expect(result).not.toBeNull()
    expect(hits.some((h) => h.includes("/api/cli/sync"))).toBe(true)
  })
})
