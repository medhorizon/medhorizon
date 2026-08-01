import { afterEach, describe, expect, test } from "bun:test"
import { pushTokensToBackend } from "../../src/plugin/codex"
import { AtlasDisabled, atlasCloudEnabled } from "../../src/openscience"
import { readFileSync } from "fs"
import path from "path"

type Hit = { url: string; method: string }

describe("Atlas direct consumers", () => {
  const prev = process.env.OPENSCIENCE_ENABLE_ATLAS
  const servers: Array<ReturnType<typeof Bun.serve>> = []

  afterEach(() => {
    for (const s of servers) s.stop(true)
    servers.length = 0
    if (prev === undefined) delete process.env.OPENSCIENCE_ENABLE_ATLAS
    else process.env.OPENSCIENCE_ENABLE_ATLAS = prev
  })

  test("pushTokensToBackend is a no-op when Atlas is disabled", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    expect(atlasCloudEnabled()).toBe(false)

    const hits: Hit[] = []
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url)
        hits.push({ url: url.pathname, method: req.method })
        return Response.json({ ok: true })
      },
    })
    servers.push(server)

    await pushTokensToBackend(`http://127.0.0.1:${server.port}`, "thk_test", {
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
    })
    expect(hits).toEqual([])
  })

  test("pushTokensToBackend posts when Atlas is enabled", async () => {
    process.env.OPENSCIENCE_ENABLE_ATLAS = "1"
    const hits: Hit[] = []
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url)
        hits.push({ url: url.pathname, method: req.method })
        return Response.json({ ok: true })
      },
    })
    servers.push(server)

    await pushTokensToBackend(`http://127.0.0.1:${server.port}`, "thk_test", {
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
    })
    expect(hits).toEqual([{ url: "/api/keys/openai-codex", method: "POST" }])
  })

  test("project CLI and auth Codex paths gate on the shared flag", () => {
    const project = readFileSync(path.join(import.meta.dir, "../../src/cli/cmd/project.ts"), "utf-8")
    const auth = readFileSync(path.join(import.meta.dir, "../../src/cli/cmd/auth.ts"), "utf-8")
    expect(project).toContain("atlasCloudEnabled")
    expect(project).toContain("AtlasDisabled.code")
    expect(project).toContain("AtlasDisabled.message")
    expect(auth).toContain("atlasCloudEnabled")
    expect(auth).toContain("if (!atlasCloudEnabled()) return")
    expect(AtlasDisabled.code).toBe("ATLAS_DISABLED")
  })
})
