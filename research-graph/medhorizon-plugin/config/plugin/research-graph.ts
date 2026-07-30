import type { Plugin } from "@synsci/plugin"
import { atlasExperiment } from "../../tools/atlas_experiment"
import { atlasGepa } from "../../tools/atlas_gepa"
import { atlasGraph } from "../../tools/atlas_graph"
import { atlasSidebar } from "../../tools/atlas_sidebar"
import { atlasSync } from "../../tools/atlas_sync"

/** MedHorizon plugin entry — calls Research Graph module API only; does not patch core. */
export const ResearchGraphPlugin: Plugin = async () => {
  return {
    tool: {
      atlas_graph: atlasGraph,
      atlas_experiment: atlasExperiment,
      atlas_gepa: atlasGepa,
      atlas_sync: atlasSync,
      atlas_sidebar: atlasSidebar,
    },
  }
}

export default ResearchGraphPlugin
