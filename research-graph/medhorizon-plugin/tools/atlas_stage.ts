import { tool } from "@synsci/plugin"
import { apiBase, rgFetch, ResearchGraphUnavailable, unavailablePayload } from "../atlas_bridge"

/** Explicit stage → node landing + session↔graph bind (LLM recovery path). */
export const atlasStage = tool({
  description:
    "Land a MedHorizon session stage onto a Research Graph node, bind session→graph, or fetch the stage-landing protocol. Prefer after calling the built-in stage tool. Idempotent via stage-land:{session}:{part_id}.",
  args: {
    action: tool.schema.enum(["land", "bind", "list", "protocol", "get_bind"]),
    graph_id: tool.schema.string().optional(),
    stage_name: tool.schema.string().optional(),
    stage_index: tool.schema.number().optional(),
    part_id: tool.schema.string().optional(),
    stage_status: tool.schema.string().optional(),
    summary: tool.schema.string().optional(),
    gated: tool.schema.boolean().optional(),
    kind: tool.schema.string().optional(),
    title: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    create_graph_title: tool.schema.string().optional(),
    directory: tool.schema.string().optional(),
    idempotency_key: tool.schema.string().optional(),
    reason: tool.schema.string().optional(),
  },
  async execute(args, ctx) {
    const meta = {
      session_id: ctx.sessionID,
      message_id: ctx.messageID,
      idempotency_key: args.idempotency_key,
      reason: args.reason || "atlas_stage tool",
      directory: args.directory,
    }
    try {
      if (args.action === "protocol") {
        return JSON.stringify({ ...(await rgFetch("/api/stages/protocol")), api: apiBase() })
      }
      if (args.action === "get_bind") {
        return JSON.stringify(await rgFetch(`/api/sessions/bind?session_id=${encodeURIComponent(ctx.sessionID)}`))
      }
      if (args.action === "list") {
        return JSON.stringify(await rgFetch(`/api/stages/by-session?session_id=${encodeURIComponent(ctx.sessionID)}`))
      }
      if (args.action === "bind") {
        if (!args.graph_id) return "graph_id required for bind"
        await ctx.ask({
          permission: "research_graph_write",
          patterns: ["session_bind"],
          always: ["research_graph_write"],
          metadata: { action: "bind", graph_id: args.graph_id },
        })
        return JSON.stringify(
          await rgFetch("/api/sessions/bind", {
            method: "POST",
            body: JSON.stringify({
              session_id: ctx.sessionID,
              graph_id: args.graph_id,
              ...meta,
            }),
          }),
        )
      }
      if (args.action === "land") {
        if (!args.stage_name) return "stage_name required for land"
        await ctx.ask({
          permission: "research_graph_write",
          patterns: ["stage_land"],
          always: ["research_graph_write"],
          metadata: { action: "land", stage: args.stage_name },
        })
        const part = args.part_id
        const key =
          args.idempotency_key ||
          (part
            ? `stage-land:${ctx.sessionID}:${part}`
            : `stage-land:${ctx.sessionID}:${args.stage_index ?? "x"}:${args.stage_name.toLowerCase()}`)
        return JSON.stringify(
          await rgFetch("/api/stages/land", {
            method: "POST",
            body: JSON.stringify({
              graph_id: args.graph_id,
              stage: {
                name: args.stage_name,
                index: args.stage_index,
                part_id: args.part_id,
                status: args.stage_status,
                summary: args.summary,
                gated: args.gated,
              },
              kind: args.kind,
              title: args.title,
              content: args.content,
              create_graph_title: args.create_graph_title,
              ...meta,
              idempotency_key: key,
            }),
          }),
        )
      }
      return `unknown action ${args.action}`
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify(unavailablePayload(err.message))
      }
      return `atlas_stage error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
