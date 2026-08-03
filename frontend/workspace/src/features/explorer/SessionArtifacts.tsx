import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import { AsyncState, type AsyncStateProps } from "@synsci/ui/async-state"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { FONT_MONO } from "@/styles/tokens"
import { IconRefresh } from "@/atlas/shared/Icon"
import { DateTime } from "luxon"
import type { SessionArtifactItem } from "@synsci/sdk/v2/client"
import { ArtifactPreview } from "./ArtifactPreview"

interface SessionArtifactsProps {
  sessionID: string
}

const PAGE_SIZE = 50

// The SDK throws the parsed error body (the SessionArtifactsError shape here);
// surface its message as the AsyncState detail, falling back to a stable copy.
function errorDetail(err: unknown, fallback: string): string {
  if (typeof err === "string") return err
  const raw = err as { error?: { message?: unknown }; body?: { message?: unknown }; message?: unknown }
  const message = raw.error?.message ?? raw.body?.message ?? raw.message
  return typeof message === "string" && message ? message : fallback
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let val = bytes / 1024
  let u = 0
  while (val >= 1024 && u < units.length - 1) {
    val /= 1024
    u++
  }
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[u]}`
}

function formatCreated(iso: string): string {
  const parsed = DateTime.fromISO(iso)
  if (!parsed.isValid) return "—"
  return parsed.toRelative() ?? parsed.toFormat("MMM d")
}

/**
 * Session artifact list surface. Owns its list/selection/preview resource state
 * independently: list errors, preview errors and download actions never
 * overwrite each other, and an existing list stays visible during refresh and
 * preview. Consumes ONLY the generated SDK — no handwritten transport, no
 * direct fetch; the full payload is read only by an explicit download through
 * the typed relative downloadPath.
 *
 * The shell keep-mounts this module within one sessionID, so the loaded pages,
 * selection and scroll survive switching to Files and back. When sessionID
 * changes the scope is reset (page/selection/preview/scroll cleared) and stale
 * in-flight responses are ignored so a late result can never write back into
 * the new session's state.
 */
export function SessionArtifacts(props: SessionArtifactsProps): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const directory = () => sync.project?.worktree || sync.data.path.directory || sdk.directory

  const [items, setItems] = createSignal<SessionArtifactItem[]>([])
  const [nextCursor, setNextCursor] = createSignal<string | undefined>(undefined)
  const [selectedID, setSelectedID] = createSignal<string | undefined>(undefined)
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [listError, setListError] = createSignal<unknown>(undefined)
  const [loadMoreError, setLoadMoreError] = createSignal<unknown>(undefined)
  let scrollEl: HTMLDivElement | undefined

  // Generation counter. Bumped on every scope reset (session change); a fetch
  // captures the generation it started under and drops its result if the scope
  // moved on, so late responses from the old session never pollute the new one.
  let scopeSeq = 0

  const resetScope = () => {
    scopeSeq += 1
    setItems([])
    setNextCursor(undefined)
    setSelectedID(undefined)
    setListError(undefined)
    setLoadMoreError(undefined)
    setLoading(false)
    setRefreshing(false)
    setLoadingMore(false)
    scrollEl?.scrollTo(0, 0)
  }

  const loadFirstPage = async () => {
    const seq = scopeSeq
    setLoading(true)
    setListError(undefined)
    try {
      const res = await sdk.client.session.artifacts.list({
        sessionID: props.sessionID,
        directory: directory(),
        limit: PAGE_SIZE,
      })
      if (seq !== scopeSeq) return
      setItems(res.data?.items ?? [])
      setNextCursor(res.data?.nextCursor)
    } catch (e) {
      if (seq !== scopeSeq) return
      setListError(e)
    } finally {
      if (seq === scopeSeq) setLoading(false)
    }
  }

  const refresh = async () => {
    if (loading()) return
    const seq = scopeSeq
    setRefreshing(true)
    setListError(undefined)
    try {
      const res = await sdk.client.session.artifacts.list({
        sessionID: props.sessionID,
        directory: directory(),
        limit: PAGE_SIZE,
      })
      if (seq !== scopeSeq) return
      setItems(res.data?.items ?? [])
      setNextCursor(res.data?.nextCursor)
    } catch (e) {
      if (seq !== scopeSeq) return
      setListError(e)
    } finally {
      if (seq === scopeSeq) setRefreshing(false)
    }
  }

  const loadMore = async () => {
    const cursor = nextCursor()
    if (!cursor || loadingMore() || refreshing()) return
    const seq = scopeSeq
    setLoadingMore(true)
    setLoadMoreError(undefined)
    try {
      const res = await sdk.client.session.artifacts.list({
        sessionID: props.sessionID,
        directory: directory(),
        limit: PAGE_SIZE,
        cursor,
      })
      if (seq !== scopeSeq) return
      setItems((prev) => [...prev, ...(res.data?.items ?? [])])
      setNextCursor(res.data?.nextCursor)
    } catch (e) {
      if (seq !== scopeSeq) return
      setLoadMoreError(e)
    } finally {
      if (seq === scopeSeq) setLoadingMore(false)
    }
  }

  // Load the first page when the module mounts and reset everything when the
  // session scope changes (keep-mounted panels survive within one sessionID).
  createEffect(
    on(
      () => props.sessionID,
      () => {
        resetScope()
        void loadFirstPage()
      },
    ),
  )

  const select = (item: SessionArtifactItem) => {
    if (selectedID() === item.id) return
    setSelectedID(item.id)
  }

  const selectedItem = createMemo(() => items().find((item) => item.id === selectedID()))

  const listBody = (): JSX.Element => (
    <div>
      <div style={colHeader()}>
        <span style={{ flex: 1 }}>Summary</span>
        <span style={{ width: "70px", "flex-shrink": 0 }}>Type</span>
        <span style={{ width: "70px", "flex-shrink": 0, "text-align": "right" }}>Size</span>
        <span style={{ width: "92px", "flex-shrink": 0, "text-align": "right" }}>Created</span>
      </div>
      <For each={items()}>
        {(item) => (
          <button
            type="button"
            data-artifact-id={item.id}
            data-component="artifact-row"
            aria-selected={selectedID() === item.id}
            onClick={() => select(item)}
            title={item.summary}
            style={rowStyle(selectedID() === item.id)}
            onMouseEnter={(el) => (el.currentTarget.style.background = "var(--color-accent-subtle)")}
            onMouseLeave={(el) =>
              (el.currentTarget.style.background = selectedID() === item.id ? "var(--color-bg-elevated)" : "transparent")
            }
          >
            <span
              style={{
                flex: 1,
                "min-width": 0,
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              {item.summary}
            </span>
            <span style={{ width: "70px", "flex-shrink": 0, color: "var(--color-text-faint)" }}>{item.type}</span>
            <span
              style={{
                width: "70px",
                "flex-shrink": 0,
                "text-align": "right",
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {formatSize(item.size)}
            </span>
            <span
              style={{
                width: "92px",
                "flex-shrink": 0,
                "text-align": "right",
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {formatCreated(item.createdAt)}
            </span>
          </button>
        )}
      </For>
      <Show when={nextCursor()}>
        <div style={{ padding: "8px 16px 14px" }}>
          <Show
            when={!loadMoreError()}
            fallback={
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-error)",
                }}
              >
                <span style={{ flex: 1 }}>{errorDetail(loadMoreError(), "couldn't load more")}</span>
                <button type="button" aria-label="retry load more" onClick={() => void loadMore()} style={footBtn()}>
                  retry
                </button>
              </div>
            }
          >
            <button type="button" aria-label="load more artifacts" onClick={() => void loadMore()} style={footBtn()}>
              {loadingMore() ? "loading more…" : "load more"}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )

  // Map the list resource onto the kit AsyncState union. List error outranks
  // everything; stale content (the last good items) becomes refreshing/error
  // children so a background refresh never blanks to a loading flash.
  const asyncState = createMemo<AsyncStateProps>(() => {
    const err = listError()
    const latest = items()
    if (err) {
      return {
        state: "error",
        label: "Session Artifacts",
        title: "can't load session artifacts",
        detail: errorDetail(err, "couldn't list session artifacts"),
        retryLabel: "retry",
        retry: () => void refresh(),
        children: latest.length ? listBody() : undefined,
      }
    }
    if (loading() && latest.length === 0) {
      return { state: "loading", label: "Session Artifacts", message: "loading artifacts…" }
    }
    if (refreshing()) {
      return { state: "refreshing", label: "Session Artifacts", message: "updating…", children: listBody() }
    }
    if (latest.length === 0) {
      return { state: "empty", label: "Session Artifacts", message: "no artifacts in this session" }
    }
    return { state: "ready", label: "Session Artifacts", loadedMessage: "artifacts loaded", children: listBody() }
  })

  return (
    <div
      style={{
        flex: 1,
        "min-height": 0,
        "min-width": 0,
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
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
        <span style={{ flex: 1, "font-family": FONT_MONO, "font-size": "11px", color: "var(--color-text-muted)" }}>
          {items().length} artifact{items().length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          aria-label="refresh artifacts"
          title="refresh"
          onClick={() => void refresh()}
          disabled={loading() || refreshing()}
          style={iconBtn(loading() || refreshing())}
        >
          <IconRefresh size={12} strokeWidth={1.6} />
        </button>
      </div>

      <div
        ref={(el) => {
          scrollEl = el
        }}
        class="atlas-scroll"
        style={{ flex: 1, "min-height": 0, "overflow-y": "auto", "overflow-x": "hidden" }}
      >
        <AsyncState {...asyncState()} />
      </div>

      <Show when={selectedItem()}>
        {(sel) => (
          <ArtifactPreview sessionID={props.sessionID} artifact={sel()} onClose={() => setSelectedID(undefined)} />
        )}
      </Show>
    </div>
  )
}

function colHeader(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "center",
    gap: "10px",
    padding: "6px 16px",
    "font-family": FONT_MONO,
    "font-size": "10px",
    "letter-spacing": "0.08em",
    "text-transform": "uppercase",
    color: "var(--color-text-faint)",
    "border-bottom": "1px solid var(--color-border)",
    position: "sticky",
    top: 0,
    background: "var(--color-bg-subtle)",
    "z-index": 1,
  } as JSX.CSSProperties
}

function rowStyle(selected: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "align-items": "center",
    gap: "10px",
    width: "100%",
    padding: "7px 16px",
    "font-family": FONT_MONO,
    "font-size": "12px",
    color: "var(--color-text-muted)",
    background: selected ? "var(--color-bg-elevated)" : "transparent",
    "box-shadow": selected ? "inset 2px 0 0 var(--color-text-faint)" : "none",
    "border-bottom": "1px solid var(--color-border)",
  } as JSX.CSSProperties
}

function iconBtn(disabled: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "26px",
    height: "26px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    color: "var(--color-text-muted)",
    opacity: disabled ? 0.4 : 1,
    "flex-shrink": 0,
  } as JSX.CSSProperties
}

function footBtn(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    padding: "5px 12px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    "font-family": FONT_MONO,
    "font-size": "11px",
    color: "var(--color-text-muted)",
  } as JSX.CSSProperties
}
