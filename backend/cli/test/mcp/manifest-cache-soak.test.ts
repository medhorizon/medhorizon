import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ToolListChangedNotificationSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import z from "zod"
import { McpManifestCache } from "../../src/mcp/manifest-cache"

type Handle = { server: McpServer; client: Client }

const handles: Handle[] = []

afterEach(async () => {
  for (const handle of handles) {
    await handle.client.close().catch(() => {})
    await handle.server.close().catch(() => {})
  }
  handles.length = 0
  McpManifestCache.clear()
})

async function start(serverName: string): Promise<Handle> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = new McpServer({ name: serverName, version: "1.0.0" })
  server.registerTool(
    "echo",
    {
      description: "Return the supplied value",
      inputSchema: { value: z.string() },
    },
    async ({ value }) => ({ content: [{ type: "text", text: value }] }),
  )
  await server.connect(serverTransport)

  const client = new Client({ name: "plan02-soak-client", version: "1.0.0" })
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    McpManifestCache.invalidate(serverName, "list_changed")
  })
  await client.connect(clientTransport)
  const handle = { server, client }
  handles.push(handle)
  return handle
}

async function listTools(client: Client): Promise<{ tools: MCPToolDef[] }> {
  const result = await client.listTools()
  return { tools: result.tools }
}

describe("McpManifestCache real SDK soak", () => {
  test("retains a non-empty manifest through three 20-turn lifecycle runs", async () => {
    const runs = 3
    const turns = 20
    const ttlMs = 25
    const metrics = { turns: 0, restarts: 0, ttlExpiries: 0, notifications: 0, failures: 0, staleRecoveries: 0 }

    for (let run = 0; run < runs; run++) {
      McpManifestCache.clear()
      let handle = await start(`plan02-soak-${run}`)

      for (let turn = 1; turn <= turns; turn++) {
        metrics.turns++
        if (turn === 4 || turn === 12) {
          await Bun.sleep(ttlMs + 5)
          metrics.ttlExpiries++
        }
        if (turn === 6 || turn === 14) {
          handle.server.sendToolListChanged()
          await Bun.sleep(0)
          metrics.notifications++
        }
        if (turn === 8 || turn === 18) {
          await handle.client.close()
          await handle.server.close()
          McpManifestCache.invalidate(`plan02-soak-${run}`, "reconnect")
          handle = await start(`plan02-soak-${run}`)
          metrics.restarts++
        }

        const refresh = async () => listTools(handle.client)
        const tools =
          turn === 16
            ? await (async () => {
                metrics.failures++
                return McpManifestCache.get(`plan02-soak-${run}`, async () => undefined, { ttlMs, force: true })
              })()
            : turn === 17
              ? await (async () => {
                  metrics.staleRecoveries++
                  await handle.client.callTool({ name: "missing-tool", arguments: {} }).catch(() => undefined)
                  return McpManifestCache.staleRefresh(`plan02-soak-${run}`, refresh, ttlMs)
                })()
              : await McpManifestCache.get(`plan02-soak-${run}`, refresh, { ttlMs })

        expect(tools.length).toBeGreaterThan(0)
        expect(tools.some((tool) => tool.name === "echo")).toBe(true)

        if (turn === 19) {
          const burst = await Promise.all(
            Array.from({ length: 5 }, () => McpManifestCache.get(`plan02-soak-${run}`, refresh, { ttlMs })),
          )
          expect(burst.every((items) => items.length > 0)).toBe(true)
        }
      }
    }

    expect(metrics.turns).toBe(60)
    expect(metrics.restarts).toBe(6)
    expect(metrics.ttlExpiries).toBe(6)
    expect(metrics.notifications).toBe(6)
    expect(metrics.failures).toBe(3)
    expect(metrics.staleRecoveries).toBe(3)
  })
})
