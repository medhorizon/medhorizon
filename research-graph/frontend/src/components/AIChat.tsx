import { useState } from "react"

export function AIChat(props: { graphId: string }) {
  const [message, setMessage] = useState("")
  const [log, setLog] = useState<Array<{ role: string; content: string; meta?: string }>>([])
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="panel stack">
      <h2>AI Chat</h2>
      {error ? <div className="error">{error}</div> : null}
      <div className="stack">
        {log.map((m, i) => (
          <div key={i}>
            <strong>{m.role}</strong>
            {m.meta ? <span className="muted"> · {m.meta}</span> : null}
            <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>{m.content}</pre>
          </div>
        ))}
      </div>
      <div className="row">
        <input
          style={{ flex: 1 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask about this graph"
        />
        <button
          type="button"
          onClick={async () => {
            setError(null)
            setLog((prev) => [...prev, { role: "user", content: message }])
            const res = await fetch("/api/ai/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ graph_id: props.graphId, message }),
            })
            const body = await res.json()
            if (!res.ok) {
              setError(JSON.stringify(body.detail ?? body))
              return
            }
            setLog((prev) => [
              ...prev,
              {
                role: "assistant",
                content: body.content,
                meta: `${body.model} · ${body.at} · sources=${(body.sources || []).join(",")}`,
              },
            ])
            setMessage("")
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
