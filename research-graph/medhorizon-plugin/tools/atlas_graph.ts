import { tool } from "@synsci/plugin"
import { apiBase, mode, rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

export const atlasGraph = tool({
  description:
    "Query or mutate the local Research Graph module (graphs/nodes/edges). Write ops require ask. Returns RESEARCH_GRAPH_UNAVAILABLE if sidecar is down.",
  args: {
    action: tool.schema.enum(["list", "get", "tree", "search", "create", "update", "edge", "export", "ui"]),
    graph_id: tool.schema.string().optional(),
    node_id: tool.schema.string().optional(),
    title: tool.schema.string().optional(),
    kind: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    source_id: tool.schema.string().optional(),
    target_id: tool.schema.string().optional(),
    relation: tool.schema.string().optional(),
    query: tool.schema.string().optional(),
    idempotency_key: tool.schema.string().optional(),
    reason: tool.schema.string().optional(),
  },
  async execute(args, ctx) {
    const meta = {
      session_id: ctx.sessionID,
      message_id: ctx.messageID,
      idempotency_key: args.idempotency_key,
      reason: args.reason,
    }
    try {
      if (args.action === "ui") {
        return JSON.stringify({ ui: "http://127.0.0.1:5173", mode: mode(), api: apiBase() })
      }
      if (args.action === "list") {
        return JSON.stringify(await rgFetch("/api/graphs"))
      }
      if (args.action === "get") {
        if (!args.graph_id) return "graph_id required"
        return JSON.stringify(await rgFetch(`/api/graphs/${args.graph_id}`))
      }
      if (args.action === "tree") {
        if (!args.graph_id) return "graph_id required"
        return JSON.stringify(await rgFetch(`/api/graphs/${args.graph_id}/tree`))
      }
      if (args.action === "export") {
        if (!args.graph_id) return "graph_id required"
        return JSON.stringify(await rgFetch(`/api/graphs/${args.graph_id}/export`))
      }
      if (args.action === "search") {
        if (!args.graph_id || !args.query) return "graph_id and query required"
        return JSON.stringify(
          await rgFetch("/api/search/semantic", {
            method: "POST",
            body: JSON.stringify({ graph_id: args.graph_id, query: args.query }),
          }),
        )
      }
      if (args.action === "create") {
        await ctx.ask({
          permission: "research_graph_write",
          patterns: ["graph"],
          always: ["research_graph_write"],
          metadata: { action: "create", reason: args.reason },
        })
        if (args.kind && args.graph_id && args.title) {
          return JSON.stringify(
            await rgFetch("/api/nodes", {
              method: "POST",
              body: JSON.stringify({
                graph_id: args.graph_id,
                kind: args.kind,
                title: args.title,
                content: args.content,
                ...meta,
              }),
            }),
          )
        }
        if (!args.title) return "title required to create graph"
        return JSON.stringify(
          await rgFetch("/api/graphs", {
            method: "POST",
            body: JSON.stringify({ title: args.title, ...meta }),
          }),
        )
      }
      if (args.action === "update") {
        await ctx.ask({
          permission: "research_graph_write",
          patterns: ["node"],
          always: ["research_graph_write"],
          metadata: { action: "update", node_id: args.node_id },
        })
        if (!args.node_id) return "node_id required"
        return JSON.stringify(
          await rgFetch(`/api/nodes/${args.node_id}`, {
            method: "PATCH",
            body: JSON.stringify({ title: args.title, content: args.content, ...meta }),
          }),
        )
      }
      if (args.action === "edge") {
        await ctx.ask({
          permission: "research_graph_write",
          patterns: ["edge"],
          always: ["research_graph_write"],
          metadata: { action: "edge" },
        })
        if (!args.graph_id || !args.source_id || !args.target_id || !args.relation) {
          return "graph_id, source_id, target_id, relation required"
        }
        return JSON.stringify(
          await rgFetch("/api/edges", {
            method: "POST",
            body: JSON.stringify({
              graph_id: args.graph_id,
              source_id: args.source_id,
              target_id: args.target_id,
              relation: args.relation,
              ...meta,
            }),
          }),
        )
      }
      return `unknown action ${args.action}`
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify({ error: err.code, message: err.message })
      }
      return `atlas_graph error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
