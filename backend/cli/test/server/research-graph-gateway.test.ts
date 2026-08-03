import { afterEach, describe, expect, test } from "bun:test"
import { ResearchGraphControlRoutes, ResearchGraphProxyRoutes } from "../../src/server/routes/research-graph"
import type { CurrentEndpoint } from "../../src/sidecar/research-graph"
import { Server } from "../../src/server/server"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers) server.stop(true)
  servers.length = 0
})

function current(origin: string, token = "capability-1"): CurrentEndpoint {
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

describe("research graph gateway proxy", () => {
  test("returns a stable unavailable response without starting a sidecar", async () => {
    const route = ResearchGraphProxyRoutes(() => null)
    const response = await route.request("/health")

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "unavailable" })
  })

  test("does not add CORS headers on same-origin gateway namespaces", async () => {
    const server = Server.listen({ port: 0, cors: ["https://workspace.example"] })
    servers.push(server)

    const response = await fetch(new URL("/research-graph/health", server.url), {
      headers: { Origin: "https://workspace.example" },
    })

    expect(response.status).toBe(503)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("access-control-allow-credentials")).toBeNull()
  })

  test("forwards safe request data, injects the live capability, and rewrites sidecar redirects", async () => {
    const seen: { authorization?: string; cookie?: string; origin?: string; body?: string; url?: string } = {}
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        seen.authorization = request.headers.get("authorization") ?? undefined
        seen.cookie = request.headers.get("cookie") ?? undefined
        seen.origin = request.headers.get("origin") ?? undefined
        seen.body = await request.text()
        seen.url = request.url
        return new Response("ok", {
          status: 307,
          headers: {
            "content-type": "text/plain",
            "location": `${new URL(request.url).origin}/embed/graph/456?next=1`,
            "access-control-allow-origin": "*",
          },
        })
      },
    })
    servers.push(upstream)
    const route = ResearchGraphProxyRoutes(() => current(upstream.url.origin))

    const response = await route.request("/embed/graph/123?x=1", {
      method: "POST",
      headers: {
        Authorization: "Bearer browser-token",
        Cookie: "session=browser",
        Origin: "https://evil.example",
        "Content-Type": "text/plain",
      },
      body: "payload",
    })

    expect(response.status).toBe(307)
    expect(await response.text()).toBe("ok")
    expect(seen.authorization).toBe("Bearer capability-1")
    expect(seen.cookie).toBeUndefined()
    expect(seen.origin).toBeUndefined()
    expect(seen.body).toBe("payload")
    expect(seen.url).toContain("/embed/graph/123?x=1")
    expect(response.headers.get("location")).toBe("/research-graph/embed/graph/456?next=1")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("retries one replayable request after a capability rotation", async () => {
    const state = { value: undefined as CurrentEndpoint | undefined }
    const seen: string[] = []
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        seen.push(request.headers.get("authorization") ?? "")
        if (seen.length === 1) {
          const next = current(new URL(request.url).origin, "capability-2")
          state.value = { ...next, generation: 2 }
          return Response.json({ status: "rejected" }, { status: 401 })
        }
        return Response.json({ ok: true })
      },
    })
    servers.push(upstream)
    state.value = current(upstream.url.origin)
    const route = ResearchGraphProxyRoutes(() => state.value ?? null)

    const response = await route.request("/api/graphs/1")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(seen).toEqual(["Bearer capability-1", "Bearer capability-2"])
  })

  test("rejects traversal paths before contacting the sidecar", async () => {
    const hits = { value: 0 }
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        hits.value += 1
        return new Response("ok")
      },
    })
    servers.push(upstream)
    const route = ResearchGraphProxyRoutes(() => current(upstream.url.origin))

    const response = await route.request("/%252e%252e/private")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ status: "invalid_path" })
    expect(hits.value).toBe(0)
  })

  test("resolves a binding into a same-origin embed path", async () => {
    const seen: { authorization?: string; path?: string } = {}
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        seen.authorization = request.headers.get("authorization") ?? undefined
        seen.path = new URL(request.url).pathname
        return Response.json({
          status: "bound",
          graph: { id: "graph/1", title: "Bound", updated_at: "2026-08-03T00:00:00Z" },
          binding_updated_at: "2026-08-03T00:01:00Z",
        })
      },
    })
    servers.push(upstream)
    const route = ResearchGraphControlRoutes(() => current(upstream.url.origin))

    const response = await route.request("/resolve?sessionId=session-1", {
      headers: { Authorization: "Bearer browser-token" },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "bound",
      graph: { id: "graph/1", title: "Bound", updatedAt: "2026-08-03T00:00:00Z" },
      embedPath: "/research-graph/embed/graph/graph%2F1",
    })
    expect(seen.authorization).toBe("Bearer capability-1")
    expect(seen.path).toBe("/api/sessions/resolve")
  })

  test("binds through the explicit control contract with a typed response", async () => {
    const seen: { body?: string; path?: string } = {}
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        seen.path = new URL(request.url).pathname
        seen.body = await request.text()
        return Response.json({
          session_id: "session-1",
          graph_id: "graph-1",
          directory: null,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:01:00Z",
        })
      },
    })
    servers.push(upstream)
    const route = ResearchGraphControlRoutes(() => current(upstream.url.origin))

    const response = await route.request("/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", graphId: "graph-1", reason: "test" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      sessionId: "session-1",
      graphId: "graph-1",
      directory: null,
      createdAt: "2026-08-03T00:00:00Z",
      updatedAt: "2026-08-03T00:01:00Z",
    })
    expect(seen.path).toBe("/api/sessions/bind")
    expect(JSON.parse(seen.body ?? "{}")).toMatchObject({ session_id: "session-1", graph_id: "graph-1" })
  })
})
