import type { Component } from "solid-js"

/**
 * Scope handed to every Explorer module. Modules receive the current session
 * id so the shell can keep each module's mounted state scoped per session; a
 * module may use the id to scope its own resources.
 */
export interface ExplorerScope {
  sessionID: string
}

/**
 * A pluggable Explorer surface. The core shell knows nothing about a module's
 * implementation — it only renders `component` (while the module is mounted)
 * and keeps it mounted after first visit. Modules are injected by the host.
 */
export interface ExplorerModule {
  id: string
  label: string
  component: Component<ExplorerScope>
}
