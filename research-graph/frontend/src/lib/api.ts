const BASE = import.meta.env.VITE_API_URL ?? ""

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(typeof detail.detail === "string" ? detail.detail : JSON.stringify(detail.detail ?? detail))
  }
  return res.json() as Promise<T>
}

export type Graph = {
  id: string
  title: string
  summary?: string
  revision: number
  archived: boolean
  updated_at: string
}

export type Node = {
  id: string
  graph_id: string
  kind: string
  title: string
  content?: string
  summary?: string
  lifecycle: string
  revision: number
}

export type Edge = {
  id: string
  source_id: string
  target_id: string
  relation: string
}

export type Experiment = {
  id: string
  graph_id: string
  title: string
  status: string
  objective: Record<string, unknown>
  budget: Record<string, unknown>
  revision: number
}

export const api = {
  health: () => request<{ status: string; mode: string; openai: boolean }>("/health"),
  graphs: () => request<Graph[]>("/api/graphs"),
  createGraph: (title: string) =>
    request<Graph>("/api/graphs", { method: "POST", body: JSON.stringify({ title, reason: "ui" }) }),
  tree: (id: string) => request<{ graph: Graph; nodes: Node[]; edges: Edge[] }>(`/api/graphs/${id}/tree`),
  createNode: (body: Partial<Node> & { graph_id: string; kind: string; title: string }) =>
    request<Node>("/api/nodes", { method: "POST", body: JSON.stringify(body) }),
  patchNode: (id: string, body: Record<string, unknown>) =>
    request<Node>(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createEdge: (body: { graph_id: string; source_id: string; target_id: string; relation: string }) =>
    request<Edge>("/api/edges", { method: "POST", body: JSON.stringify(body) }),
  exportGraph: (id: string) => request<unknown>(`/api/graphs/${id}/export`),
  experiments: (graphId: string) => request<Experiment[]>(`/api/experiments?graph_id=${graphId}`),
  getExperiment: (id: string) => request<Experiment>(`/api/experiments/${id}`),
  createExperiment: (body: Record<string, unknown>) =>
    request<Experiment>("/api/experiments", { method: "POST", body: JSON.stringify(body) }),
  approveExperiment: (id: string) =>
    request<Experiment>(`/api/experiments/${id}/approve`, { method: "POST", body: JSON.stringify({ reason: "ui" }) }),
  startRun: (id: string, dryRun = true) =>
    request<Record<string, unknown>>(`/api/experiments/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ dry_run: dryRun, seed: 1, reason: "ui" }),
    }),
  getRun: (id: string) => request<Record<string, unknown>>(`/api/runs/${id}`),
  startGepa: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/gepa/runs", { method: "POST", body: JSON.stringify(body) }),
  iterateGepa: (id: string) =>
    request<Record<string, unknown>>(`/api/gepa/runs/${id}/iterations`, {
      method: "POST",
      body: JSON.stringify({ reason: "ui" }),
    }),
  approveGepa: (id: string) =>
    request<Record<string, unknown>>(`/api/gepa/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ reason: "ui-gate" }),
    }),
  getGepa: (id: string) => request<Record<string, unknown>>(`/api/gepa/runs/${id}`),
}
