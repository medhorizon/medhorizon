import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { RLMArtifacts } from "../../src/session/rlm/artifacts"

// test/preload.ts redirects XDG_DATA_HOME to a throwaway per-process temp dir
// before any src/ import, so Global.Path.data (and therefore RLMArtifacts'
// "<data>/artifacts" store) never touches the real user data directory. No fs
// mocking: these are real directory reads/writes against that temp sandbox.
const artifactsDir = (sessionId: string) => path.join(Global.Path.data, "artifacts", sessionId)

describe("RLMArtifacts session-scoped catalog baseline", () => {
  test("register, resolve, and list work for the owning session", async () => {
    const sessionId = "ses-baseline-owner"
    const ref = await RLMArtifacts.register(sessionId, "analysis", "payload-A")

    expect(ref.id).toMatch(/^art-/)
    expect(ref.type).toBe("analysis")
    expect(ref.summary).toBe("analysis artifact (9 bytes)")
    expect(path.isAbsolute(ref.path)).toBe(true)
    expect(ref.path).toBe(path.join(artifactsDir(sessionId), `${ref.id}.dat`))

    // Resolve reads back the exact payload.
    expect(await RLMArtifacts.resolve(sessionId, ref.id)).toBe("payload-A")

    // List reads the persisted metadata sidecar, so a freshly registered
    // artifact keeps its register-time type/summary/size/createdAt (plus the
    // storage-internal path for the legacy stat fallback).
    const listed = await RLMArtifacts.list(sessionId)
    const entry = listed.find((a) => a.id === ref.id)
    expect(entry).toBeDefined()
    expect(entry!.type).toBe("analysis")
    expect(entry!.summary).toBe("analysis artifact (9 bytes)")
    expect(entry!.size).toBe(9)
    expect(typeof entry!.createdAt).toBe("number")
    expect(entry!.createdAt).toBeGreaterThan(0)
    expect(entry!.path).toBe(ref.path)
  })

  test("a different session cannot read another session's payload through the catalog", async () => {
    const owner = "ses-baseline-owner-2"
    const intruder = "ses-baseline-intruder-2"
    const ref = await RLMArtifacts.register(owner, "analysis", "secret-payload")

    // The intruder can neither resolve nor list the owner's artifact.
    expect(await RLMArtifacts.resolve(intruder, ref.id)).toBeNull()
    expect(await RLMArtifacts.list(intruder)).toEqual([])

    // The owner still sees it.
    expect(await RLMArtifacts.resolve(owner, ref.id)).toBe("secret-payload")
    expect((await RLMArtifacts.list(owner)).map((a) => a.id)).toContain(ref.id)
  })

  test("legacy .dat without metadata still lists and resolves with deterministic fallback fields", async () => {
    const sessionId = "ses-baseline-legacy"
    const legacyId = "art-legacy-0001"
    const legacyContent = "legacy payload body"
    const filePath = path.join(artifactsDir(sessionId), `${legacyId}.dat`)
    await fs.mkdir(artifactsDir(sessionId), { recursive: true })
    await Bun.write(filePath, legacyContent)

    const listed = await RLMArtifacts.list(sessionId)
    const entry = listed.find((a) => a.id === legacyId)
    expect(entry).toBeDefined()
    expect(entry!.type).toBe("unknown")
    expect(entry!.summary).toBe(`Artifact ${legacyId}.dat`)
    expect(entry!.path).toBe(filePath)

    // The fallback projection is rooted in the file's own stat: the listed path
    // points at the real file whose size/mtime match the payload on disk.
    const stat = await fs.stat(entry!.path)
    expect(stat.size).toBe(legacyContent.length)
    expect(stat.mtimeMs).toBeGreaterThan(0)

    expect(await RLMArtifacts.resolve(sessionId, legacyId)).toBe(legacyContent)
  })

  test("missing artifact and missing session resolve as null/empty, never throw", async () => {
    expect(await RLMArtifacts.resolve("ses-baseline-missing", "art-000000-missing")).toBeNull()
    expect(await RLMArtifacts.list("ses-baseline-empty")).toEqual([])
  })
})
