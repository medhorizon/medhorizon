export function GepaCandidateDiff(props: {
  candidates: Array<{
    id: string
    decision: string
    program: Record<string, unknown>
    scores: Record<string, unknown>
  }>
}) {
  return (
    <div className="stack">
      {props.candidates.map((c) => (
        <div key={c.id} className="panel">
          <div className="row">
            <code>{c.id.slice(0, 8)}</code>
            <span className={`badge ${c.decision}`}>{c.decision}</span>
            <span className="muted">primary={String((c.scores as { primary?: number }).primary ?? "—")}</span>
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
            {String((c.program as { prompt?: string }).prompt ?? JSON.stringify(c.program, null, 2))}
          </pre>
          {c.decision === "pending" ? (
            <p className="muted">Candidate preview only — not applied until gate approval.</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
