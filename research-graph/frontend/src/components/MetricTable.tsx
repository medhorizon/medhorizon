export function MetricTable(props: {
  metrics: Array<{ name: string; value: number; split?: string; evaluator?: string }>
}) {
  if (!props.metrics.length) return <p className="muted">No metrics yet.</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>Split</th>
          <th>Evaluator</th>
        </tr>
      </thead>
      <tbody>
        {props.metrics.map((m, i) => (
          <tr key={`${m.name}-${i}`}>
            <td>{m.name}</td>
            <td>{m.value}</td>
            <td>{m.split ?? "—"}</td>
            <td>{m.evaluator ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
