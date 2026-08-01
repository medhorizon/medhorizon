// First-run setup — the browser equivalent of the terminal `openscience init`
// wizard (cli/onboard.ts). Local / BYOK only; Atlas managed is retired from the
// product surface. Built on the @synsci/ui Dialog kit.
//
//   • Your own keys → the real Credentials add-key flow (auth.set + global.dispose).
//   • Not now → dismiss + persist a localStorage marker so we don't re-prompt.
import { type JSX, For, Show, createSignal } from "solid-js"
import { Dialog } from "@synsci/ui/dialog"
import { useDialog } from "@synsci/ui/context/dialog"
import { Button } from "@synsci/ui/button"
import { TextField } from "@synsci/ui/text-field"
import { useGlobalSDK } from "@/context/global-sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export const SETUP_DISMISS_KEY = "openscience.setup.dismissed"

export function readSetupDismissed(): boolean {
  try {
    return localStorage.getItem(SETUP_DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

/** Open the setup dialog. `onDismiss` fires when the user picks "Not now" so a
 *  caller (the gate) can stop auto-prompting for the rest of the session. */
export function openSetupDialog(dialog: ReturnType<typeof useDialog>, onDismiss?: () => void) {
  dialog.show(() => <SetupDialog onDismiss={onDismiss} />)
}

const BYOK_PROVIDERS: { id: string; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", placeholder: "sk-…" },
  { id: "google", label: "Google", placeholder: "AIza…" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-…" },
  { id: "xai", label: "xAI", placeholder: "xai-…" },
  { id: "meta", label: "Meta", placeholder: "meta-…" },
]

type View = "choose" | "byok"

export function SetupDialog(props: { onDismiss?: () => void }): JSX.Element {
  const dialog = useDialog()
  const sdk = useGlobalSDK()

  const [view, setView] = createSignal<View>("choose")
  const [provider, setProvider] = createSignal(BYOK_PROVIDERS[0].id)
  const [byokKey, setByokKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const dismiss = () => {
    try {
      localStorage.setItem(SETUP_DISMISS_KEY, "1")
    } catch {}
    props.onDismiss?.()
    dialog.close()
  }

  const saveByok = async () => {
    if (busy()) return
    const k = byokKey().trim()
    if (!k) return
    setBusy(true)
    setError(undefined)
    try {
      await sdk.client.auth.set({ providerID: provider(), auth: { type: "api", key: k } })
      await sdk.client.global.dispose()
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Set up models">
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "16px", "max-width": "460px", padding: "4px 2px" }}
      >
        <Show when={error()}>
          <div
            style={{
              "font-family": FONT_SANS,
              "font-size": "12px",
              color: "var(--color-error)",
              border: "1px solid var(--color-error-muted)",
              "border-radius": "4px",
              padding: "9px 11px",
              "line-height": 1.5,
            }}
          >
            {error()}
          </div>
        </Show>

        <Show when={view() === "choose"}>
          <p style={intro()}>Pick how to power your models. You can change this anytime in Settings.</p>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <ChoiceCard
              title="Your own keys"
              hint="recommended"
              body="Bring your own provider key. Stored on this machine, free and unmetered here."
              onClick={() => {
                setError(undefined)
                setView("byok")
              }}
            />
            <ChoiceCard
              title="Not now"
              body="Explore first with the free demo models. Set up anytime."
              muted
              onClick={dismiss}
            />
          </div>
        </Show>

        <Show when={view() === "byok"}>
          <p style={intro()}>Add a provider key. It's stored on this machine and billed directly by the provider.</p>
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <span style={label()}>Provider</span>
            <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
              <For each={BYOK_PROVIDERS}>
                {(p) => (
                  <button
                    type="button"
                    onClick={() => setProvider(p.id)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      padding: "5px 12px",
                      "border-radius": "4px",
                      border: provider() === p.id ? "1px solid var(--color-text)" : "1px solid var(--color-border)",
                      background: provider() === p.id ? "var(--color-accent-subtle)" : "transparent",
                      "font-family": FONT_MONO,
                      "font-size": "11px",
                      color: provider() === p.id ? "var(--color-text)" : "var(--color-text-muted)",
                    }}
                  >
                    {p.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <span style={label()}>API key</span>
            <TextField
              type="password"
              hideLabel
              placeholder={BYOK_PROVIDERS.find((p) => p.id === provider())?.placeholder ?? "sk-…"}
              value={byokKey()}
              disabled={busy()}
              onChange={setByokKey}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void saveByok()
                }
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Button
              variant="primary"
              size="small"
              disabled={busy() || !byokKey().trim()}
              onClick={() => void saveByok()}
            >
              {busy() ? "saving…" : "save key"}
            </Button>
            <span style={{ flex: 1 }} />
            <Button variant="ghost" size="small" onClick={() => setView("choose")}>
              back
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

function ChoiceCard(props: {
  title: string
  body: string
  hint?: string
  muted?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
        padding: "12px 14px",
        "border-radius": "6px",
        border: "1px solid var(--color-border)",
        background: props.muted ? "transparent" : "var(--color-surface-solid)",
        "font-family": FONT_SANS,
      }}
    >
      <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "margin-bottom": "4px" }}>
        <span style={{ "font-size": "13px", "font-weight": 600, color: "var(--color-text)" }}>{props.title}</span>
        <Show when={props.hint}>
          <span style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)" }}>
            {props.hint}
          </span>
        </Show>
      </div>
      <p style={{ margin: 0, "font-size": "12px", color: "var(--color-text-muted)", "line-height": 1.45 }}>
        {props.body}
      </p>
    </button>
  )
}

function intro(): JSX.CSSProperties {
  return {
    margin: 0,
    "font-family": FONT_SANS,
    "font-size": "13px",
    color: "var(--color-text-muted)",
    "line-height": 1.5,
  }
}

function label(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    "letter-spacing": "0.04em",
    "text-transform": "uppercase",
  }
}
