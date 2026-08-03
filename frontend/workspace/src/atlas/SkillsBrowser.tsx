/**
 * Browsable skills popover for the composer. Lists every available skill
 * (from the live `sync.data.skill` store) grouped by category/origin, with
 * search and full descriptions. Picking one prefills `/<name> ` into the
 * prompt — the same invoke convention as the inline slash autocomplete.
 */
import { createSignal, createMemo, onMount, onCleanup, For, Show, type JSX } from "solid-js"
import { Dialog } from "@synsci/ui/dialog"
import { AsyncState, type AsyncStateProps } from "@synsci/ui/async-state"
import { useDialog } from "@synsci/ui/context/dialog"
import { useSync } from "@/context/sync"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconSearch } from "@/atlas/shared/Icon"

interface SkillRow {
  name: string
  description: string
  location: string
  category?: string
  tags?: string[]
  entry?: boolean
}

function originOf(location: string): string {
  if (location.includes("installed-skills")) return "installed"
  if (location.includes("learned-skills")) return "learned"
  return "core"
}

// Filter the full library by the query, then group into category shelves sorted
// by label. Shared by the library dialog; the inline composer popover keeps its
// own copy (zero consumers, left untouched).
function groupSkills(input: SkillRow[], query: string) {
  const all = input.filter((s) => s.entry !== false)
  const q = query.trim().toLowerCase()
  const filtered = q
    ? all.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      )
    : all
  const map = new Map<string, SkillRow[]>()
  for (const s of filtered) {
    const label = s.category || originOf(s.location)
    const arr = map.get(label) ?? []
    arr.push(s)
    map.set(label, arr)
  }
  return Array.from(map.entries())
    .map(([label, items]) => ({ label, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function SkillRowButton(props: { skill: SkillRow; onPick: (name: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => props.onPick(props.skill.name)}
      class="atlas-skill-row"
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        "flex-direction": "column",
        gap: "3px",
        padding: "8px 10px",
        "border-radius": "4px",
        border: "1px solid transparent",
        width: "100%",
        "box-sizing": "border-box",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-accent-subtle)"
        e.currentTarget.style.borderColor = "var(--color-border)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent"
        e.currentTarget.style.borderColor = "transparent"
      }}
    >
      <span
        style={{
          "font-family": FONT_MONO,
          "font-size": "14px",
          "font-weight": 500,
          color: "var(--color-text)",
        }}
      >
        /{props.skill.name}
      </span>
      <Show when={props.skill.description}>
        <span
          style={{
            "font-family": FONT_SANS,
            "font-size": "13px",
            color: "var(--color-text-muted)",
            "line-height": 1.5,
            display: "-webkit-box",
            "-webkit-line-clamp": "2",
            "-webkit-box-orient": "vertical",
            overflow: "hidden",
          }}
        >
          {props.skill.description}
        </span>
      </Show>
      <Show when={(props.skill.tags ?? []).length > 0}>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", "margin-top": "2px" }}>
          <For each={(props.skill.tags ?? []).slice(0, 6)}>
            {(tag) => (
              <span
                style={{
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-text-faint)",
                  background: "var(--color-accent-subtle)",
                  padding: "1px 6px",
                  "border-radius": "4px",
                }}
              >
                {tag}
              </span>
            )}
          </For>
        </div>
      </Show>
    </button>
  )
}

