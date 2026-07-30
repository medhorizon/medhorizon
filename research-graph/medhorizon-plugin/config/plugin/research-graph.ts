import type { Plugin } from "@synsci/plugin"
import { onStageExecuteAfter, STAGE_SYSTEM_HINT } from "../../hooks/stage_land"
import { atlasExperiment } from "../../tools/atlas_experiment"
import { atlasGepa } from "../../tools/atlas_gepa"
import { atlasGraph } from "../../tools/atlas_graph"
import { atlasSidebar } from "../../tools/atlas_sidebar"
import { atlasStage } from "../../tools/atlas_stage"
import { atlasSync } from "../../tools/atlas_sync"

/** MedHorizon plugin entry — calls Research Graph module API only; does not patch core. */
export const ResearchGraphPlugin: Plugin = async (input) => {
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
  }
}

export default ResearchGraphPlugin
