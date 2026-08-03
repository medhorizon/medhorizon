import type { Component } from "solid-js"
import type { ScienceFileInspect } from "@synsci/sdk/v2/client"
import type { ArtifactKind, ArtifactRenderProps } from "./renderers/registry"
import { SequenceViewer } from "./renderers/documents/SequenceViewer"
import { MsaViewer } from "./renderers/genomics/MsaViewer"
import { ProteinStructure } from "./renderers/molecular/ProteinStructure"
import { ProjectBudget } from "./files"

/**
 * Project-only renderer registry.
 *
 * Selects a renderer for a *project file* from the generated inspect result +
 * bounded project content. It deliberately carries no session/tool artifact
 * identity and never constructs Research Graph nodes or artifact refs: the
 * payload it builds is pure renderer input (FASTA text / alignment rows /
 * structure text) bounded to a safe budget.
 *
 * A renderer is added by pushing ONE candidate object into `PROJECT_CANDIDATES`
 * with a `build(inspect, content)` that returns the bounded payload or
 * `undefined` when the content cannot be faithfully rendered.
 *
 * v1 exclusions (documented):
 *   - `genome-track` (GenomeTrack) is NOT registered: it needs a same-origin
 *     Range URL + companion index (FAI/BAI/CSI/TBI) pairing that v1 does not
 *     provide, and it shows hg38 sample content on empty input. The genome
 *     family falls back to bounded text/metadata via the wrapper.
 *   - `chem-2d` (Chem2D) is NOT registered: its only input shape is SMILES /
 *     Mol block, and no project format in the backend manifest is a SMILES
 *     file, so it can never be selected from an inspect result.
 *   - FASTQ (`fastq`) has no faithful v1 renderer — the sequence renderer's
 *     FASTA parser would garble quality lines — so it stays in the text view.
 */

export interface FastaRecord {
  id?: string
  seq: string
}

export interface ProjectRendererSelection {
  /** Artifact kind used only to keep the shared renderer props contract; it is
   * not a session/tool artifact identity. */
  kind: ArtifactKind
  component: Component<ArtifactRenderProps>
  /** Bounded renderer payload (renderer-specific shape). */
  payload: unknown
  /** True when the wrapper had to reduce the content to fit a budget. */
  clipped: boolean
}

export interface ProjectRenderCandidate {
  component: Component<ArtifactRenderProps>
  /**
   * Return the bounded payload for this renderer, or `undefined` when the
   * content cannot be faithfully rendered (empty/invalid/over-cap). This is the
   * single extension point for future project renderers.
   */
  build(inspect: ScienceFileInspect, content: string): { kind: ArtifactKind; payload: unknown; clipped: boolean } | undefined
}

/** Strip non-sequence noise (mirrors the sequence renderer's `clean`). */
export function cleanSequence(seq: string): string {
  return seq.replace(/[^A-Za-z\-.*]/g, "").toUpperCase()
}

/**
 * Parse FASTA text into records. A header-less file is treated as a single
 * bare sequence so a minimal `.fa` still renders; an empty/whitespace file
 * yields no records.
 */
export function parseFastaRecords(content: string): FastaRecord[] {
  const records: FastaRecord[] = []
  let current: FastaRecord | undefined
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      if (current) records.push(current)
      current = { id: line.slice(1).trim().split(/\s+/)[0] || undefined, seq: "" }
      continue
    }
    if (current) current.seq += line
  }
  if (current) records.push(current)
  if (records.length === 0) {
    const bare = content.replace(/^\s+/, "").trimEnd()
    if (bare) records.push({ id: undefined, seq: bare })
  }
  return records
}

/** Alignment rows for the MSA renderer, or undefined when the content is not a
 * bounded multi-sequence alignment. Falls through (rather than clamping) when
 * the alignment overflows the MSA budget so a huge FASTA never distorts. */
