import type { Node } from "../lib/api"

export function NodePanel(props: {
  node: Node | null
  experimentId?: string | null
  onSave: (patch: { title: string; content: string; lifecycle: string }) => void
  onImportMarkdown?: (markdown: string) => void
  onExportMarkdown?: () => void
}) {
  if (!props.node) {
    return <div className="panel muted">Select a node to edit details.</div>
  }
  return (
    <div className="panel stack">
      <div className="row">
        <strong>{props.node.kind}</strong>
        <span className={`badge ${props.node.lifecycle}`}>{props.node.lifecycle}</span>
        {props.experimentId ? <a href={`/experiments/${props.experimentId}`}>Open experiment</a> : null}
      </div>
      <label className="stack">
        Title
        <input key={props.node.id + "-title"} defaultValue={props.node.title} id="node-title" />
      </label>
      <label className="stack">
        Content
        <textarea key={props.node.id + "-content"} defaultValue={props.node.content ?? ""} id="node-content" rows={6} />
      </label>
      <label className="stack">
        Lifecycle
        <select id="node-lifecycle" defaultValue={props.node.lifecycle} key={props.node.id + "-life"}>
          <option value="staged">staged</option>
          <option value="committed">committed</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <div className="row">
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
        <button type="button" className="ghost" onClick={() => props.onExportMarkdown?.()}>
          Export MD
        </button>
      </div>
      {props.onImportMarkdown ? (
        <label className="stack">
          Import Markdown
          <textarea id="import-md" rows={4} placeholder={"---\nkind: hypothesis\ntitle: H1\n---\nBody"} />
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const md = (document.getElementById("import-md") as HTMLTextAreaElement).value
              props.onImportMarkdown?.(md)
            }}
          >
            Import as node
          </button>
        </label>
      ) : null}
    </div>
  )
}
