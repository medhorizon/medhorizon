/** HTTP client for the research-graph sidecar. */

export type BridgeMode = "local" | "atlas" | "hybrid"

export class ResearchGraphUnavailable extends Error {
  code = "RESEARCH_GRAPH_UNAVAILABLE" as const
  constructor(message: string) {
    super(message)
    this.name = "ResearchGraphUnavailable"
  }
}

export function unavailablePayload(message: string) {
  return { error: "RESEARCH_GRAPH_UNAVAILABLE" as const, message }
}

export function apiBase() {
  return (process.env["RESEARCH_GRAPH_API"] || "http://127.0.0.1:8000").replace(/\/$/, "")
}

export function mode(): BridgeMode {
  const value = (process.env["RESEARCH_GRAPH_MODE"] || "local") as BridgeMode
  return value
}

export async function rgFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`
  const token = process.env["RESEARCH_GRAPH_TOKEN"] || "local-dev"
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new ResearchGraphUnavailable(
      `Research Graph sidecar unreachable at ${apiBase()} (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`research-graph ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

/** Optional projection through MedHorizon's existing Atlas bridge (no auth reimplementation). */
export async function atlasBridgeFetch<T>(
  serverUrl: string,
  bridgePath: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${serverUrl.replace(/\/$/, "")}${bridgePath}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`atlas bridge ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}
