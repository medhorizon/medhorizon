import { tool } from "@synsci/plugin"
import { rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

export const atlasExperiment = tool({
  description:
    "Manage Research Graph experiments: list/create specs, approve, start dry-run or real runs, finish/cancel. Execution asks permission.",
  args: {
    action: tool.schema.enum(["list", "get", "create", "approve", "start", "finish", "cancel", "metrics"]),
    graph_id: tool.schema.string().optional(),
    experiment_id: tool.schema.string().optional(),
    run_id: tool.schema.string().optional(),
    title: tool.schema.string().optional(),
    objective_json: tool.schema.string().optional().describe("JSON object for objective"),
    code_ref_json: tool.schema.string().optional().describe("JSON object for code_ref"),
    dry_run: tool.schema.boolean().optional(),
    seed: tool.schema.number().optional(),
    exit_code: tool.schema.number().optional(),
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
    const objective = args.objective_json ? JSON.parse(args.objective_json) : {}
    const code_ref = args.code_ref_json ? JSON.parse(args.code_ref_json) : { argv: ["echo", "ok"] }
    try {
      if (args.action === "list") {
        if (!args.graph_id) return "graph_id required"
        return JSON.stringify(await rgFetch(`/api/experiments?graph_id=${args.graph_id}`))
      }
      if (args.action === "get") {
        if (!args.experiment_id) return "experiment_id required"
        return JSON.stringify(await rgFetch(`/api/experiments/${args.experiment_id}`))
      }
      if (args.action === "create") {
        await ctx.ask({
          permission: "research_graph_experiment",
          patterns: ["create"],
          always: ["research_graph_experiment"],
          metadata: { reason: args.reason },
        })
        if (!args.graph_id || !args.title) return "graph_id and title required"
        return JSON.stringify(
          await rgFetch("/api/experiments", {
            method: "POST",
            body: JSON.stringify({
              graph_id: args.graph_id,
              title: args.title,
              objective,
              code_ref,
              ...meta,
            }),
          }),
        )
      }
      if (args.action === "approve") {
        await ctx.ask({
          permission: "research_graph_experiment",
          patterns: ["approve"],
          always: ["research_graph_experiment"],
          metadata: { experiment_id: args.experiment_id },
        })
        if (!args.experiment_id) return "experiment_id required"
        return JSON.stringify(
          await rgFetch(`/api/experiments/${args.experiment_id}/approve`, {
            method: "POST",
            body: JSON.stringify(meta),
          }),
        )
      }
      if (args.action === "start") {
        await ctx.ask({
          permission: "research_graph_experiment",
          patterns: ["start"],
          always: ["research_graph_experiment"],
          metadata: { experiment_id: args.experiment_id, dry_run: args.dry_run ?? true },
        })
        if (!args.experiment_id) return "experiment_id required"
        return JSON.stringify(
          await rgFetch(`/api/experiments/${args.experiment_id}/runs`, {
            method: "POST",
            body: JSON.stringify({ dry_run: args.dry_run ?? true, seed: args.seed, ...meta }),
          }),
        )
      }
      if (args.action === "finish") {
        if (!args.run_id) return "run_id required"
        return JSON.stringify(
          await rgFetch(`/api/runs/${args.run_id}/finish`, {
            method: "POST",
            body: JSON.stringify({ exit_code: args.exit_code ?? 0, ...meta }),
          }),
        )
      }
      if (args.action === "cancel") {
        if (!args.run_id) return "run_id required"
        return JSON.stringify(await rgFetch(`/api/runs/${args.run_id}/cancel`, { method: "POST" }))
      }
      if (args.action === "metrics") {
        if (!args.run_id) return "run_id required"
        return JSON.stringify(await rgFetch(`/api/runs/${args.run_id}`))
      }
      return `unknown action ${args.action}`
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify({ error: err.code, message: err.message })
      }
      return `atlas_experiment error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
