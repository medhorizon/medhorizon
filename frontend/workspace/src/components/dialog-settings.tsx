import { Component, For, Suspense, createMemo, createSignal } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Dialog } from "@synsci/ui/dialog"
import { Icon } from "@synsci/ui/icon"
import { IconButton } from "@synsci/ui/icon-button"
import { useDialog } from "@synsci/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import {
  FONT_UI,
  FOCUS_RING,
  MOTION_EASE,
  MOTION_FAST,
  MOTION_NORMAL,
  RADIUS_CONTROL,
  RADIUS_MODAL,
} from "@/styles/tokens"
import {
  SETTINGS_PANELS,
  SETTINGS_SECTIONS,
  DEFAULT_PANEL,
  findPanel,
  resolvePanelId,
  type SettingsPanelId,
} from "./settings/registry"
import { SettingsNavContext } from "./settings/nav"

// Scoped to Settings so shared Switch/Select primitives inherit the semantic
// radius, motion, focus, and kit-color treatment without global CSS changes.
const SETTINGS_STYLES = `
.settings-dialog {
  color: var(--text-base);
  font-family: ${FONT_UI};
}
.settings-dialog [data-slot="dialog-header"] {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.settings-dialog .atlas-section-label {
  color: var(--text-base);
}
.settings-dialog :is(button, [role="button"], a, input, textarea, select, [tabindex]):focus-visible {
  outline: none !important;
  box-shadow: ${FOCUS_RING} !important;
}
.settings-dialog .settings-layout,
.settings-dialog .settings-nav,
.settings-dialog .settings-main {
  min-width: 0;
  min-height: 0;
}
.settings-dialog [data-component="switch"] [data-slot="switch-control"] {
  width: 38px;
  height: 22px;
  border-radius: 999px;
  padding: 0;
  transition: background-color ${MOTION_FAST} ${MOTION_EASE}, border-color ${MOTION_FAST} ${MOTION_EASE};
}
.settings-dialog [data-component="switch"] [data-slot="switch-thumb"] {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: none;
  margin: 0 3px;
  transform: translateX(0);
  transition: transform ${MOTION_FAST} ${MOTION_EASE};
}
.settings-dialog [data-component="switch"][data-checked] [data-slot="switch-control"],
.settings-dialog [data-component="switch"][data-checked]:hover:not([data-disabled],[data-readonly]) [data-slot="switch-control"] {
  background-color: var(--surface-interactive-base, var(--text-interactive-base));
  border-color: var(--border-interactive-base, var(--text-interactive-base));
}
.settings-dialog [data-component="switch"][data-checked] [data-slot="switch-thumb"] {
  transform: translateX(16px);
}
.settings-dialog [data-slot="select-select-trigger"] {
  border-radius: ${RADIUS_CONTROL};
  transition: background-color ${MOTION_FAST} ${MOTION_EASE}, border-color ${MOTION_FAST} ${MOTION_EASE};
}
[data-component="select-content"][data-trigger-style="settings"] {
  border-radius: ${RADIUS_CONTROL};
  padding: var(--space-1);
}
[data-component="select-content"][data-trigger-style="settings"] [data-slot="select-select-item"] {
  border-radius: ${RADIUS_CONTROL};
}

/* ── Fixed modal frame ──────────────────────────────────────────────────────
   The settings modal is ONE size regardless of the active panel. The rail +
   header stay fixed; only each panel body scrolls inside this frame. Without
   the height:100% override the shared dialog content grows to fit its content,
   so the box jumps size between tabs — the fix is to pin content to the fixed
   container height and let panels manage their own internal overflow. */
[data-component="dialog"]:has([data-slot="dialog-content"].settings-dialog) [data-slot="dialog-container"] {
  width: min(calc(100vw - var(--space-6)), 880px);
  height: min(calc(100vh - var(--space-6) - var(--space-2)), 640px);
  border-radius: ${RADIUS_MODAL};
  transition-duration: ${MOTION_NORMAL};
  transition-timing-function: ${MOTION_EASE};
}
[data-component="dialog"]:has([data-slot="dialog-content"].settings-expanded) [data-slot="dialog-container"] {
  width: min(calc(100vw - var(--space-6)), 1200px);
  height: min(calc(100vh - var(--space-6) - var(--space-2)), 840px);
}
[data-component="dialog"]:has([data-slot="dialog-content"].settings-dialog) [data-slot="dialog-content"] {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 767px) {
  [data-component="dialog"]:has([data-slot="dialog-content"].settings-dialog) [data-slot="dialog-container"],
  [data-component="dialog"]:has([data-slot="dialog-content"].settings-expanded) [data-slot="dialog-container"] {
    width: calc(100vw - var(--space-4));
    height: calc(100vh - var(--space-4));
  }
  .settings-dialog .settings-layout {
    flex-direction: column;
    overflow: hidden;
  }
  .settings-dialog .settings-nav {
    width: 100%;
    max-height: calc(var(--space-8) * 2 + var(--space-6));
    border-right: 0;
    border-bottom: 1px solid var(--border-weak-base);
    padding: var(--space-2);
  }
  .settings-dialog .settings-nav-list {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-3);
    max-height: calc(var(--space-8) + var(--space-6) + var(--space-4) + var(--space-3));
    overflow-y: auto;
  }
  .settings-dialog .settings-nav-section {
    min-width: 0;
    max-width: 100%;
    flex: 1 1 9rem;
  }
  .settings-dialog .settings-nav-section button {
    max-width: 100%;
  }
  .settings-dialog .settings-nav-footer {
    display: none;
  }
  .settings-dialog .settings-main {
    flex: 1 1 auto;
    overflow: hidden;
  }
}
`

