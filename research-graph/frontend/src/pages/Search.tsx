import { useState } from "react"
import { AIChat } from "../components/AIChat"
import { api } from "../lib/api"

export function Search() {
  const [graphId, setGraphId] = useState("")
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="stack">
      <h1>Search / AI</h1>
      <p className="muted">Semantic search and chat require OPENAI_API_KEY on the module backend.</p>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel stack">
        <input placeholder="graph id" value={graphId} onChange={(e) => setGraphId(e.target.value)} />
        <input placeholder="query" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              setError(null)
              try {
                const res = await fetch("/api/search/semantic", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ graph_id: graphId, query }),
                })
                const body = await res.json()
                if (!res.ok) throw new Error(JSON.stringify(body.detail ?? body))
                setResult(JSON.stringify(body, null, 2))
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
          >
            Semantic search
          </button>
          <button type="button" className="ghost" onClick={() => void api.health()}>
            Ping health
          </button>
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result}</pre>
      </div>
      {graphId ? <AIChat graphId={graphId} /> : <p className="muted">Enter a graph id to open AI chat.</p>}
    </div>
  )
}
