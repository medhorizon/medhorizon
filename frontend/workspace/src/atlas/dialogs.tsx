import { lazy, Show, createSignal, type JSX } from "solid-js"
import { useDialog } from "@synsci/ui/context/dialog"
import { Button } from "@synsci/ui/button"
import { Dialog } from "@synsci/ui/dialog"
import { Spinner } from "@synsci/ui/spinner"

// Deferred to first render. The kit TextField statically imports the Tooltip,
// whose kobalte popper chunk runs template() at module scope — that throws
// under solid's server build (used by `bun test`), so a static import here
// would break the workspace unit suite. lazy() keeps it out of the static
// graph; the browser build loads it on demand and then uses the kit's own
// focus trap, validation and error state.
const TextField = lazy(() => import("@synsci/ui/text-field").then((m) => ({ default: m.TextField })))

type DialogHandle = ReturnType<typeof useDialog>

/**
 * Promise-based replacements for the browser's native blocking dialogs
 * that render inside the app's dialog portal so they match the atlas UI and
 * don't reflow or steal focus the way native dialogs do.
 *
 * All three helpers settle exactly once. A single `done` closure owns the
 * resolve; every close source (button, Escape, backdrop, header close,
 * replacement) funnels into it. They mount as `mode: "stack"` dialogs so the
 * current dialog (e.g. the Settings panel) stays mounted underneath, and they
 * use the real `@synsci/ui` Dialog/Button/TextField (non-lite, Kobalte-backed)
 * so focus trap, disabled state and validation come from the kit.
 */

export type ConfirmDialogOptions = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busyLabel?: string
  /** Runs before the dialog closes; the dialog stays open on rejection. */
  submit?: () => Promise<void>
  /** Element to restore focus to after the dialog closes. */
  returnFocus?: HTMLElement
}

export type PromptDialogOptions = {
  title: string
  message?: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busyLabel?: string
  /** Returns a readable error to block submit, or undefined to allow it. */
  validate?: (value: string) => string | undefined
  /** Runs before the dialog closes; the dialog stays open on rejection. */
  submit?: (value: string) => Promise<void>
  /** Element to restore focus to after the dialog closes. */
  returnFocus?: HTMLElement
}

export type AlertDialogOptions = {
  title: string
  message?: string
  danger?: boolean
  /** Element to restore focus to after the dialog closes. */
  returnFocus?: HTMLElement
}

type InputConfig = {
  placeholder?: string
  initial?: string
  validate?: (value: string) => string | undefined
}

type RunOptions<T> = {
  title: string
  message?: string
  showCancel: boolean
  cancelLabel?: string
  confirmLabel: string
  busyLabel?: string
  cancelValue: T
  confirmValue: (value: string) => T
  dangerTitle?: boolean
  dangerConfirm?: boolean
  input?: InputConfig
  submit?: (value: string) => Promise<void>
  returnFocus?: HTMLElement
}

function dangerButtonStyle(disabled: boolean): JSX.CSSProperties {
  return {
    background: "var(--color-error, #ef4444)",
    "border-color": "var(--color-error, #ef4444)",
    color: "var(--color-on-accent)",
    opacity: disabled ? 0.55 : 1,
  }
}

function run<T>(dialog: DialogHandle, opts: RunOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string>()
    const [value, setValue] = createSignal(opts.input?.initial ?? "")

    const confirm = () => {
      if (busy()) return
      const validation = opts.input?.validate?.(value())
      if (validation) {
        setError(validation)
        return
      }
      setBusy(true)
      setError(undefined)
      const task = opts.submit ? opts.submit(value()) : Promise.resolve()
      task.then(
        () => {
          done(opts.confirmValue(value()))
          dialog.close()
        },
        (err: unknown) => {
          setBusy(false)
          setError(err instanceof Error ? err.message : String(err))
        },
      )
    }

    const cancel = () => {
      if (busy()) return
      done(opts.cancelValue)
      dialog.close()
    }

    const shown = dialog.show(
      () => (
        <Dialog
          title={
            opts.dangerTitle ? <span style={{ color: "var(--color-error, #ef4444)" }}>{opts.title}</span> : opts.title
          }
          description={opts.message}
          fit
        >
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              "min-height": "0",
              flex: "1",
              gap: "16px",
              padding: "16px 20px 20px",
            }}
          >
            <Show when={opts.input}>
              <TextField
                autofocus
                value={value()}
                placeholder={opts.input?.placeholder}
                error={error()}
                validationState={error() ? "invalid" : "valid"}
                onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => {
                  setValue(e.currentTarget.value)
                  setError(undefined)
                }}
                onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
                  if (e.key !== "Enter") return
                  e.preventDefault()
                  confirm()
                }}
              />
            </Show>
            <Show when={!opts.input && error()}>
              <div style={{ color: "var(--color-error, #ef4444)", "font-size": "12px", "line-height": "1.4" }}>
                {error()}
              </div>
            </Show>
            <div
              style={{
                display: "flex",
                "justify-content": "flex-end",
                gap: "8px",
                "margin-top": "auto",
              }}
            >
              <Show when={opts.showCancel}>
                <Button variant="secondary" disabled={busy()} onClick={cancel}>
                  {opts.cancelLabel ?? "cancel"}
                </Button>
              </Show>
              <Button
                variant="primary"
                disabled={busy()}
                onClick={confirm}
                style={opts.dangerConfirm ? dangerButtonStyle(busy()) : undefined}
              >
                <Show when={busy()}>
                  <Spinner />
                </Show>
                {busy() ? (opts.busyLabel ?? opts.confirmLabel) : opts.confirmLabel}
              </Button>
            </div>
          </div>
        </Dialog>
      ),
      {
        mode: "stack",
        canClose: () => !busy(),
        returnFocus: opts.returnFocus,
        onClose: () => done(opts.cancelValue),
      },
    )
    if (!shown) done(opts.cancelValue)
  })
}

export function confirmDialog(dialog: DialogHandle, opts: ConfirmDialogOptions): Promise<boolean> {
  return run<boolean>(dialog, {
    title: opts.title,
    message: opts.message,
    showCancel: true,
    cancelLabel: opts.cancelLabel,
    confirmLabel: opts.confirmLabel ?? "confirm",
    busyLabel: opts.busyLabel,
    cancelValue: false,
    confirmValue: () => true,
    dangerTitle: false,
    dangerConfirm: opts.danger === true,
    submit: opts.submit,
    returnFocus: opts.returnFocus,
  })
}

export function promptDialog(dialog: DialogHandle, opts: PromptDialogOptions): Promise<string | null> {
  return run<string | null>(dialog, {
    title: opts.title,
    message: opts.message,
    showCancel: true,
    cancelLabel: opts.cancelLabel,
    confirmLabel: opts.confirmLabel ?? "ok",
    busyLabel: opts.busyLabel,
    cancelValue: null,
    confirmValue: (v) => v,
    dangerTitle: false,
    dangerConfirm: opts.danger === true,
    input: {
      placeholder: opts.placeholder,
      initial: opts.initial,
      validate: opts.validate,
    },
    submit: opts.submit,
    returnFocus: opts.returnFocus,
  })
}

export function alertDialog(dialog: DialogHandle, opts: AlertDialogOptions): Promise<void> {
  return run<void>(dialog, {
    title: opts.title,
    message: opts.message,
    showCancel: false,
    confirmLabel: "ok",
    cancelValue: undefined,
    confirmValue: () => undefined,
    dangerTitle: opts.danger === true,
    dangerConfirm: false,
    returnFocus: opts.returnFocus,
  })
}
