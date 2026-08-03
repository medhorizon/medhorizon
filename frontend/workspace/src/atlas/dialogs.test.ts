/**
 * Coordinator/mapping tests for the Promise dialog helpers in `./dialogs`.
 *
 * Scope: the helpers' show() contract and single-settle lifecycle. Under bun's
 * classic .tsx transpile plus the node-condition server build of solid-js,
 * rendering the helpers' element factory would mount real Kobalte components
 * whose createEffect is a no-op, so this suite never invokes the factory. It
 * drives a hand-built controlled handle (the exact `{ show, close, active }`
 * surface the helpers receive) instead.
 *
 * Covered here: mode/canClose/onClose/returnFocus mapping, the onClose-only
 * settle path (which must NOT call dialog.close), the show()-false settle path
 * (also without dialog.close), and the per-helper cancel values. The
 * submit/busy/validate state machine, real focus and backdrop behaviour require
 * a live browser and are covered by the Playwright e2e suite instead.
 */
import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import type { useDialog, ShowOptions } from "@synsci/ui/context/dialog"
import { alertDialog, confirmDialog, promptDialog } from "./dialogs"

type DialogHandle = ReturnType<typeof useDialog>
type ShowCall = { element: () => JSX.Element; options: ShowOptions }

class Harness {
  showCalls: ShowCall[] = []
  closeCalls = 0
  allowShow = true

  get active(): DialogHandle["active"] {
    return undefined
  }

  show(element: () => JSX.Element, optionsOrOnClose?: (() => void) | ShowOptions): boolean {
    const options = typeof optionsOrOnClose === "function" ? { onClose: optionsOrOnClose } : (optionsOrOnClose ?? {})
    this.showCalls.push({ element, options })
    return this.allowShow
  }

  close(): void {
    this.closeCalls += 1
  }

  requestClose(): void {
    this.closeCalls += 1
  }
}

describe("dialog helpers (coordinator + mapping)", () => {
  test("confirmDialog shows a stack dialog with canClose, onClose and returnFocus", () => {
    const h = new Harness()
    const trigger = document.createElement("button")
    confirmDialog(h, { title: "Delete?", danger: true, returnFocus: trigger })

    const call = h.showCalls[0]
    expect(call).toBeDefined()
    expect(call.options.mode).toBe("stack")
    expect(typeof call.options.canClose).toBe("function")
    expect(typeof call.options.onClose).toBe("function")
    expect(call.options.returnFocus).toBe(trigger)
    expect(h.closeCalls).toBe(0)
  })

  test("promptDialog forwards returnFocus and stacks", () => {
    const h = new Harness()
    const input = document.createElement("input")
    promptDialog(h, { title: "Name?", returnFocus: input })

    const call = h.showCalls[0]
    expect(call.options.mode).toBe("stack")
    expect(call.options.returnFocus).toBe(input)
    expect(typeof call.options.canClose).toBe("function")
    expect(typeof call.options.onClose).toBe("function")
  })

  test("alertDialog shows a closable stack dialog", () => {
    const h = new Harness()
    alertDialog(h, { title: "Done" })

    const call = h.showCalls[0]
    expect(call.options.mode).toBe("stack")
    expect(typeof call.options.onClose).toBe("function")
  })

  test("onClose settles confirmDialog with false without calling close", async () => {
    const h = new Harness()
    const promise = confirmDialog(h, { title: "Delete?" })
    h.showCalls[0].options.onClose?.()

    await expect(promise).resolves.toBe(false)
    expect(h.closeCalls).toBe(0)
  })

  test("onClose settles promptDialog with null", async () => {
    const h = new Harness()
    const promise = promptDialog(h, { title: "Name?" })
    h.showCalls[0].options.onClose?.()

    await expect(promise).resolves.toBeNull()
    expect(h.closeCalls).toBe(0)
  })

  test("onClose settles alertDialog with undefined", async () => {
    const h = new Harness()
    const promise = alertDialog(h, { title: "Note" })
    h.showCalls[0].options.onClose?.()

    await expect(promise).resolves.toBeUndefined()
    expect(h.closeCalls).toBe(0)
  })

  test("repeated onClose never closes the dialog and keeps the cancel value", async () => {
    const h = new Harness()
    const promise = confirmDialog(h, { title: "X" })
    const onClose = h.showCalls[0].options.onClose
    if (onClose) {
      onClose()
      onClose()
    }

    await expect(promise).resolves.toBe(false)
    expect(h.closeCalls).toBe(0)
  })

  test("a vetoed show settles confirmDialog with false without calling close", async () => {
    const h = new Harness()
    h.allowShow = false
    const promise = confirmDialog(h, { title: "X" })

    await expect(promise).resolves.toBe(false)
    expect(h.closeCalls).toBe(0)
  })

  test("a vetoed prompt show settles with null", async () => {
    const h = new Harness()
    h.allowShow = false
    const promise = promptDialog(h, { title: "X" })

    await expect(promise).resolves.toBeNull()
    expect(h.closeCalls).toBe(0)
  })

  test("a vetoed alert show settles with undefined", async () => {
    const h = new Harness()
    h.allowShow = false
    const promise = alertDialog(h, { title: "X" })

    await expect(promise).resolves.toBeUndefined()
    expect(h.closeCalls).toBe(0)
  })

  test("canClose starts permissive because the dialog is not busy", () => {
    const h = new Harness()
    confirmDialog(h, { title: "X" })

    expect(h.showCalls[0].options.canClose?.()).toBe(true)
  })
})
