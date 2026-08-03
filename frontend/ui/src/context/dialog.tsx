import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  For,
  getOwner,
  onCleanup,
  Show,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
  canClose?: () => boolean
  returnFocus?: HTMLElement
  closed: boolean
}

export interface ShowOptions {
  onClose?: () => void
  /**
   * Lightweight, non-modal presentation: no backdrop overlay and no body
   * scroll lock (so opening the dialog doesn't visibly reflow the page).
   * The dialog content still mounts inside a portal and dismisses on its
   * own controls — it just doesn't dim/lock the page behind it.
   */
  lite?: boolean
  /**
   * `"replace"` (default) disposes the current top dialog when a new one is
   * shown. `"stack"` keeps the parent dialog mounted while a nested dialog
   * opens on top of it; the parent stays until it is explicitly closed.
   */
  mode?: "replace" | "stack"
  /**
   * Consulted only on user-initiated close (Escape, backdrop, header close,
   * and replacement by a new dialog). Return false to veto the close.
   * Programmatic `close()` always works.
   */
  canClose?: () => boolean
  /**
   * Element to restore focus to after this dialog closes, if it was the top
   * dialog when it closed and no newer dialog replaced it. Defaults to the
   * element focused at `show()` time — the trigger the user acted on — so
   * every dialog closes back to where it was opened from, even when the
   * call site does not (or cannot) pass an explicit element.
   */
  returnFocus?: HTMLElement
}

const Context = createContext<ReturnType<typeof init>>()

const LiteContext = createContext<boolean>(false)

/**
 * True when the surrounding dialog was opened in `lite` mode (no backdrop,
 * no scroll lock, no Kobalte focus-trap). Used by `<Dialog>` to render its
 * content as a plain `<div>` instead of `Kobalte.Content`, which would
 * otherwise throw without a Kobalte root.
 */
export function useDialogLite(): boolean {
  return useContext(LiteContext)
}

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  const clearTimer = () => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  }

  onCleanup(clearTimer)

  const top = (): Active | undefined => {
    const s = stack()
    return s[s.length - 1]
  }

  const find = (id: string): Active | undefined => stack().find((entry) => entry.id === id)

  const disposeEntry = (entry: Active) => {
    clearTimer()
    setStack((prev) => prev.filter((other) => other.id !== entry.id))
    entry.dispose()
  }

  const restoreFocus = (entry: Active) => {
    const target = entry.returnFocus
    if (!target || !target.isConnected) return
    target.focus()
  }

  /** The element the user acted on right before `show()` — the natural restore target. */
  const captureFocus = (): HTMLElement | undefined => {
    const el = document.activeElement
    return el instanceof HTMLElement && el !== document.body ? el : undefined
  }

  const close = (id?: string) => {
    const current = id === undefined ? top() : find(id)
    if (!current || current.closed) return
    current.closed = true
    current.onClose?.()
    current.setClosing(true)

    const capturedIndex = stack().indexOf(current)
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = undefined
      disposeEntry(current)
      // Restore focus only when this was still the top dialog at dispose
      // time — a newer dialog shown meanwhile must keep its own focus.
      if (stack().length <= capturedIndex) restoreFocus(current)
    }, 100)
  }

  const requestClose = (id?: string) => {
    const current = id === undefined ? top() : find(id)
    if (!current) return
    if (current.canClose && !current.canClose()) return
    close(current.id)
  }

  createEffect(() => {
    const current = top()
    if (!current) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      requestClose(current.id)
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true))
  })

  const show = (
    element: DialogElement,
    owner: Owner,
    onClose?: () => void,
    options?: { lite?: boolean; mode?: "replace" | "stack"; canClose?: () => boolean; returnFocus?: HTMLElement },
  ): boolean => {
    const fallbackFocus = options?.returnFocus ?? captureFocus()
    const replace = options?.mode !== "stack"
    const old = top()
    if (replace && old) {
      if (old.canClose && !old.canClose()) return false
      clearTimer()
      if (!old.closed) {
        old.closed = true
        old.onClose?.()
      }
      old.dispose()
      setStack((prev) => prev.filter((other) => other.id !== old.id))
    }

    const id = Math.random().toString(36).slice(2)
    const lite = options?.lite === true
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        // Lite mode bypasses Kobalte entirely. Kobalte's modal Dialog mounts
        // a Portal at <body>, adds focus-trap attributes, and (even with
        // modal={false}) momentarily reshuffles body siblings during mount,
        // which read as a page "refresh" the instant the dialog appears.
        // Rendering inside the existing dialog-stack with no portal removes
        // every body-level side effect — the element just appears in place.
        if (lite) {
          return (
            <Show when={!closing()}>
              <LiteContext.Provider value={true}>
                <div
                  data-component="dialog-lite"
                  style={{
                    position: "fixed",
                    inset: "0",
                    "z-index": "50",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "pointer-events": "none",
                  }}
                >
                  <div data-slot="dialog-lite-content" style={{ "pointer-events": "auto" }}>
                    {element()}
                  </div>
                </div>
              </LiteContext.Provider>
            </Show>
          )
        }
        return (
          <Kobalte
            modal
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open) return
              requestClose(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay data-component="dialog-overlay" onClick={() => requestClose(id)} />
              {element()}
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return false

    const entry: Active = {
      id,
      node,
      dispose,
      owner,
      onClose,
      setClosing,
      canClose: options?.canClose,
      returnFocus: fallbackFocus,
      closed: false,
    }
    setStack((prev) => [...prev, entry])
    return true
  }

  return {
    get active() {
      return top()
    },
    stack,
    close,
    requestClose,
    show,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>
          {(entry) => entry.node}
        </For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.active
    },
    /**
     * Show a dialog. Pass a function for `optionsOrOnClose` to use just an
     * onClose callback (legacy two-arg form), or an options object to opt
     * into features like `lite` (no backdrop, no scroll lock), `mode`
     * (`"stack"` keeps the current dialog open), `canClose` (veto
     * user-initiated close) and `returnFocus`.
     *
     * Returns false when the request was vetoed by a busy top dialog.
     */
    show(element: DialogElement, optionsOrOnClose?: (() => void) | ShowOptions): boolean {
      const base = ctx.active?.owner ?? owner
      const opts: ShowOptions =
        typeof optionsOrOnClose === "function" ? { onClose: optionsOrOnClose } : (optionsOrOnClose ?? {})
      return ctx.show(element, base, opts.onClose, {
        lite: opts.lite,
        mode: opts.mode,
        canClose: opts.canClose,
        returnFocus: opts.returnFocus,
      })
    },
    close() {
      ctx.close()
    },
    requestClose() {
      ctx.requestClose()
    },
  }
}
