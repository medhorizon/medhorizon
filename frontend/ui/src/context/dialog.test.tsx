/**
 * Coordinator-level tests for the Dialog context.
 *
 * Renders the real DialogProvider + useDialog through a test-local Solid-DOM
 * JSX bridge. bun 1.3.14 classic-transpiles every .tsx to React.createElement
 * and solid-js's own jsx-runtime export is broken under bun's resolution
 * (./jsx-runtime → dist/solid.js which has no jsx), so the bridge maps
 * React.createElement onto the deep-imported Solid client primitives
 * (solid-js/web/dist/web.js).
 *
 * Scope: under the node condition solid-js resolves to its non-reactive SSR
 * build, where createEffect is a no-op and createMemo computes once. So this
 * suite exercises the coordinator contract only — single-settle onClose,
 * canClose vetoes, replacement-notifies-old, stack mode, returnFocus and the
 * `show()` boolean return. Reactive content mounting, Escape handling and the
 * non-lite Kobalte path are covered by the Playwright e2e suite instead.
 *
 * The mount must pass children as a lazy accessor (not eager JSX): Solid's
 * Context.Provider writes `Owner.context[id]` inside its own memo before
 * resolving children, so a consumer reading the context during JSX
 * construction would run before the provider and throw.
 */
import { describe, expect, test } from "bun:test"
import type { JSX, ParentProps } from "solid-js"
import type * as SolidWeb from "solid-js/web/types/client.d.ts"
// The client deep build (`solid-js/web/dist/web.js`) ships no declarations.
// Its types are mirrored from the published `solid-js/web/types/client` module.
// @ts-expect-error — no .d.ts for the deep client build
import * as client from "solid-js/web/dist/web.js"
import { DialogProvider, useDialog } from "./dialog"

const { render, insert, createComponent } = client as typeof SolidWeb

const React = {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    const p: Record<string, unknown> = { ...(props ?? {}) }
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    if (typeof type === "function") return createComponent(type as (props: Record<string, unknown>) => JSX.Element, p)
    const el = document.createElement(type as string)
    for (const [k, v] of Object.entries(p)) {
      if (k === "children") continue
      if (k === "style" && v && typeof v === "object") Object.assign((el as HTMLElement).style, v)
      else if (v != null) el.setAttribute(k, String(v))
    }
    if ("children" in p) insert<unknown>(el, p.children)
    return el
  },
}

;(globalThis as { React?: unknown }).React = React

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  let handle: ReturnType<typeof useDialog> | undefined
  const dispose = render(
    () =>
      createComponent(DialogProvider, {
        // Solid's JSX transform passes children as a lazy accessor; ParentProps
        // cannot express that shape, so the props object is cast to its call shape.
        children: (() => {
          handle = useDialog()
          return null
        }) as () => JSX.Element,
      } as unknown as ParentProps),
    host,
  )
  return { handle: () => handle!, host, dispose }
}

/** Let the 100ms close timer fire. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

describe("Dialog context coordinator", () => {
  test("mounts the dialog-stack mount and show() returns true", () => {
    const { handle, host, dispose } = mount()
    expect(host.querySelector('[data-component="dialog-stack"]')).toBeTruthy()
    const ok = handle().show(() => <div data-lite-content>hi</div>, { lite: true })
    expect(ok).toBe(true)
    expect(handle().active).toBeTruthy()
    dispose()
  })

  test("close() notifies onClose at most once", async () => {
    const { handle, dispose } = mount()
    let calls = 0
    handle().show(() => <div>x</div>, { lite: true, onClose: () => calls++ })
    handle().close()
    await settle()
    handle().close()
    await settle()
    expect(calls).toBe(1)
    expect(handle().active).toBeFalsy()
    dispose()
  })

  test("programmatic close() ignores a canClose veto", async () => {
    const { handle, dispose } = mount()
    let onClose = 0
    handle().show(() => <div>x</div>, { lite: true, canClose: () => false, onClose: () => onClose++ })
    handle().close()
    await settle()
    expect(onClose).toBe(1)
    expect(handle().active).toBeFalsy()
    dispose()
  })

  test("requestClose() consults canClose", async () => {
    const { handle, dispose } = mount()
    let onClose = 0
    handle().show(() => <div>x</div>, { lite: true, canClose: () => false, onClose: () => onClose++ })
    handle().requestClose()
    await settle()
    expect(onClose).toBe(0)
    expect(handle().active).toBeTruthy()
    dispose()
  })

  test("replacement notifies the old dialog's onClose", async () => {
    const { handle, dispose } = mount()
    let oldCalls = 0
    handle().show(() => <div>a</div>, { lite: true, onClose: () => oldCalls++ })
    const ok = handle().show(() => <div>b</div>, { lite: true })
    await settle()
    expect(ok).toBe(true)
    expect(oldCalls).toBe(1)
    expect(handle().active).toBeTruthy()
    dispose()
  })

  test("replacement is vetoed when the top dialog's canClose returns false", () => {
    const { handle, dispose } = mount()
    handle().show(() => <div>a</div>, { lite: true, canClose: () => false })
    const ok = handle().show(() => <div>b</div>, { lite: true })
    expect(ok).toBe(false)
    dispose()
  })

  test("stack mode keeps the parent mounted", async () => {
    const { handle, dispose } = mount()
    let parentClosed = 0
    handle().show(() => <div>parent</div>, { lite: true, onClose: () => parentClosed++ })
    handle().show(() => <div>child</div>, { lite: true, mode: "stack" })
    expect(parentClosed).toBe(0)
    handle().close()
    await settle()
    expect(parentClosed).toBe(0)
    expect(handle().active).toBeTruthy()
    handle().close()
    await settle()
    expect(parentClosed).toBe(1)
    expect(handle().active).toBeFalsy()
    dispose()
  })

  test("returnFocus is restored after a top dialog closes", async () => {
    const { handle, dispose } = mount()
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    handle().show(() => <div>x</div>, { lite: true, returnFocus: input })
    handle().close()
    await settle()
    expect(document.activeElement).toBe(input)
    input.remove()
    dispose()
  })

  test("replacement never restores the old dialog's returnFocus", async () => {
    const { handle, dispose } = mount()
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    handle().show(() => <div>a</div>, { lite: true, returnFocus: input })
    handle().show(() => <div>b</div>, { lite: true })
    await settle()
    expect(document.activeElement).toBe(input)
    input.remove()
    dispose()
  })
})
