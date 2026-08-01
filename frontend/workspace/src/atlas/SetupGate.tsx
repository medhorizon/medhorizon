// Headless first-run gate. Auto-opens the SetupDialog exactly once when a
// brand-new user (running server, nothing configured, not previously dismissed)
// lands, mirroring the terminal wizard's isConfigured() check (cli/onboard.ts):
// a connected non-demo provider OR a configured default model. Mounted once in
// the root Layout; renders nothing. Does not probe Atlas account/session APIs.
import { createEffect, createSignal } from "solid-js"
import { useDialog } from "@synsci/ui/context/dialog"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"
import { openSetupDialog, readSetupDismissed } from "@/atlas/SetupDialog"

export function SetupGate() {
  const dialog = useDialog()
  const server = useServer()
  const providers = useProviders()
  const globalSync = useGlobalSync()

  const [dismissed, setDismissed] = createSignal(readSetupDismissed())
  let decided = false

  // "synsci" is the managed/demo provider — it can appear connected while the
  // user has no real BYOK key, so it does NOT count as configured.
  const configured = () =>
    providers.connected().some((p) => p.id !== "synsci") || !!globalSync.data.config?.model

  createEffect(() => {
    if (decided) return
    if (dismissed()) return
    if (server.healthy() !== true) return
    if (!globalSync.data.ready) return
    decided = true
    if (!configured()) openSetupDialog(dialog, () => setDismissed(true))
  })

  return null
}
