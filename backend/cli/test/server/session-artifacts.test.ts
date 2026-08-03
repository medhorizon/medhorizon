import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { RLMArtifacts } from "../../src/session/rlm/artifacts"
import { Server } from "../../src/server/server"
import { PREVIEW_CAP } from "../../src/server/routes/session-artifacts"

// test/preload.ts redirects XDG dirs to a throwaway per-process temp dir, so
// RLMArtifacts' "<data>/artifacts" store (and therefore these routes) reads and
// writes a real, isolated temp sandbox. No mocks — the routes hit the real
// Hono app via Server.internalFetch() (in-process, guarded by the nonce).
const artifactsDir = (sessionId: string) => path.join(Global.Path.data, "artifacts", sessionId)
const fetch = Server.internalFetch()
const base = (sessionId: string, suffix = "") => `http://openscience.internal/session/${sessionId}${suffix}`

// Warm the per-process project instance at module scope: the first request
// through Instance.provide runs InstanceBootstrap (plugins, LSP, file watcher,
// etc.), which would otherwise blow an individual test's 5s timeout budget.
await fetch(base("ses-warmup", "/artifacts"))

function expectNoPathLeak(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(Global.Path.data)
}

describe("session artifact catalog API", () => {
  test("register -> list -> preview -> download roundtrip preserves metadata", async () => {
    const sessionId = "ses-api-roundtrip"
    const payload = "roundtrip payload body"
    const ref = await RLMArtifacts.register(sessionId, "analysis", payload, "my summary")

    // list: typed, metadata-preserving projection with a relative downloadPath
    const listRes = await fetch(base(sessionId, "/artifacts"))
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      items: { id: string; type: string; summary: string; size: number; createdAt: string; downloadPath: string }[]
    }
    expect(listBody.items.length).toBe(1)
    const item = listBody.items[0]!
    expect(item.id).toBe(ref.id)
    expect(item.type).toBe("analysis")
    expect(item.summary).toBe("my summary")
    expect(item.size).toBe(payload.length)
    expect(typeof item.createdAt).toBe("string")
    expect(Number.isFinite(Date.parse(item.createdAt))).toBe(true)
    expect(item.downloadPath).toBe(`/session/${sessionId}/artifacts/${ref.id}/content`)
    expect("path" in item).toBe(false)
    expectNoPathLeak(listBody)

    // preview: bounded slice returns the exact content for small payloads
    const previewRes = await fetch(base(sessionId, `/artifacts/${ref.id}/preview`))
    expect(previewRes.status).toBe(200)
    const preview = (await previewRes.json()) as {
      metadata: { id: string; type: string; summary: string; size: number; createdAt: string }
      content: string
      totalBytes: number
      truncated: boolean
    }
    expect(preview.metadata.id).toBe(ref.id)
    expect(preview.metadata.type).toBe("analysis")
    expect(preview.metadata.summary).toBe("my summary")
    expect(preview.content).toBe(payload)
    expect(preview.totalBytes).toBe(payload.length)
    expect(preview.truncated).toBe(false)
    expect("path" in preview.metadata).toBe(false)
    expectNoPathLeak(preview)

    // download: explicit streaming of the raw payload with safe headers
    const downloadRes = await fetch(base(sessionId, `/artifacts/${ref.id}/content`))
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get("content-type")).toBe("application/octet-stream")
    expect(downloadRes.headers.get("content-disposition")).toContain('attachment; filename="')
    expect(downloadRes.headers.get("content-disposition")).toContain(`${ref.id}.dat`)
    expect(downloadRes.headers.get("content-length")).toBe(String(payload.length))
    expect(await downloadRes.text()).toBe(payload)
  })

  test("legacy .dat without a sidecar lists/previews/downloads with deterministic fallback fields", async () => {
    const sessionId = "ses-api-legacy"
    const legacyId = "art-legacy-0001"
    const legacyContent = "legacy payload body"
    const dir = artifactsDir(sessionId)
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, `${legacyId}.dat`), legacyContent)

    const listRes = await fetch(base(sessionId, "/artifacts"))
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      items: { id: string; type: string; summary: string; size: number; downloadPath: string }[]
    }
    expect(listBody.items.length).toBe(1)
    const item = listBody.items[0]!
    expect(item.id).toBe(legacyId)
    expect(item.type).toBe("unknown")
    expect(item.summary).toBe(`Artifact ${legacyId}.dat`)
    expect(item.size).toBe(legacyContent.length)
    expect(item.downloadPath).toBe(`/session/${sessionId}/artifacts/${legacyId}/content`)

    const previewRes = await fetch(base(sessionId, `/artifacts/${legacyId}/preview`))
    expect(previewRes.status).toBe(200)
    const preview = (await previewRes.json()) as { metadata: { type: string }; content: string }
    expect(preview.metadata.type).toBe("unknown")
    expect(preview.content).toBe(legacyContent)

    const downloadRes = await fetch(base(sessionId, `/artifacts/${legacyId}/content`))
    expect(downloadRes.status).toBe(200)
    expect(await downloadRes.text()).toBe(legacyContent)
  })

  test("pagination honors limit and cursor with a stable newest-first order", async () => {
    const sessionId = "ses-api-pagination"
    // Distinct createdAt per register (sleep) keeps newest-first deterministic.
    const refs: { id: string }[] = []
    for (let i = 0; i < 5; i++) {
      refs.push(await RLMArtifacts.register(sessionId, "raw_output", `payload-${i}`))
      await Bun.sleep(5)
    }

    const page1Res = await fetch(base(sessionId, "/artifacts?limit=2"))
    expect(page1Res.status).toBe(200)
    const page1 = (await page1Res.json()) as { items: { id: string }[]; nextCursor?: string }
    expect(page1.items.length).toBe(2)
    expect(page1.nextCursor).toBeDefined()
    expect(page1.items[0]!.id).toBe(refs[4]!.id)
    expect(page1.items[1]!.id).toBe(refs[3]!.id)

    const page2Res = await fetch(
      base(sessionId, `/artifacts?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`),
    )
    expect(page2Res.status).toBe(200)
    const page2 = (await page2Res.json()) as { items: { id: string }[]; nextCursor?: string }
    expect(page2.items.length).toBe(2)
    expect(page2.items[0]!.id).toBe(refs[2]!.id)
    expect(page2.items[1]!.id).toBe(refs[1]!.id)
    expect(page2.nextCursor).toBeDefined()

    const page3Res = await fetch(
      base(sessionId, `/artifacts?limit=2&cursor=${encodeURIComponent(page2.nextCursor!)}`),
    )
    expect(page3Res.status).toBe(200)
    const page3 = (await page3Res.json()) as { items: { id: string }[]; nextCursor?: string }
    expect(page3.items.length).toBe(1)
    expect(page3.items[0]!.id).toBe(refs[0]!.id)
    expect(page3.nextCursor).toBeUndefined()

    // no duplicates across pages, and no directory structure in the response
    const all = [...page1.items, ...page2.items, ...page3.items].map((x) => x.id)
    expect(new Set(all).size).toBe(5)
    expectNoPathLeak({ page1, page2, page3 })
  })

  test("preview is bounded: truncated/totalBytes reflect a payload larger than the cap", async () => {
    const sessionId = "ses-api-preview-large"
    const big = "x".repeat(PREVIEW_CAP + 123)
    const ref = await RLMArtifacts.register(sessionId, "raw_output", big)

    const previewRes = await fetch(base(sessionId, `/artifacts/${ref.id}/preview`))
    expect(previewRes.status).toBe(200)
    const preview = (await previewRes.json()) as { content: string; totalBytes: number; truncated: boolean }
    expect(preview.truncated).toBe(true)
    expect(preview.totalBytes).toBe(big.length)
    expect(preview.content.length).toBe(PREVIEW_CAP)
    expect(preview.content).not.toBe(big)
    expect(preview.content).toBe("x".repeat(PREVIEW_CAP))

    // download still returns the full payload
    const downloadRes = await fetch(base(sessionId, `/artifacts/${ref.id}/content`))
    expect(downloadRes.status).toBe(200)
    expect((await downloadRes.text()).length).toBe(big.length)
  })

  test("cross-session reads are rejected without leaking the payload or paths", async () => {
    const owner = "ses-api-owner"
    const intruder = "ses-api-intruder"
    const ref = await RLMArtifacts.register(owner, "analysis", "secret-payload")
    await RLMArtifacts.register(intruder, "analysis", "intruder-payload")

    const previewRes = await fetch(base(intruder, `/artifacts/${ref.id}/preview`))
    expect(previewRes.status).toBe(404)
    const previewBody = (await previewRes.json()) as { error: { code: string } }
    expect(previewBody.error.code).toBe("session_artifacts.artifact_not_found")
    expectNoPathLeak(previewBody)

    const downloadRes = await fetch(base(intruder, `/artifacts/${ref.id}/content`))
    expect(downloadRes.status).toBe(404)
    const downloadBody = (await downloadRes.json()) as { error: { code: string } }
    expect(downloadBody.error.code).toBe("session_artifacts.artifact_not_found")
    expectNoPathLeak(downloadBody)

    // the owner still reads it
    const ownerRes = await fetch(base(owner, `/artifacts/${ref.id}/preview`))
    expect(ownerRes.status).toBe(200)
  })

  test("traversal and invalid ids are rejected with stable errors and no path leak", async () => {
    const sessionId = "ses-api-traversal"

    for (const bad of [
      "not-an-artifact",
      "art-..",
      "art-..%2F..%2Fetc%2Fpasswd",
      "art-evil%2F..%2F..",
      "art-%2E%2E%2F..",
    ]) {
      const res = await fetch(base(sessionId, `/artifacts/${bad}/preview`))
      expect(res.status).toBe(400)
      expectNoPathLeak(await res.json())
    }

    // invalid session id segment (decoded traversal) is rejected
    const badSession = await fetch(base("bad%2Fsession", "/artifacts"))
    expect(badSession.status).toBe(400)
    expectNoPathLeak(await badSession.json())

    // invalid cursor and over-limit
    const badCursor = await fetch(base(sessionId, "/artifacts?cursor=not-a-cursor"))
    expect(badCursor.status).toBe(400)
    const cursorBody = (await badCursor.json()) as { error: { code: string } }
    expect(cursorBody.error.code).toBe("session_artifacts.invalid_cursor")
    expectNoPathLeak(cursorBody)

    const overLimit = await fetch(base(sessionId, "/artifacts?limit=999"))
    expect(overLimit.status).toBe(400)
  })

  test("missing session and missing artifact return stable 404 codes without paths", async () => {
    const missingId = "art-0000000000000-missing"

    // no artifact directory at all -> session_not_found
    const noSession = await fetch(base("ses-api-does-not-exist", `/artifacts/${missingId}/preview`))
    expect(noSession.status).toBe(404)
    const noSessionBody = (await noSession.json()) as { error: { code: string } }
    expect(noSessionBody.error.code).toBe("session_artifacts.session_not_found")
    expectNoPathLeak(noSessionBody)

    // existing session, unknown artifact -> artifact_not_found
    const sessionId = "ses-api-missing-art"
    await RLMArtifacts.register(sessionId, "analysis", "x")
    const noArtifact = await fetch(base(sessionId, `/artifacts/${missingId}/content`))
    expect(noArtifact.status).toBe(404)
    const noArtifactBody = (await noArtifact.json()) as { error: { code: string } }
    expect(noArtifactBody.error.code).toBe("session_artifacts.artifact_not_found")
    expectNoPathLeak(noArtifactBody)

    // a missing session still lists as an empty success page
    const empty = await fetch(base("ses-api-never-created", "/artifacts"))
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ items: [] })
  })

  test("a formal entry with a corrupt sidecar is hidden and not previewable/downloadable", async () => {
    const sessionId = "ses-api-corrupt"
    const id = "art-corrupt-0001"
    const dir = artifactsDir(sessionId)
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, `${id}.dat`), "payload despite corruption")
    await Bun.write(path.join(dir, `${id}.meta.json`), "{ not valid json")

    const listRes = await fetch(base(sessionId, "/artifacts"))
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { items: unknown[] }
    expect(body.items.length).toBe(0)

    const previewRes = await fetch(base(sessionId, `/artifacts/${id}/preview`))
    expect(previewRes.status).toBe(404)
    expectNoPathLeak(await previewRes.json())

    const downloadRes = await fetch(base(sessionId, `/artifacts/${id}/content`))
    expect(downloadRes.status).toBe(404)
    expect(await downloadRes.text()).not.toContain("payload despite corruption")
  })

  test("cleanup deletes only stale temp/orphan files, never active or committed ones", async () => {
    const sessionId = "ses-api-cleanup"
    const dir = artifactsDir(sessionId)
    await fs.mkdir(dir, { recursive: true })
    const stale = new Date(Date.now() - 30 * 60 * 1000) // older than the 10-min staleness budget

    // stale leftovers from an interrupted two-phase commit
    const staleTemp = path.join(dir, ".art-stale.payload.tmp")
    const staleOrphan = path.join(dir, "art-stale.meta.json")
    await Bun.write(staleTemp, "temp")
    await Bun.write(staleOrphan, JSON.stringify({ version: 1, id: "art-stale", type: "x", summary: "s", size: 1, createdAt: new Date().toISOString() }))
    await fs.utimes(staleTemp, stale, stale)
    await fs.utimes(staleOrphan, stale, stale)

    // fresh temp + fresh orphan = an in-flight register we must NOT delete
    const freshTemp = path.join(dir, ".art-fresh.payload.tmp")
    const freshOrphan = path.join(dir, "art-fresh.meta.json")
    await Bun.write(freshTemp, "temp")
    await Bun.write(freshOrphan, JSON.stringify({ version: 1, id: "art-fresh", type: "x", summary: "s", size: 1, createdAt: new Date().toISOString() }))

    // committed artifact + corrupt formal entry must survive cleanup
    const committed = await RLMArtifacts.register(sessionId, "analysis", "keep-me")
    const corruptId = "art-corrupt-0002"
    await Bun.write(path.join(dir, `${corruptId}.dat`), "keep")
    await Bun.write(path.join(dir, `${corruptId}.meta.json`), "not json")

    await RLMArtifacts.cleanup()

    // stale temp and stale metadata-only orphan are swept
    expect(await fs.stat(staleTemp).catch(() => null)).toBeNull()
    expect(await fs.stat(staleOrphan).catch(() => null)).toBeNull()
    // active (fresh) temps/orphans survive
    expect(await fs.stat(freshTemp).catch(() => null)).not.toBeNull()
    expect(await fs.stat(freshOrphan).catch(() => null)).not.toBeNull()
    // committed payload and corrupt formal entry survive
    expect(await RLMArtifacts.resolve(sessionId, committed.id)).toBe("keep-me")
    expect(await fs.stat(path.join(dir, `${corruptId}.dat`)).catch(() => null)).not.toBeNull()
  })
})
