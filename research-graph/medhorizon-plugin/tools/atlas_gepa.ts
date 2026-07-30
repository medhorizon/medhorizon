import { tool } from "@synsci/plugin"
import { rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

export const atlasGepa = tool({
  description:
    "GEPA optimization loop against Research Graph experiments. All mutating actions ask permission. Never applies candidates without approve gate.",
  args: {
    action: tool.schema.enum(["status", "start", "iterate", "approve", "stop", "replay", "report"]),
    experiment_id: tool.schema.string().optional(),
    gepa_run_id: tool.schema.string().optional(),
    generation: tool.schema.number().optional(),
    objective_json: tool.schema.string().optional(),
    budget_json: tool.schema.string().optional(),
    seed: tool.schema.number().optional(),
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
    const objective = args.objective_json ? JSON.parse(args.objective_json) : { primary: "score" }
    const budget = args.budget_json
      ? JSON.parse(args.budget_json)
      : { max_iterations: 3, max_candidates: 4, patience: 2 }
    try {
      if (args.action === "status" || args.action === "report") {
        if (!args.gepa_run_id) return "gepa_run_id required"
        return JSON.stringify(await rgFetch(`/api/gepa/runs/${args.gepa_run_id}`))
      }
      if (args.action === "start") {
        await ctx.ask({
          permission: "research_graph_gepa",
          patterns: ["start"],
          always: ["research_graph_gepa"],
          metadata: { experiment_id: args.experiment_id },
        })
        if (!args.experiment_id) return "experiment_id required"
        return JSON.stringify(
          await rgFetch("/api/gepa/runs", {
            method: "POST",
            body: JSON.stringify({
              experiment_id: args.experiment_id,
              objective,
              budget,
              seed: args.seed ?? 42,
              ...meta,
            }),
          }),
        )
      }
      if (args.action === "iterate") {
        await ctx.ask({
          permission: "research_graph_gepa",
          patterns: ["iterate"],
          always: ["research_graph_gepa"],
          metadata: { gepa_run_id: args.gepa_run_id },
        })
        if (!args.gepa_run_id) return "gepa_run_id required"
        return JSON.stringify(
          await rgFetch(`/api/gepa/runs/${args.gepa_run_id}/iterations`, {
            method: "POST",
            body: JSON.stringify(meta),
          }),
        )
      }
      if (args.action === "approve") {
        await ctx.ask({
          permission: "research_graph_gepa",
          patterns: ["approve"],
          always: ["research_graph_gepa"],
          metadata: { gepa_run_id: args.gepa_run_id },
        })
        if (!args.gepa_run_id) return "gepa_run_id required"
        return JSON.stringify(
          await rgFetch(`/api/gepa/runs/${args.gepa_run_id}/approve`, {
            method: "POST",
            body: JSON.stringify(meta),
          }),
        )
      }
      if (args.action === "stop") {
        await ctx.ask({
          permission: "research_graph_gepa",
          patterns: ["stop"],
          always: ["research_graph_gepa"],
          metadata: { gepa_run_id: args.gepa_run_id },
        })
        if (!args.gepa_run_id) return "gepa_run_id required"
        return JSON.stringify(await rgFetch(`/api/gepa/runs/${args.gepa_run_id}/stop`, { method: "POST" }))
      }
      if (args.action === "replay") {
        await ctx.ask({
          permission: "research_graph_gepa",
          patterns: ["replay"],
          always: ["research_graph_gepa"],
          metadata: { gepa_run_id: args.gepa_run_id },
        })
        if (!args.gepa_run_id) return "gepa_run_id required"
        return JSON.stringify(
          await rgFetch(`/api/gepa/runs/${args.gepa_run_id}/replay`, {
            method: "POST",
            body: JSON.stringify(meta),
          }),
        )
      }
      return `unknown action ${args.action}`
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify({ error: err.code, message: err.message })
      }
      return `atlas_gepa error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
