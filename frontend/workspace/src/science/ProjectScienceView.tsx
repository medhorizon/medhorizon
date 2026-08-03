import { For, Show, createMemo, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { ScienceFileInspect } from "@synsci/sdk/v2/client"
import {
  clipText,
  formatBytes,
  hasPreviewContent,
  inspectTruncated,
  mapInspectToUi,
  previewOf,
} from "./files"
import { selectProjectRenderer } from "./project-registry"

/**
 * Project-file science view.
 *
 * A thin wrapper that turns a generated inspect result + bounded project
 * content into the right UI: a registered project renderer, a bounded text
 * preview, a metadata-only card, or a streamed-media affordance.
 *
 * Ownership boundary: this wrapper consumes *project-file* data only. It keeps
 * project-file identity/transport separate from tool/session artifacts — it
 * builds renderer payloads from bounded file content and never constructs an
 * artifact ref or Research Graph node.
 *
 * Safety: input is validated and CLIPPED to the frozen budgets before any
 * renderer is mounted. Invalid/empty input never reaches a renderer, so the
 * Sequence/MSA/GenomeTrack sample content can never appear for a project file;
 * such input falls through to a real empty/text/metadata view.
 */

export interface ProjectScienceViewProps {
  /** Generated backend inspect result (sole classification source). */
  inspect: ScienceFileInspect
  /** Bounded project content. Defaults to the inspect's own bounded preview. */
  content?: string
  /** Same-origin raw/stream URL for download/native media consumption. */
  downloadUrl?: string
  /** Optional display height hint in px. */
  height?: number
}

export function ProjectScienceView(props: ProjectScienceViewProps): JSX.Element {
  const inspect = createMemo(() => props.inspect)
  const ui = createMemo(() => mapInspectToUi(inspect()))
  const boundedContent = createMemo(() => props.content ?? previewOf(inspect()))
  const selection = createMemo(() =>
    ui().mode === "render" ? selectProjectRenderer(inspect(), boundedContent()) : undefined,
  )

  return (
    <div
      data-component="project-science-view"
      data-capability={inspect().capability}
      data-policy={inspect().readPolicy}
      data-mode={ui().mode}
      style={{ display: "flex", "flex-direction": "column", gap: "8px" }}
    >
      <Show when={ui().mode === "render" && selection()}>
        {(sel) => (
          <div data-slot="project-science-render">
            <Show when={sel().clipped || inspectTruncated(inspect())}>
              <div data-slot="project-science-truncated">Bounded preview — content clipped to fit the render budget.</div>
            </Show>
            <Dynamic component={sel().component} kind={sel().kind} data={sel().payload} height={props.height} />
          </div>
        )}
      </Show>

      <Show when={(ui().mode === "render" && !selection()) || ui().mode === "text"}>
        <ProjectText inspect={inspect()} content={boundedContent()} downloadUrl={props.downloadUrl} />
      </Show>

      <Show when={ui().mode === "metadata"}>
        <ProjectMetadata inspect={inspect()} downloadUrl={props.downloadUrl} />
      </Show>

      <Show when={ui().mode === "stream"}>
        <ProjectStream inspect={inspect()} downloadUrl={props.downloadUrl} />
      </Show>
    </div>
  )
}

function ProjectHeader(props: { inspect: ScienceFileInspect }): JSX.Element {
  return (
    <div data-slot="project-science-header" style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "align-items": "baseline" }}>
      <span data-slot="project-science-name" style={{ "font-weight": "600" }}>
        {props.inspect.name}
      </span>
      <span data-slot="project-science-format" style={{ color: "#8a8a8a", "font-size": "12px" }}>
        {props.inspect.format}
      </span>
      <span data-slot="project-science-size" style={{ color: "#8a8a8a", "font-size": "12px" }}>
        {formatBytes(props.inspect.size)}
      </span>
      <Show when={props.inspect.warnings.length > 0}>
        <ul data-slot="project-science-warnings" style={{ margin: "0", "padding-left": "16px", "font-size": "12px", color: "#a8760a" }}>
          <For each={props.inspect.warnings}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>
    </div>
  )
}

function ProjectDownload(props: { inspect: ScienceFileInspect; downloadUrl?: string }): JSX.Element {
  return (
    <Show when={props.downloadUrl}>
      <a data-slot="project-science-download" href={props.downloadUrl} download={props.inspect.name}>
        Download
      </a>
    </Show>
  )
}

function ProjectText(props: {
  inspect: ScienceFileInspect
  content: string
  downloadUrl?: string
}): JSX.Element {
  const hasContent = () => hasPreviewContent(props.inspect) || props.content.trim().length > 0
  const shown = createMemo(() => clipText(props.content))
  const truncated = createMemo(() => inspectTruncated(props.inspect) || shown().length < props.content.length)
  return (
    <div data-slot="project-science-text" data-component="project-science-text" style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <ProjectHeader inspect={props.inspect} />
      <Show when={truncated()}>
        <div data-slot="project-science-truncated">Bounded preview — content clipped to fit the retained-chars budget.</div>
      </Show>
      <Show when={hasContent()}>
        <pre data-slot="project-science-text-body" style={{ margin: "0", "max-height": "420px", overflow: "auto", "white-space": "pre-wrap", "word-break": "break-word", "font-size": "12px", background: "rgba(128,128,128,0.06)", padding: "8px 10px", "border-radius": "4px" }}>
          {shown()}
        </pre>
      </Show>
      <Show when={!hasContent()}>
        <div data-slot="project-science-text-empty">No content to display.</div>
      </Show>
      <ProjectDownload inspect={props.inspect} downloadUrl={props.downloadUrl} />
    </div>
  )
}

function ProjectMetadata(props: { inspect: ScienceFileInspect; downloadUrl?: string }): JSX.Element {
  const rows = createMemo(
    () =>
      [
        ["Family", props.inspect.family],
        ["Format", props.inspect.format],
        ["Capability", props.inspect.capability],
        ["Size", formatBytes(props.inspect.size)],
        ["Evidence", props.inspect.evidence],
      ] as const,
  )
  return (
    <div data-slot="project-science-metadata" data-component="project-science-metadata" style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <ProjectHeader inspect={props.inspect} />
      <dl data-slot="project-science-meta" style={{ margin: "0", display: "grid", "grid-template-columns": "max-content 1fr", gap: "2px 12px", "font-size": "12px" }}>
        <For each={rows()}>
          {(row) => (
            <div data-slot="project-science-meta-row" style={{ display: "contents" }}>
              <dt style={{ color: "#8a8a8a" }}>{row[0]}</dt>
              <dd style={{ margin: "0" }}>{row[1]}</dd>
            </div>
          )}
        </For>
      </dl>
      <ProjectDownload inspect={props.inspect} downloadUrl={props.downloadUrl} />
    </div>
  )
}

function ProjectStream(props: { inspect: ScienceFileInspect; downloadUrl?: string }): JSX.Element {
  return (
    <div data-slot="project-science-stream" data-component="project-science-stream" style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <ProjectHeader inspect={props.inspect} />
      <Show when={props.downloadUrl} fallback={<div data-slot="project-science-stream-hint">Streamed media — open or download via the file action menu.</div>}>
        <a data-slot="project-science-open" href={props.downloadUrl} download={props.inspect.name}>
          Open / download
        </a>
      </Show>
    </div>
  )
}

export default ProjectScienceView
