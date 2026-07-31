import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.cache" })

export const DEFAULT_TTL_MS = 5 * 60 * 1000

type Entry = {
  tools: MCPToolDef[]
  fetchedAt: number
  degraded: boolean
}

type RefreshResult = { tools: MCPToolDef[] } | undefined

const entries = new Map<string, Entry>()
const inflight = new Map<string, Promise<Entry | undefined>>()

export namespace McpManifestCache {
  export function peek(server: string) {
    return entries.get(server)
  }

  export function invalidate(server: string, reason: string) {
    const had = entries.has(server)
    entries.delete(server)
    log.info("cache_invalidate", { server, reason, had })
  }

  export function clear(server?: string) {
    if (server) entries.delete(server)
    else entries.clear()
  }

  export function set(server: string, tools: MCPToolDef[]) {
    entries.set(server, { tools, fetchedAt: Date.now(), degraded: false })
    log.info("cache_refresh_ok", { server, toolCount: tools.length })
  }

  export function expired(entry: Entry, ttlMs: number) {
    return Date.now() - entry.fetchedAt > ttlMs
  }

  export async function get(
    server: string,
    refresh: () => Promise<RefreshResult>,
    input: { ttlMs: number; force?: boolean },
  ): Promise<MCPToolDef[]> {
    const existing = entries.get(server)

    if (!input.force && existing && !expired(existing, input.ttlMs)) {
      log.info("cache_hit", { server, toolCount: existing.tools.length, degraded: existing.degraded })
      return existing.tools
    }

    log.info("cache_miss", {
      server,
      reason: !existing ? "empty" : input.force ? "forced" : "ttl_expired",
    })

    return refreshSingleFlight(server, refresh, existing)
  }

  async function refreshSingleFlight(
    server: string,
    refresh: () => Promise<RefreshResult>,
    lastGood: Entry | undefined,
  ): Promise<MCPToolDef[]> {
    const pending = inflight.get(server)
    if (pending) {
      const entry = await pending
      if (entry) return entry.tools
      const kept = lastGood ?? entries.get(server)
      return kept?.tools ?? []
    }

    const promise = (async (): Promise<Entry | undefined> => {
      const result = await refresh()
      if (result) {
        const entry: Entry = { tools: result.tools, fetchedAt: Date.now(), degraded: false }
        entries.set(server, entry)
        log.info("cache_refresh_ok", { server, toolCount: result.tools.length })
        return entry
      }

      const kept = lastGood ?? entries.get(server)
      log.info("cache_refresh_failed", { server, keptLastGood: !!kept, toolCount: kept?.tools.length ?? 0 })
      if (kept) {
        const degraded = { ...kept, degraded: true }
        entries.set(server, degraded)
        return degraded
      }
      return undefined
    })()

    inflight.set(server, promise)
    try {
      const entry = await promise
      return entry?.tools ?? []
    } finally {
      inflight.delete(server)
    }
  }

  export async function staleRefresh(
    server: string,
    refresh: () => Promise<RefreshResult>,
    ttlMs: number,
  ): Promise<MCPToolDef[]> {
    log.info("cache_stale_call", { server })
    invalidate(server, "stale_call")
    return get(server, refresh, { ttlMs, force: true })
  }
}
