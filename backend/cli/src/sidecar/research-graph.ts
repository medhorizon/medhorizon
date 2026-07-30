import { existsSync } from "fs"
import path from "path"
import { UI } from "../cli/ui"

type Side = {
  kill: (signal?: number | NodeJS.Signals) => void
  exited: Promise<number>
}

const state: { child: Side | null } = { child: null }

function sibling() {
  if (process.platform === "win32") return "research-graph.exe"
  return "research-graph"
}

function candidates() {
  const name = sibling()
  const home = process.env.LOCALAPPDATA || process.env.HOME || ""
  return [
    path.join(path.dirname(process.execPath), name),
    path.join(process.cwd(), name),
    path.join(home, "MedHorizon", name),
    path.join(home, ".local", "medhorizon", name),
    process.env.RESEARCH_GRAPH_BIN || "",
  ].filter(Boolean)
}

/** Start Research Graph sidecar if a sibling binary is present. Idempotent. */
export async function startResearchGraphSidecar() {
  if (state.child) return state.child
  if (process.env.RESEARCH_GRAPH_DISABLE === "1") return null

  const bin = candidates().find((p) => existsSync(p))
  if (!bin) return null

  try {
    const res = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(800) })
    if (res.ok) {
      UI.println(UI.Style.TEXT_DIM, "  Research Graph sidecar already running on :8000")
      return null
    }
  } catch {
    // not up — start it
  }

  const proc = Bun.spawn([bin], {
    cwd: path.dirname(bin),
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      APP_ENV: process.env.APP_ENV || "production",
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: "8000",
      RESEARCH_GRAPH_API: "http://127.0.0.1:8000",
      PUBLIC_API_URL: "http://127.0.0.1:8000",
      UI_URL: "http://127.0.0.1:8000",
    },
  })
  proc.unref()
  state.child = {
    kill: (signal) => {
      try {
        proc.kill(signal)
      } catch {
        // already exited
      }
    },
    exited: proc.exited,
  }

  UI.println(UI.Style.TEXT_INFO_BOLD + "  Research Graph", UI.Style.TEXT_NORMAL, "sidecar → http://127.0.0.1:8000")
  return state.child
}

export function stopResearchGraphSidecar() {
  if (!state.child) return
  state.child.kill()
  state.child = null
}
