export function ProvenancePanel(props: {
  events: Array<{ event_type: string; actor: string; created_at: string; payload?: Record<string, unknown> }>
}) {
  if (!props.events.length) return <p className="muted">No provenance events.</p>
  return (
    <div className="stack">
      {props.events.map((e, i) => (
        <div key={i} className="panel">
          <div className="row">
            <strong>{e.event_type}</strong>
            <span className="muted">{e.actor}</span>
            <span className="muted">{e.created_at}</span>
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
            {JSON.stringify(e.payload ?? {}, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  )
}
