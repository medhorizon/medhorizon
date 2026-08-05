import {
  createSignal,
  createResource,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  type JSX,
  Show,
  Switch,
  Match,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Markdown } from "@synsci/ui/markdown"
import { AsyncState, type AsyncStateProps } from "@synsci/ui/async-state"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { FONT_MONO, FONT_SANS, FONT_CODE } from "@/styles/tokens"
import { PdfViewer } from "@/science/renderers/documents/PdfViewer"
import { ProjectScienceView } from "@/science/ProjectScienceView"
import { clipText, formatBytes, inspectTruncated, mapInspectToUi, previewOf, type ProjectUiMode } from "@/science/files"
import type { ScienceFileInspect } from "@synsci/sdk/v2/client"
import { toast } from "@/atlas/Toast"
import { IconFile, IconX, IconCopy, IconDownload, IconBookOpen, IconBraces, IconRefresh } from "@/atlas/shared/Icon"

/**
 * Inline file view — header (icon + name + subtitle + controls) over the
 * type-aware renderer body.
 *
 * LOAD POLICY (inspect-first): the only request issued on mount is the bounded
 * science `file.inspect`. The old eager `file.read` never starts before inspect
 * resolves; after inspect the generated `readPolicy` decides the rest:
 *
 *   - `editable-full` (within the frozen size threshold) → a single `file.read`
 *     for the full text, then the existing markdown / code / renderer path.
 *   - `bounded-preview` (over-budget text) → only the server-bounded preview,
 *     read-only, with a hard char cap and an explicit truncated note.
 *   - `metadata-only` (large/unknown binary) → metadata/capability summary and
 *     a same-origin raw download; no full read, no base64/data URL.
 *   - `streamed-media` (pdf) → the canonical same-origin raw/Range URL is handed
 *     to the native consumer (pdfjs). Never base64/data-URL/JS content state.
 *
 * Read-only previews/metadata never expose a source/edit action that could
 * implicitly trigger a full read. An inspect failure with unknown size/policy
 * NEVER falls back to a full read — only retry / a raw stream download.
 *
 * Renderer-capable project files (sequence/structure) are handed to the
 * project wrapper `ProjectScienceView`; everything else keeps the renderers
 * below. This is the single load/renderer entry — the slide-in drawer
 * (`FilePreview`, below) and the center-pane document tabs both mount it.
 */

const ext = (name: string): string => {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

// Extension → shiki/highlight.js language id for the code fallback.
const LANG: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  rs: "rust",
  go: "go",
  swift: "swift",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cu: "cpp",
  // .tex and friends are text/source files — highlight them as LaTeX source
  // (shiki has a `latex` grammar). A full \documentclass document must never
  // be fed to KaTeX (which only typesets a single math string → blank page).
  tex: "latex",
  latex: "latex",
  sty: "latex",
  cls: "latex",
  bib: "latex",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  r: "r",
  jl: "julia",
  lua: "lua",
  dockerfile: "docker",
  makefile: "makefile",
  csv: "csv",
  txt: "text",
  log: "text",
}

type Kind = "markdown" | "pdf" | "image" | "code" | "binary"

