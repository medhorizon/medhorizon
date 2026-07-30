import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { GepaCandidateDiff } from "../components/GepaCandidateDiff"
import { api } from "../lib/api"

export function GepaRun() {
  const params = useParams()
  const id = params.id!
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [iteration, setIteration] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setData(await api.getGepa(id))
  }

  useEffect(() => {
    void refresh().catch((err) => setError(String(err)))
  }, [id])

  const run = (data?.run ?? {}) as Record<string, unknown>

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>GEPA run</h1>
        <span className={`badge ${String(run.status ?? "draft")}`}>{String(run.status ?? "…")}</span>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel row">
        <button
          type="button"
          onClick={async () => {
            const result = await api.iterateGepa(id)
            setIteration(result)
            await refresh()
          }}
        >
          Generate + evaluate generation
        </button>
        <button
          type="button"
          disabled={run.status !== "awaiting_gate"}
          onClick={async () => {
            await api.approveGepa(id)
            await refresh()
          }}
        >
          Approve selected (gate)
        </button>
      </div>
      {iteration ? (
        <div className="stack">
          <div className="panel">
            <h2>Iteration</h2>
            <p className="muted">
              gate_required={String(iteration.gate_required)} stopped={String(iteration.stopped)}
            </p>
            <pre style={{ margin: 0, fontSize: "0.8rem" }}>
              {JSON.stringify((iteration.iteration as { critic_report?: unknown })?.critic_report ?? {}, null, 2)}
            </pre>
          </div>
          <GepaCandidateDiff
            candidates={
              (iteration.candidates as Array<{
                id: string
                decision: string
                program: Record<string, unknown>
                scores: Record<string, unknown>
              }>) ?? []
            }
          />
        </div>
      ) : (
        <p className="muted">Run an iteration to inspect candidates. Pending candidates are previews only.</p>
      )}
    </div>
  )
}
