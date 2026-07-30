import type { Node } from "../lib/api"

export function NodePanel(props: { node: Node | null; onSave: (patch: { title: string; content: string; lifecycle: string }) => void }) {
  if (!props.node) {
    return <div className="panel muted">Select a node to edit details.</div>
  }
  return (
    <div className="panel stack">
      <div className="row">
        <strong>{props.node.kind}</strong>
        <span className={`badge ${props.node.lifecycle}`}>{props.node.lifecycle}</span>
      </div>
      <label className="stack">
        Title
        <input
          key={props.node.id + "-title"}
          defaultValue={props.node.title}
          id="node-title"
        />
      </label>
      <label className="stack">
        Content
        <textarea
          key={props.node.id + "-content"}
          defaultValue={props.node.content ?? ""}
          id="node-content"
          rows={6}
        />
      </label>
      <label className="stack">
        Lifecycle
        <select id="node-lifecycle" defaultValue={props.node.lifecycle} key={props.node.id + "-life"}>
          <option value="staged">staged</option>
          <option value="committed">committed</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          const title = (document.getElementById("node-title") as HTMLInputElement).value
          const content = (document.getElementById("node-content") as HTMLTextAreaElement).value
          const lifecycle = (document.getElementById("node-lifecycle") as HTMLSelectElement).value
          props.onSave({ title, content, lifecycle })
        }}
      >
        Save node
      </button>
    </div>
  )
}
