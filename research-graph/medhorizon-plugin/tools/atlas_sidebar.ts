import { tool } from "@synsci/plugin"
import { apiBase, mode, rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

/** Expose the MedHorizon sidebar-card integration contract to agents. */
export const atlasSidebar = tool({
  description:
    "Return the Research Graph featured sidebar-card payload / manifest for MedHorizon. Does not modify MedHorizon core; card is injected via HTTP embed or gateway.",
  args: {
    action: tool.schema.enum(["card", "manifest", "inject_hint"]),
  },
  async execute(args) {
    try {
      if (args.action === "manifest") {
        return JSON.stringify(await rgFetch("/integration/manifest"))
      }
      if (args.action === "card") {
        return JSON.stringify(await rgFetch("/integration/sidebar-card"))
      }
      const api = apiBase()
      return JSON.stringify({
        mode: mode(),
        modifies_medhorizon_core: false,
        options: [
          {
            id: "gateway",
            command: "python3 research-graph/scripts/medhorizon-gateway.py",
            open: "http://127.0.0.1:5199",
            note: "Proxies MedHorizon UI and injects sidebar-card.js",
          },
          {
            id: "bookmarklet",
            url: `${api}/embed/bookmarklet`,
            note: "One-click inject on an already-open MedHorizon tab",
          },
          {
            id: "iframe",
            url: "http://127.0.0.1:5173/embed/card",
            note: "Standalone featured card surface",
          },
        ],
        script: `${api}/embed/sidebar-card.js`,
        card: `${api}/integration/sidebar-card`,
      })
    } catch (err) {
      if (err instanceof ResearchGraphUnavailable) {
        return JSON.stringify({ error: err.code, message: err.message })
      }
      return `atlas_sidebar error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
