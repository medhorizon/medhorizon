import type { ScienceFileCapability, ScienceFileInspect, ScienceFileReadPolicy } from "@synsci/sdk/v2/client"

/**
 * Project-file UI mapper.
 *
 * This module is NOT a detector. It consumes the backend-generated inspect
 * contract (`@synsci/sdk` `ScienceFileInspect`) and maps `capability` ×
 * `readPolicy` exhaustively onto a UI mode. It holds no extension or magic
 * table and never overrides a successful inspect with a local guess: the only
 * inputs are the generated `capability`/`readPolicy` fields.
 *
 * The four UI modes map onto the four backend read policies:
 *   - `render`  → a project renderer (registry) can display the bounded content
 *   - `text`    → bounded text preview / source view (existing FileView text)
 *   - `metadata`→ metadata-only card + download (no content available)
 *   - `stream`  → streamed media via a same-origin raw URL (native consumer)
 */

export type ProjectUiMode = "render" | "text" | "metadata" | "stream"

export interface ProjectUiBehavior {
  mode: ProjectUiMode
}

/**
 * Frontend-facing resource budgets. These are display/render caps only — they
 * mirror the frozen backend budgets (bounded preview ≤ 256 KiB, retained chars,
 * DOM nodes) so the browser never retains or renders unbounded content. They are
 * NOT a scientific detector: nothing here inspects extensions, magic bytes, or
 * file names.
 */
export const ProjectBudget = {
  /** Max characters the browser retains while rendering a project file view. */
  BROWSER_RETAINED_CHARS: 512 * 1024,
  /** Max DOM nodes a renderer may create for a single project file view. */
  DOM_NODE_CAP: 4096,
  /** Linear sequence residues the wrapper passes to the sequence renderer. The
   * renderer itself caps at 20 000, but a 20 000-residue cell grid exceeds the
   * DOM node budget, so the project wrapper clips to a DOM-safe count. */
  SEQUENCE_MAX_RESIDUES: 3000,
  /** Max MSA rows/columns/cells the wrapper hands to the alignment renderer;
   * larger alignments fall back to the linear sequence / text view instead of
   * being distorted. */
  MSA_MAX_ROWS: 512,
  MSA_MAX_COLS: 4096,
  MSA_MAX_CELLS: 65_536,
  /** Max chars of inline structure text passed to the Mol* renderer. */
  STRUCTURE_MAX_CHARS: 512 * 1024,
  /** Max chars of the bounded text preview shown in the plain-text view. */
  TEXT_PREVIEW_MAX_CHARS: 256 * 1024,
} as const

/**
 * Exhaustive capability × readPolicy → UI mode grid. Every cell is deliberate:
 *   - content-bearing policies (editable-full / bounded-preview) resolve by
 *     capability: sequence/structure may render, table/genome/document/text/
 *     unknown stay in the text view, pdf streams, binary is metadata-only.
 *   - metadata-only always lands in the metadata card.
 *   - streamed-media streams pdf; nothing else is a streamed media family.
 */
export const PROJECT_UI_GRID: Record<ScienceFileCapability, Record<ScienceFileReadPolicy, ProjectUiMode>> = {
  sequence: {
    "editable-full": "render",
    "bounded-preview": "render",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  structure: {
    "editable-full": "render",
    "bounded-preview": "render",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  table: {
    "editable-full": "text",
    "bounded-preview": "text",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  genome: {
    "editable-full": "text",
    "bounded-preview": "text",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  document: {
    "editable-full": "text",
    "bounded-preview": "text",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  pdf: {
    "editable-full": "stream",
    "bounded-preview": "metadata",
    "metadata-only": "metadata",
    "streamed-media": "stream",
  },
  binary: {
    "editable-full": "metadata",
    "bounded-preview": "metadata",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  text: {
    "editable-full": "text",
    "bounded-preview": "text",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
  unknown: {
    "editable-full": "text",
    "bounded-preview": "text",
    "metadata-only": "metadata",
    "streamed-media": "metadata",
  },
}

/** Map a generated inspect result to the UI mode the wrapper should use. */
export function mapInspectToUi(inspect: ScienceFileInspect): ProjectUiBehavior {
  return { mode: PROJECT_UI_GRID[inspect.capability][inspect.readPolicy] }
}

/** Whether the inspect carried bounded text preview content. */
export function hasPreviewContent(inspect: ScienceFileInspect): boolean {
  return inspect.mode === "text" && typeof inspect.preview === "string" && inspect.preview.trim().length > 0
}

/** The bounded text preview carried by a text inspect, or "" for binary. */
export function previewOf(inspect: ScienceFileInspect): string {
  return inspect.mode === "text" && typeof inspect.preview === "string" ? inspect.preview : ""
}

/** True when the inspect preview was truncated by the server budget. */
export function inspectTruncated(inspect: ScienceFileInspect): boolean {
  return inspect.mode === "text" && inspect.truncated === true
}

/** Cap a text string to `maxChars` (defaults to the retained-chars budget). */
export function clipText(text: string, maxChars: number = ProjectBudget.BROWSER_RETAINED_CHARS): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/** Compact human-readable byte size for metadata cards. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return String(size)
  if (size < 1024) return `${size} B`
  const units = ["KB", "MB", "GB", "TB"] as const
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
