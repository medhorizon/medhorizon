import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconNetwork } from "@/atlas/shared/Icon"
import { useSync } from "@/context/sync"

const API_DEFAULT = "http://127.0.0.1:8000"
const UI_CANDIDATES = ["http://127.0.0.1:5173", "http://127.0.0.1:8000"] as const
const TOKEN = "local-dev"

function origin(env?: string, fallback = API_DEFAULT) {
  const raw = (env || "").trim().replace(/\/+$/, "")
  return raw || fallback
}

function apiBase() {
  return origin(import.meta.env.VITE_RESEARCH_GRAPH_API, API_DEFAULT)
}

/** True when the URL serves the SPA (HTML), not a bare FastAPI JSON 404. */
async function isSpaOrigin(base: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2500)
  try {
    const res = await fetch(`${base}/embed/graph/_probe`, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "text/html" },
    })
    const type = res.headers.get("content-type") || ""
    if (type.includes("text/html")) return true
    const text = await res.text()
    if (text.trimStart().startsWith("<!") || text.includes("<html")) return true
    // API-only :8000 returns {"detail":"Not Found"} with application/json
    if (text.includes('"detail"') && text.includes("Not Found")) return false
    return false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function resolveUiBase() {
  const forced = import.meta.env.VITE_RESEARCH_GRAPH_UI?.trim()
  if (forced) {
    const base = origin(forced)
    if (await isSpaOrigin(base)) return base
    throw new Error(
      `VITE_RESEARCH_GRAPH_UI=${base} is not serving the Research Graph SPA. ` +
        `Start Vite on :5173 or rebuild the sidecar UI.`,
    )
  }
  for (const candidate of UI_CANDIDATES) {
    if (await isSpaOrigin(candidate)) return candidate
  }
  throw new Error(
    "Research Graph UI not found. Start Vite: cd research-graph/frontend && bun run dev -- --port 5173 " +
      "(API alone on :8000 has no /embed/graph page).",
  )
}

async function rgFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    const detail =
      typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body)
    throw new Error(`${res.status} ${detail}`)
  }
  return res.json() as Promise<T>
}

type GraphRow = { id: string; title?: string; archived?: boolean; updated_at?: string }
type StageRow = { graph_id: string }

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Match session title → graph title (e.g. "HCC overview…" → HCC_Research). */
function matchGraphByTitle(graphs: GraphRow[], sessionTitle: string) {
  const session = normalizeTitle(sessionTitle)
  if (!session) return

  const ranked = graphs
    .map((graph) => {
      const title = normalizeTitle(graph.title ?? "")
      if (!title) return { graph, score: 0 }
      const base = title.replace(/\bresearch\b/g, " ").replace(/\s+/g, " ").trim()
      if (session.includes(title) || title.includes(session)) return { graph, score: 100 }
      if (base && (session.includes(base) || base.split(" ").every((t) => t.length < 3 || session.includes(t)))) {
        return { graph, score: 80 }
      }
      const tokens = title
        .split(" ")
        .filter((t) => t.length >= 3 && t !== "research" && t !== "new" && t !== "graph")
      const hits = tokens.filter((t) => session.includes(t)).length
      return { graph, score: hits * 25 }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(b.graph.updated_at ?? "").localeCompare(String(a.graph.updated_at ?? "")))

  return ranked[0]?.graph
}

async function pinBind(sessionID: string, graphId: string) {
  try {
    await rgFetch("/api/sessions/bind", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionID,
        graph_id: graphId,
        reason: "sidebar-resolve",
      }),
    })
  } catch {
    // best-effort; iframe can still load the resolved id
  }
}

