import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { MetricTable } from "../components/MetricTable"
import { api, type Experiment } from "../lib/api"

export function ExperimentView() {
  const params = useParams()
  const id = params.id!
  const [exp, setExp] = useState<Experiment | null>(null)
  const [run, setRun] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gepaId, setGepaId] = useState<string | null>(null)

  useEffect(() => {
    void api
      .getExperiment(id)
      .then(setExp)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [id])

  if (!exp) return <div>{error ? <div className="error">{error}</div> : "Loading…"}</div>

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{exp.title}</h1>
        <span className={`badge ${exp.status}`}>{exp.status}</span>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel stack">
        <pre style={{ margin: 0 }}>{JSON.stringify(exp.objective, null, 2)}</pre>
        <div className="row">
          <button
            type="button"
            disabled={exp.status !== "draft"}
            onClick={async () => setExp(await api.approveExperiment(exp.id))}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={exp.status !== "approved"}
            onClick={async () => {
              const result = await api.startRun(exp.id, true)
              setRun(result)
              setExp(await api.getExperiment(exp.id))
            }}
          >
            Dry-run
          </button>
          <button
            type="button"
            onClick={async () => {
              if (exp.status === "draft") {
                setError("Approve the experiment before starting GEPA.")
                return
              }
              const gepa = await api.startGepa({
                experiment_id: exp.id,
                objective: exp.objective,
                budget: { max_iterations: 3, max_candidates: 3, patience: 2 },
                seed: 42,
                reason: "ui",
              })
              setGepaId(String(gepa.id))
            }}
          >
            Start GEPA
          </button>
          {gepaId ? <Link to={`/gepa/${gepaId}`}>Open GEPA run</Link> : null}
        </div>
      </div>
      {run ? (
        <div className="panel stack">
          <h2>Run</h2>
          <p>
            <span className={`badge ${String(run.status)}`}>{String(run.status)}</span> hash=
            {String(run.input_hash).slice(0, 12)}
          </p>
          <MetricTable metrics={(run.metrics as Array<{ name: string; value: number }>) ?? []} />
          <pre style={{ margin: 0, fontSize: "0.8rem" }}>{JSON.stringify(run.provenance ?? {}, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  )
}
