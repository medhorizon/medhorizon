import { tool } from "@synsci/plugin"
import { mode, rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

export const atlasSync = tool({
  description: "Inspect Research Graph sync outbox / capability and retry pending Atlas projections. Ask on retry/commit.",
  args: {
    action: tool.schema.enum(["capability", "outbox", "retry"]),
    item_id: tool.schema.string().optional(),
    status: tool.schema.string().optional(),
  },
  async execute(args, ctx) {
    try {
      if (args.action === "capability") {
        const cap = await rgFetch("/api/sync/capability")
        return JSON.stringify({ ...cap, plugin_mode: mode() })
      }
      if (args.action === "outbox") {
        const q = args.status ? `?status=${encodeURIComponent(args.status)}` : ""
        return JSON.stringify(await rgFetch(`/api/sync/outbox${q}`))
      }
      if (args.action === "retry") {
        await ctx.ask({
          permission: "research_graph_sync",
          patterns: ["retry"],
          always: ["research_graph_sync"],
          metadata: { item_id: args.item_id },
        })
        if (!args.item_id) return "item_id required"
        return JSON.stringify(await rgFetch(`/api/sync/outbox/${args.item_id}/retry`, { method: "POST" }))
      }
      return `unknown action ${args.action}`
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify({ error: err.code, message: err.message })
      }
      return `atlas_sync error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