export const DialogSettings: Component = () => {
  const platform = usePlatform()
  const dialog = useDialog()

  // Browser-style history so back/forward chevrons are real navigation.
  const [history, setHistory] = createSignal<SettingsPanelId[]>([DEFAULT_PANEL])
  const [cursor, setCursor] = createSignal(0)
  const [expanded, setExpanded] = createSignal(false)

  const current = createMemo(() => findPanel(history()[cursor()]))
  const canBack = createMemo(() => cursor() > 0)
  const canForward = createMemo(() => cursor() < history().length - 1)

  const navigate = (id: SettingsPanelId | string) => {
    const panel = resolvePanelId(id)
    if (history()[cursor()] === panel) return
    const next = history().slice(0, cursor() + 1)
    next.push(panel)
    setHistory(next)
    setCursor(next.length - 1)
  }
  const back = () => canBack() && setCursor(cursor() - 1)
  const forward = () => canForward() && setCursor(cursor() + 1)

  return (
    <Dialog
      title={<span>Settings</span>}
      action={<span aria-hidden="true" />}
      size="x-large"
      transition
      class="settings-dialog"
      classList={{ "settings-expanded": expanded() }}
    >
      <style>{SETTINGS_STYLES}</style>
      <div class="settings-layout flex h-full w-full" data-surface="settings" style={{ "font-family": FONT_UI }}>
        {/* ── Left rail ── */}
        <nav
          aria-label="Settings sections"
          class="settings-nav flex flex-col justify-between w-[224px] flex-shrink-0 border-r border-border-weak-base bg-surface-base/30 py-[var(--space-3)] px-[calc(var(--space-2)_+_var(--space-1)/2)]"
        >
          <div class="settings-nav-list flex flex-col gap-[var(--space-5)] overflow-y-auto no-scrollbar pt-[var(--space-1)]">
            <For each={SETTINGS_SECTIONS}>
              {(section) => (
                <div class="settings-nav-section flex flex-col gap-[var(--space-1)]">
                  <span
                    class="px-[calc(var(--space-2)_+_var(--space-1)/2)] pb-[var(--space-1)] atlas-section-label"
                    style={{ "font-family": FONT_UI }}
                  >
                    {section.label}
                  </span>
                  <For each={SETTINGS_PANELS.filter((p) => p.section === section.id)}>
                    {(panel) => (
                      <button
                        type="button"
                        class="flex items-center gap-[calc(var(--space-2)_+_var(--space-1)/2)] h-[var(--space-6)] px-[calc(var(--space-2)_+_var(--space-1)/2)] rounded-[var(--radius-control)] text-13-medium transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] text-left"
                        style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
                        classList={{
                          "bg-surface-raised-base-active text-text-strong": current().id === panel.id,
                          "text-text-weak hover:text-text-strong hover:bg-surface-raised-base/60":
                            current().id !== panel.id,
                        }}
                        onClick={() => navigate(panel.id)}
                        aria-current={current().id === panel.id ? "page" : undefined}
                      >
                        <Icon name={panel.icon} size="small" class="flex-shrink-0" />
                        <span class="truncate" style={{ "font-family": FONT_UI }}>
                          {panel.title}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
          <div class="settings-nav-footer flex flex-col gap-[calc(var(--space-1)/2)] px-[calc(var(--space-2)_+_var(--space-1)/2)] pt-[var(--space-2)] text-text-weak">
            <span class="text-12-medium" style={{ "font-family": FONT_UI }}>
              MedHorizon
            </span>
            <span class="text-11-regular" style={{ "font-family": FONT_UI }}>
              v{platform.version}
            </span>
          </div>
        </nav>

        {/* ── Right column ── */}
        <div class="settings-main flex flex-col flex-1 min-w-0">
          {/* Header */}
          <header class="settings-header flex items-center justify-between gap-[var(--space-2)] min-h-[52px] px-[var(--space-3)] border-b border-border-weak-base flex-shrink-0">
            <div class="flex items-center gap-[var(--space-1)] min-w-0">
              <IconButton icon="arrow-left" variant="ghost" disabled={!canBack()} onClick={back} aria-label="Back" />
              <IconButton
                icon="arrow-right"
                variant="ghost"
                disabled={!canForward()}
                onClick={forward}
                aria-label="Forward"
              />
              <span
                class="text-14-medium text-text-strong truncate pl-[var(--space-1)]"
                style={{ "font-family": FONT_UI }}
              >
                {current().title}
              </span>
            </div>
            <div class="flex items-center gap-[var(--space-1)] flex-shrink-0">
              <IconButton
                icon={expanded() ? "collapse" : "expand"}
                variant="ghost"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded() ? "Collapse" : "Expand"}
              />
              <IconButton icon="close" variant="ghost" onClick={() => dialog.close()} aria-label="Close" />
            </div>
          </header>

          {/* Body */}
          <div class="settings-body flex flex-col flex-1 min-h-0 overflow-hidden">
            <Suspense
              fallback={
                <div class="flex flex-1 items-center justify-center text-13-regular text-text-weak">Loading…</div>
              }
            >
              <SettingsNavContext.Provider value={navigate}>
                <div
                  class="settings-surface flex flex-col flex-1 min-h-0 overflow-hidden"
                  data-surface-ready="settings"
                  data-visual-ready="settings"
                >
                  <Dynamic component={current().component} />
                </div>
              </SettingsNavContext.Provider>
            </Suspense>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
