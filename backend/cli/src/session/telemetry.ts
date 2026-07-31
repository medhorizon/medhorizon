import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Token } from "@/util/token"
import { MessageV2 } from "./message-v2"
import type { Tool } from "ai"
import z from "zod"

// Context-management telemetry (spec P0 + plan 13 task 1). Every metric is a bus
// event so it lands in the streamed event contract for free — tests subscribe
// in-process, the TUI/web client receives it over the event channel, and a future
// `/context` panel can render it with no new plumbing. Emission is always on; the
// paired log line is at DEBUG so it stays quiet by default. Logs carry counts and
// tool IDs only — never prompt bodies, args, credentials, or result content.
export namespace SessionTelemetry {
  const log = Log.create({ service: "session.telemetry" })

  const ToolGroup = z.object({
    count: z.number(),
    bytes: z.number(),
    tokens: z.number(),
    ids: z.array(z.string()),
  })

  const McpServerGroup = ToolGroup.extend({
    server: z.string(),
  })

  export const Event = {
    // Per-turn breakdown of the working context by content type + tool-definition
    // sizes, emitted right before the model call.
    Context: BusEvent.define(
      "session.context",
      z.object({
        sessionID: z.string(),
        tokens: z.object({
          system: z.number(),
          text: z.number(),
          reasoning: z.number(),
          tool: z.number(),
          skills: z.number(),
          image: z.number(),
          toolArgs: z.number(),
          toolResults: z.number(),
          user: z.number(),
        }),
        images: z.number(),
        total: z.number(),
        tools: z.object({
          native: ToolGroup,
          plugin: ToolGroup,
          mcp: ToolGroup.extend({
            servers: z.array(McpServerGroup),
          }),
          total: z.object({
            count: z.number(),
            bytes: z.number(),
            tokens: z.number(),
          }),
        }),
        estimate: z.number(),
      }),
    ),
    // Provider-reported usage after a model step finishes. Source of truth for
    // total tokens; component estimates above are diagnostic only.
    Usage: BusEvent.define(
      "session.usage",
      z.object({
        sessionID: z.string(),
        tokens: z.object({
          input: z.number(),
          output: z.number(),
          reasoning: z.number(),
          cache: z.object({
            read: z.number(),
            write: z.number(),
          }),
        }),
      }),
    ),
    // One event per reclaim mechanism (prune vs LLM summary), tagged with what triggered
    // it and how much it reclaimed — so cheap deterministic reduction (levels 2-3) is
    // attributable separately from the expensive LLM summary (level 4).
    Compaction: BusEvent.define(
      "session.compaction",
      z.object({
        sessionID: z.string(),
        trigger: z.enum(["proactive", "overflow", "manual"]),
        mechanism: z.enum(["prune", "summary"]),
        before: z.number().optional(),
        after: z.number().optional(),
        reclaimed: z.number(),
      }),
    ),
  }

  export type Source = "native" | "plugin" | "mcp"

  export type Origin = {
    source: Source
    server?: string
  }

  export type ToolGroupStats = {
    count: number
    bytes: number
    tokens: number
    ids: string[]
  }

  export type ToolDefinitionStats = {
    native: ToolGroupStats
    plugin: ToolGroupStats
    mcp: ToolGroupStats & { servers: Array<ToolGroupStats & { server: string }> }
    total: { count: number; bytes: number; tokens: number }
  }

  export type ProviderTokens = {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }

  function emptyGroup(): ToolGroupStats {
    return { count: 0, bytes: 0, tokens: 0, ids: [] }
  }

