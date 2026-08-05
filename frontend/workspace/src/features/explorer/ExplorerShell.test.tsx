/**
 * DOM tests for ExplorerShell — the module-array rollback boundary. When the
 * host injects a single module the shell degrades to that module's plain
 * full-height surface (no tablist, no empty tab/panel, no stale selection);
 * with several modules it renders the tablist and mounts only the default
 * module's panel until a tab is visited.
 *
 * Mirrors the Plan 07 frontend/ui render approach: bun classic-transpiles .tsx
 * to React.createElement, so a test-local bridge maps that onto the deep Solid
 * client primitives (solid-js/web/dist/web.js). Under bun's node condition
 * solid-js resolves to its non-reactive build, so these tests exercise the
 * synchronous initial render tree only — exactly where the rollback/degrade
 * guard lives. Interactive tab-switching is covered by the Playwright E2E.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import type * as SolidWeb from "solid-js/web/types/client.d.ts"
// @ts-expect-error — no .d.ts for the deep client build
import * as client from "solid-js/web/dist/web.js"
import { ExplorerShell } from "./ExplorerShell"
import type { ExplorerModule } from "./contract"

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
    if ("children" in p) insert<unknown>(el, p.children as never)
    return el
  },
}

;(globalThis as { React?: unknown }).React = React

// solid-js resolves to its server build under bun's node condition; that build
// mints ids through a shared hydration context, so ExplorerShell's
// createUniqueId() would throw under a non-hydrating context. Prime a
// non-hydrating context once (before any test mounts) to unblock id minting
// without switching the build into hydration mode.
const solidRuntime = (await import("solid-js")) as unknown as {
  sharedConfig: { context?: { id: string; count: number; noHydrate?: boolean } }
}
solidRuntime.sharedConfig.context = { id: "explorer-test", count: 0, noHydrate: true }

// Dummy module surface: an identifiable DOM node carrying the scope it was
// mounted with, so tests can assert which module mounted and that it received
// the current session id.
function moduleNode(id: string, label: string): ExplorerModule {
  return {
    id,
    label,
    component: (props) => {
      const el = document.createElement("div")
      el.setAttribute("data-module-id", id)
      el.setAttribute("data-session", props.sessionID)
      el.textContent = `${label}@${props.sessionID}`
      return el as unknown as JSX.Element
    },
  }
}

function mount(modules: ExplorerModule[], defaultModule: string, sessionID = "ses-t") {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(ExplorerShell, { modules, defaultModule, scope: { sessionID } }), host)
  return { host, dispose }
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("ExplorerShell module-array rollback boundary", () => {
  test("a single injected module degrades to that module's plain full-height surface", () => {
    const files = moduleNode("files", "Files")
    const { host } = mount([files], "files")

    // No tablist, no tab buttons, no tabpanels — just the module surface.
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.querySelector('[role="tab"]')).toBeNull()
    expect(host.querySelector('[role="tabpanel"]')).toBeNull()
    const surface = host.querySelector('[data-module-id="files"]')
    expect(surface).toBeTruthy()
    expect(surface!.getAttribute("data-session")).toBe("ses-t")
    expect(surface!.textContent).toContain("Files")
  })

  test("removing the second module leaves no empty tab, panel, or stale selection", () => {
    const files = moduleNode("files", "Files")
    const artifacts = moduleNode("session-artifacts", "Session Artifacts")

    // Two-module shell first: the tablist shows only the injected modules and
    // the default (files) panel is the only one mounted before any visit.
    const full = mount([files, artifacts], "files")
    const tabs = full.host.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(2)
    expect(tabs[0]!.textContent).toContain("Files")
    expect(tabs[1]!.textContent).toContain("Session Artifacts")
    expect(full.host.querySelector('[data-module-id="files"]')).toBeTruthy()
    expect(full.host.querySelector('[data-module-id="session-artifacts"]')).toBeNull()

    // After the host drops the artifacts module the shell degrades to the
    // Files-only surface: no tablist, no stale artifacts tab/panel.
    const degraded = mount([files], "files")
    expect(degraded.host.querySelector('[role="tablist"]')).toBeNull()
    expect(degraded.host.querySelector('[role="tab"]')).toBeNull()
    expect(degraded.host.querySelector('[role="tabpanel"]')).toBeNull()
    expect(degraded.host.querySelector('[data-module-id="session-artifacts"]')).toBeNull()
    expect(degraded.host.querySelector('[data-module-id="files"]')).toBeTruthy()
  })

  test("the shell renders only the modules the host injects", () => {
    const files = moduleNode("files", "Files")
    const { host } = mount([files], "files")
    expect(host.querySelectorAll('[data-module-id]').length).toBe(1)
    expect(host.querySelector('[data-module-id="session-artifacts"]')).toBeNull()
  })
})
