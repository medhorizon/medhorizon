import { afterEach, describe, expect, test } from "bun:test"
import { ResearchGraphControlRoutes } from "../../src/server/routes/research-graph"
import type { CurrentEndpoint } from "../../src/sidecar/research-graph"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers) server.stop(true)
  servers.length = 0
})

function current(origin: string, token = "capability-session"): CurrentEndpoint {
  return {
    generation: 1,
    mode: "managed",
    endpoint: {
      origin,
      api: origin,
      token,
      service: "research-graph",
      version: "0.3.6",
      protocol: 1,
    },
  }
}

describe("research graph session control contract", () => {
  test("returns not_bound without asking the sidecar for graph data", async () => {
    const hits = { value: 0 }
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        hits.value += 1
        return Response.json({ status: "not_bound" })
      },
    })
    servers.push(upstream)

    const response = await ResearchGraphControlRoutes(() => current(upstream.url.origin)).request(
      "/resolve?sessionId=session-unbound",
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "not_bound" })
    expect(hits.value).toBe(1)
  })

  test("keeps stale bindings as an integrity error", async () => {
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json(
          { detail: { code: "binding_integrity", message: "bound graph does not exist" } },
          { status: 409 },
        ),
    })
    servers.push(upstream)

    const response = await ResearchGraphControlRoutes(() => current(upstream.url.origin)).request(
      "/resolve?sessionId=session-stale",
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      status: "integrity",
      code: "research_graph_integrity",
      message: "bound graph does not exist",
    })
  })
})
