import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from "solid-js"
import { FONT_MONO } from "@/styles/tokens"
import type { ExplorerModule, ExplorerScope } from "./contract"

export interface ExplorerShellProps {
  /** Module list injected by the host; the shell renders only these. */
  modules: ExplorerModule[]
  /** id of the initially selected module (e.g. "files"). */
  defaultModule: string
  /** Scope handed to every mounted module component. */
  scope: ExplorerScope
}

/**
 * Atlas-independent Explorer core shell. It owns ONLY:
 *   - the module tablist (ARIA tablist/tab/tabpanel + arrow-key navigation),
 *   - the selected module id,
 *   - keep-mounted: once a module is visited it stays mounted within the same
 *     sessionID, so its local state (cwd, history, filter, view, scroll)
 *     survives switching to another module.
 * It does not create resources, interpret items, or know any module
 * implementation. The module list and default module are injected by the host.
 *
 * When the host injects a single module the shell degrades to a plain
 * full-height surface (the original Files look) — the module is the default
 * and therefore already mounted.
 */
export function ExplorerShell(props: ExplorerShellProps): JSX.Element {
  const uid = createUniqueId()
  const [selected, setSelected] = createSignal(props.defaultModule)
  const [visited, setVisited] = createSignal<ReadonlySet<string>>(new Set([props.defaultModule]))

  const activeId = createMemo(() => {
    if (props.modules.some((m) => m.id === selected())) return selected()
    return props.modules[0]?.id ?? ""
  })

  const select = (id: string) => {
    if (!props.modules.some((m) => m.id === id)) return
    setSelected(id)
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  const onTablistKeyDown = (e: KeyboardEvent) => {
    const ids = props.modules.map((m) => m.id)
    if (ids.length < 2) return
    const idx = ids.indexOf(activeId())
    let next = -1
    if (e.key === "ArrowLeft") next = idx < 0 ? 0 : (idx - 1 + ids.length) % ids.length
    else if (e.key === "ArrowRight") next = idx < 0 ? 0 : (idx + 1) % ids.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = ids.length - 1
    else return
    e.preventDefault()
    select(ids[next])
    document.getElementById(`${uid}-tab-${ids[next]}`)?.focus()
  }

  const single = props.modules.length <= 1 ? props.modules[0] : undefined
  if (single) {
    const Single = single.component
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
        <Single sessionID={props.scope.sessionID} />
      </div>
    )
  }

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
        role="tablist"
        aria-label="Explorer modules"
        onKeyDown={onTablistKeyDown}
        style={{
          display: "flex",
          "align-items": "stretch",
          gap: "4px",
          padding: "6px 8px",
          "border-bottom": "1px solid var(--color-border)",
          background: "var(--color-bg-subtle)",
          "overflow-x": "auto",
          "flex-shrink": 0,
        }}
      >
        <For each={props.modules}>
          {(m) => {
            const active = () => m.id === activeId()
            return (
              <button
                type="button"
                role="tab"
                id={`${uid}-tab-${m.id}`}
                aria-selected={active()}
                aria-controls={`${uid}-panel-${m.id}`}
                tabIndex={active() ? 0 : -1}
                onClick={() => select(m.id)}
                onFocus={() => select(m.id)}
                style={tabButton(active())}
              >
                {m.label}
              </button>
            )
          }}
        </For>
      </div>

      <div style={{ flex: 1, "min-height": 0, position: "relative", display: "flex" }}>
        <For each={props.modules}>
          {(m) => {
            const Comp = m.component
            return (
              <Show when={visited().has(m.id)}>
                <div
                  role="tabpanel"
                  id={`${uid}-panel-${m.id}`}
                  aria-labelledby={`${uid}-tab-${m.id}`}
                  style={{
                    flex: 1,
                    "min-height": 0,
                    "min-width": 0,
                    display: m.id === activeId() ? "flex" : "none",
                    "flex-direction": "column",
                    overflow: "hidden",
                  }}
                >
                  <Comp sessionID={props.scope.sessionID} />
                </div>
              </Show>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function tabButton(active: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    gap: "6px",
    padding: "5px 10px",
    "border-radius": "4px",
    border: active ? "1px solid var(--color-border-strong)" : "1px solid transparent",
    background: active ? "var(--color-surface-solid)" : "transparent",
    "box-shadow": active ? "0 1px 2px rgba(0,0,0,0.10)" : "none",
    "font-family": FONT_MONO,
    "font-size": "11px",
    "font-weight": active ? 700 : 400,
    color: active ? "var(--color-text)" : "var(--color-text-muted)",
    transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
    "white-space": "nowrap",
    "flex-shrink": 0,
  } as JSX.CSSProperties
}