async function resolveGraphId(sessionID: string | undefined, sessionTitle?: string): Promise<string | undefined> {
  if (sessionID) {
    try {
      const bound = await rgFetch<{ graph_id: string }>(
        `/api/sessions/bind?session_id=${encodeURIComponent(sessionID)}`,
      )
      if (bound.graph_id) return bound.graph_id
    } catch {
      // no binding — try stage landings / title / latest
    }

    try {
      const stages = await rgFetch<StageRow[]>(
        `/api/stages/by-session?session_id=${encodeURIComponent(sessionID)}`,
      )
      const fromStage = stages.find((row) => row.graph_id)?.graph_id
      if (fromStage) {
        void pinBind(sessionID, fromStage)
        return fromStage
      }
    } catch {
      // no stage landings for this session
    }
  }

  const graphs = await rgFetch<GraphRow[]>("/api/graphs")
  const active = graphs.filter((g) => !g.archived)
  const list = active.length ? active : graphs

  if (sessionTitle) {
    const hit = matchGraphByTitle(list, sessionTitle)
    if (hit?.id) {
      if (sessionID) void pinBind(sessionID, hit.id)
      return hit.id
    }
  }

  // Latest first; skip empty stubs only when a newer empty graph shadows an older board with nodes.
  list.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
  const scored = await Promise.all(
    list.map(async (graph) => {
      try {
        const tree = await rgFetch<{ nodes: unknown[] }>(`/api/graphs/${encodeURIComponent(graph.id)}/tree`)
        return { graph, nodes: tree.nodes?.length ?? 0 }
      } catch {
        return { graph, nodes: 0 }
      }
    }),
  )
  const newest = scored[0]
  const populated = scored.find((row) => row.nodes > 0)
  const pick = newest?.nodes ? newest.graph : (populated?.graph ?? newest?.graph)
  if (pick?.id && sessionID && populated && pick.id === populated.graph.id) void pinBind(sessionID, pick.id)
  return pick?.id
}

export function ResearchGraphPane(): JSX.Element {
  const params = useParams()
  const sync = useSync()
  const [status, setStatus] = createSignal<"loading" | "ready" | "empty" | "down">("loading")
  const [message, setMessage] = createSignal("")
  const [graphId, setGraphId] = createSignal<string>()
  const [ui, setUi] = createSignal(API_DEFAULT)
  const [tick, setTick] = createSignal(0)

  const reload = () => setTick((n) => n + 1)

  createEffect(() => {
    const sessionID = params.id
    const sessionTitle = sessionID ? sync.session.get(sessionID)?.title : undefined
    tick()
    let cancelled = false
    setStatus("loading")
    setMessage("")
    setGraphId(undefined)

    void (async () => {
      try {
        await rgFetch<{ status: string }>("/health")
        if (cancelled) return
        const spa = await resolveUiBase()
        if (cancelled) return
        setUi(spa)
        const id = await resolveGraphId(sessionID, sessionTitle)
        if (cancelled) return
        if (!id) {
          setStatus("empty")
          setMessage("No Research Graph yet. Create one in Research Graph UI or bind this session via atlas_stage.")
          return
        }
        setGraphId(id)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        setStatus("down")
        setMessage(
          err instanceof Error
            ? err.message
            : "Research Graph unavailable. Start API :8000 and Vite UI :5173.",
        )
      }
    })()

    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <div
      style={{
        flex: 1,
        "min-height": 0,
        "min-width": 0,
        display: "flex",
        "flex-direction": "column",
        background: "var(--color-bg)",
      }}
    >
      <Show when={status() === "ready" && graphId()} keyed>
        {(id) => (
          <iframe
            title="Research Graph"
            src={`${ui()}/embed/graph/${encodeURIComponent(id)}`}
            style={{
              flex: 1,
              width: "100%",
              height: "100%",
              "min-height": 0,
              "min-width": 0,
              border: 0,
              display: "block",
              background: "#101612",
            }}
          />
        )}
      </Show>

      <Show when={status() !== "ready"}>
        <div
          style={{
            flex: 1,
            display: "grid",
            "place-items": "center",
            padding: "24px",
            "text-align": "center",
            gap: "10px",
          }}
        >
          <IconNetwork size={28} strokeWidth={1.25} />
          <div style={{ "font-family": FONT_SANS, "font-size": "13px", color: "var(--color-text)" }}>
            {status() === "loading" && "Connecting to Research Graph…"}
            {status() === "down" && "research graph is unavailable"}
            {status() === "empty" && "no graph"}
          </div>
          <Show when={message()}>
            <p
              style={{
                "font-family": FONT_MONO,
                "font-size": "11px",
                color: "var(--color-text-muted)",
                "max-width": "300px",
                "line-height": 1.45,
                margin: 0,
              }}
            >
              {message()}
            </p>
          </Show>
          <Show when={status() === "down" || status() === "empty"}>
            <button type="button" onClick={reload} style={retryBtn()}>
              retry
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function retryBtn(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "11px",
    padding: "4px 8px",
    border: "1px solid var(--color-border-strong)",
    "border-radius": "4px",
    background: "var(--color-surface-solid)",
    color: "var(--color-text)",
    cursor: "pointer",
  }
}
