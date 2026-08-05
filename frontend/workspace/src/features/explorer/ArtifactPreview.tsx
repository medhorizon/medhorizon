import { createMemo, createResource, createSignal, Show, type JSX } from "solid-js"
import { AsyncState, type AsyncStateProps } from "@synsci/ui/async-state"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { resolveServerRoute } from "@/config/server-url"
import { FONT_MONO } from "@/styles/tokens"
import { IconDownload, IconX } from "@/atlas/shared/Icon"
import type { SessionArtifactItem, SessionArtifactPreview } from "@synsci/sdk/v2/client"

interface ArtifactPreviewProps {
  sessionID: string
  artifact: SessionArtifactItem
  onClose: () => void
}

// The SDK throws the parsed error body (the SessionArtifactsError shape here);
// surface its message as the AsyncState detail, falling back to a stable copy.
function errorDetail(err: unknown, fallback: string): string {
  if (typeof err === "string") return err
  const raw = err as { error?: { message?: unknown }; body?: { message?: unknown }; message?: unknown }
  const message = raw.error?.message ?? raw.body?.message ?? raw.message
  return typeof message === "string" && message ? message : fallback
}

/**
 * Bounded preview + explicit download for one selected session artifact.
 * Selection reads ONLY the server-bounded preview slice (never the full
 * payload) into the DOM; the full payload is read only by an explicit download
 * that navigates the browser through the typed relative downloadPath. Preview
 * errors are contained here and never overwrite the list or a prior preview.
 */
export function ArtifactPreview(props: ArtifactPreviewProps): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const directory = () => sync.project?.worktree || sync.data.path.directory || sdk.directory

  const [refreshKey, setRefreshKey] = createSignal(0)

  // Re-fetch when the selection (artifact id) or session changes; the resource
  // caches per key, so re-selecting the same row does not re-request.
  const [preview] = createResource(
    () => [props.sessionID, props.artifact.id, refreshKey()] as const,
    async ([sessionID, artifactID]) => {
      const res = await sdk.client.session.artifact.preview({ sessionID, artifactID, directory: directory() })
      if (res.data === undefined) throw new Error("unexpected response while previewing artifact")
      return res.data as SessionArtifactPreview
    },
  )

  const asyncState = createMemo<AsyncStateProps>(() => {
    if (preview.error) {
      return {
        state: "error",
        label: "Artifact preview",
        title: "preview unavailable",
        detail: errorDetail(preview.error, "couldn't preview this artifact"),
        retryLabel: "retry",
        retry: () => setRefreshKey((k) => k + 1),
      }
    }
    const data = preview()
    if (!data) {
      return { state: "loading", label: "Artifact preview", message: "loading preview…" }
    }
    return {
      state: "ready",
      label: "Artifact preview",
      loadedMessage: "preview loaded",
      children: (
        <pre
          data-slot="artifact-preview-content"
          style={{
            margin: 0,
            "font-family": FONT_MONO,
            "font-size": "11.5px",
            "line-height": 1.55,
            color: "var(--color-text)",
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere",
          }}
        >
          {data.content}
        </pre>
      ),
    }
  })

  // Explicit download: navigate the browser through the server-typed relative
  // downloadPath (resolved against the API origin when the UI is hosted
  // separately, kept relative in same-origin bundled builds). Never fetches the
  // payload into the page — a download failure cannot touch list/preview state.
  const download = () => {
    const href = resolveServerRoute(props.artifact.downloadPath, sdk.url, window.location.origin)
    const a = document.createElement("a")
    a.href = href
    a.rel = "noopener"
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div
      data-component="artifact-preview"
      style={{
        "flex-shrink": 0,
        "min-height": "0",
        display: "flex",
        "flex-direction": "column",
        "border-top": "1px solid var(--color-border)",
        background: "var(--color-bg-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--color-border)",
          "flex-shrink": 0,
        }}
      >
        <span
          style={{
            flex: 1,
            "min-width": 0,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "font-family": FONT_MONO,
            "font-size": "11px",
            color: "var(--color-text)",
          }}
        >
          {props.artifact.summary}
        </span>
        {/* preview() re-throws when the resource errored (e.g. the artifact is
            gone after a session switch); guard so a 404 never crashes the app. */}
        <Show when={!preview.error && preview()?.truncated}>
          <span style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)" }}>
            truncated
          </span>
        </Show>
        <button type="button" aria-label="download artifact" title="download artifact" onClick={download} style={iconBtn()}>
          <IconDownload size={13} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label="close preview" title="close preview" onClick={props.onClose} style={iconBtn()}>
          <IconX size={13} strokeWidth={1.6} />
        </button>
      </div>
      <div class="atlas-scroll" style={{ flex: 1, "min-height": 0, overflow: "auto", padding: "10px 14px" }}>
        <AsyncState {...asyncState()} />
      </div>
    </div>
  )
}

function iconBtn(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "26px",
    height: "26px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    color: "var(--color-text-muted)",
    "flex-shrink": 0,
  } as JSX.CSSProperties
}
