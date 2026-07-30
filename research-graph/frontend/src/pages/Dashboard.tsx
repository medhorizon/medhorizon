import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api, type Graph } from "../lib/api"

export function Dashboard() {
  const [graphs, setGraphs] = useState<Graph[]>([])
  const [title, setTitle] = useState("New research graph")
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<string>("…")

  async function load() {
    setError(null)
    try {
      const [list, h] = await Promise.all([api.graphs(), api.health()])
      setGraphs(list)
      setHealth(`${h.status} · ${h.mode}${h.openai ? " · openai" : ""}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Dashboard</h1>
        <span className="muted">API {health}</span>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        <button
          type="button"
          onClick={async () => {
            await api.createGraph(title)
            await load()
          }}
        >
          Create graph
        </button>
      </div>
      <div className="stack">
        {graphs.map((g) => (
          <Link key={g.id} to={`/graphs/${g.id}`} className="panel row" style={{ color: "inherit" }}>
            <strong>{g.title}</strong>
            <span className="muted">rev {g.revision}</span>
            <span className={`badge ${g.archived ? "archived" : "committed"}`}>
              {g.archived ? "archived" : "active"}
            </span>
          </Link>
        ))}
        {!graphs.length ? <p className="muted">No graphs yet.</p> : null}
      </div>
    </div>
  )
}
