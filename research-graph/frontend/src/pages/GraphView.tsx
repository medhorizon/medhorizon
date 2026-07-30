import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { GraphCanvas } from "../components/GraphCanvas"
import { NodePanel } from "../components/NodePanel"
import { api, type Edge, type Experiment, type Node } from "../lib/api"

function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

export function GraphView() {
  const params = useParams()
  const graphId = params.id!
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [title, setTitle] = useState("")
  const [selected, setSelected] = useState<Node | null>(null)
  const [kind, setKind] = useState("hypothesis")
  const [nodeTitle, setNodeTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [filter, setFilter] = useState("all")
  const [experiments, setExperiments] = useState<Experiment[]>([])

  async function load() {
    setError(null)
    try {
      const tree = await api.tree(graphId)
      setTitle(tree.graph.title)
      setNodes(tree.nodes)
      setEdges(tree.edges)
      setExperiments(await api.experiments(graphId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [graphId])

  async function openSession(node: Node) {
    setStatus(null)
    setError(null)
    try {
      const nav = await api.medhorizonNav(node.id)
      if (!nav.open_url) throw new Error(nav.hint || "无法打开 MedHorizon 对话")
      openUrl(nav.open_url)
      setStatus(`已打开会话 ${nav.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function branchHere(node: Node) {
    setStatus(null)
    setError(null)
    const ok = window.confirm(
      `在阶段「${node.meta?.medhorizon_stage?.name ?? node.title}」开分支？\n将 fork MedHorizon 会话（原会话保留）。`,
    )
    if (!ok) return
    try {
      const result = await api.medhorizonBranch(node.id)
      openUrl(result.open_url)
      setStatus(`已开分支 → ${result.session.id}${result.restored ? "（已恢复工作区快照）" : ""}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const visible = filter === "all" ? nodes : nodes.filter((n) => n.kind === filter || n.lifecycle === filter)
  const linkedExperiment =
    selected?.kind === "experiment"
      ? (experiments.find((e) => e.title === selected.title) ?? experiments[0])
      : experiments.find((e) => e.hypothesis_node_id === selected?.id)

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{title || "Graph"}</h1>
        <div className="row">
          <Link to={`/experiments?graph=${graphId}`}>Experiments</Link>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await api.archiveGraph(graphId)
              await load()
            }}
          >
            Archive
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const data = await api.exportGraph(graphId)
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.href = url
              a.download = `${title || "graph"}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export JSON
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {status ? <p className="muted">{status}</p> : null}
      <div className="panel row">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {["hypothesis", "evidence", "literature", "experiment", "note", "insight", "conclusion"].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          placeholder="Node title"
          value={nodeTitle}
          onChange={(e) => setNodeTitle(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={async () => {
            if (!nodeTitle.trim()) return
            await api.createNode({ graph_id: graphId, kind, title: nodeTitle })
            setNodeTitle("")
            await load()
          }}
        >
          Add node
        </button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">all</option>
          <option value="hypothesis">hypothesis</option>
          <option value="evidence">evidence</option>
          <option value="staged">staged</option>
          <option value="committed">committed</option>
          <option value="archived">archived</option>
        </select>
      </div>
      <GraphCanvas
        nodes={visible}
        edges={edges}
        onSelect={setSelected}
        onOpenSession={(n) => void openSession(n)}
        onBranch={(n) => void branchHere(n)}
      />
      <NodePanel
        node={selected}
        experimentId={linkedExperiment?.id}
        status={selected ? status : null}
        onSave={async (patch) => {
          if (!selected) return
          await api.patchNode(selected.id, { ...patch, expected_revision: selected.revision })
          await load()
        }}
        onExportMarkdown={async () => {
          if (!selected) return
          const { markdown } = await api.exportNodeMarkdown(selected.id)
          const blob = new Blob([markdown], { type: "text/markdown" })
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = `${selected.title}.md`
          a.click()
          URL.revokeObjectURL(url)
        }}
        onImportMarkdown={async (markdown) => {
          await api.importMarkdown(graphId, markdown)
          await load()
        }}
        onOpenSession={() => {
          if (selected) void openSession(selected)
        }}
        onBranch={() => {
          if (selected) void branchHere(selected)
        }}
      />
    </div>
  )
}
