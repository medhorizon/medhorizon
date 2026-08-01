import { createSignal } from "solid-js"

export type RightPaneTab = "stages" | "terminal" | "research-graph"

const PANE_OPEN_KEY = "thesis-rightpane-open-v1"
const HIDDEN_TABS_KEY = "thesis-rightpane-hidden-tabs-v1"
const AGENT_KEY = "thesis-agent-v1"
const TAB_KEY = "thesis-rightpane-tab-v1"

// User-selectable agents. A previously-persisted agent that no longer exists (e.g. a
// removed mode) falls back to the default rather than sending an invalid agent.
const VALID_AGENTS = new Set(["research", "biology", "physics", "ml", "plan"])
const VALID_TABS = new Set<RightPaneTab>(["stages", "terminal", "research-graph"])

function normalizeTab(raw: unknown): RightPaneTab {
  // Legacy Atlas Canvas tab and any unknown value collapse to Research Graph.
  if (raw === "canvas" || raw === "atlas") return "research-graph"
  if (typeof raw === "string" && VALID_TABS.has(raw as RightPaneTab)) return raw as RightPaneTab
  return "research-graph"
}

function readAgent(): string {
  try {
    const saved = localStorage.getItem(AGENT_KEY)
    return saved && VALID_AGENTS.has(saved) ? saved : "research"
  } catch {
    return "research"
  }
}

function readPaneOpen(): boolean {
  try {
    return localStorage.getItem(PANE_OPEN_KEY) !== "0"
  } catch {
    return true
  }
}

function readHiddenTabs(): RightPaneTab[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    // Drop retired canvas/atlas entries; keep only live tabs.
    return arr.map(normalizeTab).filter((t, i, all) => all.indexOf(t) === i && VALID_TABS.has(t))
  } catch {
    return []
  }
}

function readTab(): RightPaneTab {
  try {
    return normalizeTab(localStorage.getItem(TAB_KEY) ?? "research-graph")
  } catch {
    return "research-graph"
  }
}

const [helpOpen, setHelpOpen] = createSignal(false)
const [paletteOpen, setPaletteOpen] = createSignal(false)
const [rightPaneTab, setRightPaneTabRaw] = createSignal<RightPaneTab>(readTab())
const [rightPaneOpen, setRightPaneOpenRaw] = createSignal(readPaneOpen())
const [hiddenTabs, setHiddenTabs] = createSignal<RightPaneTab[]>(readHiddenTabs())
const [agent, setAgentRaw] = createSignal<string>(readAgent())
const [prefill, setPrefill] = createSignal<string | undefined>(undefined)
// When true, the composer submits the prefilled text immediately instead of just
// dropping it in the box (used by one-click actions like stage/graph helpers).
const [prefillSend, setPrefillSend] = createSignal(false)
// A command to open in a new terminal tab (e.g. `ollama serve`, `ollama pull …`).
// A consumer inside the TerminalProvider (RightPane) runs it and clears this.
export type TerminalCommand = { command: string; args?: string[]; title?: string }
const [terminalCommand, setTerminalCommand] = createSignal<TerminalCommand | undefined>(undefined)

function setAgent(name: string) {
  try {
    localStorage.setItem(AGENT_KEY, name)
  } catch {}
  setAgentRaw(name)
}

function setRightPaneOpen(v: boolean) {
  try {
    localStorage.setItem(PANE_OPEN_KEY, v ? "1" : "0")
  } catch {}
  setRightPaneOpenRaw(v)
}

function setRightPaneTab(tab: RightPaneTab | string) {
  const next = normalizeTab(tab)
  try {
    localStorage.setItem(TAB_KEY, next)
  } catch {}
  setRightPaneTabRaw(next)
}

function toggleTabHidden(tab: RightPaneTab) {
  setHiddenTabs((prev) => {
    const next = prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]
    try {
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next))
    } catch {}
    return next
  })
}

function isTabHidden(tab: RightPaneTab) {
  return hiddenTabs().includes(tab)
}

export const uiStore = {
  helpOpen,
  setHelpOpen,
  paletteOpen,
  setPaletteOpen,
  rightPaneTab,
  setRightPaneTab,
  rightPaneOpen,
  setRightPaneOpen,
  hiddenTabs,
  toggleTabHidden,
  isTabHidden,
  agent,
  setAgent,
  prefill,
  setPrefill,
  prefillSend,
  setPrefillSend,
  terminalCommand,
  setTerminalCommand,
}
