import { describe, test, expect, beforeEach } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { McpManifestCache, DEFAULT_TTL_MS } from "../../src/mcp/manifest-cache"

const sample = (name: string): MCPToolDef => ({
  name,
  inputSchema: { type: "object", properties: {} },
})

describe("McpManifestCache", () => {
  beforeEach(() => {
    McpManifestCache.clear()
  })

  test("cache hit avoids refresh when within TTL", async () => {
    let calls = 0
    const refresh = async () => {
      calls++
      return { tools: [sample("alpha")] }
    }

    McpManifestCache.set("srv", [sample("seed")])
    const entry = McpManifestCache.peek("srv")!
    entry.fetchedAt = Date.now()

    const tools = await McpManifestCache.get("srv", refresh, { ttlMs: DEFAULT_TTL_MS })
    expect(calls).toBe(0)
    expect(tools.map((tool) => tool.name)).toEqual(["seed"])
  })

  test("TTL expiry triggers refresh", async () => {
    let calls = 0
    const refresh = async () => {
      calls++
      return { tools: [sample("fresh")] }
    }

    McpManifestCache.set("srv", [sample("stale")])
    const entry = McpManifestCache.peek("srv")!
    entry.fetchedAt = Date.now() - DEFAULT_TTL_MS - 1

    const tools = await McpManifestCache.get("srv", refresh, { ttlMs: DEFAULT_TTL_MS })
    expect(calls).toBe(1)
    expect(tools.map((tool) => tool.name)).toEqual(["fresh"])
  })

  test("failed refresh keeps last-good manifest", async () => {
    McpManifestCache.set("srv", [sample("good")])

    const tools = await McpManifestCache.get(
      "srv",
      async () => undefined,
      { ttlMs: DEFAULT_TTL_MS, force: true },
    )

    expect(tools.map((tool) => tool.name)).toEqual(["good"])
    expect(McpManifestCache.peek("srv")?.degraded).toBe(true)
  })

  test("list_changed invalidates before next fetch", async () => {
    McpManifestCache.set("srv", [sample("old")])
    McpManifestCache.invalidate("srv", "list_changed")

    let calls = 0
    const tools = await McpManifestCache.get(
      "srv",
      async () => {
        calls++
        return { tools: [sample("new")] }
      },
      { ttlMs: DEFAULT_TTL_MS },
    )

    expect(calls).toBe(1)
    expect(tools.map((tool) => tool.name)).toEqual(["new"])
  })

  test("concurrent refresh is single-flight", async () => {
    let calls = 0
    const refresh = async () => {
      calls++
      await Bun.sleep(20)
      return { tools: [sample("one")] }
    }

    const [a, b] = await Promise.all([
      McpManifestCache.get("srv", refresh, { ttlMs: DEFAULT_TTL_MS }),
      McpManifestCache.get("srv", refresh, { ttlMs: DEFAULT_TTL_MS }),
    ])

    expect(calls).toBe(1)
    expect(a.map((tool) => tool.name)).toEqual(["one"])
    expect(b.map((tool) => tool.name)).toEqual(["one"])
  })

  test("staleRefresh forces invalidate and refresh", async () => {
    McpManifestCache.set("srv", [sample("old")])

    let calls = 0
    const tools = await McpManifestCache.staleRefresh(
      "srv",
      async () => {
        calls++
        return { tools: [sample("new")] }
      },
      DEFAULT_TTL_MS,
    )

    expect(calls).toBe(1)
    expect(tools.map((tool) => tool.name)).toEqual(["new"])
  })
})
