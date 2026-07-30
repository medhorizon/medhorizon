import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { MetricTable } from "../components/MetricTable"
import { api, type Experiment, type Graph } from "../lib/api"

export function Experiments() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [graphs, setGraphs] = useState<Graph[]>([])
  const [graphId, setGraphId] = useState(params.get("graph") ?? "")
  const [items, setItems] = useState<Experiment[]>([])
  const [title, setTitle] = useState("New experiment")
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null)

  async function loadGraphs() {
    const list = await api.graphs()
    setGraphs(list)
    if (!graphId && list[0]) setGraphId(list[0].id)
  }

  async function loadExperiments(id: string) {
    if (!id) return
    setItems(await api.experiments(id))
  }

  useEffect(() => {
    void loadGraphs().catch((err) => setError(String(err)))
  }, [])

  useEffect(() => {
    void loadExperiments(graphId).catch((err) => setError(String(err)))
  }, [graphId])

  return (
    <div className="stack">
      <h1>Experiments</h1>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel row">
        <select value={graphId} onChange={(e) => setGraphId(e.target.value)}>
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        <button
          type="button"
          onClick={async () => {
            const exp = await api.createExperiment({
              graph_id: graphId,
              title,
              objective: { primary: "score" },
              code_ref: { argv: ["echo", "ok"] },
              budget: { max_cost: 1 },
              reason: "ui",
            })
            await loadExperiments(graphId)
            navigate(`/experiments/${exp.id}`)
          }}
        >
          Create draft
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Rev</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.title}</td>
              <td>
                <span className={`badge ${e.status}`}>{e.status}</span>
              </td>
              <td>{e.revision}</td>
              <td>
                <Link to={`/experiments/${e.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lastRun ? (
        <div className="panel">
          <h2>Last run</h2>
          <p>
            Status <span className={`badge ${String(lastRun.status)}`}>{String(lastRun.status)}</span>
          </p>
          <MetricTable metrics={(lastRun.metrics as Array<{ name: string; value: number }>) ?? []} />
        </div>
      ) : null}
      <button type="button" className="ghost" onClick={() => setLastRun(null)} hidden={!lastRun}>
        Clear
      </button>
    </div>
  )
}