/**
 * Image extensions that may be previewed inline by streaming the canonical
 * same-origin raw URL through a native `<img>`. This is a DISPLAY affordance
 * (like `LANG`), not a scientific detector: routing still follows the generated
 * inspect readPolicy (a `metadata-only` binary shows metadata/capability), and
 * the raw transport is the sanctioned streamed-media path — never a data URL.
 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"])

export function FileView(props: {
  path: string
  directory?: string
  subtitle?: string
  onClose?: () => void
}): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const directory = () => props.directory || sync.project?.worktree || sync.data.path.directory || sdk.directory
  const name = () => props.path.split("/").pop() || props.path
  const e = () => ext(name())

  // `showSource` flips rendered docs (md / tex) to their raw text; for code
  // files it flips the read-only highlighted view into an editable textarea.
  const [showSource, setShowSource] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [savedText, setSavedText] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [imageFailed, setImageFailed] = createSignal(false)

  // Phase 1 — inspect-first. The ONLY request issued on mount is the bounded
  // science inspect; the old `file.read` is never started before this resolves.
  const [inspectState] = createResource(
    () => [directory(), props.path, refreshKey()] as const,
    async ([dir, path]) => {
      if (!dir || !path) return undefined
      // Pass the params FLAT — the generated client maps `directory`/`path`
      // into the query string; `directory` re-roots the backend Instance so any
      // host folder is inspectable by directory + relative path.
      const res = await sdk.client.file.inspect({ directory: dir, path })
      const data = res.data
      if (data === undefined) throw new Error("unexpected response while inspecting file")
      return data
    },
  )

  // The resource accessor re-throws its error once resolved, so snapshot the
  // last good value; inspect() stays readable for stale content and refresh
  // errors (the error banner renders above it instead of clearing it).
  const [knownInspect, setKnownInspect] = createSignal<ScienceFileInspect | undefined>(undefined)
  createEffect(() => {
    if (!inspectState.error) setKnownInspect(inspectState())
  })
  const inspect = () => knownInspect()

  // Phase 2 — full content. Runs ONLY for editable-full text within the frozen
  // threshold, and never before inspect settles. The source key includes the
  // inspect result, so a refresh that changes the readPolicy (e.g. the file
  // outgrew the full-read threshold) re-evaluates and aborts an in-flight read.
  const [full] = createResource(
    () => {
      const ins = inspect()
      if (!ins || ins.readPolicy !== "editable-full" || ins.mode !== "text") return undefined
      return [directory(), props.path, refreshKey(), ins] as const
    },
    async ([dir, path]) => {
      if (!dir || !path) return ""
      const res = await sdk.client.file.read({ directory: dir, path })
      const data = res.data
      if (data === undefined) throw new Error("unexpected response while reading file")
      return data.content ?? ""
    },
  )

  const [knownText, setKnownText] = createSignal<string | undefined>(undefined)
  createEffect(() => {
    if (!full.error) setKnownText(full())
  })
  const fullText = () => knownText()

  const editable = createMemo(() => {
    const ins = inspect()
    return !!ins && ins.mode === "text" && ins.readPolicy === "editable-full"
  })
  const boundedText = createMemo(() => {
    const ins = inspect()
    return !!ins && ins.mode === "text" && ins.readPolicy === "bounded-preview"
  })
  const binaryMode = createMemo(() => {
    const ins = inspect()
    return !!ins && ins.mode === "binary"
  })
  const uiMode = createMemo<ProjectUiMode | undefined>(() => {
    const ins = inspect()
    return ins ? mapInspectToUi(ins).mode : undefined
  })

  // Displayed text: the full read for editable-full, or the server-bounded
  // preview for bounded-preview. Metadata/stream modes carry no text.
  const textContent = createMemo(() => {
    const ins = inspect()
    if (!ins || ins.mode !== "text") return ""
    if (ins.readPolicy === "editable-full") return fullText() ?? ""
    return previewOf(ins)
  })
  const dirty = () => editable() && draft() !== savedText()

  const kind = createMemo<Kind>(() => {
    const ins = inspect()
    const x = e()
    if (ins?.format === "pdf" || ins?.readPolicy === "streamed-media") return "pdf"
    if (ins?.mode === "binary") return IMAGE_EXTS.has(x) ? "image" : "binary"
    if (x === "md" || x === "markdown" || x === "mdx") return "markdown"
    return "code"
  })

  const badge = () => {
    const ins = inspect()
    const k = kind()
    if (k === "code") return LANG[e()] ?? e() ?? "text"
    if (k === "binary") return ins && ins.format !== "unknown" ? ins.format : "binary"
    return k
  }

  createEffect(() => {
    if (!editable() || full.loading || full.error) return
    const next = textContent()
    setDraft(next)
    setSavedText(next)
  })

  // Reset the image-fallback flag whenever the document is re-inspected.
  createEffect(() => {
    void refreshKey()
    setImageFailed(false)
  })

  // Canonical same-origin raw/Range URL for native consumption (img, pdfjs,
  // download). Built with URLSearchParams for path-safety; never a fetch, never
  // JSON/base64/data-URL, never held in JS content state.
  const rawUrl = () => {
    const dir = directory()
    const p = props.path
    if (!dir || !p) return ""
    const url = new URL(`${sdk.url.replace(/\/$/, "")}/file/raw`)
    url.searchParams.set("directory", dir)
    url.searchParams.set("path", p)
    return url.toString()
  }

  const save = async () => {
    if (saving() || !editable() || !dirty()) return
    setSaving(true)
    try {
      // The generated SDK owns file writes (its `file.write` method maps to the
      // backend write route); the legacy handwritten fetch workaround is gone.
      const res = await sdk.client.file.write({ directory: directory(), path: props.path, content: draft() })
      const d = res.data
      const next = d && typeof d.content === "string" ? d.content : draft()
      setDraft(next)
      setSavedText(next)
      toast.success("saved", name())
    } catch (err) {
      toast.error("save failed", errorDetail(err))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(textContent())
      toast.success("copied", name())
    } catch {}
  }

  const toggleable = () => editable() && (kind() === "markdown" || kind() === "code")

  // The renderer body — render mode via the project wrapper, then pdf / image /
  // binary / bounded text, then the existing markdown / code views. binary is a
  // capability state after a successful inspect, never an error.
  const body = (): JSX.Element => {
    const ins = inspect()
    const k = kind()

    if (uiMode() === "render" && ins && textContent()) {
      return (
        <div style={{ padding: "14px 16px" }}>
          <ProjectScienceView inspect={ins} content={textContent()} downloadUrl={rawUrl()} height={100000} />
        </div>
      )
    }

    if (k === "pdf") {
      // streamed-media: hand the canonical raw URL to pdfjs — never base64.
      return (
        <div style={{ padding: "14px" }}>
          <PdfViewer kind="pdf" data={{ url: rawUrl(), maxPages: 40 }} height={100000} />
        </div>
      )
    }

    if (k === "image") {
      return (
        <div style={{ display: "grid", "place-items": "center", padding: "22px", "min-height": "100%" }}>
          <Show when={!imageFailed()} fallback={<BinaryNote inspect={ins} />}>
            <img
              src={rawUrl()}
              alt={name()}
              onError={() => setImageFailed(true)}
              style={{
                "max-width": "100%",
                "max-height": "100%",
                "object-fit": "contain",
                "border-radius": "4px",
              }}
            />
          </Show>
        </div>
      )
    }

    if (k === "binary") {
      return (
        <div
          style={{
            display: "grid",
            "place-items": "center",
            padding: "40px 24px",
            "min-height": "100%",
            "text-align": "center",
          }}
        >
          <BinaryNote inspect={ins} />
        </div>
      )
    }

    if (boundedText()) {
      // Over-budget text: server-bounded preview only, read-only, hard-capped
      // retained chars and minimal DOM (a single <pre>, no syntax highlighting).
      return (
        <div style={{ padding: "14px 16px" }}>
          <Show when={truncatedNote()}>
            <div
              data-slot="project-science-truncated"
              style={{ "font-size": "12px", color: "#a8760a", "margin-bottom": "6px" }}
            >
              Bounded preview — content clipped to fit the retained-chars budget.
            </div>
          </Show>
          <pre
            data-slot="project-science-text-body"
            class="atlas-scroll"
            style={{
              margin: "0",
              "max-height": "420px",
              overflow: "auto",
              "white-space": "pre-wrap",
              "word-break": "break-word",
              "font-family": FONT_CODE,
              "font-size": "12px",
              "line-height": 1.65,
              color: "var(--color-text)",
              background: "rgba(128,128,128,0.06)",
              padding: "8px 10px",
              "border-radius": "4px",
            }}
          >
            {clipText(textContent())}
          </pre>
        </div>
      )
    }

    return (
      <Switch>
        {/* markdown */}
        <Match when={k === "markdown" && !showSource()}>
          <div style={{ padding: "22px 26px", "max-width": "820px", margin: "0 auto" }}>
            <Markdown class="atlas-md" text={draft()} />
          </div>
        </Match>

        {/* code / text — highlighted read view (the editable textarea renders
            directly in the body Show below to keep its fill-height layout) */}
        <Match when={k === "code" || (k === "markdown" && showSource())}>
          <div style={{ padding: "14px 16px" }}>
            <Markdown
              class="atlas-md"
              text={fence(
                showSource() && k !== "code" ? langFor(k, e()) : (LANG[e()] ?? "text"),
                draft(),
              )}
            />
          </div>
        </Match>
      </Switch>
    )
  }

  const truncatedNote = () => {
    const ins = inspect()
    const serverTruncated = ins ? inspectTruncated(ins) : false
    return serverTruncated || clipText(textContent()).length < textContent().length
  }

  // Map the inspect/full resources onto the kit AsyncState union. Error/loading
  // follow the derivation rules with the last-good values as stale content; a
  // successful empty text file maps to `empty` (still editable via the header);
  // binary/unsupported is a ready capability state, not an error.
  const asyncState = createMemo<AsyncStateProps>(() => {
    const err = inspectState.error || full.error
    const loading = inspectState.loading || (editable() && full.loading)
    const stale = (() => {
      const ins = inspect()
      if (!ins) return false
      if (ins.mode !== "text") return true
      return textContent().length > 0
    })()
    if (err) {
      return {
        state: "error",
        label: name(),
        title: "couldn't open this file",
        detail: errorDetail(err),
        retryLabel: "retry",
        retry: () => setRefreshKey((k) => k + 1),
        children: stale ? body() : undefined,
      }
    }
    if (loading) {
      return stale
        ? { state: "refreshing", label: name(), message: "updating file…", children: body() }
        : { state: "loading", label: name(), message: "loading file…" }
    }
    const ins = inspect()
    if (ins && ins.mode === "text" && textContent() === "") {
      return { state: "empty", label: name(), message: "empty file" }
    }
    return { state: "ready", label: name(), loadedMessage: "file loaded", children: body() }
  })

  return (
    <div
      style={{
        flex: 1,
        "min-height": 0,
        "min-width": 0,
        display: "flex",
        "flex-direction": "column",
        background: "var(--color-surface-solid)",
        overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          padding: "10px 12px 10px 16px",
          "border-bottom": "1px solid var(--color-border)",
          background: "var(--color-bg)",
          "flex-shrink": 0,
        }}
      >
        <IconFile size={14} strokeWidth={1.5} />
        <div style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: "1px" }}>
          <span
            title={props.path}
            style={{
              "font-family": FONT_CODE,
              "font-size": "12px",
              color: "var(--color-text)",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {name()}
          </span>
          <Show when={props.subtitle}>
            <span
              title={props.subtitle}
              style={{
                "font-family": FONT_MONO,
                "font-size": "10px",
                color: "var(--color-text-faint)",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              {props.subtitle}
            </span>
          </Show>
        </div>
        <span
          style={{
            "flex-shrink": 0,
            padding: "2px 8px",
            "border-radius": "4px",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-subtle)",
            "font-family": FONT_MONO,
            "font-size": "10px",
            color: "var(--color-text-faint)",
            "letter-spacing": "0.03em",
          }}
        >
          {badge()}
        </span>

        <Show when={dirty()}>
          <button type="button" onClick={() => setDraft(savedText())} style={ctlBtn()}>
            reset
          </button>
          <button type="button" onClick={() => void save()} style={ctlBtn(true)}>
            {saving() ? "saving…" : "save"}
          </button>
        </Show>

        <Show when={toggleable()}>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title={showSource() ? "rendered view" : kind() === "code" ? "edit source" : "raw source"}
            style={iconBtn(showSource())}
          >
            <Show when={showSource()} fallback={<IconBraces size={13} strokeWidth={1.6} />}>
              <IconBookOpen size={13} strokeWidth={1.6} />
            </Show>
          </button>
        </Show>

        <Show when={!binaryMode()}>
          <button type="button" onClick={() => void copy()} title="copy contents" style={iconBtn()}>
            <IconCopy size={13} strokeWidth={1.6} />
          </button>
        </Show>
        <Show when={binaryMode()}>
          <a href={rawUrl()} download={name()} title="download" style={{ ...iconBtn(), "text-decoration": "none" }}>
            <IconDownload size={13} strokeWidth={1.6} />
          </a>
        </Show>

        <button type="button" onClick={() => setRefreshKey((k) => k + 1)} title="refresh" style={iconBtn()}>
          <IconRefresh size={13} strokeWidth={1.6} />
        </button>

        <Show when={props.onClose}>
          <button type="button" onClick={() => props.onClose!()} title="close" style={iconBtn()}>
            <IconX size={14} strokeWidth={1.7} />
          </button>
        </Show>
      </div>

      {/* body — the editable source textarea renders directly so its fill-height
          editor layout is preserved; every other state goes through the shared
          AsyncState shell. */}
      <Show
        when={editable() && kind() === "code" && showSource()}
        fallback={
          <div
            class="atlas-scroll"
            style={{
              flex: 1,
              "min-height": 0,
              overflow: "auto",
              background: "var(--color-bg-subtle)",
            }}
          >
            <AsyncState {...asyncState()} />
          </div>
        }
      >
        <textarea
          value={draft()}
          spellcheck={false}
          onInput={(ev) => setDraft(ev.currentTarget.value)}
          class="atlas-scroll"
          style={{
            all: "unset",
            "box-sizing": "border-box",
            display: "block",
            width: "100%",
            "min-height": "100%",
            padding: "16px 18px",
            "font-family": FONT_CODE,
            "font-size": "12px",
            "line-height": 1.65,
            color: "var(--color-text)",
            "white-space": "pre",
            "tab-size": 2,
          }}
        />
      </Show>
    </div>
  )
}

/**
 * Metadata/capability summary for a binary project file. Kept as the plain
 * "Binary file — no inline preview." capability state (with the inspect's
 * family/format/size) — a successful inspect capability, never an error.
 */
function BinaryNote(props: { inspect?: ScienceFileInspect }): JSX.Element {
  return (
    <div
      style={{
        "font-family": FONT_SANS,
        "font-size": "13px",
        color: "var(--color-text-muted)",
        "line-height": 1.6,
      }}
    >
      Binary file — no inline preview.
      <br />
      Use the download button above to open it.
      <Show when={props.inspect}>
        {(ins) => (
          <div
            data-slot="project-science-meta"
            style={{
              "margin-top": "8px",
              "font-family": FONT_MONO,
              "font-size": "11px",
              color: "var(--color-text-faint)",
            }}
          >
            family {ins().family} · format {ins().format} · {formatBytes(ins().size)}
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * Slide-in drawer wrapper around FileView — kept for the legacy right-pane
 * preview path. Backdrop / Esc / the header × all close it.
 */
export function FilePreview(props: { path: string; onClose: () => void }): JSX.Element {
  const [mounted, setMounted] = createSignal(false)
  onMount(() => {
    requestAnimationFrame(() => setMounted(true))
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
  return (
    <Portal>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.42)",
          "backdrop-filter": "blur(2px)",
          "z-index": 90,
          opacity: mounted() ? 1 : 0,
          transition: "opacity 120ms ease",
        }}
      />
      <div
        role="dialog"
        aria-label={`preview ${props.path}`}
        style={{
          position: "fixed",
          top: "14px",
          bottom: "14px",
          right: "14px",
          width: "clamp(360px, 60vw, 820px)",
          "max-width": "calc(100vw - 28px)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--color-surface-solid)",
          border: "1px solid var(--color-border-strong)",
          "border-radius": "4px",
          "box-shadow": "var(--shadow-lg, 0 24px 60px rgba(0,0,0,0.35))",
          overflow: "hidden",
          "z-index": 91,
          transform: mounted() ? "translateX(0)" : "translateX(16px)",
          opacity: mounted() ? 1 : 0,
          transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease",
        }}
      >
        <FileView path={props.path} onClose={props.onClose} />
      </div>
    </Portal>
  )
}

function langFor(k: Kind, x: string): string {
  if (k === "markdown") return "markdown"
  return LANG[x] ?? "text"
}

// The SDK throws the parsed JSON error body (e.g. hono's { message }); surface
// that message as the AsyncState detail, falling back to a stable copy.
function errorDetail(err: unknown): string {
  if (typeof err === "string") return err
  const raw = err as { body?: { message?: unknown }; message?: unknown }
  const message = raw.body?.message ?? raw.message
  return typeof message === "string" && message ? message : "couldn't open this file"
}

// Wrap raw file text in a fenced code block so the shared Markdown renderer
// (marked + shiki) syntax-highlights it. Guards against content that already
// contains a triple backtick by widening the fence.
function fence(lang: string, body: string): string {
  let ticks = "```"
  while (body.includes(ticks)) ticks += "`"
  return `${ticks}${lang}\n${body}\n${ticks}`
}

function iconBtn(active = false): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "28px",
    height: "28px",
    "border-radius": "4px",
    color: active ? "var(--color-text)" : "var(--color-text-faint)",
    background: active ? "var(--color-accent-subtle)" : "transparent",
    "flex-shrink": 0,
    transition: "background 120ms ease, color 120ms ease",
  } as JSX.CSSProperties
}

function ctlBtn(primary = false): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    padding: "5px 11px",
    "border-radius": "4px",
    border: primary ? "1px solid var(--color-text)" : "1px solid var(--color-border)",
    background: primary ? "var(--color-text)" : "var(--color-bg-subtle)",
    color: primary ? "var(--color-bg)" : "var(--color-text-muted)",
    "font-family": FONT_MONO,
    "font-size": "11px",
    "font-weight": primary ? 600 : 500,
    "flex-shrink": 0,
  } as JSX.CSSProperties
}

export default FilePreview