function msaRows(content: string): { id: string; seq: string }[] | undefined {
  const records = parseFastaRecords(content).map((r) => ({ ...r, seq: cleanSequence(r.seq) }))
  if (records.length < 2) return undefined
  if (records.length > ProjectBudget.MSA_MAX_ROWS) return undefined
  let cols = 0
  let cells = 0
  for (const r of records) {
    cols = Math.max(cols, r.seq.length)
    cells += r.seq.length
  }
  if (cols > ProjectBudget.MSA_MAX_COLS || cells > ProjectBudget.MSA_MAX_CELLS) return undefined
  const rows = records
    .filter((r) => r.seq.length > 0)
    .map((r, i) => ({ id: r.id ?? `seq_${i + 1}`, seq: r.seq }))
  return rows.length >= 2 ? rows : undefined
}

/** Linear-sequence payload for the sequence renderer: the first FASTA record,
 * clipped to a DOM-safe residue budget. Returns undefined for an empty record
 * so the wrapper never mounts the renderer with sample content. */
function buildSequence(
  inspect: ScienceFileInspect,
  content: string,
): { kind: ArtifactKind; payload: unknown; clipped: boolean } | undefined {
  if (inspect.capability !== "sequence" || inspect.format !== "fasta") return undefined
  const first = parseFastaRecords(content)[0]
  const seq = first ? cleanSequence(first.seq) : ""
  if (!seq) return undefined
  const clipped = seq.length > ProjectBudget.SEQUENCE_MAX_RESIDUES
  const shown = seq.slice(0, ProjectBudget.SEQUENCE_MAX_RESIDUES)
  const header = first?.id ? `>${first.id}\n` : ">seq\n"
  return { kind: "sequence", payload: { fasta: header + shown }, clipped }
}

/** MSA payload from a bounded multi-record FASTA alignment. */
function buildMsa(
  inspect: ScienceFileInspect,
  content: string,
): { kind: ArtifactKind; payload: unknown; clipped: boolean } | undefined {
  if (inspect.capability !== "sequence" || inspect.format !== "fasta") return undefined
  const rows = msaRows(content)
  if (!rows) return undefined
  return { kind: "msa", payload: { sequences: rows }, clipped: false }
}

/** Payload keys the Mol* structure renderer accepts for inline text. */
const STRUCTURE_FORMAT_KEYS: Partial<Record<ScienceFileInspect["format"], "pdb" | "mmcif" | "xyz" | "mol" | "sdf">> = {
  pdb: "pdb",
  mmcif: "mmcif",
  xyz: "xyz",
  mol: "mol",
  sdf: "sdf",
}

/** Structure payload for the Mol* renderer from bounded structure text. */
function buildStructure(
  inspect: ScienceFileInspect,
  content: string,
): { kind: ArtifactKind; payload: unknown; clipped: boolean } | undefined {
  if (inspect.capability !== "structure") return undefined
  const key = STRUCTURE_FORMAT_KEYS[inspect.format]
  if (!key) return undefined
  const clipped = content.length > ProjectBudget.STRUCTURE_MAX_CHARS
  const body = clipped ? content.slice(0, ProjectBudget.STRUCTURE_MAX_CHARS) : content
  if (!body.trim()) return undefined
  const kind: ArtifactKind = key === "pdb" || key === "mmcif" ? "protein-structure" : "chem-3d"
  return { kind, payload: { [key]: body }, clipped }
}

/**
 * Ordered candidates. Order matters inside the `sequence` capability: a
 * bounded multi-record FASTA renders as an MSA; otherwise the first record is
 * shown linearly. A new renderer plugs in as one candidate entry.
 */
const PROJECT_CANDIDATES: ProjectRenderCandidate[] = [
  { component: MsaViewer, build: buildMsa },
  { component: SequenceViewer, build: buildSequence },
  { component: ProteinStructure, build: buildStructure },
]

/**
 * Select a project renderer for the generated inspect result and bounded
 * content, or undefined when the file should fall back to the plain text /
 * metadata view. Never mounted with empty/invalid input: every build returns
 * undefined for content that would produce the renderer's sample display.
 */
export function selectProjectRenderer(
  inspect: ScienceFileInspect,
  content: string,
): ProjectRendererSelection | undefined {
  if (inspect.mode !== "text" || !content || content.length === 0) return undefined
  for (const candidate of PROJECT_CANDIDATES) {
    const built = candidate.build(inspect, content)
    if (built) return { kind: built.kind, component: candidate.component, payload: built.payload, clipped: built.clipped }
  }
  return undefined
}