export function SkillsBrowser(props: { onPick: (name: string) => void; onClose: () => void }): JSX.Element {
  const sync = useSync()
  const [query, setQuery] = createSignal("")
  let panelRef: HTMLDivElement | undefined

  onMount(() => {
    const onDown = (e: PointerEvent) => {
      if (panelRef && !panelRef.contains(e.target as Node)) props.onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose()
    }
    // Defer so the click that opened the popover doesn't immediately close it.
    setTimeout(() => document.addEventListener("pointerdown", onDown), 0)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    })
  })

  const groups = createMemo(() => {
    const all = ((sync.data.skill ?? []) as SkillRow[]).filter((s) => s.entry !== false)
    const q = query().trim().toLowerCase()
    const filtered = q
      ? all.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description ?? "").toLowerCase().includes(q) ||
            (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
        )
      : all
    const map = new Map<string, SkillRow[]>()
    for (const s of filtered) {
      const label = s.category || originOf(s.location)
      const arr = map.get(label) ?? []
      arr.push(s)
      map.set(label, arr)
    }
    return Array.from(map.entries())
      .map(([label, items]) => ({ label, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  const total = createMemo(() => groups().reduce((n, g) => n + g.items.length, 0))

  return (
    <div
      ref={panelRef}
      class="atlas-fade-in"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        "margin-bottom": "6px",
        "max-height": "380px",
        display: "flex",
        "flex-direction": "column",
        background: "var(--color-surface-solid)",
        border: "1px solid var(--color-border-strong)",
        "border-radius": "4px",
        "box-shadow": "var(--shadow-md)",
        overflow: "hidden",
        "z-index": 40,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 10px",
          "border-bottom": "1px solid var(--color-border)",
        }}
      >
        <span
          style={{
            "font-family": FONT_MONO,
            "font-size": "10px",
            "letter-spacing": "0.08em",
            "text-transform": "uppercase",
            color: "var(--color-text-faint)",
          }}
        >
          skills
        </span>
        <span
          class="tab-fig"
          style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-muted)" }}
        >
          {total()}
        </span>
        <input
          autofocus
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="search skills…"
          style={{
            all: "unset",
            flex: 1,
            "font-family": FONT_SANS,
            "font-size": "12px",
            color: "var(--color-text)",
            padding: "2px 4px",
          }}
        />
        <button
          type="button"
          onClick={props.onClose}
          title="close (esc)"
          style={{
            all: "unset",
            cursor: "pointer",
            color: "var(--color-text-faint)",
            "font-family": FONT_MONO,
            "font-size": "13px",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      <div class="atlas-scroll" style={{ "overflow-y": "auto", padding: "6px" }}>
        <Show
          when={total() > 0}
          fallback={
            <div
              style={{
                padding: "18px 10px",
                "text-align": "center",
                "font-family": FONT_MONO,
                "font-size": "11px",
                color: "var(--color-text-faint)",
              }}
            >
              no matching skills
            </div>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div style={{ "margin-bottom": "6px" }}>
                <div
                  style={{
                    padding: "6px 8px 3px",
                    "font-family": FONT_MONO,
                    "font-size": "10px",
                    "letter-spacing": "0.08em",
                    "text-transform": "uppercase",
                    color: "var(--color-text-faint)",
                  }}
                >
                  {group.label}
                </div>
                <For each={group.items}>
                  {(skill) => (
                    <button
                      type="button"
                      onClick={() => props.onPick(skill.name)}
                      class="atlas-skill-row"
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "2px",
                        padding: "7px 8px",
                        "border-radius": "4px",
                        width: "100%",
                        "box-sizing": "border-box",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span
                        style={{
                          "font-family": FONT_SANS,
                          "font-size": "13px",
                          "font-weight": 500,
                          color: "var(--color-text)",
                        }}
                      >
                        /{skill.name}
                      </span>
                      <Show when={skill.description}>
                        <span
                          style={{
                            "font-family": FONT_SANS,
                            "font-size": "12px",
                            color: "var(--color-text-muted)",
                            "line-height": 1.45,
                            display: "-webkit-box",
                            "-webkit-line-clamp": "2",
                            "-webkit-box-orient": "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {skill.description}
                        </span>
                      </Show>
                      <Show when={(skill.tags ?? []).length > 0}>
                        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", "margin-top": "2px" }}>
                          <For each={(skill.tags ?? []).slice(0, 5)}>
                            {(tag) => (
                              <span
                                style={{
                                  "font-family": FONT_MONO,
                                  "font-size": "10px",
                                  color: "var(--color-text-faint)",
                                  background: "var(--color-accent-subtle)",
                                  padding: "1px 5px",
                                  "border-radius": "4px",
                                }}
                              >
                                {tag}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

/**
 * Central skill-library modal. Shown through the app dialog system
 * (`dialog.show(() => <SkillLibraryDialog … />)`) as a proper centered
 * library window — search + grouped skill rows. Picking a skill fires
 * `onPick(name)` and closes the dialog; the caller decides what "pick"
 * means (the right pane prefills `/<name> ` into the composer).
 */
export function SkillLibraryDialog(props: { onPick: (name: string) => void }): JSX.Element {
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const groups = createMemo(() => groupSkills((sync.data.skill ?? []) as SkillRow[], query()))
  const total = createMemo(() => groups().reduce((n, g) => n + g.items.length, 0))
  const pick = (name: string) => {
    props.onPick(name)
    dialog.close()
  }

  // The query-filtered shelf list. `total() === 0` here is a query no-match —
  // the library itself is non-empty in every state that renders this body, so it
  // stays a distinct second layer from the resource-level `empty` state.
  const rows = (
    <div style={{ display: "flex", "flex-direction": "column", gap: "14px" }}>
      <Show
        when={total() > 0}
        fallback={
          <div
            style={{
              padding: "40px 10px",
              "text-align": "center",
              "font-family": FONT_MONO,
              "font-size": "12px",
              color: "var(--color-text-faint)",
            }}
          >
            no matching skills
          </div>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  padding: "0 4px 6px",
                  "border-bottom": "1px solid var(--color-border)",
                  "margin-bottom": "4px",
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  "letter-spacing": "0.08em",
                  "text-transform": "uppercase",
                  color: "var(--color-text-faint)",
                }}
              >
                <span style={{ flex: 1 }}>{group.label}</span>
                <span>{group.items.length}</span>
              </div>
              <For each={group.items}>
                {(skill) => <SkillRowButton skill={skill} onPick={pick} />}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  )

  // skill_status is the source of truth for the library (the overall sync
  // status can reach `complete` even when the skill fetch failed). partial maps
  // naturally: stale skills -> refreshing, no skills yet -> loading.
  const state = createMemo<AsyncStateProps>(() => {
    const status = sync.data.skill_status
    const count = (sync.data.skill ?? []).length
    if (status === "error") {
      return {
        state: "error",
        label: "skills",
        title: "couldn't load skills",
        detail: sync.data.skill_error,
        retry: () => void sync.skill.refetch(),
        retryLabel: "retry",
        children: count > 0 ? rows : undefined,
      }
    }
    if (status === "loading") {
      return count > 0
        ? { state: "refreshing", label: "skills", message: "updating skills…", children: rows }
        : { state: "loading", label: "skills", message: "loading skills…" }
    }
    return count > 0
      ? { state: "ready", label: "skills", children: rows, loadedMessage: "skills loaded" }
      : { state: "empty", label: "skills", message: "no skills available" }
  })

  return (
    <Dialog title="Skill Library" size="large" transition>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          width: "min(680px, 82vw)",
          "min-height": "440px",
          "max-height": "64vh",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "8px 10px",
            border: "1px solid var(--color-border-strong)",
            "border-radius": "4px",
            background: "var(--color-bg)",
          }}
        >
          <IconSearch size={13} strokeWidth={1.5} />
          <input
            autofocus
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="search skills…"
            style={{
              all: "unset",
              flex: 1,
              "font-family": FONT_SANS,
              "font-size": "14px",
              color: "var(--color-text)",
            }}
          />
          <span
            style={{
              "font-family": FONT_MONO,
              "font-size": "11px",
              "letter-spacing": "0.08em",
              "text-transform": "uppercase",
              color: "var(--color-text-faint)",
            }}
          >
            {total()} skills
          </span>
        </div>

        <div
          class="atlas-scroll"
          style={{
            flex: 1,
            "min-height": 0,
            "overflow-y": "auto",
            "padding-right": "2px",
          }}
        >
          <AsyncState {...state()} />
        </div>
      </div>
    </Dialog>
  )
}
