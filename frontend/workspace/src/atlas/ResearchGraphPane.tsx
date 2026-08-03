import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconNetwork } from "@/atlas/shared/Icon"
import { useSDK } from "@/context/sdk"

type State = "loading" | "ready" | "not_bound" | "unavailable" | "error"

function errorValue(error: unknown): { status?: string; code?: string; message?: string } {
  if (typeof error !== "object" || error === null) return {}
  const value = error as { status?: unknown; code?: unknown; message?: unknown }
  return {
    status: typeof value.status === "string" ? value.status : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  }
}

function embed(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/research-graph/embed/")) return
  if (value.includes("\\") || value.includes("://") || value.includes("\u0000")) return
  return value
}

function failure(error: unknown): { state: Exclude<State, "loading" | "ready" | "not_bound">; message: string } {
  const value = errorValue(error)
  const unavailable = value.status === "unavailable" || value.status === "timeout" || value.code === "research_graph_unavailable"
  if (unavailable) {
    return { state: "unavailable", message: "Research Graph is unavailable. Retry when the sidecar is ready." }
  }
  if (value.status === "rejected" || value.status === "incompatible" || value.status === "integrity") {
    return { state: "error", message: `Research Graph ${value.status}.` }
  }
  return { state: "error", message: value.message || "Could not resolve this session's Research Graph." }
}

export function ResearchGraphPane(): JSX.Element {
  const params = useParams()
  const sdk = useSDK()
  const [status, setStatus] = createSignal<State>("loading")
  const [message, setMessage] = createSignal("")
  const [path, setPath] = createSignal<string>()
  const [tick, setTick] = createSignal(0)

  const reload = () => setTick((value) => value + 1)

  createEffect(() => {
    const sessionID = params.id
    tick()
    const lifecycle = { cancelled: false }
    setStatus("loading")
    setMessage("")
    setPath(undefined)

    if (!sessionID || sessionID === "new") {
      setStatus("not_bound")
      setMessage("Select a session to resolve its Research Graph binding.")
      return
    }

    void (async () => {
      try {
        const result = await sdk.client.researchGraph.session.resolve({ sessionId: sessionID })
        if (lifecycle.cancelled) return
        const data = result.data
        if (!data || data.status === "not_bound") {
          setStatus("not_bound")
          setMessage("This session is not bound to a Research Graph.")
          return
        }
        const next = embed(data.embedPath)
        if (!next) {
          setStatus("error")
          setMessage("Research Graph returned an invalid embed path.")
          return
        }
        setPath(next)
        setStatus("ready")
      } catch (error) {
        if (lifecycle.cancelled) return
        const result = failure(error)
        setStatus(result.state)
        setMessage(result.message)
      }
    })()

    onCleanup(() => {
      lifecycle.cancelled = true
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
      <Show when={status() === "ready" && path()} keyed>
        {(src) => (
          <iframe
            title="Research Graph"
            src={src}
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
          aria-live="polite"
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
            {status() === "unavailable" && "research graph is unavailable"}
            {status() === "error" && "could not open research graph"}
            {status() === "not_bound" && "no graph bound"}
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
          <Show when={status() !== "loading"}>
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