  /** Longest sanitized MCP client-name prefix that matches a tool id. */
  export function mcpServer(id: string, servers: readonly string[]) {
    const ranked = servers
      .map((server) => ({
        server,
        prefix: server.replace(/[^a-zA-Z0-9_-]/g, "_") + "_",
      }))
      .filter((entry) => id.startsWith(entry.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)
    return ranked[0]?.server
  }

  function schemaOf(tool: Tool): unknown {
    const schema = (tool as { inputSchema?: { jsonSchema?: unknown } }).inputSchema?.jsonSchema
    return schema ?? {}
  }

  /** Serialized definition size for one tool. Never logs the payload. */
  export function definitionSize(id: string, tool: Tool) {
    const encoded = JSON.stringify({
      name: id,
      description: tool.description ?? "",
      parameters: schemaOf(tool),
    })
    const bytes = Buffer.byteLength(encoded)
    return { bytes, tokens: Token.estimate(encoded) }
  }

  export function measureTools(
    tools: Record<string, Tool>,
    origins: Record<string, Origin> = {},
  ): ToolDefinitionStats {
    const native = emptyGroup()
    const plugin = emptyGroup()
    const mcp = { ...emptyGroup(), servers: [] as Array<ToolGroupStats & { server: string }> }
    const byServer = new Map<string, ToolGroupStats>()

    for (const [id, tool] of Object.entries(tools)) {
      if (id === "_noop" || id === "invalid") continue
      const size = definitionSize(id, tool)
      const origin = origins[id] ?? { source: "native" as const }
      const bucket = origin.source === "plugin" ? plugin : origin.source === "mcp" ? mcp : native
      bucket.count += 1
      bucket.bytes += size.bytes
      bucket.tokens += size.tokens
      bucket.ids.push(id)
      if (origin.source !== "mcp") continue
      const server = origin.server ?? "unknown"
      const group = byServer.get(server) ?? emptyGroup()
      group.count += 1
      group.bytes += size.bytes
      group.tokens += size.tokens
      group.ids.push(id)
      byServer.set(server, group)
    }

    mcp.servers = [...byServer.entries()]
      .map(([server, stats]) => ({ server, ...stats }))
      .sort((a, b) => a.server.localeCompare(b.server))
    native.ids.sort()
    plugin.ids.sort()
    mcp.ids.sort()

    return {
      native,
      plugin,
      mcp,
      total: {
        count: native.count + plugin.count + mcp.count,
        bytes: native.bytes + plugin.bytes + mcp.bytes,
        tokens: native.tokens + plugin.tokens + mcp.tokens,
      },
    }
  }

  export function withSystem(composition: MessageV2.Composition, system: string[]): MessageV2.Composition {
    const tokens = system.reduce((sum, part) => sum + Token.estimate(part), 0)
    return {
      ...composition,
      system: tokens,
      total: tokens + composition.text + composition.reasoning + composition.tool + composition.skills + composition.image,
    }
  }

  export function recordContext(input: {
    sessionID: string
    composition: MessageV2.Composition
    tools?: ToolDefinitionStats
  }) {
    const c = input.composition
    const tools = input.tools ?? measureTools({})
    const estimate = c.total + tools.total.tokens
    log.debug("context", {
      sessionID: input.sessionID,
      total: c.total,
      system: c.system,
      text: c.text,
      tool: c.tool,
      toolArgs: c.toolArgs,
      toolResults: c.toolResults,
      user: c.user,
      image: c.image,
      reasoning: c.reasoning,
      skills: c.skills,
      images: c.images,
      estimate,
      tools: {
        native: tools.native.count,
        plugin: tools.plugin.count,
        mcp: tools.mcp.count,
        bytes: tools.total.bytes,
        tokens: tools.total.tokens,
        ids: [...tools.native.ids, ...tools.plugin.ids, ...tools.mcp.ids],
        mcpServers: tools.mcp.servers.map((server) => ({
          server: server.server,
          count: server.count,
          bytes: server.bytes,
          tokens: server.tokens,
          ids: server.ids,
        })),
      },
    })
    // Fire-and-forget: callers don't await this. Bus.publish rejects if any subscriber
    // throws, so swallow it here — telemetry must never crash the session loop it observes.
    return Bus.publish(Event.Context, {
      sessionID: input.sessionID,
      tokens: {
        system: c.system,
        text: c.text,
        reasoning: c.reasoning,
        tool: c.tool,
        skills: c.skills,
        image: c.image,
        toolArgs: c.toolArgs,
        toolResults: c.toolResults,
        user: c.user,
      },
      images: c.images,
      total: c.total,
      tools,
      estimate,
    }).catch((error) => log.debug("context telemetry publish failed", { error: `${error}` }))
  }

  export function recordUsage(input: { sessionID: string; tokens: ProviderTokens }) {
    log.debug("usage", {
      sessionID: input.sessionID,
      input: input.tokens.input,
      output: input.tokens.output,
      reasoning: input.tokens.reasoning,
      cacheRead: input.tokens.cache.read,
      cacheWrite: input.tokens.cache.write,
    })
    return Bus.publish(Event.Usage, {
      sessionID: input.sessionID,
      tokens: input.tokens,
    }).catch((error) => log.debug("usage telemetry publish failed", { error: `${error}` }))
  }

  export function recordCompaction(input: {
    sessionID: string
    trigger: "proactive" | "overflow" | "manual"
    mechanism: "prune" | "summary"
    reclaimed: number
    before?: number
    after?: number
  }) {
    // When the caller knows only the reclaimed amount (the prune path returns just that),
    // derive `after` from `before` so consumers always get a consistent before/after/delta.
    // Clamp at 0: `before` (real provider tokens) and `reclaimed` (a local estimate over the
    // pruned history) use different bases, so the estimate can exceed `before` — a context
    // size is never negative.
    const rawAfter = input.after ?? (input.before !== undefined ? input.before - input.reclaimed : undefined)
    const after = rawAfter !== undefined ? Math.max(0, rawAfter) : undefined
    log.debug("compaction", {
      sessionID: input.sessionID,
      trigger: input.trigger,
      mechanism: input.mechanism,
      before: input.before,
      after,
      reclaimed: input.reclaimed,
    })
    return Bus.publish(Event.Compaction, {
      sessionID: input.sessionID,
      trigger: input.trigger,
      mechanism: input.mechanism,
      before: input.before,
      after,
      reclaimed: input.reclaimed,
    }).catch((error) => log.debug("compaction telemetry publish failed", { error: `${error}` }))
  }
}
