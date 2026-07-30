const BASE = import.meta.env.VITE_API_URL ?? ""
const TOKEN = localStorage.getItem("rg_token") || "local-dev"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
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
  tags?: string[]
  meta?: {
    medhorizon_stage?: {
      name?: string
      index?: number
      part_id?: string
      session_id?: string
      message_id?: string
      directory?: string
      status?: string
      summary?: string
    }
  }
}

export type MedhorizonNav = {
  node_id: string
  graph_id: string
  session_id?: string | null
  message_id?: string | null
  part_id?: string | null
  stage_name?: string | null
  directory?: string | null
  can_open: boolean
  can_branch: boolean
  open_url?: string | null
  open_url_gateway?: string | null
  hint?: string | null
}

export type MedhorizonBranch = {
  source_session_id: string
  session: { id: string; title?: string }
  restored: boolean
  open_url: string
  open_url_gateway?: string
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
  hypothesis_node_id?: string | null
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
  archiveGraph: (id: string) =>
    request<Graph>(`/api/graphs/${id}/archive`, { method: "POST", body: JSON.stringify({ reason: "ui" }) }),
  exportNodeMarkdown: (id: string) => request<{ markdown: string }>(`/api/nodes/${id}/markdown`),
  importMarkdown: (graphId: string, markdown: string) =>
    request<Node>(`/api/graphs/${graphId}/import/markdown`, {
      method: "POST",
      body: JSON.stringify({ markdown }),
    }),
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
  sidebarCard: () =>
    request<{
      title: string
      subtitle: string
      mode: string
      metrics: { graphs: number; experiments: number; gepa_awaiting_gate: number }
      latest_graph: { id: string; title: string } | null
      cta: { label: string; href: string }
    }>("/integration/sidebar-card"),
  manifest: () => request<Record<string, unknown>>("/integration/manifest"),
  medhorizonNav: (nodeId: string) => request<MedhorizonNav>(`/api/nodes/${nodeId}/medhorizon`),
  medhorizonBranch: (nodeId: string, restoreFiles = true) =>
    request<MedhorizonBranch>(`/api/nodes/${nodeId}/medhorizon/branch`, {
      method: "POST",
      body: JSON.stringify({ restore_files: restoreFiles, reason: "ui-branch" }),
    }),
}
