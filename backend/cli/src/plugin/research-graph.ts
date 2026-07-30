import type { Hooks, PluginInput } from "@synsci/plugin"
import { onStageExecuteAfter, STAGE_SYSTEM_HINT } from "../../../../research-graph/medhorizon-plugin/hooks/stage_land"
import { atlasExperiment } from "../../../../research-graph/medhorizon-plugin/tools/atlas_experiment"
import { atlasGepa } from "../../../../research-graph/medhorizon-plugin/tools/atlas_gepa"
import { atlasGraph } from "../../../../research-graph/medhorizon-plugin/tools/atlas_graph"
import { atlasSidebar } from "../../../../research-graph/medhorizon-plugin/tools/atlas_sidebar"
import { atlasStage } from "../../../../research-graph/medhorizon-plugin/tools/atlas_stage"
import { atlasSync } from "../../../../research-graph/medhorizon-plugin/tools/atlas_sync"

/** Built-in Research Graph plugin — ships inside MedHorizon binary. */
export async function ResearchGraphPlugin(input: PluginInput): Promise<Hooks> {
  if (process.env.RESEARCH_GRAPH_DISABLE === "1") return {}

  process.env.RESEARCH_GRAPH_API ||= "http://127.0.0.1:8000"
  process.env.RESEARCH_GRAPH_MODE ||= "local"
  const directory = input.directory

  return {
    tool: {
      atlas_graph: atlasGraph,
      atlas_experiment: atlasExperiment,
      atlas_gepa: atlasGepa,
      atlas_sync: atlasSync,
      atlas_sidebar: atlasSidebar,
      atlas_stage: atlasStage,
    },
    "tool.execute.after": (inp, out) => onStageExecuteAfter(inp, out, directory),
    "experimental.chat.system.transform": async (_input, output) => {
      if (output.system.some((s) => s.includes("Research Graph stage landing"))) return
      output.system.push(STAGE_SYSTEM_HINT)
    },
    config: async (cfg) => {
      const perm = (cfg.permission ??= {}) as Record<string, "ask" | "allow" | "deny">
      perm.research_graph_write ??= "ask"
      perm.research_graph_experiment ??= "ask"
      perm.research_graph_gepa ??= "ask"
      perm.research_graph_sync ??= "ask"
    },
  }
}
