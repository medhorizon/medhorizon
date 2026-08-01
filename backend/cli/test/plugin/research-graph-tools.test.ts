import { afterEach, describe, expect, test } from "bun:test"
import { atlasGraph } from "../../../../research-graph/medhorizon-plugin/tools/atlas_graph"
import { atlasStage } from "../../../../research-graph/medhorizon-plugin/tools/atlas_stage"
import { atlasSync } from "../../../../research-graph/medhorizon-plugin/tools/atlas_sync"
import type { ToolContext } from "@synsci/plugin"

type Hit = { url: string; method: string }

function ctx(): ToolContext {
  return {
    sessionID: "ses_rg_tools",
    messageID: "msg_rg_tools",
    agent: "research",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

function serve(hits: Hit[], handler: (req: Request, url: URL) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      hits.push({ url: url.pathname + url.search, method: req.method })
      return handler(req, url)
    },
  })
}

describe("research-graph atlas_* tools (local sidecar only)", () => {
  const prevApi = process.env.RESEARCH_GRAPH_API
  const prevMode = process.env.RESEARCH_GRAPH_MODE
  const prevToken = process.env.RESEARCH_GRAPH_TOKEN
  const prevAtlas = process.env.OPENSCIENCE_API_BASE
  const servers: Array<ReturnType<typeof Bun.serve>> = []

  afterEach(() => {
    for (const s of servers) s.stop(true)
    servers.length = 0
    if (prevApi === undefined) delete process.env.RESEARCH_GRAPH_API
    else process.env.RESEARCH_GRAPH_API = prevApi
    if (prevMode === undefined) delete process.env.RESEARCH_GRAPH_MODE
    else process.env.RESEARCH_GRAPH_MODE = prevMode
    if (prevToken === undefined) delete process.env.RESEARCH_GRAPH_TOKEN
    else process.env.RESEARCH_GRAPH_TOKEN = prevToken
    if (prevAtlas === undefined) delete process.env.OPENSCIENCE_API_BASE
    else process.env.OPENSCIENCE_API_BASE = prevAtlas
  })

  test("atlas_graph / atlas_stage / atlas_sync hit local RG only; Atlas capture stays at 0", async () => {
    const rgHits: Hit[] = []
    const atlasHits: Hit[] = []

    const atlas = serve(atlasHits, () => Response.json({ ok: false }, { status: 500 }))
    servers.push(atlas)
    process.env.OPENSCIENCE_API_BASE = `http://127.0.0.1:${atlas.port}`

    const rg = serve(rgHits, (_req, url) => {
      if (url.pathname === "/api/graphs" && _req.method === "GET") {
        return Response.json([{ id: "g1", title: "Local graph" }])
      }
      if (url.pathname === "/api/stages/protocol") {
        return Response.json({ version: 1, tools: ["atlas_stage", "atlas_graph"] })
      }
      if (url.pathname === "/api/sync/capability") {
        return Response.json({
          mode: "local",
          supports: { graphs: true, atlas_projection: false },
        })
      }
      if (url.pathname === "/api/sync/outbox") {
        return Response.json([{ id: "ob1", status: "pending" }])
      }
      if (url.pathname === "/api/sync/outbox/ob1/retry" && _req.method === "POST") {
        return Response.json({ id: "ob1", status: "pending", retried: true })
      }
      return new Response("not found", { status: 404 })
    })
    servers.push(rg)
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${rg.port}`
    process.env.RESEARCH_GRAPH_MODE = "local"
    process.env.RESEARCH_GRAPH_TOKEN = "local-dev"

    const toolCtx = ctx()

    const listed = JSON.parse(await atlasGraph.execute({ action: "list" }, toolCtx))
    expect(listed).toEqual([{ id: "g1", title: "Local graph" }])

    const protocol = JSON.parse(await atlasStage.execute({ action: "protocol" }, toolCtx))
    expect(protocol.version).toBe(1)
    expect(protocol.api).toContain(`127.0.0.1:${rg.port}`)

    const capability = JSON.parse(await atlasSync.execute({ action: "capability" }, toolCtx))
    expect(capability.plugin_mode).toBe("local")
    expect(capability.supports?.atlas_projection).toBe(false)

    const outbox = JSON.parse(await atlasSync.execute({ action: "outbox" }, toolCtx))
    expect(outbox[0]?.id).toBe("ob1")

    const retried = JSON.parse(await atlasSync.execute({ action: "retry", item_id: "ob1" }, toolCtx))
    expect(retried.retried).toBe(true)

    expect(rgHits.length).toBeGreaterThanOrEqual(5)
    expect(rgHits.every((h) => h.url.startsWith("/api/"))).toBe(true)
    expect(atlasHits).toEqual([])
  })

  test("atlas_sync local mode reports RESEARCH_GRAPH_UNAVAILABLE without Atlas traffic", async () => {
    const atlasHits: Hit[] = []
    const atlas = serve(atlasHits, () => Response.json({ ok: true }))
    servers.push(atlas)
    process.env.OPENSCIENCE_API_BASE = `http://127.0.0.1:${atlas.port}`
    process.env.RESEARCH_GRAPH_API = "http://127.0.0.1:1"
    process.env.RESEARCH_GRAPH_MODE = "local"

    const body = JSON.parse(await atlasSync.execute({ action: "capability" }, ctx()))
    expect(body.error).toBe("RESEARCH_GRAPH_UNAVAILABLE")
    expect(atlasHits).toEqual([])
  })
})
